// tests/transfer.test.js
// transferFunds: moves money between two pockets, records it, never changes limits,
// never lets the source go below zero, and never double-moves on a retry.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transferFunds, handleRequest } from '../backend/05_Api.gs.js';
import { parseRequest } from '../backend/07_Entry.gs.js';
import { installGlobals, createProps } from './helpers/appsScriptGlobals.js';
import { freshWorkbook, createSheet } from './helpers/fixtures.js';

const TOKEN = 'test-token';
const RID = 'req-0001-aaaa';
const ADJ_HEADER = [
  'Adj ID', 'Timestamp', 'User', 'Month', 'Type', 'From Pocket', 'To Pocket',
  'Amount', 'Note', 'Request ID', 'Account ID',
];
const POCKETS = [
  ['P01', 'Groceries', 'Chase', 800, 385, 'Active'],
  ['P02', 'Dining Out', 'Card', 250, 15, 'Active'],
  ['P03', 'Old', 'Chase', 100, 50, 'Archived'],
];

function setup({ pockets = POCKETS } = {}) {
  const wb = freshWorkbook(pockets, []);
  const adj = createSheet('Adjustments', [ADJ_HEADER]);
  const sheets = { Pockets: wb.pockets, Transactions: wb.txns, Monthly_Report: wb.report, Adjustments: adj };
  const ss = {
    getSheetByName: (n) => sheets[n] || null,
    insertSheet: (n) => createSheet(n, []),
  };
  const events = [];
  let held = false;
  const lock = {
    tryLock() { if (held) return false; held = true; events.push('lock'); return true; },
    releaseLock() { held = false; events.push('release'); },
  };
  const restore = installGlobals({
    ss,
    props: createProps({ API_TOKEN: TOKEN, USERS: 'Alex,Sam' }),
    lockService: { getScriptLock: () => lock, getUserLock: () => lock },
  });
  globalThis.SpreadsheetApp.flush = () => { events.push('flush'); };
  globalThis.Logger = { log() {} };
  const cleanup = () => { restore(); delete globalThis.Logger; };
  const row = (i) => wb.pockets._rows[i];
  return { wb, adj, events, restore: cleanup, row };
}

const move = (over = {}) => transferFunds({
  token: TOKEN, user: 'Alex', fromPocketId: 'P01', toPocketId: 'P02', amount: 200, note: 'top up', requestId: RID, ...over,
});

test('moving R200 from R385 leaves 185 and adds 200; one adjustment row; limits unchanged', () => {
  const { adj, restore, row } = setup();
  try {
    const r = move();
    assert.equal(r.ok, true);
    assert.equal(row(1)[4], 185);
    assert.equal(row(2)[4], 215);
    assert.equal(row(1)[3], 800);
    assert.equal(row(2)[3], 250);
    assert.equal(r.from.balance, 185);
    assert.equal(r.to.balance, 215);
    assert.equal(r.from.limit, 800);
    assert.equal(r.to.limit, 250);
    assert.equal(adj._rows.length, 2, 'header + one adjustment');
    const a = adj._rows[1];
    assert.equal(a[0], 'A1001');
    assert.equal(a[2], 'Alex');
    assert.equal(a[4], 'transfer');
    assert.equal(a[5], 'P01');
    assert.equal(a[6], 'P02');
    assert.equal(a[7], 200);
    assert.equal(a[8], 'top up');
    assert.equal(a[9], RID);
    assert.equal(r.adjustment.id, 'A1001');
    assert.equal(r.adjustment.type, 'transfer');
    assert.equal(r.adjustment.amount, 200);
    assert.match(r.adjustment.month, /^\d{4}-\d{2}$/);
  } finally { restore(); }
});

test('cents stay exact', () => {
  const { restore, row } = setup({ pockets: [
    ['P01', 'A', '', 100, 0.3, 'Active'],
    ['P02', 'B', '', 100, 0.1, 'Active'],
  ] });
  try {
    assert.equal(move({ amount: 0.2 }).ok, true);
    assert.equal(row(1)[4], 0.1);
    assert.equal(row(2)[4], 0.3);
  } finally { restore(); }
});

test('over-balance gives the exact message and writes nothing', () => {
  const { adj, restore, row } = setup();
  try {
    const r = move({ amount: 385.01 });
    assert.equal(r.ok, false);
    assert.equal(r.error, 'INSUFFICIENT_FUNDS');
    assert.equal(r.message, 'Insufficient funds in Groceries. Remaining: R385.00');
    assert.deepEqual(r.context, { pocketId: 'P01', remaining: 385, amount: 385.01 });
    assert.equal(row(1)[4], 385);
    assert.equal(row(2)[4], 15);
    assert.equal(adj._rows.length, 1);
  } finally { restore(); }
});

test('moving the exact balance is allowed', () => {
  const { restore, row } = setup();
  try {
    assert.equal(move({ amount: 385 }).ok, true);
    assert.equal(row(1)[4], 0);
    assert.equal(row(2)[4], 400);
  } finally { restore(); }
});

