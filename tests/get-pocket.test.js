// tests/get-pocket.test.js
// getPocket: one pocket's month, and a breakdown that agrees with the real balance.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getPocket, pocketBreakdown, transferFunds, createTransaction, handleRequest,
} from '../backend/05_Api.gs.js';
import { installGlobals, createProps } from './helpers/appsScriptGlobals.js';
import { freshWorkbook, createSheet, v2Pocket } from './helpers/fixtures.js';

const TOKEN = 'test-token';
const ADJ_HEADER = [
  'Adj ID', 'Timestamp', 'User', 'Month', 'Type', 'From Pocket', 'To Pocket',
  'Amount', 'Note', 'Request ID', 'Account ID',
];

function setup() {
  const wb = freshWorkbook([
    v2Pocket({ id: 'P01', name: 'Groceries', account: 'Chase', limit: 800, balance: 900, carriedIn: 100 }),
    v2Pocket({ id: 'P02', name: 'Dining Out', account: 'Card', limit: 250, balance: 250 }),
    v2Pocket({ id: 'P03', name: 'Old', account: 'Chase', limit: 100, balance: 50, status: 'Archived' }),
  ], []);
  const adj = createSheet('Adjustments', [ADJ_HEADER]);
  const sheets = { Pockets: wb.pockets, Transactions: wb.txns, Monthly_Report: wb.report, Adjustments: adj };
  const ss = {
    getSheetByName: (n) => sheets[n] || null,
    insertSheet: (n) => createSheet(n, []),
  };
  let held = false;
  const lock = {
    tryLock() { if (held) return false; held = true; return true; },
    releaseLock() { held = false; },
  };
  const restore = installGlobals({
    ss,
    props: createProps({ API_TOKEN: TOKEN, USERS: 'Alex,Sam' }),
    lockService: { getScriptLock: () => lock, getUserLock: () => lock },
  });
  globalThis.SpreadsheetApp.flush = () => {};
  globalThis.Logger = { log() {} };
  return { wb, restore: () => { restore(); delete globalThis.Logger; } };
}

test('breakdown.left equals the balance after a transfer in, a transfer out and 3 expenses', () => {
  const { wb, restore } = setup();
  try {
    assert.equal(transferFunds({
      token: TOKEN, user: 'Alex', fromPocketId: 'P02', toPocketId: 'P01', amount: 50.25, requestId: 'req-in-0001',
    }).ok, true);
    assert.equal(transferFunds({
      token: TOKEN, user: 'Alex', fromPocketId: 'P01', toPocketId: 'P02', amount: 20.1, requestId: 'req-out-0001',
    }).ok, true);
    ['10.10', '20.20', '30.30'].forEach((amount, i) => {
      assert.equal(createTransaction({
        token: TOKEN, user: 'Sam', pocketId: 'P01', amount, requestId: 'req-exp-000' + i,
      }).ok, true);
    });
    createTransaction({ token: TOKEN, user: 'Sam', pocketId: 'P02', amount: 5, requestId: 'req-exp-other' });

    const r = getPocket({ token: TOKEN, pocketId: 'P01' });
    assert.equal(r.ok, true);
    assert.equal(r.breakdown.limit, 800);
    assert.equal(r.breakdown.carriedIn, 100);
    assert.equal(r.breakdown.movedIn, 50.25);
    assert.equal(r.breakdown.movedOut, 20.1);
    assert.equal(r.breakdown.spent, 60.6);
    assert.equal(r.breakdown.count, 3);
    assert.equal(r.breakdown.left, wb.pockets._rows[1][4]);
    assert.equal(r.transactions.length, 3);
    assert.ok(r.transactions.every((t) => t.pocketId === 'P01'));
    assert.equal(r.adjustments.length, 2);
    assert.equal(r.pocket.id, 'P01');
  } finally {
    restore();
  }
});

test('an archived pocket can be read; an unknown pocket and a bad token are refused', () => {
  const { restore } = setup();
  try {
    assert.equal(getPocket({ token: TOKEN, pocketId: 'P03' }).ok, true);
    const missing = handleRequest({ action: 'getPocket', params: { token: TOKEN, pocketId: 'P99' } });
    assert.equal(missing.ok, false);
    assert.equal(missing.error, 'POCKET_NOT_FOUND');
    assert.equal(getPocket({ token: 'nope', pocketId: 'P01' }).error, 'UNAUTHORIZED');
  } finally {
    restore();
  }
});

test('pocketBreakdown ignores carry/forfeit adjustments and works in whole cents', () => {
  const b = pocketBreakdown(
    { id: 'P01', limit: 0.3, carriedIn: 0.1 },
    [{ amount: 0.1 }, { amount: 0.2 }],
    [
      { type: 'transfer', fromPocketId: 'P02', toPocketId: 'P01', amount: 0.1 },
      { type: 'carry', fromPocketId: '', toPocketId: 'P01', amount: 5 },
      { type: 'sweep', fromPocketId: 'P01', toPocketId: 'P02', amount: 0.2 },
    ],
  );
  assert.deepEqual(b, { limit: 0.3, carriedIn: 0.1, movedIn: 0.1, movedOut: 0.2, spent: 0.3, count: 2, left: 0 });
});
