// tests/rollover.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeRunRate, monthKey, shouldRollover, applyRollover, localParts, daysInLocalMonth } from '../backend/04_Rollover.gs.js';

test('computeRunRate projects month-end spend from elapsed days', () => {
  // 10 days in, R300 spent of an R800 pocket -> R300/10*31 = R930 projected.
  const r = computeRunRate({ spent: 300, limit: 800, daysElapsed: 10, daysInMonth: 31 });
  assert.equal(r.projected, 930);
  assert.equal(r.pctUsed, 37.5);
  // 930 / 800 = 116% of the limit, which is past the 110% critical line.
  assert.equal(r.severity, 'critical');
});

test('computeRunRate is warning just over the limit, under 110%', () => {
  // 10 days in, R280 spent -> projected 868, which is 108.5% of an R800 limit.
  const r = computeRunRate({ spent: 280, limit: 800, daysElapsed: 10, daysInMonth: 31 });
  assert.equal(r.projected, 868);
  assert.equal(r.severity, 'warning');
});

test('computeRunRate is onTrack when projection fits the limit', () => {
  const r = computeRunRate({ spent: 100, limit: 800, daysElapsed: 10, daysInMonth: 31 });
  assert.equal(r.severity, 'onTrack');
  assert.equal(r.projected, 310);
});

test('computeRunRate is critical past 110% of the limit', () => {
  const r = computeRunRate({ spent: 500, limit: 800, daysElapsed: 10, daysInMonth: 31 });
  assert.equal(r.severity, 'critical');   // 1550 projected
});

test('computeRunRate treats day 0 and zero limits safely', () => {
  const zeroLimit = computeRunRate({ spent: 0, limit: 0, daysElapsed: 0, daysInMonth: 31 });
  assert.equal(zeroLimit.pctUsed, 0);
  assert.equal(zeroLimit.severity, 'onTrack');
  assert.equal(zeroLimit.projected, 0);

  const dayOne = computeRunRate({ spent: 0, limit: 800, daysElapsed: 0, daysInMonth: 31 });
  assert.equal(dayOne.projected, 0);      // never divide by zero
});

test('computeRunRate never projects below actual spend when daysElapsed is 0', () => {
  // With zero elapsed days the velocity is unknown; fall back to actual spend.
  const r = computeRunRate({ spent: 400, limit: 800, daysElapsed: 0, daysInMonth: 31 });
  assert.equal(r.projected, 400);
});

test('monthKey formats YYYY-MM in the household timezone (SAST, UTC+2)', () => {
  assert.equal(monthKey(new Date('2026-10-01T00:00:00Z')), '2026-10');
  assert.equal(monthKey(new Date('2026-12-31T21:59:59Z')), '2026-12', '23:59:59 SAST on the 31st');
  assert.equal(monthKey(new Date('2026-12-31T22:00:00Z')), '2027-01', 'midnight SAST is already the new year');
});

test('an expense at 00:30 SAST on the 1st belongs to the NEW month (it counted as the old one in UTC)', () => {
  assert.equal(monthKey(new Date('2026-10-01T00:30:00+02:00')), '2026-10');
  assert.equal(monthKey(new Date('2026-09-30T23:30:00+02:00')), '2026-09');
});

test('localParts and daysInLocalMonth follow the household calendar', () => {
  assert.deepEqual(localParts(new Date('2026-02-28T22:30:00Z')), { year: 2026, month: 3, day: 1 });
  assert.equal(daysInLocalMonth(new Date('2026-02-10T12:00:00Z')), 28);
  assert.equal(daysInLocalMonth(new Date('2028-02-10T12:00:00Z')), 29);
  assert.equal(daysInLocalMonth(new Date('2026-02-28T22:30:00Z')), 31, 'it is already March 1 in SAST');
});

test('shouldRollover is true only when the month key moved on', () => {
  assert.equal(shouldRollover('2026-09', '2026-10-01T00:05:00Z'), true);
  assert.equal(shouldRollover('2026-10', '2026-10-01T00:05:00Z'), false);
  assert.equal(shouldRollover('2026-10', '2026-10-31T21:59:00Z'), false);
  assert.equal(shouldRollover(null, '2026-10-01T00:05:00Z'), true);   // first ever run
});

test('applyRollover resets active pockets to their limit and leaves others alone', () => {
  const pockets = [
    { id: 'P01', name: 'Groceries', limit: 800, balance: 340.5, status: 'Active' },
    { id: 'P02', name: 'Dining Out', limit: 250, balance: 15, status: 'Active' },
    { id: 'P03', name: 'Old', limit: 100, balance: 100, status: 'Archived' },
  ];
  const r = applyRollover(pockets);
  assert.equal(r.resetCount, 2);
  assert.equal(r.skippedCount, 1);
  assert.equal(r.pockets.find((p) => p.id === 'P01').balance, 800);
  assert.equal(r.pockets.find((p) => p.id === 'P03').balance, 100);  // archived untouched
});

const pk = (id, over = {}) => ({
  id, name: id, limit: 100, balance: 0, status: 'Active', rule: 'Reset', sweepTo: '', carriedIn: 0, kind: 'Spend', ...over,
});
const byId = (r, id) => r.pockets.find((p) => p.id === id);

