// tests/update-users.test.js
// updateUsers: the household names are entered in the app and stored in the USERS
// Script Property. Nothing in code names anyone.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { updateUsers, createTransaction, handleRequest } from '../backend/05_Api.gs.js';
import { getUsers } from '../backend/02_Auth.gs.js';
import { ACTIONS } from '../backend/00_Config.gs.js';
import { installGlobals, createProps } from './helpers/appsScriptGlobals.js';
import { freshWorkbook, createSheet } from './helpers/fixtures.js';

const TOKEN = 'test-token';

/** A fake workbook, a script lock that logs lock/release/flush, and Script Properties with no USERS. */
function setup({ props = {} } = {}) {
  const wb = freshWorkbook([['P01', 'Groceries', 'Chase', 800, 100, 'Active']], []);
  const ss = {
    getSheetByName: (n) => (n === 'Pockets' ? wb.pockets : n === 'Transactions' ? wb.txns : n === 'Monthly_Report' ? wb.report : null),
    insertSheet: (n) => createSheet(n, []),
  };
  const events = [];
  let held = false;
  const lock = {
    tryLock() { if (held) return false; held = true; events.push('lock'); return true; },
    releaseLock() { held = false; events.push('release'); },
  };
  const scriptProps = createProps({ API_TOKEN: TOKEN, ...props });
  const restore = installGlobals({
    ss,
    props: scriptProps,
    lockService: { getScriptLock: () => lock, getUserLock: () => lock },
  });
  globalThis.SpreadsheetApp.flush = () => { events.push('flush'); };
  return { wb, events, scriptProps, hold: () => { held = true; }, restore };
}

const save = (users, over = {}) => updateUsers({ token: TOKEN, users, ...over });
const viaDispatcher = (action, params) => handleRequest({ action, params: { token: TOKEN, ...params } });

test('getUsers is empty when the USERS property is unset, blank or only commas', () => {
  for (const props of [{}, { USERS: '' }, { USERS: ' , ,' }]) {
    const s = setup({ props });
    assert.deepEqual(getUsers(), [], JSON.stringify(props));
    s.restore();
  }
});

test('updateUsers is a registered API action', () => {
  assert.ok(ACTIONS.includes('updateUsers'));
});

test('updateUsers saves the list; getUsers and getState return it', () => {
  const s = setup();
  const r = viaDispatcher('updateUsers', { users: ['Thandi', 'Pieter'] });
  assert.equal(r.ok, true);
  assert.deepEqual(r.users, ['Thandi', 'Pieter']);
  assert.equal(s.scriptProps.getProperty('USERS'), 'Thandi,Pieter');
  assert.deepEqual(getUsers(), ['Thandi', 'Pieter']);
  assert.deepEqual(viaDispatcher('getState', {}).summary.users, ['Thandi', 'Pieter']);
  s.restore();
});

test('updateUsers trims each name and returns what was saved', () => {
  const s = setup();
  const r = save(['  Thandi ', 'Pieter  ']);
  assert.deepEqual(r.users, ['Thandi', 'Pieter']);
  assert.equal(s.scriptProps.getProperty('USERS'), 'Thandi,Pieter');
  s.restore();
});

test('updateUsers replaces the previous list', () => {
  const s = setup({ props: { USERS: 'Alex,Sam' } });
  assert.deepEqual(save(['Thandi']).users, ['Thandi']);
  assert.deepEqual(getUsers(), ['Thandi']);
  s.restore();
});

test('updateUsers accepts a single name, ten names, and a 30-character name', () => {
  const s = setup();
  assert.equal(save(['Thandi']).ok, true);
  const ten = Array.from({ length: 10 }, (_, i) => 'Member' + i);
  assert.deepEqual(save(ten).users, ten);
  assert.equal(save(['x'.repeat(30)]).ok, true);
  s.restore();
});

