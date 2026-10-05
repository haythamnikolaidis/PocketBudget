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