test('applyRollover Carry: balance is limit plus leftover, with a carry adjustment', () => {
  const r = applyRollover([pk('P01', { rule: 'Carry', balance: 40 })], { fromMonthLabel: 'September 2026' });
  assert.equal(byId(r, 'P01').balance, 140);
  assert.equal(byId(r, 'P01').carriedIn, 40);
  assert.deepEqual(r.adjustments, [{ type: 'carry', toPocketId: 'P01', amount: 40, note: 'Left over from September 2026' }]);
});

test('applyRollover Reset: balance is the limit, leftover is forfeited', () => {
  const r = applyRollover([pk('P01', { rule: 'Reset', balance: 40, carriedIn: 10 })]);
  assert.equal(byId(r, 'P01').balance, 100);
  assert.equal(byId(r, 'P01').carriedIn, 0);
  assert.deepEqual(r.adjustments, [{ type: 'forfeit', fromPocketId: 'P01', amount: 40, note: 'Left over' }]);
});

test('applyRollover treats a missing rule as Reset', () => {
  const p = pk('P01', { balance: 30 });
  delete p.rule;
  const r = applyRollover([p]);
  assert.equal(byId(r, 'P01').balance, 100);
  assert.equal(r.adjustments[0].type, 'forfeit');
});

test('applyRollover Sweep moves the leftover into the target', () => {
  const r = applyRollover([
    pk('P01', { rule: 'Sweep', sweepTo: 'P09', balance: 25 }),
    pk('P09', { rule: 'Carry', kind: 'Savings', limit: 0, balance: 500 }),
  ], { fromMonthLabel: 'September 2026' });
  assert.equal(byId(r, 'P01').balance, 100);
  assert.equal(byId(r, 'P01').carriedIn, 0);
  assert.equal(byId(r, 'P09').balance, 525);
  assert.deepEqual(r.adjustments.find((a) => a.type === 'sweep'),
    { type: 'sweep', fromPocketId: 'P01', toPocketId: 'P09', amount: 25, note: 'Left over from September 2026' });
});

test('applyRollover: two pockets sweeping into Savings', () => {
  const r = applyRollover([
    pk('P01', { rule: 'Sweep', sweepTo: 'P09', balance: 25 }),
    pk('P02', { rule: 'Sweep', sweepTo: 'P09', balance: 15.5 }),
    pk('P09', { rule: 'Carry', kind: 'Savings', limit: 0, balance: 100 }),
  ]);
  assert.equal(byId(r, 'P09').balance, 140.5);
  assert.equal(byId(r, 'P09').carriedIn, 100);
  assert.equal(r.adjustments.filter((a) => a.type === 'sweep').length, 2);
});

test('applyRollover: a broken sweep target behaves as Carry', () => {
  const r = applyRollover([
    pk('P01', { rule: 'Sweep', sweepTo: 'P99', balance: 20 }),
    pk('P02', { rule: 'Sweep', sweepTo: 'P02', balance: 30 }),
    pk('P03', { rule: 'Sweep', sweepTo: 'P04', balance: 40 }),
    pk('P04', { status: 'Archived' }),
    pk('P05', { rule: 'Sweep', sweepTo: '', balance: 50 }),
  ]);
  assert.equal(byId(r, 'P01').balance, 120);
  assert.equal(byId(r, 'P02').balance, 130);
  assert.equal(byId(r, 'P03').balance, 140);
  assert.equal(byId(r, 'P05').balance, 150);
  assert.equal(byId(r, 'P01').carriedIn, 20);
  assert.deepEqual(r.adjustments.map((a) => a.type), ['carry', 'carry', 'carry', 'carry']);
});

test('applyRollover: nothing left over means no adjustment', () => {
  const r = applyRollover([
    pk('P01', { rule: 'Carry', balance: 0 }),
    pk('P02', { rule: 'Reset', balance: 0 }),
    pk('P03', { rule: 'Sweep', sweepTo: 'P01', balance: 0 }),
  ]);
  assert.deepEqual(r.adjustments, []);
  assert.equal(byId(r, 'P01').balance, 100);
  assert.equal(byId(r, 'P03').balance, 100);
});

test('applyRollover leaves archived pockets untouched and counts them', () => {
  const archived = pk('P01', { status: 'Archived', rule: 'Carry', balance: 77, carriedIn: 5 });
  const r = applyRollover([archived, pk('P02', { balance: 10 })]);
  assert.deepEqual(byId(r, 'P01'), archived);
  assert.equal(r.skippedCount, 1);
  assert.equal(r.resetCount, 1);
  assert.equal(r.adjustments.every((a) => a.fromPocketId !== 'P01' && a.toPocketId !== 'P01'), true);
});

test('applyRollover keeps cents exact (0.10 + 0.20 swept = 0.30)', () => {
  const r = applyRollover([
    pk('P01', { rule: 'Sweep', sweepTo: 'P09', balance: 0.1 }),
    pk('P02', { rule: 'Sweep', sweepTo: 'P09', balance: 0.2 }),
    pk('P09', { rule: 'Carry', limit: 0, balance: 0 }),
  ]);
  assert.equal(byId(r, 'P09').balance, 0.3);
  assert.deepEqual(r.adjustments.map((a) => a.amount), [0.1, 0.2]);
});

test('applyRollover: a Carry pocket that is also a sweep target ends with limit + own leftover + swept in', () => {
  const r = applyRollover([
    pk('P09', { rule: 'Carry', limit: 200, balance: 30 }),
    pk('P01', { rule: 'Sweep', sweepTo: 'P09', balance: 25 }),
  ]);
  assert.equal(byId(r, 'P09').balance, 255);
  assert.equal(byId(r, 'P09').carriedIn, 30);
});