test('updateUsers refuses a bad list whole, says INVALID_USERS, and keeps the saved list', () => {
  const s = setup({ props: { USERS: 'Thandi,Pieter' } });
  const cases = {
    'empty list': [],
    'not a list': 'Thandi,Pieter',
    'missing': undefined,
    'a non-string name': ['Thandi', 7],
    'a blank name': ['Thandi', ''],
    'a whitespace-only name': ['Thandi', '   '],
    'a duplicate': ['Thandi', 'Pieter', 'Thandi'],
    'a duplicate that differs only by case': ['Thandi', 'THANDI'],
    'a duplicate that differs only by spaces and case': ['Thandi', ' thandi '],
    'a comma in a name': ['Thandi', 'Pieter, Jr'],
    'a 31-character name': ['x'.repeat(31)],
    'eleven names': Array.from({ length: 11 }, (_, i) => 'Member' + i),
  };
  for (const [label, users] of Object.entries(cases)) {
    const r = save(users);
    assert.equal(r.ok, false, label);
    assert.equal(r.error, 'INVALID_USERS', label);
    assert.ok(r.message, label + ' explains itself');
    assert.equal(s.scriptProps.getProperty('USERS'), 'Thandi,Pieter', label + ' leaves the saved list alone');
  }
  s.restore();
});

test('updateUsers rejects a bad or missing token and changes nothing', () => {
  const s = setup({ props: { USERS: 'Thandi,Pieter' } });
  for (const token of ['wrong', '', undefined]) {
    const r = updateUsers({ token, users: ['Mallory'] });
    assert.equal(r.ok, false);
    assert.equal(r.error, 'UNAUTHORIZED');
  }
  assert.equal(s.scriptProps.getProperty('USERS'), 'Thandi,Pieter');
  assert.deepEqual(s.events, [], 'not even the lock was touched');
  s.restore();
});

test('updateUsers takes the lock, flushes, then releases it', () => {
  const s = setup();
  save(['Thandi']);
  assert.deepEqual(s.events, ['lock', 'flush', 'release']);
  s.restore();
});

test('updateUsers releases the lock if the write throws', () => {
  const s = setup();
  const props = globalThis.PropertiesService.getScriptProperties();
  const realSet = props.setProperty;
  props.setProperty = () => { throw new Error('quota'); };
  const r = viaDispatcher('updateUsers', { users: ['Thandi'] });
  props.setProperty = realSet;
  assert.equal(r.ok, false);
  assert.equal(r.error, 'SERVER_ERROR');
  assert.deepEqual(s.events, ['lock', 'flush', 'release']);
  s.restore();
});

test('updateUsers answers BUSY and writes nothing when the lock is held', () => {
  const s = setup({ props: { USERS: 'Thandi,Pieter' } });
  s.hold();
  const r = save(['Mallory']);
  assert.equal(r.ok, false);
  assert.equal(r.error, 'BUSY');
  assert.equal(s.scriptProps.getProperty('USERS'), 'Thandi,Pieter');
  s.restore();
});

test('no names, no expenses: createTransaction refuses while the list is empty', () => {
  const s = setup();
  const r = createTransaction({ token: TOKEN, user: 'Alex', pocketId: 'P01', amount: 5 });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'INVALID_USER');
  assert.equal(s.wb.pockets._rows[1][4], 100, 'balance untouched');
  s.restore();
});

test('createTransaction accepts a saved name and rejects one that is not in the saved list', () => {
  const s = setup();
  save(['Thandi', 'Pieter']);
  const bad = createTransaction({ token: TOKEN, user: 'Alex', pocketId: 'P01', amount: 5 });
  assert.equal(bad.ok, false);
  assert.equal(bad.error, 'INVALID_USER');
  assert.equal(s.wb.pockets._rows[1][4], 100, 'balance untouched');
  assert.equal(createTransaction({ token: TOKEN, user: 'Pieter', pocketId: 'P01', amount: 5 }).ok, true);
  assert.equal(s.wb.pockets._rows[1][4], 95);

  save(['Thandi']);
  assert.equal(createTransaction({ token: TOKEN, user: 'Pieter', pocketId: 'P01', amount: 5 }).error, 'INVALID_USER', 'a removed name is refused');
  s.restore();
});
