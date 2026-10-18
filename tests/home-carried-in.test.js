// tests/home-carried-in.test.js
// End to end: a Carry pocket rolls over a month boundary with leftover money, the real
// getState handler answers, and that payload feeds the real Home rendering. What Home
// shows must agree with the Pocket detail figures from getPocket.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getState, getPocket } from '../backend/05_Api.gs.js';
import { installGlobals, createProps } from './helpers/appsScriptGlobals.js';
import { freshWorkbook, createSheet, v2Pocket } from './helpers/fixtures.js';
import { pocketRowHtml, summaryHtml } from '../app/js/render.js';

const TOKEN = 'test-token';
const ADJ_HEADER = [
  'Adj ID', 'Timestamp', 'User', 'Month', 'Type', 'From Pocket', 'To Pocket',
  'Amount', 'Note', 'Request ID', 'Account ID',
];

function setup(props = {}) {
  const wb = freshWorkbook([
    v2Pocket({ id: 'P01', name: 'Groceries', account: 'Chase', limit: 1000, balance: 200, rule: 'Carry' }),
    v2Pocket({ id: 'P02', name: 'Dining Out', account: 'Card', limit: 300, balance: 300, rule: 'Reset' }),
  ], []);
  const adj = createSheet('Adjustments', [ADJ_HEADER]);
  const sheets = { Pockets: wb.pockets, Transactions: wb.txns, Monthly_Report: wb.report, Adjustments: adj };
  const ss = { getSheetByName: (n) => sheets[n] || null, insertSheet: (n) => createSheet(n, []) };
  let held = false;
  const lock = {
    tryLock() { if (held) return false; held = true; return true; },
    releaseLock() { held = false; },
  };
  const restore = installGlobals({
    ss,
    props: createProps({ API_TOKEN: TOKEN, LAST_ROLLOVER_KEY: '2026-09', ...props }),
    lockService: { getScriptLock: () => lock, getUserLock: () => lock },
  });
  globalThis.SpreadsheetApp.flush = () => {};
  globalThis.Logger = { log() {} };
  return { wb, restore: () => { restore(); delete globalThis.Logger; } };
}

const text = (html) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * The Home screen for a getState payload, as plain text: one string per pocket row and the
 * summary. Pocket P01 has R1,000 limit and R200 left over from September; P02 resets.
 */
function rollOverAndRender(t, { dropNewSummaryFields = false } = {}) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-05T10:00:00Z') });
  const { restore } = setup();
  try {
    const state = getState({ token: TOKEN });
    const details = Object.fromEntries(['P01', 'P02'].map((id) => [id, getPocket({ token: TOKEN, pocketId: id })]));
    // An older deployed backend sends the same pockets but not the summary fields added later.
    const summary = dropNewSummaryFields ? { ...state.summary, totalAvailable: undefined } : state.summary;
    return {
      state,
      details,
      rows: Object.fromEntries(state.pockets.map((p) => [p.id, text(pocketRowHtml(p, null, { month: state.month }))])),
      summaryText: text(summaryHtml(summary, state.pockets, null)),
    };
  } finally { restore(); }
}

test('Home agrees with the Pocket detail after a Carry rollover with money carried in', (t) => {
  const { state, details, rows, summaryText } = rollOverAndRender(t);
  assert.equal(details.P01.breakdown.limit, 1000);
  assert.equal(details.P01.breakdown.carriedIn, 200);
  assert.equal(details.P01.breakdown.left, 1200);
  assert.ok(rows.P01.includes('R1,200'), rows.P01);
  assert.ok(!rows.P01.includes('R2,'), rows.P01);

  const left = details.P01.breakdown.left + details.P02.breakdown.left;
  const budget = details.P01.breakdown.limit + details.P01.breakdown.carriedIn
    + details.P02.breakdown.limit + details.P02.breakdown.carriedIn;
  assert.equal(left, 1500);
  assert.ok(summaryText.includes('Left this month R1,500 of R' + budget.toLocaleString('en-US')), summaryText);
  assert.ok(summaryText.includes('includes R200 carried in'), summaryText);
  assert.equal(state.pockets.find((p) => p.id === 'P01').balance, details.P01.breakdown.left);
});

test('Home measures money left against limit plus carried-in even when the backend sends no totalAvailable', (t) => {
  const { summaryText } = rollOverAndRender(t, { dropNewSummaryFields: true });
  assert.ok(summaryText.includes('Left this month R1,500 of R1,500'), summaryText);
  assert.ok(summaryText.includes('100%'), summaryText);
});

test('carried-in money is never counted as negative spending in getState', (t) => {
  const { state } = rollOverAndRender(t);
  const p = state.pockets.find((x) => x.id === 'P01');
  assert.equal(p.spent, 0);
  assert.equal(p.pctUsed, 0);
  assert.equal(state.summary.totalSpent, 0);
});
