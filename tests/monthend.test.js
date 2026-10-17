// tests/monthend.test.js
// buildMonthEnd: the month-end leftovers summary shown during the first week of a month.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMonthEnd } from '../backend/05_Api.gs.js';

const pockets = [
  { id: 'P01', name: 'Groceries' },
  { id: 'P02', name: 'Fun' },
  { id: 'P03', name: 'Savings' },
];
const adjs = [
  { type: 'carry', fromPocketId: '', toPocketId: 'P01', amount: 120.1 },
  { type: 'sweep', fromPocketId: 'P02', toPocketId: 'P03', amount: 200.2 },
  { type: 'forfeit', fromPocketId: 'P02', toPocketId: '', amount: 5.05 },
  { type: 'transfer', fromPocketId: 'P01', toPocketId: 'P02', amount: 999 },
];

test('present on day 1 and day 7, null on day 8', () => {
  assert.ok(buildMonthEnd(adjs, pockets, new Date('2026-10-01T10:00:00Z')));
  assert.ok(buildMonthEnd(adjs, pockets, new Date('2026-10-07T10:00:00Z')));
  assert.equal(buildMonthEnd(adjs, pockets, new Date('2026-10-08T10:00:00Z')), null);
});

test('transfers are left out, items sorted biggest first with names', () => {
  const me = buildMonthEnd(adjs, pockets, new Date('2026-10-02T10:00:00Z'));
  assert.deepEqual(me.items.map((i) => i.type), ['sweep', 'carry', 'forfeit']);
  assert.deepEqual(me.items[0], {
    pocketId: 'P02', name: 'Fun', type: 'sweep', amount: 200.2, toPocketId: 'P03', toName: 'Savings',
  });
  assert.equal(me.items[1].pocketId, 'P01');
  assert.equal(me.items[1].name, 'Groceries');
});

test('totals are exact', () => {
  const me = buildMonthEnd(adjs, pockets, new Date('2026-10-02T10:00:00Z'));
  assert.deepEqual(me.totals, { carried: 120.1, swept: 200.2, forfeited: 5.05, all: 325.35 });
  assert.equal(me.fromMonth, '2026-09');
});

test('January reports the previous December', () => {
  const me = buildMonthEnd(adjs, pockets, new Date('2027-01-03T10:00:00Z'));
  assert.equal(me.fromMonth, '2026-12');
});

test('null when there are no carry, sweep or forfeit items', () => {
  assert.equal(buildMonthEnd([adjs[3]], pockets, new Date('2026-10-02T10:00:00Z')), null);
  assert.equal(buildMonthEnd([], pockets, new Date('2026-10-02T10:00:00Z')), null);
});
