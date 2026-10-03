// tests/setup.test.js
// setup() and the first nightly run: neither may destroy data.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, dailyRollover } from '../backend/07_Entry.gs.js';
import { monthKey } from '../backend/04_Rollover.gs.js';
import { installGlobals, createProps } from './helpers/appsScriptGlobals.js';
import { createSheet } from './helpers/fakeSheet.js';
import { HEADER_POCKETS, HEADER_TRANSACTIONS } from './helpers/fixtures.js';

/** A workbook + ScriptApp double that records triggers. */
function world({ props = {}, pockets = [], triggers = [] } = {}) {
  const sheets = {
    Pockets: createSheet('Pockets', [HEADER_POCKETS, ...pockets]),
    Transactions: createSheet('Transactions', [HEADER_TRANSACTIONS]),
    Monthly_Report: createSheet('Monthly_Report', []),
  };
  const ss = {
    getSheetByName: (n) => sheets[n] || null,
    insertSheet: (n) => (sheets[n] = createSheet(n, [])),
  };
  const p = createProps(props);
  const restore = installGlobals({ ss, props: p });
  const live = [...triggers];
  globalThis.ScriptApp = {
    getProjectTriggers: () => [...live],
    deleteTrigger: (t) => { live.splice(live.indexOf(t), 1); },
    newTrigger: (fn) => {
      const spec = { fn };
      const b = { timeBased: () => b, everyDays: () => b, atHour: () => b, create: () => { live.push({ getHandlerFunction: () => fn }); return spec; } };
      return b;
    },
  };
  globalThis.Logger = { log() {} };
  return { sheets, props: p, live, restore: () => { restore(); delete globalThis.ScriptApp; delete globalThis.Logger; } };
}

test('setup() creates exactly one dailyRollover trigger, however often it is run', () => {
  const w = world();
  setup(); setup(); setup();
  assert.equal(w.live.filter((t) => t.getHandlerFunction() === 'dailyRollover').length, 1);
  w.restore();
});

test('setup() leaves other triggers alone', () => {
  const other = { getHandlerFunction: () => 'somethingElse' };
  const w = world({ triggers: [other] });
  setup();
  assert.ok(w.live.includes(other));
  w.restore();
});

test('setup() keeps an existing token and generates one only when missing', () => {
  const w = world({ props: { API_TOKEN: 'keep-me' } });
  setup();
  assert.equal(w.props.getProperty('API_TOKEN'), 'keep-me');
  w.restore();
  const w2 = world();
  setup();
  assert.ok(w2.props.getProperty('API_TOKEN').length >= 24, 'a token was generated');
  w2.restore();
});

test('setup() records this month, so the first nightly run does not reset mid-month spending', () => {
  const w = world({ pockets: [['P01', 'Groceries', 'Chase', 800, 120, 'Active']] });
  setup();
  assert.equal(w.props.getProperty('LAST_ROLLOVER_KEY'), monthKey(new Date()));
  dailyRollover();
  assert.equal(w.sheets.Pockets._rows[1][4], 120, 'balance untouched');
  w.restore();
});

test('an install that never recorded a rollover is seeded, not wiped, on its next run', () => {
  const w = world({ pockets: [['P01', 'Groceries', 'Chase', 800, 120, 'Active']] });   // no key: set up before it existed
  dailyRollover();
  assert.equal(w.sheets.Pockets._rows[1][4], 120);
  assert.equal(w.props.getProperty('LAST_ROLLOVER_KEY'), monthKey(new Date()));
  w.restore();
});

test('the rollover still happens once a month has really passed', () => {
  const w = world({ props: { LAST_ROLLOVER_KEY: '2020-01' }, pockets: [['P01', 'Groceries', 'Chase', 800, 120, 'Active']] });
  dailyRollover();
  assert.equal(w.sheets.Pockets._rows[1][4], 800);
  w.restore();
});
