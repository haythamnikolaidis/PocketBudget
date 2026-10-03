// tests/money-path.test.js
// The guarantees around the writes that move money:
//
//   Idempotency  a retried expense (same requestId) is recorded and deducted ONCE
//   Flush        buffered writes are pushed to the sheet BEFORE the lock is released
//   Atomicity    a failure part-way never leaves a deduction without a record, or a
//                refund without a deleted transaction
//
// The fake sheet is rigged to fail at the exact step each test names.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTransaction, createPocket, deleteTransaction, updatePocket, handleRequest } from '../backend/05_Api.gs.js';
import { dailyRollover } from '../backend/07_Entry.gs.js';
import { installGlobals, createProps } from './helpers/appsScriptGlobals.js';
import { freshWorkbook } from './helpers/fixtures.js';

const TOKEN = 'test-token';
const RID = 'req-0001-aaaa';

/** A real exclusive lock that logs 'release', plus a flush that logs 'flush'. */
function setup({ pockets = [['P01', 'Groceries', 'Chase', 800, 100, 'Active']], txns = [], props = {} } = {}) {
  const wb = freshWorkbook(pockets, txns);
  const ss = {
    getSheetByName: (n) => (n === 'Pockets' ? wb.pockets : n === 'Transactions' ? wb.txns : n === 'Monthly_Report' ? wb.report : null),
  };
  const events = [];
  let held = false;
  const lock = {
    tryLock() { if (held) return false; held = true; events.push('lock'); return true; },
    releaseLock() { held = false; events.push('release'); },
  };
  const restore = installGlobals({
    ss,
    props: createProps({ API_TOKEN: TOKEN, ...props }),
    lockService: { getScriptLock: () => lock, getUserLock: () => lock },
  });
  globalThis.SpreadsheetApp.flush = () => { events.push('flush'); };
  globalThis.Logger = { log() {} };
  const balance = () => wb.pockets._rows[1][4];
  const cleanup = () => { restore(); delete globalThis.Logger; };
  return { wb, events, lock, balance, restore: cleanup, hold: () => { held = true; } };
}

const spend = (over = {}) => createTransaction({
  token: TOKEN, user: 'Alex', pocketId: 'P01', amount: 10, requestId: RID, ...over,
});

/** Through the dispatcher, as production calls it: a thrown fault becomes an error envelope. */
const viaDispatcher = (action, params) => handleRequest({ action, params: { token: TOKEN, ...params } });
const spendSafely = (over = {}) => viaDispatcher('createTransaction', {
  user: 'Alex', pocketId: 'P01', amount: 10, requestId: RID, ...over,
});

/* ------------------------------------------------------------ idempotency -- */

test('IDEMPOTENCY: the same requestId is recorded and deducted once', () => {
  const { restore, wb, balance } = setup();
  const first = spend();
  const second = spend();

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(second.duplicate, true, 'the retry is flagged as a replay');
  assert.equal(second.transaction.id, first.transaction.id, 'the retry returns the ORIGINAL transaction');
  assert.equal(balance(), 90, 'deducted once, not twice');
  assert.equal(wb.txns._rows.length, 2, 'header + one transaction');
  restore();
});

test('IDEMPOTENCY: different requestIds are different expenses', () => {
  const { restore, balance } = setup();
  spend({ requestId: 'req-0001-aaaa' });
  spend({ requestId: 'req-0002-bbbb' });
  assert.equal(balance(), 80);
  restore();
});

test('IDEMPOTENCY: with no requestId nothing is deduplicated (older clients keep working)', () => {
  const { restore, balance } = setup();
  spend({ requestId: undefined });
  spend({ requestId: undefined });
  assert.equal(balance(), 80);
  restore();
});

test('IDEMPOTENCY: a replay still answers when the original would now be refused', () => {
  const { restore, balance } = setup({ pockets: [['P01', 'Groceries', 'Chase', 800, 10, 'Active']] });
  assert.equal(spend({ amount: 10 }).ok, true);   // balance is now 0
  const again = spend({ amount: 10 });
  assert.equal(again.ok, true, 'not INSUFFICIENT_FUNDS: this is the same expense, already paid');
  assert.equal(again.duplicate, true);
  assert.equal(balance(), 0);
  restore();
});

test('IDEMPOTENCY: reusing a requestId for a different expense is refused and changes nothing', () => {
  const { restore, balance } = setup();
  spend({ amount: 10 });
  const r = spend({ amount: 25 });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'INVALID_REQUEST');
  assert.equal(balance(), 90);
  restore();
});

