// backend/03_Sheets.gs.js
// CANONICAL SOURCE. The ONLY module that touches SpreadsheetApp.

import { SHEETS, REQUEST_ID_LOOKBACK_ROWS } from './00_Config.gs.js';
import { nextPocketId, nextTransactionId, isValidPocketId, balanceAfterLimitChange, escapeCell } from './01_Utils.gs.js';

/** Script Properties holding the highest pocket / transaction number ever issued. */
const PROP_LAST_POCKET = 'LAST_POCKET_NUM';
const PROP_LAST_TXN = 'LAST_TXN_NUM';

function lastIssued(key) {
  return Number(PropertiesService.getScriptProperties().getProperty(key)) || 0;
}

/* --------------------------------------------------------------- plumbing -- */

function ss() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

export function getPocketSheet() {
  const s = ss().getSheetByName(SHEETS.POCKETS);
  if (!s) throw new Error('Missing sheet: ' + SHEETS.POCKETS);
  return s;
}

export function getTransactionSheet() {
  const s = ss().getSheetByName(SHEETS.TRANSACTIONS);
  if (!s) throw new Error('Missing sheet: ' + SHEETS.TRANSACTIONS);
  return s;
}

export function getReportSheet() {
  const s = ss().getSheetByName(SHEETS.REPORT);
  if (!s) throw new Error('Missing sheet: ' + SHEETS.REPORT);
  return s;
}

/** Rows below the header, skipping fully-blank rows. */
function dataRows(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const values = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
  return values.filter((r) => r.some((c) => c !== '' && c != null));
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const isoDate = (v) => {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string' && v) {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return null;
};

/* ------------------------------------------------------------------ reads -- */

/** All pockets as typed objects. Archived pockets are hidden unless requested. */
export function readPockets({ includeArchived = false } = {}) {
  return dataRows(getPocketSheet()).map((r) => ({
    id: String(r[0]),
    name: String(r[1]),
    account: String(r[2]),
    limit: num(r[3]),
    balance: num(r[4]),
    status: String(r[5] || 'Active'),
  })).filter((p) => includeArchived || p.status !== 'Archived');
}

/** Transactions newest-first, optionally capped. */
export function readTransactions({ limit = 0 } = {}) {
  const txns = dataRows(getTransactionSheet()).map((r) => ({
    id: String(r[0]),
    timestamp: isoDate(r[1]),
    user: String(r[2]),
    pocketId: String(r[3]),
    amount: num(r[4]),
    note: String(r[5] || ''),
  }));
  txns.sort((a, b) => {
    const at = a.timestamp || '', bt = b.timestamp || '';
    if (at === bt) return b.id.localeCompare(a.id);
    return bt.localeCompare(at);
  });
  return limit > 0 ? txns.slice(0, limit) : txns;
}

/** 1-based sheet row for a pocket ID (header is row 1), or 0 if not found. */
export function findPocketRow(pocketId) {
  const sheet = getPocketSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === pocketId) return i + 2;
  }
  return 0;
}

/** 1-based sheet row for a transaction ID, or 0 if not found. */
function findTransactionRow(txnId) {
  const sheet = getTransactionSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === txnId) return i + 2;
  }
  return 0;
}

/**
 * Look for an already-recorded transaction carrying this `requestId`, among the
 * newest rows only. Used to make a retried expense idempotent: when the first
 * attempt committed but its response was lost, the retry finds it here instead
 * of spending the money a second time.
 */
export function findTransactionByRequestId(requestId, lookback = REQUEST_ID_LOOKBACK_ROWS) {
  if (!requestId) return null;
  const sheet = getTransactionSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2 || sheet.getLastColumn() < 7) return null;
  const first = Math.max(2, lastRow - lookback + 1);
  const rows = sheet.getRange(first, 1, lastRow - first + 1, 7).getValues();
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    if (String(r[6]) !== requestId) continue;
    return {
      id: String(r[0]),
      timestamp: isoDate(r[1]),
      user: String(r[2]),
      pocketId: String(r[3]),
      amount: num(r[4]),
      note: String(r[5] || ''),
    };
  }
  return null;
}

/** A transaction's `{ id, timestamp, pocketId, amount }` WITHOUT removing it, or null if absent. */
export function getTransactionRecord(txnId) {
  const row = findTransactionRow(txnId);
  if (!row) return null;
  const vals = getTransactionSheet().getRange(row, 1, 1, 6).getValues()[0];
  return { id: String(vals[0]), timestamp: isoDate(vals[1]), pocketId: String(vals[3]), amount: num(vals[4]) };
}

/**
 * Push every pending write to the spreadsheet. Apps Script may buffer writes,
 * and a lock released before they land lets the next request read the old
 * balance — which is exactly the lost update the lock exists to prevent. Call
 * this before releasing the script lock.
 */
