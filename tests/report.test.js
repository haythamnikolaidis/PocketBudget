// tests/report.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summariseSpend, buildReportRows, daysElapsedInMonth } from '../backend/06_Report.gs.js';

const POCKETS = [
  { id: 'P01', name: 'Groceries', account: 'Chase Checking', limit: 800, balance: 340.5, status: 'Active' },
  { id: 'P02', name: 'Dining Out', account: 'Credit Card A', limit: 250, balance: 15, status: 'Active' },
];

const TXNS = [
  { id: 'T1001', timestamp: '2026-10-01T14:20:00.000Z', user: 'Alex', pocketId: 'P01', amount: 65.2, note: 'Whole Foods' },
  { id: 'T1002', timestamp: '2026-10-01T18:45:00.000Z', user: 'Sam', pocketId: 'P02', amount: 42, note: 'Pizza Night' },
  { id: 'T1003', timestamp: '2026-09-30T10:00:00.000Z', user: 'Alex', pocketId: 'P01', amount: 500, note: 'September bulk' },
];

test('summariseSpend totals only transactions inside the month', () => {
  const s = summariseSpend(TXNS, POCKETS, '2026-10');
  assert.equal(s.byPocket.P01, 65.2);    // the $500 is September, excluded
  assert.equal(s.byPocket.P02, 42);
  assert.equal(s.byUser.Alex, 65.2);
  assert.equal(s.byUser.Sam, 42);
  assert.equal(s.total, 107.2);
  assert.equal(s.count, 2);
});

test('summariseSpend ignores transactions for unknown pockets', () => {
  const s = summariseSpend([...TXNS, { id: 'T9', timestamp: '2026-10-05T00:00:00.000Z', user: 'Alex', pocketId: 'P99', amount: 10, note: '' }], POCKETS, '2026-10');
  assert.equal(Object.keys(s.byPocket).includes('P99'), false);
  assert.equal(s.total, 107.2);
});

test('summariseSpend reports every configured user, even at zero', () => {
  const s = summariseSpend([], POCKETS, '2026-10');
  assert.deepEqual(Object.keys(s.byUser).sort(), ['Alex', 'Sam']);
  assert.equal(s.total, 0);
});

test('buildReportRows lays out budget vs actual with run-rate per pocket', () => {
  const rows = buildReportRows({
    pockets: POCKETS, transactions: TXNS, month: '2026-10',
    now: new Date('2026-10-10T12:00:00Z'), daysInMonth: 31,
  });
  const header = rows[0];
  assert.deepEqual(header.slice(0, 5),
    ['Month', 'Pocket', 'Bank Account', 'Monthly Limit', 'Spent']);

  const groceries = rows.find((r) => r[1] === 'Groceries');
  assert.equal(groceries[0], '2026-10');
  assert.equal(groceries[4], 65.2);       // month-scoped spend
  assert.equal(groceries[5], 800 - 65.2); // remaining vs limit for this month
  assert.ok(['onTrack', 'warning', 'critical'].includes(groceries[8]));
});

test('buildReportRows appends a spouse-split block', () => {
  const rows = buildReportRows({
    pockets: POCKETS, transactions: TXNS, month: '2026-10',
    now: new Date('2026-10-10T12:00:00Z'), daysInMonth: 31,
  });
  const flat = rows.map((r) => r.join(' ')).join('\n');
  assert.match(flat, /SPOUSE SPLIT/);
  assert.match(flat, /Alex/);
  assert.match(flat, /Sam/);
});

test('daysElapsedInMonth counts elapsed days, never more than the total', () => {
  assert.equal(daysElapsedInMonth(new Date('2026-10-01T00:30:00Z'), 31), 1);
  assert.equal(daysElapsedInMonth(new Date('2026-10-10T12:00:00Z'), 31), 10);
  assert.equal(daysElapsedInMonth(new Date('2026-10-31T23:00:00Z'), 31), 31);
});