test('bad requests are refused and nothing is written', () => {
  const cases = [
    ['same pocket', { toPocketId: 'P01' }, 'INVALID_REQUEST'],
    ['empty from', { fromPocketId: '' }, 'INVALID_REQUEST'],
    ['empty to', { toPocketId: '' }, 'INVALID_REQUEST'],
    ['archived from', { fromPocketId: 'P03' }, 'POCKET_NOT_FOUND'],
    ['archived to', { toPocketId: 'P03' }, 'POCKET_NOT_FOUND'],
    ['unknown from', { fromPocketId: 'P99' }, 'POCKET_NOT_FOUND'],
    ['unknown to', { toPocketId: 'P99' }, 'POCKET_NOT_FOUND'],
    ['zero', { amount: 0 }, 'INVALID_AMOUNT'],
    ['negative', { amount: -5 }, 'INVALID_AMOUNT'],
    ['bad token', { token: 'nope' }, 'UNAUTHORIZED'],
    ['bad user', { user: 'Mallory' }, 'INVALID_USER'],
    ['bad requestId', { requestId: 'short' }, 'INVALID_REQUEST'],
  ];
  for (const [label, over, code] of cases) {
    const { adj, restore, row } = setup();
    try {
      const r = move(over);
      assert.equal(r.ok, false, label);
      assert.equal(r.error, code, label);
      assert.equal(row(1)[4], 385, label);
      assert.equal(row(2)[4], 15, label);
      assert.equal(adj._rows.length, 1, label);
    } finally { restore(); }
  }
});

test('the same requestId twice moves the money once', () => {
  const { adj, restore, row } = setup();
  try {
    const first = move();
    const second = move();
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(second.duplicate, true);
    assert.equal(first.duplicate, undefined);
    assert.equal(second.adjustment.id, first.adjustment.id);
    assert.equal(second.from.balance, 185);
    assert.equal(second.to.balance, 215);
    assert.equal(row(1)[4], 185);
    assert.equal(row(2)[4], 215);
    assert.equal(adj._rows.length, 2);
  } finally { restore(); }
});

test('the lock is released and writes flushed on success and on rejection', () => {
  for (const over of [{}, { amount: 9999 }]) {
    const { events, restore } = setup();
    try {
      move(over);
      assert.deepEqual(events.slice(0, 1), ['lock']);
      assert.equal(events.at(-1), 'release');
      assert.ok(events.indexOf('flush') > -1 && events.indexOf('flush') < events.lastIndexOf('release'),
        'flush happens before release');
    } finally { restore(); }
  }
});

test('a failed credit puts the debit back and the error comes out of the dispatcher', () => {
  const { wb, restore, row } = setup();
  try {
    const orig = wb.pockets.getRange.bind(wb.pockets);
    wb.pockets.getRange = (r, c, ...rest) => {
      const range = orig(r, c, ...rest);
      if (r === 3 && c === 5) {
        range.setValue = () => { throw new Error('sheet write failed'); };
        range.setValues = () => { throw new Error('sheet write failed'); };
      }
      return range;
    };
    const r = handleRequest({ action: 'transferFunds', params: {
      token: TOKEN, user: 'Alex', fromPocketId: 'P01', toPocketId: 'P02', amount: 200, requestId: RID,
    } });
    assert.equal(r.ok, false);
    assert.equal(r.error, 'SERVER_ERROR');
    assert.equal(row(1)[4], 385, 'the debit was put back');
    assert.equal(row(2)[4], 15);
  } finally { restore(); }
});

test('the exact body the Move money screen posts is accepted and credited to the acting user', () => {
  const { adj, restore, row } = setup();
  try {
    const wire = JSON.stringify({
      action: 'transferFunds', token: TOKEN, user: 'Sam', fromPocketId: 'P01', toPocketId: 'P02',
      amount: 25.5, note: 'Braai', requestId: 'b1c2d3e4-5f60-4a7b',
    });
    const r = parseRequest({ postData: { contents: wire } }, 'POST');
    const res = handleRequest({ action: r.action, params: r.params });
    assert.equal(res.ok, true);
    assert.equal(res.adjustment.user, 'Sam');
    assert.equal(row(1)[4], 359.5);
    assert.equal(row(2)[4], 40.5);
    assert.equal(adj._rows[1][2], 'Sam');
  } finally { restore(); }
});

test('a bank-account name in the user field is rejected as an unknown user and moves nothing', () => {
  const { adj, restore, row } = setup();
  try {
    const r = move({ user: 'Chase' });
    assert.equal(r.ok, false);
    assert.equal(r.error, 'INVALID_USER');
    assert.equal(r.message, 'Unknown user: Chase');
    assert.equal(row(1)[4], 385);
    assert.equal(adj._rows.length, 1);
  } finally { restore(); }
});