test('IDEMPOTENCY: a malformed requestId is rejected before anything is written', () => {
  const { restore, wb, balance } = setup();
  for (const bad of ['short', 'has spaces in it', 'x'.repeat(65), '=HYPERLINK("x")']) {
    const r = spend({ requestId: bad });
    assert.equal(r.ok, false, bad);
    assert.equal(r.error, 'INVALID_REQUEST', bad);
  }
  assert.equal(balance(), 100);
  assert.equal(wb.txns._rows.length, 1);
  restore();
});

test('IDEMPOTENCY: the requestId is stored beside the transaction and the column is labelled', () => {
  const { restore, wb } = setup();
  spend();
  assert.equal(wb.txns._rows[1][6], RID);
  assert.equal(wb.txns._rows[0][6], 'Request ID');
  restore();
});

/* ------------------------------------------------------------------ flush -- */

test('FLUSH: writes are flushed immediately before the lock is released, on every path', () => {
  const cases = {
    'success': (s) => spend(),
    'insufficient funds': (s) => spend({ amount: 9999, requestId: 'req-0009-zzzz' }),
    'unknown pocket': (s) => spend({ pocketId: 'P99' }),
    'replay': (s) => { spend(); s.events.length = 0; return spend(); },
    'createPocket': (s) => createPocket({ token: TOKEN, name: 'Fuel', account: '', limit: 50 }),
    'updatePocket': (s) => updatePocket({ token: TOKEN, pocketId: 'P01', name: 'Food' }),
    'deleteTransaction': (s) => { const t = spend(); s.events.length = 0; return deleteTransaction({ token: TOKEN, txnId: t.transaction.id }); },
  };
  for (const [label, run] of Object.entries(cases)) {
    const s = setup();
    run(s);
    assert.deepEqual(s.events.slice(-2), ['flush', 'release'], `${label}: ${s.events.join(',')}`);
    s.restore();
  }
});

test('FLUSH: the lock is still released if the flush itself throws', () => {
  const s = setup();
  globalThis.SpreadsheetApp.flush = () => { throw new Error('flush failed'); };
  const r = viaDispatcher('createTransaction', { user: 'Alex', pocketId: 'P01', amount: 5 });
  assert.equal(r.ok, false, 'the fault is reported, not swallowed');
  assert.equal(s.events.at(-1), 'release');
  s.restore();
});

test('FLUSH: the rollover takes the same lock, flushes, and releases', () => {
  const s = setup({ pockets: [['P01', 'Groceries', 'Chase', 800, 100, 'Active']], props: { LAST_ROLLOVER_KEY: '2026-01' } });
  dailyRollover();
  assert.equal(s.balance(), 800, 'rolled over to the limit');
  const tail = s.events.slice(s.events.indexOf('lock'));
  assert.deepEqual(tail.slice(0, 3), ['lock', 'flush', 'release'], tail.join(','));
  s.restore();
});

test('FLUSH: a rollover that cannot get the lock changes nothing and will retry', () => {
  const s = setup({ pockets: [['P01', 'Groceries', 'Chase', 800, 100, 'Active']], props: { LAST_ROLLOVER_KEY: '2026-01' } });
  s.hold();   // an expense is mid-flight
  assert.throws(() => dailyRollover(), /script lock/);
  assert.equal(s.balance(), 100, 'balances untouched');
  assert.equal(globalThis.PropertiesService.getScriptProperties().getProperty('LAST_ROLLOVER_KEY'), '2026-01',
    'the month is not marked done, so the next run retries');
  s.restore();
});

/* ------------------------------------------------------------- atomicity -- */

test('ATOMIC: if recording the transaction fails, the balance is not touched', () => {
  const s = setup();
  s.wb.txns.appendRow = () => { throw new Error('append failed'); };
  const r = spendSafely();
  assert.equal(r.ok, false);
  assert.equal(s.balance(), 100, 'no deduction without a record');
  s.restore();
});

test('ATOMIC: if the balance write fails, the just-added transaction is removed again', () => {
  const s = setup();
  const realGetRange = s.wb.pockets.getRange.bind(s.wb.pockets);
  s.wb.pockets.getRange = (row, col, ...rest) => {
    const range = realGetRange(row, col, ...rest);
    if (col === 5) range.setValue = () => { throw new Error('balance write failed'); };
    return range;
  };
  const r = spendSafely();
  assert.equal(r.ok, false);
  assert.match(r.message, /balance write failed/);
  assert.equal(s.wb.txns._rows.length, 1, 'no orphan transaction');
  assert.equal(s.balance(), 100);
  s.restore();
});

test('ATOMIC: the server stamps the time; a client timestamp is ignored (even a malformed one)', () => {
  const s = setup();
  const before = Date.now();
  const r = spend({ timestamp: '1999-01-01T00:00:00Z' });
  const bad = spend({ timestamp: 'not a date', requestId: 'req-0002-bbbb' });
  assert.equal(r.ok, true);
  assert.equal(bad.ok, true, 'a junk timestamp can no longer break a write that has moved money');
  const stored = s.wb.txns._rows[1][1];
  assert.ok(stored instanceof Date && stored.getTime() >= before, 'stored time is the server time');
  assert.equal(r.transaction.timestamp, stored.toISOString(), 'the reply matches what was stored');
  s.restore();
});

