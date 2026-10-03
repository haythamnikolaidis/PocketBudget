// tests/invariants.test.js
// Property-style tests for the four invariants the dispatcher must hold.
//
// These are deliberately adversarial: they probe the EXACT boundary conditions
// (one cent over, exact balance, zero balance) and simulate concurrent
// submissions, rather than checking happy paths.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTransaction, deleteTransaction, handleRequest } from '../backend/05_Api.gs.js';
import { installGlobals, createProps } from './helpers/appsScriptGlobals.js';
import { freshWorkbook } from './helpers/fixtures.js';

const TOKEN = 'test-token';

/**
 * A lock that behaves like the real one: only ONE holder at a time.
 * tryLock fails while another caller holds it, which is what makes the
 * concurrency assertions meaningful.
 */
function exclusiveLock() {
  let held = false;
  return {
    get _held() { return held; },
    tryLock() {
      if (held) return false;
      held = true;
      return true;
    },
    releaseLock() { held = false; },
    hasLock() { return held; },
  };
}

function withApi(pocketRows = [], txnRows = []) {
  const wb = freshWorkbook(pocketRows, txnRows);
  const ss = {
    getSheetByName: (n) => (n === 'Pockets' ? wb.pockets : n === 'Transactions' ? wb.txns : n === 'Monthly_Report' ? wb.report : null),
  };
  const lock = exclusiveLock();
  const restore = installGlobals({
    ss,
    props: createProps({ API_TOKEN: TOKEN }),
    lockService: { getScriptLock: () => lock, getUserLock: () => lock },
  });
  return { wb, lock, restore };
}

test('INVARIANT 1: one cent over the balance is rejected; the balance is untouched', () => {
  const { restore, wb } = withApi([['P01', 'Groceries', 'Chase', 800, 100, 'Active']], []);
  const r = createTransaction({ token: TOKEN, user: 'Alex', pocketId: 'P01', amount: 100.01 });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'INSUFFICIENT_FUNDS');
  assert.equal(r.context.remaining, 100);
  assert.equal(wb.pockets.getRange(2, 5).getValues()[0][0], 100, 'balance must not move');
  assert.equal(wb.txns._rows.length, 1, 'no transaction row may be appended');
  restore();
});

test('INVARIANT 1: spending the EXACT balance succeeds and locks the pocket at zero', () => {
  const { restore } = withApi([['P01', 'Groceries', 'Chase', 800, 100, 'Active']], []);
  const r = createTransaction({ token: TOKEN, user: 'Alex', pocketId: 'P01', amount: 100 });
  assert.equal(r.ok, true);
  assert.equal(r.pocket.balance, 0);
  assert.equal(r.pocket.isLocked, true);
  restore();
});

test('INVARIANT 1: a zero-balance pocket rejects even the smallest amount', () => {
  const { restore, wb } = withApi([['P01', 'Groceries', 'Chase', 800, 0, 'Active']], []);
  const r = createTransaction({ token: TOKEN, user: 'Alex', pocketId: 'P01', amount: 0.01 });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'INSUFFICIENT_FUNDS');
  assert.equal(wb.txns._rows.length, 1);
  restore();
});

test('INVARIANT 1: repeated spending never drives a balance below zero', () => {
  const { restore } = withApi([['P01', 'Groceries', 'Chase', 100, 10, 'Active']], []);
  let balance = 10;
  let accepted = 0;
  for (let i = 0; i < 20; i++) {
    const r = createTransaction({ token: TOKEN, user: 'Alex', pocketId: 'P01', amount: 4 });
    if (r.ok) { balance = r.pocket.balance; accepted++; }
    assert.ok(balance >= 0, 'balance went negative: ' + balance);
  }
  assert.equal(accepted, 2, 'only two R4 spends fit into R10');
  assert.equal(balance, 2);
  restore();
});

test('INVARIANT 1: a client-supplied balance cannot influence the deduction', () => {
  // A malicious/buggy client posts a stale "balance" of 0; the server must
  // ignore it and use the authoritative sheet value.
  const { restore } = withApi([['P01', 'Groceries', 'Chase', 800, 50, 'Active']], []);
  const r = createTransaction({
    token: TOKEN, user: 'Alex', pocketId: 'P01', amount: 20, balance: 0,
  });
  assert.equal(r.ok, true);
  assert.equal(r.pocket.balance, 30, 'server must use the sheet value (50 - 20)');
  restore();
});

test('INVARIANT 2: the lock is released after a successful deduction', () => {
  const { restore, lock } = withApi([['P01', 'Groceries', 'Chase', 800, 50, 'Active']], []);
  createTransaction({ token: TOKEN, user: 'Alex', pocketId: 'P01', amount: 10 });
  assert.equal(lock.hasLock(), false, 'lock leaked on the success path');
  restore();
});

test('INVARIANT 2: the lock is released after an insufficient-funds rejection', () => {
  const { restore, lock } = withApi([['P01', 'Groceries', 'Chase', 800, 5, 'Active']], []);
  createTransaction({ token: TOKEN, user: 'Alex', pocketId: 'P01', amount: 9999 });
  assert.equal(lock.hasLock(), false, 'lock leaked on the rejection path');
  restore();
});

