// tests/rollover-timing.test.js
// A write that lands between midnight on the 1st and the nightly trigger must roll the
// month over first, so the spend is taken from the new month's balance, not lost.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTransaction, deleteTransaction, getState, rolloverIfDue } from '../backend/05_Api.gs.js';
import { dailyRollover } from '../backend/07_Entry.gs.js';
import { installGlobals, createProps } from './helpers/appsScriptGlobals.js';
import { freshWorkbook, createSheet, v2Pocket } from './helpers/fixtures.js';

const TOKEN = 'test-token';
const RID = 'req-0001-aaaa';
const NOW = new Date('2026-10-31T22:30:00Z'); // 00:30 on 1 Nov, household time
const ADJ_HEADER = [
  'Adj ID', 'Timestamp', 'User', 'Month', 'Type', 'From Pocket', 'To Pocket',
  'Amount', 'Note', 'Request ID', 'Account ID',
];

function setup({ pockets, txns = [], props = {}, busy = false, adjustments = false }) {
  const wb = freshWorkbook(pockets, txns);
  const adj = adjustments ? createSheet('Adjustments', [ADJ_HEADER]) : null;
  const ss = {
    getSheetByName: (n) => (n === 'Pockets' ? wb.pockets : n === 'Transactions' ? wb.txns : n === 'Monthly_Report' ? wb.report : n === 'Adjustments' ? adj : null),
  };
  let held = false;
  const lockCalls = { tryLock: 0 };
  const lock = {
    tryLock() { lockCalls.tryLock++; if (busy || held) return false; held = true; return true; },
    releaseLock() { held = false; },
  };
  const scriptProps = createProps({ API_TOKEN: TOKEN, USERS: 'Alex,Sam', ...props });
  const restore = installGlobals({
    ss,
    props: scriptProps,
    lockService: { getScriptLock: () => lock, getUserLock: () => lock },
  });
  globalThis.SpreadsheetApp.flush = () => {};
  const logs = [];
  globalThis.Logger = { log: (m) => logs.push(String(m)) };
  const balanceOf = (row) => wb.pockets._rows[row][4];
  const cleanup = () => { restore(); delete globalThis.Logger; };
  return { wb, adj, logs, balanceOf, lockCalls, key: () => scriptProps.getProperty('LAST_ROLLOVER_KEY'), restore: cleanup };
}

const GROCERIES = ['P01', 'Groceries', 'Chase', 800, 0, 'Active'];

test('an expense just after midnight on the 1st rolls over first, then deducts', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const s = setup({ pockets: [GROCERIES], props: { LAST_ROLLOVER_KEY: '2026-10' } });
  const r = createTransaction({ token: TOKEN, user: 'Alex', pocketId: 'P01', amount: 50, requestId: RID });

  assert.equal(r.ok, true);
  assert.equal(s.balanceOf(1), 750);
  assert.equal(s.key(), '2026-11');
  s.restore();
});

test('the 02:00 trigger after such an expense does not undo it', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const s = setup({ pockets: [GROCERIES], props: { LAST_ROLLOVER_KEY: '2026-10' } });
  createTransaction({ token: TOKEN, user: 'Alex', pocketId: 'P01', amount: 50, requestId: RID });
  dailyRollover();

  assert.equal(s.balanceOf(1), 750);
  s.restore();
});

test('within the same month, an expense leaves the other pockets alone', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const s = setup({
    pockets: [['P01', 'Groceries', 'Chase', 800, 100, 'Active'], ['P02', 'Dining', 'Chase', 250, 15, 'Active']],
    props: { LAST_ROLLOVER_KEY: '2026-11' },
  });
  const r = createTransaction({ token: TOKEN, user: 'Alex', pocketId: 'P01', amount: 10, requestId: RID });

  assert.equal(r.ok, true);
  assert.equal(s.balanceOf(1), 90);
  assert.equal(s.balanceOf(2), 15, 'the other pocket is untouched');
  s.restore();
});

test('deleting a transaction in a new month also rolls over first', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const s = setup({
    pockets: [['P01', 'Groceries', 'Chase', 800, 700, 'Active'], ['P02', 'Dining', 'Chase', 250, 15, 'Active']],
    txns: [['T1001', new Date('2026-10-20T10:00:00Z'), 'Alex', 'P01', 100, 'Shop']],
    props: { LAST_ROLLOVER_KEY: '2026-10' },
  });
  const r = deleteTransaction({ token: TOKEN, txnId: 'T1001' });

  assert.equal(r.ok, true);
  assert.equal(s.key(), '2026-11');
  assert.equal(s.balanceOf(2), 250, 'the other pocket was reset by the rollover');
  s.restore();
});

test('getState in a new month rolls over: balance reset, key updated', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const s = setup({
    pockets: [['P01', 'Groceries', 'Chase', 800, 100, 'Active']],
    props: { LAST_ROLLOVER_KEY: '2026-10' },
  });
  const r = getState({ token: TOKEN });

  assert.equal(r.ok, true);
  assert.equal(s.balanceOf(1), 800);
  assert.equal(s.key(), '2026-11');
  s.restore();
});

