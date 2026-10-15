// tests/migration.test.js
// migrateV2(): adds the v2 headers and sheets, changes nothing else, and is idempotent.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migrateV2 } from '../backend/07_Entry.gs.js';
import { installGlobals, createProps } from './helpers/appsScriptGlobals.js';
import { createSheet } from './helpers/fakeSheet.js';
import { HEADER_POCKETS, HEADER_TRANSACTIONS, v2Pocket } from './helpers/fixtures.js';
import { readPockets } from '../backend/03_Sheets.gs.js';

const OLD_TXN_HEADER = [...HEADER_TRANSACTIONS, 'Request ID'];

function oldWorkbook() {
  const sheets = {
    Pockets: createSheet('Pockets', [
      HEADER_POCKETS,
      ['P001', 'Groceries', 'FNB', 3000, 1250.5, 'Active'],
      ['P002', 'Fuel', 'FNB', 1500, 1500, 'Active'],
    ]),
    Transactions: createSheet('Transactions', [
      OLD_TXN_HEADER,
      ['T1001', '2026-10-01T08:00:00Z', 'Sam', 'P001', 49.5, 'Spar', 'req-1'],
    ]),
    Monthly_Report: createSheet('Monthly_Report', []),
  };
  const ss = {
    getSheetByName: (n) => sheets[n] || null,
    insertSheet: (n) => (sheets[n] = createSheet(n, [])),
  };
  globalThis.Logger = { log() {} };
  const restore = installGlobals({ ss, props: createProps({}) });
  return { sheets, restore: () => { restore(); delete globalThis.Logger; } };
}

const header = (sheet) => sheet._rows[0];

test('an old-style workbook gets every v2 header and both new sheets', () => {
  const w = oldWorkbook();
  const changes = migrateV2();
  assert.ok(changes.length > 0);
  assert.deepEqual(header(w.sheets.Pockets).slice(6, 10), ['Leftover Rule', 'Sweep To', 'Carried In', 'Kind']);
  assert.deepEqual(header(w.sheets.Transactions).slice(7, 9), ['Group ID', 'Paid With']);
  assert.deepEqual(header(w.sheets.Adjustments), [
    'Adj ID', 'Timestamp', 'User', 'Month', 'Type', 'From Pocket', 'To Pocket',
    'Amount', 'Note', 'Request ID', 'Account ID',
  ]);
  assert.deepEqual(header(w.sheets.Accounts), [
    'Account ID', 'Name', 'Type', 'Statement Day', 'Due Day', 'Credit Limit', 'Status',
  ]);
  assert.equal(w.sheets.Adjustments._frozenRows, 1);
  assert.equal(w.sheets.Accounts._frozenRows, 1);
  assert.ok(changes.includes('Pockets: added header Leftover Rule'));
  w.restore();
});

test('running migrateV2 a second time changes nothing', () => {
  const w = oldWorkbook();
  migrateV2();
  const before = JSON.stringify(Object.values(w.sheets).map((s) => s._rows));
  assert.deepEqual(migrateV2(), []);
  assert.equal(JSON.stringify(Object.values(w.sheets).map((s) => s._rows)), before);
  w.restore();
});

test('existing data in the old columns is untouched', () => {
  const w = oldWorkbook();
  const pocketsBefore = w.sheets.Pockets._rows.map((r) => [...r]);
  const txnsBefore = w.sheets.Transactions._rows.map((r) => [...r]);
  migrateV2();
  assert.deepEqual(w.sheets.Pockets._rows.slice(1).map((r) => r.slice(0, 6)), pocketsBefore.slice(1));
  assert.deepEqual(w.sheets.Pockets._rows[0].slice(0, 6), pocketsBefore[0]);
  assert.deepEqual(w.sheets.Transactions._rows.slice(1), txnsBefore.slice(1));
  assert.deepEqual(w.sheets.Transactions._rows[0].slice(0, 7), txnsBefore[0]);
  w.restore();
});

test('a header the owner already filled in is not overwritten', () => {
  const w = oldWorkbook();
  w.sheets.Pockets._rows[0][9] = 'My Kind';
  migrateV2();
  assert.equal(w.sheets.Pockets._rows[0][9], 'My Kind');
  w.restore();
});

test('migration fills pocket defaults and a second run reports no change', () => {
  const w = oldWorkbook();
  const changes = migrateV2();
  assert.ok(changes.includes('Pockets: filled defaults on 2 rows'));
  assert.deepEqual(w.sheets.Pockets._rows[1].slice(6, 10), ['Reset', '', 0, 'Spend']);
  assert.deepEqual(w.sheets.Pockets._rows[2].slice(6, 10), ['Reset', '', 0, 'Spend']);
  assert.deepEqual(migrateV2(), []);
  w.restore();
});

test('readPockets on a 6-column sheet returns the v2 defaults', () => {
  const w = oldWorkbook();
  const [p] = readPockets();
  assert.equal(p.rule, 'Reset');
  assert.equal(p.sweepTo, '');
  assert.equal(p.carriedIn, 0);
  assert.equal(p.kind, 'Spend');
  w.restore();
});

test('readPockets returns the v2 fields stored on the sheet', () => {
  const w = oldWorkbook();
  migrateV2();
  w.sheets.Pockets._rows.push(v2Pocket({
    id: 'P09', name: 'Rainy Day', limit: 0, balance: 50, rule: 'Sweep', sweepTo: 'P09', carriedIn: 120, kind: 'Savings',
  }));
  const p = readPockets().find((x) => x.id === 'P09');
  assert.equal(p.rule, 'Sweep');
  assert.equal(p.sweepTo, 'P09');
  assert.equal(p.carriedIn, 120);
  assert.equal(p.kind, 'Savings');
  w.restore();
});
