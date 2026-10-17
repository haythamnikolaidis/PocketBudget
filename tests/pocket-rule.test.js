// tests/pocket-rule.test.js
// The leftover rule on createPocket / updatePocket.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPocket, updatePocket } from '../backend/05_Api.gs.js';
import { installGlobals, createProps } from './helpers/appsScriptGlobals.js';
import { freshWorkbook } from './helpers/fixtures.js';

const TOKEN = 'test-token';
const ROWS = [
  ['P01', 'Groceries', 'Chase', 800, 100, 'Active'],
  ['P02', 'Fuel', 'Chase', 300, 300, 'Active'],
  ['P03', 'Old', 'Chase', 100, 100, 'Archived'],
];

function setup() {
  const wb = freshWorkbook(ROWS, []);
  const ss = {
    getSheetByName: (n) => (n === 'Pockets' ? wb.pockets : n === 'Transactions' ? wb.txns : n === 'Monthly_Report' ? wb.report : null),
  };
  const lock = { tryLock: () => true, releaseLock() {} };
  const restore = installGlobals({
    ss,
    props: createProps({ API_TOKEN: TOKEN }),
    lockService: { getScriptLock: () => lock, getUserLock: () => lock },
  });
  return { wb, restore };
}

const create = (over) => createPocket({ token: TOKEN, name: 'New', account: 'Chase', limit: 100, ...over });
const update = (over) => updatePocket({ token: TOKEN, pocketId: 'P01', ...over });

test('createPocket with no rule stores Carry and writes all ten columns', () => {
  const { wb, restore } = setup();
  const r = create({});
  assert.equal(r.ok, true);
  const row = wb.pockets._rows[wb.pockets._rows.length - 1];
  assert.deepEqual(row.slice(3), [100, 100, 'Active', 'Carry', '', 0, 'Spend']);
  restore();
});

test('createPocket allows R0 with Carry but refuses R0 with Reset', () => {
  const { restore } = setup();
  assert.equal(create({ limit: 0 }).ok, true);
  const r = create({ limit: 0, rule: 'Reset' });
  assert.equal(r.error, 'INVALID_AMOUNT');
  assert.equal(r.message, 'A pocket that resets needs a monthly limit above R0.');
  restore();
});

test('createPocket refuses an unknown rule', () => {
  const { restore } = setup();
  assert.equal(create({ rule: 'Hoard' }).error, 'INVALID_RULE');
  restore();
});

test('Sweep to an unknown or archived pocket is refused; to an active one is stored', () => {
  const { wb, restore } = setup();
  assert.equal(create({ rule: 'Sweep', sweepTo: 'P99' }).error, 'INVALID_RULE');
  assert.equal(create({ rule: 'Sweep', sweepTo: 'P03' }).error, 'INVALID_RULE');
  assert.equal(create({ rule: 'Sweep' }).error, 'INVALID_RULE');
  assert.equal(create({ rule: 'Sweep', sweepTo: 'P02' }).ok, true);
  const row = wb.pockets._rows[wb.pockets._rows.length - 1];
  assert.deepEqual(row.slice(6, 8), ['Sweep', 'P02']);
  restore();
});

test('updatePocket refuses Sweep to itself', () => {
  const { restore } = setup();
  assert.equal(update({ rule: 'Sweep', sweepTo: 'P01' }).error, 'INVALID_RULE');
  restore();
});

test('updatePocket writes rule and sweepTo to columns G and H', () => {
  const { wb, restore } = setup();
  const r = update({ rule: 'Sweep', sweepTo: 'P02' });
  assert.equal(r.ok, true);
  assert.deepEqual(wb.pockets._rows[1].slice(6, 8), ['Sweep', 'P02']);
  restore();
});

test('updatePocket checks the effective rule: R0 on a Reset pocket is refused, on Carry allowed', () => {
  const { wb, restore } = setup();
  assert.equal(update({ limit: 0 }).error, 'INVALID_AMOUNT');
  assert.equal(update({ rule: 'Carry' }).ok, true);
  assert.equal(update({ limit: 0 }).ok, true);
  assert.equal(wb.pockets._rows[1][3], 0);
  assert.equal(update({ rule: 'Reset' }).error, 'INVALID_AMOUNT');
  restore();
});
