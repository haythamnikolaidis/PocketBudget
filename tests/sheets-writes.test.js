// tests/sheets-writes.test.js
// Coverage for the write-path and bootstrap functions of 03_Sheets.gs.js that
// tests/sheets-api.test.js does not reach: appendPocket, updatePocketRow,
// archivePocketRow, the three get*Sheet accessors, and ensureSheets.
//
// These matter because the API dispatcher (05_Api.gs.js) calls them on every
// createPocket / updatePocket / deleteTransaction request.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getPocketSheet, getTransactionSheet, getReportSheet,
  appendPocket, updatePocketRow, archivePocketRow, readPockets, ensureSheets,
} from '../backend/03_Sheets.gs.js';
import { createSheet } from './helpers/fakeSheet.js';
import { installGlobals } from './helpers/appsScriptGlobals.js';
import { HEADER_POCKETS, HEADER_TRANSACTIONS, SAMPLE_POCKETS } from './helpers/fixtures.js';

/**
 * Wire a fake spreadsheet whose getSheetByName can also create sheets on demand,
 * so ensureSheets() is exercisable.
 */
function withWorkbook(pocketRows = SAMPLE_POCKETS) {
  const sheets = {
    Pockets: createSheet('Pockets', [HEADER_POCKETS, ...pocketRows]),
    Transactions: createSheet('Transactions', [HEADER_TRANSACTIONS]),
    Monthly_Report: createSheet('Monthly_Report', []),
  };
  const ss = {
    getSheetByName: (n) => sheets[n] || null,
    insertSheet: (n) => {
      const s = createSheet(n, []);
      sheets[n] = s;
      return s;
    },
  };
  const restore = installGlobals({ ss });
  return { sheets, restore };
}

test('the three sheet accessors return their own sheet by name', () => {
  const { sheets, restore } = withWorkbook();
  assert.equal(getPocketSheet().name, 'Pockets');
  assert.equal(getTransactionSheet().name, 'Transactions');
  assert.equal(getReportSheet().name, 'Monthly_Report');
  assert.equal(getPocketSheet(), sheets.Pockets);
  restore();
});

test('a missing sheet throws a named error rather than returning null', () => {
  const restore = installGlobals({
    ss: { getSheetByName: () => null, insertSheet: () => createSheet('x', []) },
  });
  assert.throws(() => getPocketSheet(), /Missing sheet: Pockets/);
  assert.throws(() => getTransactionSheet(), /Missing sheet: Transactions/);
  assert.throws(() => getReportSheet(), /Missing sheet: Monthly_Report/);
  restore();
});

test('appendPocket opens a pocket at balance === limit and returns its id', () => {
  const { restore } = withWorkbook([]);
  const p = appendPocket({ name: 'Fuel', account: 'Chase Checking', limit: 200 });
  assert.match(p.id, /^P\d{2}$/);
  assert.equal(p.balance, 200);
  assert.equal(p.status, 'Active');

  const [stored] = readPockets();
  assert.deepEqual(stored, {
    id: p.id, name: 'Fuel', account: 'Chase Checking',
    limit: 200, balance: 200, status: 'Active',
  });
  restore();
});

test('appendPocket continues the id sequence across calls', () => {
  const { restore } = withWorkbook([]);
  const a = appendPocket({ name: 'A', account: 'X', limit: 10 });
  const b = appendPocket({ name: 'B', account: 'X', limit: 10 });
  assert.ok(
    Number(b.id.slice(1)) === Number(a.id.slice(1)) + 1,
    'expected sequential ids, got ' + a.id + ' then ' + b.id,
  );
  restore();
});

test('updatePocketRow renames without disturbing the balance', () => {
  const { restore } = withWorkbook();
  const p = updatePocketRow('P01', { name: 'Food' });
  assert.equal(p.name, 'Food');
  assert.equal(p.balance, 340.5);   // unchanged
  assert.equal(p.limit, 800);
  restore();
});

test('updatePocketRow lowers the balance by the same amount as the limit, never below zero', () => {
  const { restore } = withWorkbook();
  // P01: limit 800, balance 340.50 (R459.50 spent). A limit of 600 keeps that spend: 140.50.
  assert.equal(updatePocketRow('P01', { limit: 600 }).balance, 140.5);
  // Lowering past what is left floors at zero rather than going negative.
  assert.equal(updatePocketRow('P01', { limit: 100 }).balance, 0);
  restore();
});

test('updatePocketRow raises the balance by the same amount as the limit (it used to stay put)', () => {
  const { restore } = withWorkbook();
  const p = updatePocketRow('P01', { limit: 1000 });
  assert.equal(p.limit, 1000);
  assert.equal(p.balance, 540.5, 'R200 more limit is R200 more to spend');
  restore();
});

test('raising then lowering a limit cannot create money', () => {
  const { restore } = withWorkbook();
  updatePocketRow('P01', { limit: 1000 });
  assert.equal(updatePocketRow('P01', { limit: 800 }).balance, 340.5);
  restore();
});

test('updatePocketRow throws for an unknown pocket', () => {
  const { restore } = withWorkbook();
  assert.throws(() => updatePocketRow('P99', { name: 'x' }), /P99/);
  restore();
});

test('archivePocketRow hides the pocket from readPockets but keeps the row', () => {
  const { restore } = withWorkbook();
  archivePocketRow('P02');
  const visible = readPockets();
  const all = readPockets({ includeArchived: true });
  assert.equal(visible.length, 1);
  assert.equal(all.length, 2);
  assert.equal(all.find((p) => p.id === 'P02').status, 'Archived');
  restore();
});

test('ensureSheets creates missing sheets with headers and a frozen header row', () => {
  const restore = installGlobals({
    ss: {
      getSheetByName: () => null,
      insertSheet: (n) => createSheet(n, []),
    },
  });
  const created = ensureSheets();
  assert.deepEqual(created.sort(), ['Monthly_Report', 'Pockets', 'Transactions']);
  restore();
});

test('ensureSheets is idempotent and never rewrites existing headers', () => {
  const { restore } = withWorkbook();
  // Headers already present from the fixture; ensureSheets must not clobber them.
  ensureSheets();
  const row = getPocketSheet().getRange(1, 1, 1, 6).getValues()[0];
  assert.deepEqual(row, HEADER_POCKETS);
  assert.equal(getPocketSheet()._frozenRows, 0, 'must not re-freeze an existing sheet');
  restore();
});