test('getState in the same month never takes the lock', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const s = setup({
    pockets: [['P01', 'Groceries', 'Chase', 800, 100, 'Active']],
    props: { LAST_ROLLOVER_KEY: '2026-11' },
  });
  const r = getState({ token: TOKEN });

  assert.equal(r.ok, true);
  assert.equal(s.lockCalls.tryLock, 0);
  assert.equal(s.balanceOf(1), 100);
  s.restore();
});

test('getState with the lock busy still returns ok and rolls nothing over', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const s = setup({
    pockets: [['P01', 'Groceries', 'Chase', 800, 100, 'Active']],
    props: { LAST_ROLLOVER_KEY: '2026-10' },
    busy: true,
  });
  const r = getState({ token: TOKEN });

  assert.equal(r.ok, true);
  assert.equal(s.lockCalls.tryLock, 1);
  assert.equal(s.balanceOf(1), 100);
  assert.equal(s.key(), '2026-10');
  s.restore();
});

const V2_POCKETS = [
  v2Pocket({ id: 'P01', name: 'Groceries', limit: 800, balance: 120.5, rule: 'Carry' }),
  v2Pocket({ id: 'P02', name: 'Dining', limit: 250, balance: 40, rule: 'Reset', carriedIn: 15 }),
  v2Pocket({ id: 'P03', name: 'Fun', limit: 100, balance: 30, rule: 'Sweep', sweepTo: 'P04' }),
  v2Pocket({ id: 'P04', name: 'Savings', limit: 0, balance: 500, rule: 'Carry', kind: 'Savings' }),
  v2Pocket({ id: 'P05', name: 'Old', limit: 60, balance: 20, status: 'Archived', rule: 'Carry', carriedIn: 5 }),
];

const adjustmentFields = (rows) => rows.slice(1).map((r) => ({
  user: r[2], month: r[3], type: r[4], from: r[5], to: r[6], amount: r[7], note: r[8],
}));

test('rolloverIfDue in a new month stores balances, Carried In and the adjustment rows', () => {
  const s = setup({ pockets: V2_POCKETS, props: { LAST_ROLLOVER_KEY: '2026-10' }, adjustments: true });
  try {
    assert.equal(rolloverIfDue(NOW), true);

    const rows = s.wb.pockets._rows;
    assert.deepEqual([rows[1][4], rows[1][8]], [920.5, 120.5], 'Carry keeps the leftover');
    assert.deepEqual([rows[2][4], rows[2][8]], [250, 0], 'Reset goes back to the limit and clears Carried In');
    assert.deepEqual([rows[3][4], rows[3][8]], [100, 0], 'Sweep goes back to the limit');
    assert.deepEqual([rows[4][4], rows[4][8]], [530, 500], 'the target holds its own carry plus the swept amount');
    assert.deepEqual([rows[5][4], rows[5][8]], [20, 5], 'an archived pocket is not touched');
    assert.equal(s.key(), '2026-11');

    const note = 'Left over from October';
    assert.deepEqual(adjustmentFields(s.adj._rows), [
      { user: 'system', month: '2026-11', type: 'carry', from: '', to: 'P01', amount: 120.5, note },
      { user: 'system', month: '2026-11', type: 'forfeit', from: 'P02', to: '', amount: 40, note },
      { user: 'system', month: '2026-11', type: 'sweep', from: 'P03', to: 'P04', amount: 30, note },
      { user: 'system', month: '2026-11', type: 'carry', from: '', to: 'P04', amount: 500, note },
    ]);
    assert.deepEqual(s.adj._rows.slice(1).map((r) => r[0]), ['A1001', 'A1002', 'A1003', 'A1004']);
    s.adj._rows.slice(1).forEach((r) => assert.equal(r[1].getTime(), NOW.getTime()));
  } finally {
    s.restore();
  }
});

test('a second rolloverIfDue in the same month changes nothing', () => {
  const s = setup({ pockets: V2_POCKETS, props: { LAST_ROLLOVER_KEY: '2026-10' }, adjustments: true });
  try {
    rolloverIfDue(NOW);
    const pocketsAfter = JSON.stringify(s.wb.pockets._rows);
    const adjAfter = JSON.stringify(s.adj._rows);

    assert.equal(rolloverIfDue(new Date('2026-11-05T09:00:00Z')), false);
    assert.equal(JSON.stringify(s.wb.pockets._rows), pocketsAfter);
    assert.equal(JSON.stringify(s.adj._rows), adjAfter);
  } finally {
    s.restore();
  }
});

test('with no Adjustments sheet the balances still roll and nothing throws', () => {
  const s = setup({ pockets: V2_POCKETS, props: { LAST_ROLLOVER_KEY: '2026-10' } });
  try {
    assert.doesNotThrow(() => rolloverIfDue(NOW));

    const rows = s.wb.pockets._rows;
    assert.deepEqual([rows[1][4], rows[1][8]], [920.5, 120.5]);
    assert.deepEqual([rows[4][4], rows[4][8]], [530, 500]);
    assert.equal(s.key(), '2026-11');
    assert.ok(s.logs.some((m) => m.includes('Adjustments sheet is missing')), 'the skipped rows are logged');
  } finally {
    s.restore();
  }
});