test('INVARIANT 2: the lock is released after a malformed request', () => {
  const { restore, lock } = withApi([['P01', 'Groceries', 'Chase', 800, 50, 'Active']], []);
  createTransaction({ token: TOKEN, user: 'Alex', pocketId: 'P99', amount: 10 });
  assert.equal(lock.hasLock(), false);
  restore();
});

test('INVARIANT 2: a second request is rejected as BUSY while the lock is held', async () => {
  const wb = freshWorkbook([['P01', 'Groceries', 'Chase', 800, 50, 'Active']], []);
  const ss = { getSheetByName: (n) => (n === 'Pockets' ? wb.pockets : n === 'Transactions' ? wb.txns : wb.report) };
  const lock = exclusiveLock();
  const restore = installGlobals({
    ss, props: createProps({ API_TOKEN: TOKEN }),
    lockService: { getScriptLock: () => lock, getUserLock: () => lock },
  });

  lock.tryLock();   // simulate another request already in flight
  const r = createTransaction({ token: TOKEN, user: 'Alex', pocketId: 'P01', amount: 10 });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'BUSY');
  assert.match(r.message, /Another update is in progress/);
  lock.releaseLock();
  restore();
});

test('INVARIANT 3: the rejection message matches the brief exactly', () => {
  const { restore } = withApi([['P02', 'Dining Out', 'Credit Card A', 250, 15, 'Active']], []);
  const r = createTransaction({ token: TOKEN, user: 'Sam', pocketId: 'P02', amount: 99.99 });
  assert.equal(r.message, 'Insufficient funds in Dining Out. Remaining: R15.00');
  restore();
});

test('INVARIANT 3: the message formats sub-dollar balances correctly', () => {
  const { restore } = withApi([['P01', 'Snacks', 'Chase', 50, 0.05, 'Active']], []);
  const r = createTransaction({ token: TOKEN, user: 'Alex', pocketId: 'P01', amount: 1 });
  assert.equal(r.message, 'Insufficient funds in Snacks. Remaining: R0.05');
  restore();
});

test('INVARIANT 4: a bad token is rejected before any data is read or written', () => {
  const { restore, wb } = withApi([['P01', 'Groceries', 'Chase', 800, 340.5, 'Active']], []);
  const r = createTransaction({ token: 'wrong', user: 'Alex', pocketId: 'P01', amount: 40.5 });
  assert.equal(r.error, 'UNAUTHORIZED');
  assert.equal(wb.pockets.getRange(2, 5).getValues()[0][0], 340.5);
  assert.equal(wb.txns._rows.length, 1);
  restore();
});

test('INVARIANT 4: handleRequest never throws, whatever it is handed', () => {
  const { restore } = withApi();
  for (const bad of [
    { action: 'createTransaction', params: { token: TOKEN, user: null, pocketId: {}, amount: [] } },
    { action: 'getState', params: { token: TOKEN, month: { toString: null } } },
    { action: 'deleteTransaction', params: { token: TOKEN, txnId: 12345 } },
  ]) {
    assert.doesNotThrow(() => handleRequest(bad), 'threw for ' + JSON.stringify(Object.keys(bad.params)));
  }
  restore();
});

test('deleteTransaction refunds the pocket and never pushes it over its limit', () => {
  const { restore, wb } = withApi([['P01', 'Groceries', 'Chase', 100, 40, 'Active']], []);
  // Log R30 -> balance 10; deleting it must refund back to 40.
  const txn = createTransaction({ token: TOKEN, user: 'Alex', pocketId: 'P01', amount: 30 });
  assert.equal(txn.pocket.balance, 10);

  const del = deleteTransaction({ token: TOKEN, txnId: txn.transaction.id });
  assert.equal(del.ok, true);
  assert.equal(del.pocket.balance, 40, 'refund restores the original balance');
  assert.equal(wb.pockets.getRange(2, 5).getValues()[0][0], 40);
  restore();
});

test('deleteTransaction clamps the refund at the pocket limit', () => {
  // Balance 90, limit 100. A stale row claiming R50 must refund only R10,
  // never push the balance to 140.
  const wbSeed = freshWorkbook([['P01', 'Groceries', 'Chase', 100, 90, 'Active']], []);
  wbSeed.txns.appendRow(['T1001', new Date(), 'Alex', 'P01', 50, 'stale row']);
  const ss = { getSheetByName: (n) => (n === 'Pockets' ? wbSeed.pockets : n === 'Transactions' ? wbSeed.txns : wbSeed.report) };
  const lock = exclusiveLock();
  const restore = installGlobals({
    ss, props: createProps({ API_TOKEN: TOKEN }),
    lockService: { getScriptLock: () => lock, getUserLock: () => lock },
  });

  const del = deleteTransaction({ token: TOKEN, txnId: 'T1001' });
  assert.equal(del.ok, true);
  assert.equal(del.pocket.balance, 100, 'must clamp to the limit, not 140');
  restore();
});