// tests/rollover-timing.test.js
// A write that lands between midnight on the 1st and the nightly trigger must roll the
// month over first, so the spend is taken from the new month's balance, not lost.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTransaction, deleteTransaction, getState } from '../backend/05_Api.gs.js';
import { dailyRollover } from '../backend/07_Entry.gs.js';
import { installGlobals, createProps } from './helpers/appsScriptGlobals.js';
import { freshWorkbook } from './helpers/fixtures.js';

const TOKEN = 'test-token';
const RID = 'req-0001-aaaa';
const NOW = new Date('2026-10-31T22:30:00Z'); // 00:30 on 1 Nov, household time

function setup({ pockets, txns = [], props = {}, busy = false }) {
  const wb = freshWorkbook(pockets, txns);
  const ss = {
    getSheetByName: (n) => (n === 'Pockets' ? wb.pockets : n === 'Transactions' ? wb.txns : n === 'Monthly_Report' ? wb.report : null),
  };
  let held = false;
  const lockCalls = { tryLock: 0 };
  const lock = {
    tryLock() { lockCalls.tryLock++; if (busy || held) return false; held = true; return true; },
    releaseLock() { held = false; },
  };
  const scriptProps = createProps({ API_TOKEN: TOKEN, ...props });
  const restore = installGlobals({
    ss,
    props: scriptProps,
    lockService: { getScriptLock: () => lock, getUserLock: () => lock },
  });
  globalThis.SpreadsheetApp.flush = () => {};
  globalThis.Logger = { log() {} };
  const balanceOf = (row) => wb.pockets._rows[row][4];
  const cleanup = () => { restore(); delete globalThis.Logger; };
  return { wb, balanceOf, lockCalls, key: () => scriptProps.getProperty('LAST_ROLLOVER_KEY'), restore: cleanup };
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
