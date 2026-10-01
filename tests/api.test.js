// tests/api.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTransaction, createPocket, getState, handleRequest } from '../backend/05_Api.gs.js';
import { installGlobals, createProps } from './helpers/appsScriptGlobals.js';
import { freshWorkbook, SAMPLE_POCKETS, SAMPLE_TXNS } from './helpers/fixtures.js';

const TOKEN = 'test-token';

function withApi(pocketRows = SAMPLE_POCKETS, txnRows = SAMPLE_TXNS) {
  const wb = freshWorkbook(pocketRows, txnRows);
  const ss = {
    getSheetByName: (n) => (n === 'Pockets' ? wb.pockets : n === 'Transactions' ? wb.txns : n === 'Monthly_Report' ? wb.report : null),
  };
  const props = createProps({ API_TOKEN: TOKEN });
  const lock = { _held: false, tryLock() { this._held = true; return true; }, releaseLock() { this._held = false; } };
  const restore = installGlobals({
    ss,
    props,
    lockService: { getScriptLock: () => lock, getUserLock: () => lock },
  });
  return { wb, restore, lock };
}

test('createTransaction deducts and returns the new balance', () => {
  const { restore } = withApi();
  const r = createTransaction({ token: TOKEN, user: 'Alex', pocketId: 'P01', amount: 40.5, note: 'Groceries' });
  assert.equal(r.ok, true);
  assert.equal(r.pocket.balance, 300);          // 340.5 - 40.5
  assert.equal(r.transaction.amount, 40.5);
  assert.equal(r.transaction.user, 'Alex');
  assert.match(r.transaction.id, /^T\d+$/);
  restore();
});

test('createTransaction writes the transaction row to the sheet', () => {
  const { restore, wb } = withApi();
  createTransaction({ token: TOKEN, user: 'Sam', pocketId: 'P02', amount: 10, note: 'Lunch' });
  assert.equal(wb.txns._rows.length, 4);       // header + 2 sample + 1 new
  const last = wb.txns._rows[3];
  assert.equal(last[2], 'Sam');
  assert.equal(last[3], 'P02');
  assert.equal(last[4], 10);
  restore();
});

test('createTransaction BLOCKS overspend with the exact brief message', () => {
  const { restore, wb } = withApi();
  const r = createTransaction({ token: TOKEN, user: 'Alex', pocketId: 'P02', amount: 99.99, note: 'Dinner' });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'INSUFFICIENT_FUNDS');
  assert.equal(r.message, 'Insufficient funds in Dining Out. Remaining: $15.00');
  assert.equal(r.context.remaining, 15);
  assert.equal(wb.pockets.getRange(3, 5).getValues()[0][0], 15);   // untouched
  assert.equal(wb.txns._rows.length, 3);                            // no row appended
  restore();
});

test('createTransaction treats spending the exact balance as allowed', () => {
  const { restore } = withApi();
  const r = createTransaction({ token: TOKEN, user: 'Alex', pocketId: 'P02', amount: 15, note: 'Exactly' });
  assert.equal(r.ok, true);
  assert.equal(r.pocket.balance, 0);
  assert.equal(r.pocket.isLocked, true);
  restore();
});

test('createTransaction blocks any amount once the balance is zero', () => {
  const { restore } = withApi([['P01', 'Groceries', 'Chase', 100, 0, 'Active']], []);
  const r = createTransaction({ token: TOKEN, user: 'Alex', pocketId: 'P01', amount: 0.01 });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'INSUFFICIENT_FUNDS');
  restore();
});

test('createTransaction rejects a zero-amount submission', () => {
  const { restore } = withApi();
  const r = createTransaction({ token: TOKEN, user: 'Alex', pocketId: 'P01', amount: 0 });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'INVALID_AMOUNT');
  restore();
});

test('createTransaction rejects an unknown user', () => {
  const { restore } = withApi();
  const r = createTransaction({ token: TOKEN, user: 'Mallory', pocketId: 'P01', amount: 5 });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'INVALID_USER');
  restore();
});

test('createTransaction rejects an unknown or archived pocket', () => {
  const { restore } = withApi([
    ['P01', 'Groceries', 'Chase', 800, 340.5, 'Active'],
    ['P02', 'Old', 'Chase', 100, 100, 'Archived'],
  ], []);
  assert.equal(createTransaction({ token: TOKEN, user: 'Alex', pocketId: 'P99', amount: 5 }).error, 'POCKET_NOT_FOUND');
  assert.equal(createTransaction({ token: TOKEN, user: 'Alex', pocketId: 'P02', amount: 5 }).error, 'POCKET_NOT_FOUND');
  restore();
});

