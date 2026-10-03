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
  assert.equal(s.byPocket.P01, 65.2);    // the R500 is September, excluded
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
/* ------------------------------------------------------ rendering (item 3) -- */

import { renderReport, buildReport, monthlyTotals, padRows } from '../backend/06_Report.gs.js';
import { createSheet } from './helpers/fakeSheet.js';

const NOW = new Date('2026-10-10T12:00:00Z');

test('the report is rectangular, so setValues accepts it (it threw every night when ragged)', () => {
  const { rows } = buildReport({ pockets: POCKETS, transactions: TXNS, month: '2026-10', now: NOW, daysInMonth: 31 });
  const widths = new Set(rows.map((r) => r.length));
  assert.equal(widths.size, 1, 'every row has the same width: ' + [...widths].join(','));
  assert.equal(padRows([[1], [1, 2, 3], []]).every((r) => r.length === 3), true);
});

test('renderReport writes the whole report to a sheet that enforces the range size', () => {
  const sheet = createSheet('Monthly_Report', []);
  const out = renderReport(sheet, { pockets: POCKETS, transactions: TXNS, now: NOW });
  assert.equal(out.month, '2026-10');
  assert.equal(sheet._rows[0][1], 'Pocket');
  assert.equal(sheet._rows.length, out.rowCount);
});

test('the report keeps history: spend per month comes from Transactions, not the current month only', () => {
  assert.deepEqual(monthlyTotals(TXNS, POCKETS), [['2026-09', 500], ['2026-10', 107.2]]);
  const { rows } = buildReport({ pockets: POCKETS, transactions: TXNS, month: '2026-10', now: NOW, daysInMonth: 31 });
  const flat = rows.map((r) => r.join('|')).join('\n');
  assert.match(flat, /MONTH-OVER-MONTH/);
  assert.match(flat, /2026-09\|500/);
});

test('monthlyTotals keeps only the newest 12 months and ignores unknown pockets', () => {
  const many = [];
  for (let m = 1; m <= 12; m++) many.push({ id: 'T' + m, timestamp: `2025-${String(m).padStart(2, '0')}-15T10:00:00Z`, user: 'Alex', pocketId: 'P01', amount: 1, note: '' });
  many.push({ id: 'T99', timestamp: '2026-01-15T10:00:00Z', user: 'Alex', pocketId: 'P01', amount: 1, note: '' });
  many.push({ id: 'T98', timestamp: '2026-02-15T10:00:00Z', user: 'Alex', pocketId: 'P77', amount: 5, note: '' });
  const out = monthlyTotals(many, POCKETS);
  assert.equal(out.length, 12);
  assert.equal(out[0][0], '2025-02');
  assert.equal(out.at(-1)[0], '2026-01');
});

test('the run-rate is not shown in the first days of a month, when it is noise', () => {
  const early = buildReport({ pockets: POCKETS, transactions: TXNS, month: '2026-10', now: new Date('2026-10-02T12:00:00Z'), daysInMonth: 31 });
  const row = early.rows.find((r) => r[1] === 'Groceries');
  assert.equal(row[8], 'tooEarly');
  assert.equal(row[9], '');
});

test('pocket names that look like formulas are written as text', () => {
  const evil = [{ id: 'P01', name: '=IMPORTDATA("http://x")', account: '+1', limit: 10, balance: 10, status: 'Active' }];
  const { rows } = buildReport({ pockets: evil, transactions: [], month: '2026-10', now: NOW, daysInMonth: 31 });
  assert.equal(rows[1][1], '\'=IMPORTDATA("http://x")');
  assert.equal(rows[1][2], "'+1");
});

test('charts are drawn from the right ranges, and a chart failure never loses the data', () => {
  const charts = [];
  const sheet = createSheet('Monthly_Report', []);
  const realGetRange = sheet.getRange.bind(sheet);
  sheet.getRange = (...a) => { const r = realGetRange(...a); r.setFontWeight = () => r; r.setNumberFormat = () => r; return r; };
  const removed = [];
  sheet.getCharts = () => [{ id: 'old' }];
  sheet.removeChart = (c) => removed.push(c.id);
  sheet.insertChart = (c) => charts.push(c);
  sheet.newChart = () => {
    const spec = { ranges: [] };
    const b = {
      setChartType: (t) => { spec.type = t; return b; },
      addRange: (r) => { spec.ranges.push(r); return b; },
      setNumHeaders: () => b, setOption: (k, v) => { spec[k] = v; return b; },
      setPosition: () => b, build: () => spec,
    };
    return b;
  };
  globalThis.Charts = { ChartType: { COLUMN: 'COLUMN', PIE: 'PIE' } };
  try {
    renderReport(sheet, { pockets: POCKETS, transactions: TXNS, now: NOW });
    assert.deepEqual(removed, ['old'], 'old charts are replaced, not stacked');
    assert.equal(charts.length, 3);
    assert.deepEqual(charts.map((c) => c.type), ['COLUMN', 'PIE', 'COLUMN']);

    // Now make charting blow up: the numbers must still be on the sheet.
    sheet.newChart = () => { throw new Error('charts unavailable'); };
    const sheet2Rows = () => sheet._rows.length;
    assert.doesNotThrow(() => renderReport(sheet, { pockets: POCKETS, transactions: TXNS, now: NOW }));
    assert.ok(sheet2Rows() > 5);
  } finally {
    delete globalThis.Charts;
  }
});