export function flushWrites() {
  SpreadsheetApp.flush();
}

/* ----------------------------------------------------------------- writes -- */

/** Set a pocket's Current Balance (column E). */
export function writeBalance(pocketId, balance) {
  const row = findPocketRow(pocketId);
  if (!row) throw new Error('Pocket not found: ' + pocketId);
  getPocketSheet().getRange(row, 5).setValue(balance);
  return balance;
}

export function appendPocket({ name, account, limit }) {
  const sheet = getPocketSheet();
  const id = issueId(nextPocketIdFromSheet(), PROP_LAST_POCKET);
  // escapeCell: a name like =IMPORTDATA(...) would otherwise be stored as a live formula.
  sheet.appendRow([id, escapeCell(name), escapeCell(account), limit, limit, 'Active']);
  return { id, name, account, limit, balance: limit, status: 'Active' };
}

export function updatePocketRow(pocketId, { name, account, limit, status }) {
  const row = findPocketRow(pocketId);
  if (!row) throw new Error('Pocket not found: ' + pocketId);
  const sheet = getPocketSheet();
  if (name != null) sheet.getRange(row, 2).setValue(escapeCell(name));
  if (account != null) sheet.getRange(row, 3).setValue(escapeCell(account));
  if (limit != null) {
    const oldLimit = num(sheet.getRange(row, 4).getValues()[0][0]);
    const cur = num(sheet.getRange(row, 5).getValues()[0][0]);
    sheet.getRange(row, 4).setValue(limit);
    // The balance moves with the limit (see balanceAfterLimitChange).
    sheet.getRange(row, 5).setValue(balanceAfterLimitChange(cur, oldLimit, limit));
  }
  if (status != null) sheet.getRange(row, 6).setValue(status);
  return readPockets({ includeArchived: true }).find((p) => p.id === pocketId) || null;
}

export function archivePocketRow(pocketId) {
  return updatePocketRow(pocketId, { status: 'Archived' });
}

/** Append a transaction. Returns the new transaction ID. */
export function appendTransaction({ user, pocketId, amount, note, timestamp, requestId }) {
  const sheet = getTransactionSheet();
  const id = issueId(nextTransactionIdFromSheet(), PROP_LAST_TXN);
  sheet.appendRow([id, timestamp || new Date(), user, pocketId, amount, escapeCell(note), requestId || '']);
  if (requestId) {
    // Sheets created before idempotency existed have no 7th header.
    const header = sheet.getRange(1, 7);
    if (header.getValues()[0][0] === '') header.setValue('Request ID');
  }
  return id;
}

/**
 * Delete a transaction row.
 * Returns `{ id, pocketId, amount }` so the caller can refund the pocket, or null if absent.
 */
export function deleteTransactionRow(txnId) {
  const row = findTransactionRow(txnId);
  if (!row) return null;
  const sheet = getTransactionSheet();
  const vals = sheet.getRange(row, 1, 1, 6).getValues()[0];
  const record = {
    id: String(vals[0]),
    pocketId: String(vals[3]),
    amount: num(vals[4]),
  };
  sheet.deleteRow(row);
  return record;
}

/** Record that an ID has been handed out, so it can never be issued again. */
function issueId(id, propertyKey) {
  PropertiesService.getScriptProperties().setProperty(propertyKey, String(parseInt(String(id).slice(1), 10)));
  return id;
}

/** The ID the next pocket will get: above every row AND every ID ever issued. Does not reserve it. */
export function nextPocketIdFromSheet() {
  const rows = dataRows(getPocketSheet());
  return nextPocketId(rows.map((r) => String(r[0])), lastIssued(PROP_LAST_POCKET));
}

/** The ID the next transaction will get; see nextPocketIdFromSheet. */
export function nextTransactionIdFromSheet() {
  const rows = dataRows(getTransactionSheet());
  return nextTransactionId(rows.map((r) => String(r[0])), lastIssued(PROP_LAST_TXN));
}

/* -------------------------------------------------------------- bootstrap -- */

/** Create the three sheets with headers if they do not exist. Run once from `setup()`. */
export function ensureSheets() {
  const created = [];
  const wanted = {
    [SHEETS.POCKETS]: ['Pocket ID', 'Pocket Name', 'Bank Account', 'Monthly Limit', 'Current Balance', 'Status'],
    [SHEETS.TRANSACTIONS]: ['Transaction ID', 'Timestamp', 'User / Spouse', 'Pocket ID', 'Amount', 'Merchant / Note', 'Request ID'],
    [SHEETS.REPORT]: [],
  };
  for (const [name, headers] of Object.entries(wanted)) {
    const sheet = ss().getSheetByName(name) || ss().insertSheet(name);
    if (headers.length && sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.setFrozenRows(1);
    }
    created.push(name);
  }
  return created;
}