test('ATOMIC delete: if the refund fails, the transaction is kept', () => {
  const s = setup({ pockets: [['P01', 'Groceries', 'Chase', 800, 90, 'Active']],
    txns: [['T1001', new Date(), 'Alex', 'P01', 10, '']] });
  const realGetRange = s.wb.pockets.getRange.bind(s.wb.pockets);
  s.wb.pockets.getRange = (row, col, ...rest) => {
    const range = realGetRange(row, col, ...rest);
    if (col === 5) range.setValue = () => { throw new Error('refund failed'); };
    return range;
  };
  const r = viaDispatcher('deleteTransaction', { txnId: 'T1001' });
  assert.equal(r.ok, false);
  assert.equal(s.wb.txns._rows.length, 2, 'the transaction is still there');
  assert.equal(s.balance(), 90);
  s.restore();
});

test('ATOMIC delete: if removing the row fails, the refund is undone', () => {
  const s = setup({ pockets: [['P01', 'Groceries', 'Chase', 800, 90, 'Active']],
    txns: [['T1001', new Date(), 'Alex', 'P01', 10, '']] });
  s.wb.txns.deleteRow = () => { throw new Error('delete failed'); };
  const r = viaDispatcher('deleteTransaction', { txnId: 'T1001' });
  assert.equal(r.ok, false);
  assert.equal(s.balance(), 90, 'no free money when the transaction survives');
  assert.equal(s.wb.txns._rows.length, 2);
  s.restore();
});

test('ATOMIC delete: the happy path still refunds and removes', () => {
  const s = setup({ pockets: [['P01', 'Groceries', 'Chase', 800, 90, 'Active']],
    txns: [['T1001', new Date(), 'Alex', 'P01', 10, '']] });
  const r = deleteTransaction({ token: TOKEN, txnId: 'T1001' });
  assert.equal(r.ok, true);
  assert.equal(s.balance(), 100);
  assert.equal(s.wb.txns._rows.length, 1);
  s.restore();
});

/* --------------------------------------------------------------- rollover -- */

test('ROLLOVER: balances are actually written back to the limit, archived pockets are left alone', () => {
  const s = setup({
    pockets: [
      ['P01', 'Groceries', 'Chase', 800, 100, 'Active'],
      ['P02', 'Fuel', 'Chase', 300, 0, 'Active'],
      ['P03', 'Old', 'Chase', 50, 5, 'Archived'],
    ],
    props: { LAST_ROLLOVER_KEY: '2026-01' },
  });
  dailyRollover();
  assert.deepEqual(s.wb.pockets._rows.slice(1).map((r) => r[4]), [800, 300, 5]);
  s.restore();
});

test('ROLLOVER: running again in the same month does not reset spending', () => {
  const s = setup({ pockets: [['P01', 'Groceries', 'Chase', 800, 800, 'Active']], props: { LAST_ROLLOVER_KEY: '2026-01' } });
  dailyRollover();
  createTransaction({ token: TOKEN, user: 'Alex', pocketId: 'P01', amount: 100 });
  dailyRollover();
  assert.equal(s.balance(), 700);
  s.restore();
});

/* ------------------------------------------------- limit changes (item 9) -- */

test('LIMITS: raising the limit of a depleted pocket gives it money, so it can be spent again', () => {
  const s = setup({ pockets: [['P01', 'Groceries', 'Chase', 100, 0, 'Active']] });
  assert.equal(spend({ amount: 5 }).error, 'INSUFFICIENT_FUNDS');
  const r = updatePocket({ token: TOKEN, pocketId: 'P01', limit: 150 });
  assert.equal(r.pocket.balance, 50);
  assert.equal(r.pocket.isLocked, false);
  assert.equal(spend({ amount: 5, requestId: 'req-0002-bbbb' }).ok, true);
  s.restore();
});

/* ---------------------------------------- deleting old expenses (item 10) -- */

test('DELETE: removing an expense from an EARLIER month does not refund this month', () => {
  const s = setup({
    pockets: [['P01', 'Groceries', 'Chase', 800, 800, 'Active']],
    txns: [['T1001', new Date('2020-03-10T10:00:00Z'), 'Alex', 'P01', 500, 'old']],
  });
  const r = deleteTransaction({ token: TOKEN, txnId: 'T1001' });
  assert.equal(r.ok, true);
  assert.equal(r.refunded, false, 'the reply says no refund was made');
  assert.equal(s.wb.txns._rows.length, 1, 'but the row is gone from the history');
  s.restore();
  const s2 = setup({
    pockets: [['P01', 'Groceries', 'Chase', 800, 300, 'Active']],
    txns: [['T1001', new Date('2020-03-10T10:00:00Z'), 'Alex', 'P01', 100, 'old']],
  });
  deleteTransaction({ token: TOKEN, txnId: 'T1001' });
  assert.equal(s2.balance(), 300, 'this month\'s balance is untouched');
  s2.restore();
});

