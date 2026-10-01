import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  readPockets, readTransactions, findPocketRow, writeBalance,
  appendTransaction, deleteTransactionRow, nextPocketIdFromSheet,
  nextTransactionIdFromSheet,
} from '../backend/03_Sheets.gs.js';
import { installGlobals } from './helpers/appsScriptGlobals.js';
import { freshWorkbook, SAMPLE_POCKETS, SAMPLE_TXNS } from './helpers/fixtures.js';

/** Wire the fixture workbook into fake Apps Script globals; returns a restore fn. */
function withWorkbook(pocketRows = SAMPLE_POCKETS, txnRows = SAMPLE_TXNS) {
  const wb = freshWorkbook(pocketRows, txnRows);
  const ss = {
    getSheetByName: (n) => wb.pockets.name === n ? wb.pockets
      : wb.txns.name === n ? wb.txns
      : wb.report.name === n ? wb.report
      : null,
  };
  const restore = installGlobals({ ss });
  return { wb, restore };
}

test('readPockets returns typed objects and skips blank rows', () => {
  const { restore } = withWorkbook([
    ['P01', 'Groceries', 'Chase Checking', 800, 340.5, 'Active'],
    ['', '', '', '', '', ''],
    ['P02', 'Dining Out', 'Credit Card A', 250, 15, 'Active'],
  ]);
  const pockets = readPockets();
  assert.equal(pockets.length, 2);
  assert.deepEqual(pockets[0], {
    id: 'P01', name: 'Groceries', account: 'Chase Checking',
    limit: 800, balance: 340.5, status: 'Active',
  });
  restore();
});

test('readPockets excludes Archived pockets by default', () => {
  const { restore } = withWorkbook([
    ['P01', 'Groceries', 'Chase', 800, 340.5, 'Active'],
    ['P02', 'Old', 'Chase', 100, 100, 'Archived'],
  ]);
  assert.equal(readPockets().length, 1);
  assert.equal(readPockets({ includeArchived: true }).length, 2);
  restore();
});

test('readPockets tolerates a sheet with no header row', () => {
  const { restore } = withWorkbook([], []);
  assert.deepEqual(readPockets(), []);
  restore();
});

test('readTransactions returns newest first', () => {
  const { restore } = withWorkbook(SAMPLE_POCKETS, [
    ['T1001', new Date('2026-10-01T14:20:00Z'), 'Alex', 'P01', 65.2, 'Whole Foods'],
    ['T1002', new Date('2026-10-03T09:00:00Z'), 'Sam', 'P02', 42, 'Pizza Night'],
    ['T1003', new Date('2026-10-02T11:00:00Z'), 'Alex', 'P01', 10, 'Cafe'],
  ]);
  const txns = readTransactions();
  assert.deepEqual(txns.map((t) => t.id), ['T1002', 'T1003', 'T1001']);
  restore();
});

test('readTransactions honours a limit', () => {
  const { restore } = withWorkbook();
  assert.equal(readTransactions({ limit: 2 }).length, 2);
  restore();
});

test('readTransactions converts amount to a number and timestamp to ISO', () => {
  const { restore } = withWorkbook();
  const [t] = readTransactions({ limit: 1 });
  assert.equal(typeof t.amount, 'number');
  assert.equal(typeof t.timestamp, 'string');
  assert.match(t.timestamp, /^\d{4}-\d{2}-\d{2}T/);
  restore();
});

test('findPocketRow locates the 1-based sheet row, or 0 when absent', () => {
  const { restore } = withWorkbook();
  assert.equal(findPocketRow('P01'), 2);   // row 1 is the header
  assert.equal(findPocketRow('P02'), 3);
  assert.equal(findPocketRow('P99'), 0);
  restore();
});

test('writeBalance updates only column E and leaves siblings alone', () => {
  const { restore, wb } = withWorkbook();
  writeBalance('P01', 275.3);
  const row = wb.pockets.getRange(2, 1, 1, 6).getValues()[0];
  assert.equal(row[4], 275.3);
  assert.equal(row[3], 800);          // limit untouched
  assert.equal(row[1], 'Groceries');   // name untouched
  restore();
});

test('writeBalance throws when the pocket does not exist', () => {
  const { restore } = withWorkbook();
  assert.throws(() => writeBalance('P99', 10), /P99/);
  restore();
});

test('appendTransaction returns the new id and the row is readable back', () => {
  const { restore } = withWorkbook();
  const id = appendTransaction({
    user: 'Alex', pocketId: 'P01', amount: 12.34,
    note: 'Bakery', timestamp: new Date('2026-10-05T10:00:00Z'),
  });
  assert.equal(id, 'T1003');
  const txns = readTransactions();
  assert.equal(txns[0].id, 'T1003');
  assert.equal(txns[0].amount, 12.34);
  restore();
});

test('deleteTransactionRow removes the row and returns what it deleted', () => {
  const { restore, wb } = withWorkbook();
  const deleted = deleteTransactionRow('T1002');
  assert.equal(deleted.pocketId, 'P02');
  assert.equal(deleted.amount, 42);
  assert.deepEqual(readTransactions().map((t) => t.id), ['T1001']);
  restore();
});

test('deleteTransactionRow returns null for an unknown id', () => {
  const { restore } = withWorkbook();
  assert.equal(deleteTransactionRow('T9999'), null);
  restore();
});

test('nextPocketIdFromSheet and nextTransactionIdFromSheet read the sheet', () => {
  const { restore } = withWorkbook();
  assert.equal(nextPocketIdFromSheet(), 'P03');
  assert.equal(nextTransactionIdFromSheet(), 'T1003');
  restore();
});