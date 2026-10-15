import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshWorkbook } from './helpers/fixtures.js';
import { createProps, installGlobals } from './helpers/appsScriptGlobals.js';
import { readRecentTransactions } from '../backend/03_Sheets.gs.js';

function withTxns(rows) {
  const wb = freshWorkbook([], rows);
  const calls = { getRange: 0 };
  const orig = wb.txns.getRange.bind(wb.txns);
  wb.txns.getRange = (...a) => { calls.getRange++; return orig(...a); };
  const ss = { getSheetByName: (n) => (n === 'Transactions' ? wb.txns : null) };
  const restore = installGlobals({ ss, props: createProps() });
  return { wb, calls, restore };
}

const row = (n, iso) => ['T' + (1000 + n), new Date(iso), 'Alex', 'P01', 10, 'x'];

test('3 months of rows: every row of the current month, newest first', () => {
  const rows = [];
  let n = 1;
  for (const m of ['2026-08', '2026-09', '2026-10']) {
    for (let d = 1; d <= 5; d++) rows.push(row(n++, `${m}-0${d}T12:00:00Z`));
  }
  const { restore } = withTxns(rows);
  try {
    const out = readRecentTransactions({ month: '2026-10', minRows: 1 });
    const oct = out.filter((t) => t.timestamp.startsWith('2026-10'));
    assert.equal(oct.length, 5);
    assert.deepEqual(out.slice(0, 5).map((t) => t.timestamp.slice(0, 10)),
      ['2026-10-05', '2026-10-04', '2026-10-03', '2026-10-02', '2026-10-01']);
    const sorted = [...out].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    assert.deepEqual(out, sorted);
  } finally { restore(); }
});

test('only 2 rows this month, 100 older: at least 30 rows returned', () => {
  const rows = [];
  for (let i = 0; i < 100; i++) rows.push(row(i + 1, new Date(Date.UTC(2026, 8, 1, 0, i)).toISOString()));
  rows.push(row(101, '2026-10-02T10:00:00Z'), row(102, '2026-10-03T10:00:00Z'));
  const { restore } = withTxns(rows);
  try {
    const out = readRecentTransactions({ month: '2026-10' });
    assert.ok(out.length >= 30);
    assert.equal(out[0].id, 'T1102');
  } finally { restore(); }
});

test('empty sheet and header-only sheet return []', () => {
  const { restore } = withTxns([]);
  try {
    assert.deepEqual(readRecentTransactions({ month: '2026-10' }), []);
  } finally { restore(); }
  const empty = withTxns([]);
  empty.wb.txns._rows = [];
  try {
    assert.deepEqual(readRecentTransactions({ month: '2026-10' }), []);
  } finally { empty.restore(); }
});

test('2,000 rows with 100 this month: at most 2 getRange calls', () => {
  const rows = [];
  for (let i = 0; i < 1900; i++) rows.push(row(i + 1, new Date(Date.UTC(2026, 8, 1) + i * 60000).toISOString()));
  for (let i = 0; i < 100; i++) rows.push(row(1901 + i, new Date(Date.UTC(2026, 9, 2) + i * 60000).toISOString()));
  const { restore, calls } = withTxns(rows);
  try {
    const out = readRecentTransactions({ month: '2026-10' });
    assert.ok(out.filter((t) => t.timestamp.startsWith('2026-10')).length === 100);
    assert.ok(calls.getRange <= 2, 'getRange calls: ' + calls.getRange);
  } finally { restore(); }
});