test('DELETE: removing this month\'s expense still refunds it', () => {
  const s = setup({
    pockets: [['P01', 'Groceries', 'Chase', 800, 300, 'Active']],
    txns: [['T1001', new Date(), 'Alex', 'P01', 100, 'new']],
  });
  const r = deleteTransaction({ token: TOKEN, txnId: 'T1001' });
  assert.equal(r.refunded, true);
  assert.equal(s.balance(), 400);
  s.restore();
});

/* ----------------------------------------------------- id reuse (item 11) -- */

test('IDS: deleting the newest transaction does not free its id', () => {
  const s = setup({ pockets: [['P01', 'Groceries', 'Chase', 800, 800, 'Active']] });
  const a = spend({ requestId: 'req-0001-aaaa' });
  const b = spend({ requestId: 'req-0002-bbbb' });
  assert.equal(deleteTransaction({ token: TOKEN, txnId: b.transaction.id }).ok, true);
  const c = spend({ requestId: 'req-0003-cccc' });
  assert.notEqual(c.transaction.id, b.transaction.id, 'the deleted id is retired, not recycled');
  assert.ok(Number(c.transaction.id.slice(1)) > Number(b.transaction.id.slice(1)));
  assert.ok(a.transaction.id < b.transaction.id);
  s.restore();
});

test('IDS: a stale phone deleting an id that was already removed cannot hit a newer expense', () => {
  const s = setup({ pockets: [['P01', 'Groceries', 'Chase', 800, 800, 'Active']] });
  const old = spend({ requestId: 'req-0001-aaaa' });
  deleteTransaction({ token: TOKEN, txnId: old.transaction.id });          // phone B deletes it
  const fresh = spend({ requestId: 'req-0002-bbbb' });                      // then logs another
  const stale = viaDispatcher('deleteTransaction', { txnId: old.transaction.id });   // phone A, still showing the old row
  assert.equal(stale.ok, false);
  assert.equal(stale.error, 'TRANSACTION_NOT_FOUND');
  assert.equal(s.wb.txns._rows.length, 2, 'the newer expense survives');
  assert.equal(s.wb.txns._rows[1][0], fresh.transaction.id);
  s.restore();
});

test('IDS: a deleted pocket row does not hand its id to the next pocket', () => {
  const s = setup({ pockets: [['P01', 'Groceries', 'Chase', 800, 800, 'Active']] });
  const p2 = createPocket({ token: TOKEN, name: 'Fuel', account: '', limit: 100 });
  assert.equal(p2.pocket.id, 'P02');
  s.wb.pockets.deleteRow(3);                      // someone removes the row by hand in the sheet
  const p3 = createPocket({ token: TOKEN, name: 'Gifts', account: '', limit: 100 });
  assert.equal(p3.pocket.id, 'P03', 'P02 is retired: old transactions may still point at it');
  s.restore();
});

test('IDS: nextTransactionId / nextPocketId honour the highest number ever issued', async () => {
  const { nextTransactionId, nextPocketId } = await import('../backend/01_Utils.gs.js');
  assert.equal(nextTransactionId(['T1001'], 1005), 'T1006');
  assert.equal(nextTransactionId(['T1009'], 1005), 'T1010', 'rows above the counter still win');
  assert.equal(nextPocketId(['P01'], 4), 'P05');
  assert.equal(nextPocketId([], 0), 'P01');
});

/* ----------------------------------------------------- timezone (item 12) -- */

test('TZ: getState counts an expense logged at 00:30 SAST on the 1st in the NEW month', () => {
  const s = setup({
    pockets: [['P01', 'Groceries', 'Chase', 800, 700, 'Active']],
    txns: [
      ['T1001', new Date('2026-09-30T22:30:00Z'), 'Alex', 'P01', 40, 'just after midnight SAST'],
      ['T1002', new Date('2026-09-30T21:30:00Z'), 'Alex', 'P01', 60, 'just before midnight SAST'],
    ],
  });
  const oct = viaDispatcher('getState', { month: '2026-10' });
  const sep = viaDispatcher('getState', { month: '2026-09' });
  assert.equal(oct.pockets[0].spent, 40, 'only the 00:30 expense is October');
  assert.equal(sep.pockets[0].spent, 60, 'the 23:30 one is still September');
  s.restore();
});
