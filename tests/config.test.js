import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as config from '../backend/00_Config.gs.js';
import { SHEETS, ACTIONS, SERVER_VERSION } from '../backend/00_Config.gs.js';

test('config exposes the three sheet names', () => {
  assert.equal(SHEETS.POCKETS, 'Pockets');
  assert.equal(SHEETS.TRANSACTIONS, 'Transactions');
  assert.equal(SHEETS.REPORT, 'Monthly_Report');
});

test('config holds no household names: they are entered in the app', () => {
  assert.equal('USERS' in config, false);
});

test('config action list covers the public API', () => {
  for (const a of ['ping', 'getState', 'createPocket', 'updatePocket',
                   'createTransaction', 'deleteTransaction', 'updateUsers']) {
    assert.ok(ACTIONS.includes(a), `missing action ${a}`);
  }
});

test('server version is semver-shaped', () => {
  assert.match(SERVER_VERSION, /^\d+\.\d+\.\d+$/);
});