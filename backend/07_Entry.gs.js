// backend/07_Entry.gs.js
// CANONICAL SOURCE. `backend/*.gs` is generated from this file by `npm run build`.
// The only file that deals with HTTP event objects.
//
// Companion manifest: backend/appsscript.json. It requests
// spreadsheets.currentonly (NOT .../auth/spreadsheets) because this script only
// ever touches its own bound sheet — ask for the narrowest scope that works.

import { handleRequest } from './05_Api.gs.js';
import { verifyToken, getApiToken, setApiToken, getUsers } from './02_Auth.gs.js';
import {
  readPockets, readTransactions, getReportSheet, ensureSheets, flushWrites,
} from './03_Sheets.gs.js';
import { applyRollover, shouldRollover, monthKey } from './04_Rollover.gs.js';
import { renderReport } from './06_Report.gs.js';
import { writeBalance } from './03_Sheets.gs.js';
import { USERS, USERS_PROPERTY, SHEETS, LOCK_TIMEOUT_MS } from './00_Config.gs.js';

/** Serialize a response as ContentService JSON. */
function json(res) {
  return ContentService.createTextOutput(JSON.stringify(res))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Normalise an Apps Script event into { action, params, parseError }. */
export function parseRequest(e, method) {
  const out = { action: null, params: {}, parseError: false };
  if (!e) return out;

  if (method === 'POST') {
    const raw = (e.postData && e.postData.contents) || '';
    if (!raw) { out.action = 'getState'; return out; }
    try {
      const body = JSON.parse(raw);
      const { action, ...params } = body || {};
      out.action = action || 'getState';
      out.params = params;
    } catch (_) {
      out.parseError = true;
    }
    return out;
  }

  const p = e.parameter || {};
  out.action = p.action || 'getState';
  out.params = p;
  return out;
}

/**
 * GET entry point.
 *
 * NOTE ON TRANSPORT (§0): GET is CORS-safelisted, so no preflight is sent and
 * fetch's default redirect:'follow' handles Apps Script's 302 to
 * script.googleusercontent.com. `token` arrives as a query parameter.
 */
function doGet(e) {
  const r = parseRequest(e, 'GET');
  return json(handleRequest({ action: r.action, params: r.params }));
}

/**
 * POST entry point.
 *
 * CRITICAL (§0): the client sends Content-Type: text/plain, NOT application/json.
 * With application/json the browser sends a CORS preflight, Apps Script has no
 * doOptions, the preflight 405s, and the whole request fails. text/plain is
 * CORS-safelisted so no preflight happens. We JSON.parse the raw body ourselves.
 */
function doPost(e) {
  const r = parseRequest(e, 'POST');
  if (r.parseError) {
    return json({ ok: false, error: 'INVALID_JSON', message: 'Request body was not valid JSON.' });
  }
  return json(handleRequest({ action: r.action, params: r.params }));
}

/* ------------------------------------------------------------- triggers -- */

/**
 * Daily trigger. Idempotent: does nothing if the month has not changed, so a
 * missed run on the 1st self-heals on the 2nd rather than skipping a reset.
 */
export function dailyRollover() {
  const props = PropertiesService.getScriptProperties();
  const lastKey = props.getProperty('LAST_ROLLOVER_KEY');
  const now = new Date();

  if (!lastKey) {
    // No record of ever rolling over: this is either a brand-new install or one set
    // up before the key existed. Either way, resetting now would wipe whatever has
    // been spent so far this month. Record the month and start rolling from the next.
    props.setProperty('LAST_ROLLOVER_KEY', monthKey(now));
    Logger.log('PocketBudget rollover: first run, recorded ' + monthKey(now) + ' without resetting.');
  } else if (shouldRollover(lastKey, now)) {
    // Same lock as every expense: a rollover racing a submission could overwrite
    // the balance that submission had just deducted from. Throwing (rather than
    // skipping) leaves LAST_ROLLOVER_KEY unset, so the next run tries again.
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(LOCK_TIMEOUT_MS)) {
      throw new Error('Rollover postponed: could not get the script lock.');
    }
    try {
      const pockets = readPockets({ includeArchived: true });
      const { pockets: reset, resetCount } = applyRollover(pockets);
      // Compare against the balance as it WAS. `reset` already holds balance ===
      // limit for every active pocket, so testing `p.balance !== p.limit` on it
      // was always false and the rollover wrote nothing to the sheet.
      pockets.forEach((before, i) => {
        const after = reset[i];
        if (after.status === 'Active' && before.balance !== after.balance) {
          writeBalance(after.id, after.balance);
        }
      });
      props.setProperty('LAST_ROLLOVER_KEY', monthKey(now));
      Logger.log('PocketBudget rollover: reset ' + resetCount + ' pockets for ' + monthKey(now));
    } finally {
      try {
        flushWrites();
      } finally {
        lock.releaseLock();
      }
    }
  }

  refreshReport(now);
}

/** Rebuild the Monthly_Report tab from the live sheets. Also on the PocketBudget menu. */
export function refreshReport(now = new Date()) {
  renderReport(getReportSheet(), {
    pockets: readPockets(),
    transactions: readTransactions(),
    now,
    users: getUsers(),
  });
}

/**
 * Simple trigger: adds a PocketBudget menu to the sheet so the report can be
 * refreshed on demand instead of waiting for the nightly run.
 */
function onOpen() {
  try {
    SpreadsheetApp.getUi()
      .createMenu('PocketBudget')
      .addItem('Refresh report', 'refreshReport')
      .addToUi();
  } catch (_) {
    // No UI (a trigger or API run): nothing to add a menu to.
  }
}

/**
 * One-time bootstrap, run from the Apps Script editor:
 *   1. Setup ▸ copy this function, paste into 07_Entry.gs.js, save.
 *   2. Run setup() once and authorise.
 *   3. Delete the call from any menu if you don't want one.
 */
export function setup() {
  const sheets = ensureSheets();
  const existing = getApiToken();
  const token = existing || Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  if (!existing) setApiToken(token);

  // Treat this month as already rolled over, so the first nightly run does not
  // reset balances that have been spent down since setup.
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('LAST_ROLLOVER_KEY')) props.setProperty('LAST_ROLLOVER_KEY', monthKey(new Date()));

  // Make the household member list visible and editable in Project Settings >
  // Script Properties, rather than buried in code.
  if (!props.getProperty(USERS_PROPERTY)) props.setProperty(USERS_PROPERTY, USERS.join(','));

  // Idempotent: running setup() again must not stack a second trigger (two
  // triggers means two rollovers and two report rebuilds a night).
  for (const t of ScriptApp.getProjectTriggers()) {
    if (t.getHandlerFunction() === 'dailyRollover') ScriptApp.deleteTrigger(t);
  }
  ScriptApp.newTrigger('dailyRollover')
    .timeBased()
    .everyDays(1)
    .atHour(2)
    .create();

  Logger.log('Sheets ready: ' + sheets.join(', '));
  Logger.log('Users: ' + getUsers().join(', ') + '  (change with the USERS Script Property)');
  Logger.log('Household token (copy this into the PWA setup screen): ' + token);
}
