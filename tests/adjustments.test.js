// tests/adjustments.test.js
// Adjustments sheet I/O: appendAdjustments, readAdjustments, findAdjustmentByRequestId.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendAdjustments, readAdjustments, findAdjustmentByRequestId } from '../backend/03_Sheets.gs.js';
import { nextAdjustmentId } from '../backend/01_Utils.gs.js';
import { installGlobals, createProps } from './helpers/appsScriptGlobals.js';
import { createSheet } from './helpers/fakeSheet.js';

const HEADER = [
  'Adj ID', 'Timestamp', 'User', 'Month', 'Type', 'From Pocket', 'To Pocket',
  'Amount', 'Note', 'Request ID', 'Account ID',
];

function setup({ withSheet = true, rows = [], props = {} } = {}) {
  const adj = createSheet('Adjustments', [HEADER, ...rows]);
  let setValuesCalls = 0;
  const origGetRange = adj.getRange.bind(adj);
  adj.getRange = (...args) => {
    const range = origGetRange(...args);
    const orig = range.setValues;
    range.setValues = (v) => { setValuesCalls++; return orig.call(range, v); };
    return range;
  };
  const ss = { getSheetByName: (n) => (n === 'Adjustments' && withSheet ? adj : null) };
  const restore = installGlobals({ ss, props: createProps(props) });
  return { adj, restore, calls: () => setValuesCalls };
}

const item = (over = {}) => ({
  timestamp: new Date('2026-10-05T10:00:00Z'), user: 'Sam', month: '2026-10', type: 'transfer',
  fromPocketId: 'P001', toPocketId: 'P002', amount: 25.5, note: 'top up', requestId: 'req-aaaa-0001',
  accountId: 'AC01', ...over,
});

test('appending 3 items issues A1001-A1003 with one setValues and correct columns', () => {
  const { adj, restore, calls } = setup();
  try {
    const ids = appendAdjustments([
      item(),
      item({ type: 'carry', fromPocketId: 'P002', toPocketId: '', amount: 10, note: '=SUM(1)', requestId: 'req-aaaa-0002', accountId: '' }),
      item({ type: 'forfeit', amount: 3, requestId: 'req-aaaa-0003' }),
    ]);
    assert.deepEqual(ids, ['A1001', 'A1002', 'A1003']);
    assert.equal(calls(), 1);
    assert.equal(adj._rows.length, 4);
    assert.deepEqual(adj._rows[1], [
      'A1001', new Date('2026-10-05T10:00:00Z'), 'Sam', '2026-10', 'transfer',
      'P001', 'P002', 25.5, 'top up', 'req-aaaa-0001', 'AC01',
    ]);
    assert.equal(adj._rows[2][4], 'carry');
    assert.equal(adj._rows[2][6], '');
    assert.notEqual(adj._rows[2][8], '=SUM(1)');
    assert.equal(adj._rows[3][0], 'A1003');
  } finally { restore(); }
});

test('appending never reuses an issued number', () => {
  const { restore } = setup({ props: { LAST_ADJ_NUM: '1050' } });
  try {
    assert.deepEqual(appendAdjustments([item()]), ['A1051']);
  } finally { restore(); }
});

test('appending to a missing sheet throws the migrate hint', () => {
  const { restore } = setup({ withSheet: false });
  try {
    assert.throws(() => appendAdjustments([item()]), /Missing sheet: Adjustments\. Run migrateV2\(\)\./);
  } finally { restore(); }
});

test('readAdjustments filters by month and sorts newest first', () => {
  const { restore } = setup();
  try {
    appendAdjustments([
      item({ timestamp: new Date('2026-09-30T10:00:00Z'), month: '2026-09' }),
      item({ timestamp: new Date('2026-10-03T10:00:00Z') }),
      item({ timestamp: new Date('2026-10-07T10:00:00Z'), type: 'sweep' }),
    ]);
    const oct = readAdjustments({ month: '2026-10' });
    assert.deepEqual(oct.map((a) => a.id), ['A1003', 'A1002']);
    assert.equal(oct[0].type, 'sweep');
    assert.equal(oct[0].amount, 25.5);
    assert.equal(oct[0].fromPocketId, 'P001');
    assert.equal(oct[0].accountId, 'AC01');
    assert.equal(readAdjustments().length, 3);
    assert.equal(readAdjustments({ month: '2025-01' }).length, 0);
  } finally { restore(); }
});

test('readAdjustments on a missing sheet is empty', () => {
  const { restore } = setup({ withSheet: false });
  try {
    assert.deepEqual(readAdjustments(), []);
    assert.deepEqual(readAdjustments({ month: '2026-10' }), []);
  } finally { restore(); }
});

test('findAdjustmentByRequestId finds and misses', () => {
  const { restore } = setup();
  try {
    appendAdjustments([item(), item({ requestId: 'req-aaaa-0002', amount: 7 })]);
    const hit = findAdjustmentByRequestId('req-aaaa-0002');
    assert.equal(hit.id, 'A1002');
    assert.equal(hit.amount, 7);
    assert.equal(findAdjustmentByRequestId('req-zzzz-9999'), null);
    assert.equal(findAdjustmentByRequestId(''), null);
  } finally { restore(); }
});

test('findAdjustmentByRequestId on a missing sheet is null', () => {
  const { restore } = setup({ withSheet: false });
  try {
    assert.equal(findAdjustmentByRequestId('req-aaaa-0001'), null);
  } finally { restore(); }
});

test('nextAdjustmentId never reuses a number below lastIssued', () => {
  assert.equal(nextAdjustmentId([]), 'A1001');
  assert.equal(nextAdjustmentId(['A1001', 'A1002']), 'A1003');
  assert.equal(nextAdjustmentId(['A1001'], 1500), 'A1501');
  assert.equal(nextAdjustmentId(['T1009', 'junk', 'A12x'], 0), 'A1001');
  assert.equal(nextAdjustmentId(['A1005'], 3), 'A1006');
});