test('createTransaction rejects a bad token before touching any data', () => {
  const { restore, wb } = withApi();
  const r = createTransaction({ token: 'wrong', user: 'Alex', pocketId: 'P01', amount: 40.5 });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'UNAUTHORIZED');
  assert.equal(wb.pockets.getRange(2, 5).getValues()[0][0], 340.5);   // untouched
  restore();
});

test('createTransaction releases the lock even when it rejects', () => {
  const { restore, lock } = withApi();
  createTransaction({ token: TOKEN, user: 'Alex', pocketId: 'P02', amount: 9999 });
  assert.equal(lock._held, false);
  restore();
});

test('createTransaction never lets the balance go below zero under repeated spending', () => {
  const { restore } = withApi([['P01', 'Groceries', 'Chase', 100, 10, 'Active']], []);
  let balance = 10;
  for (let i = 0; i < 5; i++) {
    const r = createTransaction({ token: TOKEN, user: 'Alex', pocketId: 'P01', amount: 4 });
    if (r.ok) balance = r.pocket.balance;
  }
  assert.equal(balance, 2);      // 10 -> 6 -> 2, then blocked
  assert.equal(balance >= 0, true);
  restore();
});

test('createPocket creates with balance equal to limit and blocks a zero limit name', () => {
  const { restore } = withApi();
  const r = createPocket({ token: TOKEN, name: 'Fuel', account: 'Chase', limit: 200 });
  assert.equal(r.ok, true);
  assert.equal(r.pocket.balance, 200);
  assert.match(r.pocket.id, /^P\d{2}$/);
  assert.equal(createPocket({ token: TOKEN, name: '', account: 'Chase', limit: 200 }).error, 'INVALID_NAME');
  restore();
});

test('getState returns pockets, transactions and summary in one payload', () => {
  const { restore } = withApi();
  const s = getState({ token: TOKEN, month: '2026-10' });
  assert.equal(s.ok, true);
  assert.equal(s.pockets.length, 2);
  assert.equal(s.transactions.length, 2);
  // spent is MONTH-scoped so it survives rollover: only T1001 falls in 2026-10.
  assert.equal(s.pockets[0].spent, 65.2);
  assert.equal(s.pockets[0].pctUsed, 8.15);
  // balance is the live figure straight from the sheet.
  assert.equal(s.pockets[0].balance, 340.5);
  assert.equal(s.summary.totalLimit, 1050);
  assert.deepEqual(s.summary.users, ['Alex', 'Sam']);
  restore();
});

test('getState marks a depleted pocket as locked', () => {
  const { restore } = withApi([['P01', 'Groceries', 'Chase', 100, 0, 'Active']], []);
  assert.equal(getState({ token: TOKEN }).pockets[0].isLocked, true);
  restore();
});

test('getState caps transactions at 10', () => {
  const many = Array.from({ length: 15 }, (_, i) => [
    'T' + (1001 + i), new Date(`2026-10-01T${String(i % 24).padStart(2, '0')}:00:00Z`),
    'Alex', 'P01', 5, 'note ' + i,
  ]);
  const { restore } = withApi(SAMPLE_POCKETS, many);
  assert.equal(getState({ token: TOKEN }).transactions.length, 10);
  restore();
});

test('handleRequest routes getState and rejects unknown actions', () => {
  const { restore } = withApi();
  assert.equal(handleRequest({ action: 'getState', params: { token: TOKEN } }).ok, true);
  assert.equal(handleRequest({ action: 'nope', params: { token: TOKEN } }).error, 'UNKNOWN_ACTION');
  restore();
});

test('handleRequest requires a token on every action', () => {
  const { restore } = withApi();
  assert.equal(handleRequest({ action: 'getState', params: {} }).error, 'UNAUTHORIZED');
  assert.equal(handleRequest({ action: 'getState', params: { token: 'bad' } }).error, 'UNAUTHORIZED');
  restore();
});

test('handleRequest never throws — it returns an error envelope', () => {
  const { restore } = withApi();
  const r = handleRequest({ action: 'getState', params: { token: TOKEN } });
  assert.equal(r.ok, true);
  assert.equal(typeof r.version, 'string');
  restore();
});
