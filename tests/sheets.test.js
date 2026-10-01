import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSheet, resetSheet } from './helpers/fakeSheet.js';
import { createLock, createProps, installGlobals } from './helpers/appsScriptGlobals.js';

const H = ['Pocket ID', 'Pocket Name'];   // stands in for the header row

test('fakeSheet: getRange reads cells, 1-based including the header', () => {
  const sh = createSheet('Pockets', [H, ['P01', 'Groceries']]);
  assert.equal(sh.getLastRow(), 2);
  assert.deepEqual(sh.getRange(1, 1, 1, 1).getValues(), [['Pocket ID']]);
  assert.deepEqual(sh.getRange(2, 1, 1, 1).getValues(), [['P01']]);
});

test('fakeSheet: setValue writes through to the sheet, not just the snapshot', () => {
  const sh = createSheet('Pockets', [H, ['P01', 'Groceries', 'Chase', 800, 340.5, 'Active']]);
  sh.getRange(2, 5).setValue(300);
  assert.deepEqual(sh.getRange(2, 5).getValues(), [[300]]);
});

test('fakeSheet: setValues writes a whole row', () => {
  const sh = createSheet('Pockets', [H, ['P01', 'Groceries', 'Chase', 800, 340.5, 'Active']]);
  sh.getRange(2, 1, 1, 6).setValues([['P01', 'Groceries', 'Chase', 800, 300, 'Active']]);
  assert.deepEqual(sh.getRange(2, 1, 1, 6).getValues(),
    [['P01', 'Groceries', 'Chase', 800, 300, 'Active']]);
});

test('fakeSheet: appendRow adds after the last row', () => {
  const sh = createSheet('Pockets', [H, ['P01', 'Groceries']]);
  sh.appendRow(['P02', 'Fuel']);
  assert.equal(sh.getLastRow(), 3);
  assert.deepEqual(sh.getRange(3, 1).getValues(), [['P02']]);
});

test('fakeSheet: deleteRow removes the given 1-based row', () => {
  const sh = createSheet('Pockets', [H, ['P01', 'Groceries'], ['P02', 'Fuel']]);
  sh.deleteRow(2);
  assert.deepEqual(sh.getRange(2, 1).getValues(), [['P02']]);
});

test('fakeSheet: getRange tolerates out-of-range reads', () => {
  const sh = createSheet('Pockets', [H, ['P01']]);
  assert.deepEqual(sh.getRange(99, 1).getValues(), [['']]);
});

test('fakeSheet: resetSheet restores rows', () => {
  const sh = createSheet('Pockets', [H, ['P01', 'Groceries']]);
  resetSheet(sh, [H, ['P09', 'Fuel']]);
  assert.deepEqual(sh.getRange(2, 1).getValues(), [['P09']]);
});

test('lock stub records acquisition', () => {
  const lock = createLock();
  assert.equal(lock.hasLock(), false);
  lock.tryLock(1000);
  assert.equal(lock.hasLock(), true);
  lock.releaseLock();
  assert.equal(lock.hasLock(), false);
});

test('props stub round-trips values as strings', () => {
  const p = createProps({ API_TOKEN: 'abc' });
  assert.equal(p.getProperty('API_TOKEN'), 'abc');
  assert.equal(p.getProperty('MISSING'), null);
  p.setProperty('SHEET_ID', '123');
  assert.equal(p.getProperty('SHEET_ID'), '123');
});

test('installGlobals installs and restores cleanly', () => {
  assert.equal(globalThis.SpreadsheetApp, undefined);
  const restore = installGlobals({});
  assert.equal(typeof globalThis.SpreadsheetApp, 'object');
  restore();
  assert.equal(globalThis.SpreadsheetApp, undefined);
});