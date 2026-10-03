// backend/06_Report.gs.js
// CANONICAL SOURCE. Aggregates Transactions -> Monthly_Report.
// Spend is scoped to the report month; history survives rollover because it is
// derived from Transactions, never from Current Balance.

import { USERS } from './00_Config.gs.js';
import { escapeCell } from './01_Utils.gs.js';
import { computeRunRate, monthKey, localParts, daysInLocalMonth } from './04_Rollover.gs.js';

/** Days elapsed in the reporting month, household-local (1-based, capped at daysInMonth). */
export function daysElapsedInMonth(now = new Date(), daysInMonth = 31) {
  return Math.min(Math.max(1, localParts(now).day), daysInMonth);
}

/** Total spend within `month`, broken down by pocket and by user. */
export function summariseSpend(transactions, pockets, month, users = USERS) {
  const known = new Set(pockets.map((p) => p.id));
  const byPocket = {};
  const byUser = {};
  for (const u of users) byUser[u] = 0;

  let total = 0;
  let count = 0;

  for (const t of transactions) {
    if (!t.timestamp || monthKey(new Date(t.timestamp)) !== month) continue;
    if (!known.has(t.pocketId)) continue;
    const amt = Number(t.amount) || 0;
    byPocket[t.pocketId] = (byPocket[t.pocketId] || 0) + amt;
    byUser[t.user] = (byUser[t.user] || 0) + amt;
    total += amt;
    count++;
  }

  return {
    byPocket, byUser,
    total: Math.round(total * 100) / 100,
    count,
  };
}

/** Spend per calendar month across ALL months, oldest first, newest `limit` months only. */
export function monthlyTotals(transactions, pockets, limit = 12) {
  const known = new Set(pockets.map((p) => p.id));
  const totals = new Map();
  for (const t of transactions) {
    if (!t.timestamp || !known.has(t.pocketId)) continue;
    const key = monthKey(new Date(t.timestamp));
    totals.set(key, (totals.get(key) || 0) + (Number(t.amount) || 0));
  }
  return [...totals.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .slice(-limit)
    .map(([month, total]) => [month, Math.round(total * 100) / 100]);
}

/** Give every row the same width. `setValues` throws on a ragged array. */
export function padRows(rows) {
  const width = rows.reduce((m, r) => Math.max(m, r.length), 1);
  return rows.map((r) => (r.length === width ? r : [...r, ...new Array(width - r.length).fill('')]));
}

/** Projections made in the first days of a month are noise (one big shop projects to 10x). */
export const MIN_DAYS_FOR_RUN_RATE = 3;

/**
 * The report as rows, plus where each block sits (1-based sheet rows) so charts
 * can point at them.
 *
 * Columns of the pocket table: Month | Pocket | Bank Account | Monthly Limit | Spent |
 *          Remaining | Balance Now | Pct Used | Severity | Projected
 */
export function buildReport({ pockets, transactions, month, now = new Date(), daysInMonth = 31, users = USERS }) {
  const spend = summariseSpend(transactions, pockets, month, users);
  const elapsed = daysElapsedInMonth(now, daysInMonth);

  const rows = [[
    'Month', 'Pocket', 'Bank Account', 'Monthly Limit', 'Spent', 'Remaining',
    'Balance Now', 'Pct Used', 'Severity', 'Projected',
  ]];
  const layout = { pocketHeader: 1, pocketCount: pockets.length };

  for (const p of pockets) {
    const spent = spend.byPocket[p.id] || 0;
    const rr = computeRunRate({ spent, limit: p.limit, daysElapsed: elapsed, daysInMonth });
    const early = elapsed < MIN_DAYS_FOR_RUN_RATE;
    rows.push([
      month,
      escapeCell(p.name),
      escapeCell(p.account),
      p.limit,
      Math.round(spent * 100) / 100,
      Math.round((p.limit - spent) * 100) / 100,
      p.balance,
      rr.pctUsed,
      early ? 'tooEarly' : rr.severity,
      early ? '' : Math.round(rr.projected * 100) / 100,
    ]);
  }

  rows.push([]);
  layout.spouseHeader = rows.length + 1;
  rows.push(['SPOUSE SPLIT', 'Total Spend', 'Share']);
  for (const u of users) {
    const amt = spend.byUser[u] || 0;
    const share = spend.total > 0 ? Math.round((amt / spend.total) * 1000) / 10 : 0;
    rows.push([escapeCell(u), Math.round(amt * 100) / 100, share + '%']);
  }
  layout.spouseCount = users.length;

  rows.push([]);
  rows.push(['Month', 'Total Limit', 'Total Spent', 'Total Balance']);
  const totalLimit = pockets.reduce((s, p) => s + p.limit, 0);
  const totalBalance = pockets.reduce((s, p) => s + p.balance, 0);
  rows.push([month, Math.round(totalLimit * 100) / 100,
             spend.total, Math.round(totalBalance * 100) / 100]);

  // History: derived from Transactions every time, so earlier months are never lost
  // when this sheet is rewritten.
  const history = monthlyTotals(transactions, pockets);
  rows.push([]);
  layout.monthHeader = rows.length + 1;
  rows.push(['MONTH-OVER-MONTH', 'Total Spent']);
  for (const row of history) rows.push(row);
  layout.monthCount = history.length;

  return { rows: padRows(rows), layout };
}

/** Rows only — kept for callers and tests that do not need the layout. */
export function buildReportRows(args) {
  return buildReport(args).rows;
}

/* ------------------------------------------------------- sheet rendering -- */

/** Run a formatting/chart step; a failure there must never lose the data already written. */
function bestEffort(label, fn) {
  try {
    fn();
  } catch (err) {
    if (typeof Logger !== 'undefined') Logger.log('PocketBudget report: ' + label + ' skipped: ' + err.message);
  }
}

/** Remove the old charts and draw three: budget vs actual, spouse split, month over month. */
function rebuildCharts(sheet, layout, width) {
  if (typeof Charts === 'undefined' || typeof sheet.newChart !== 'function') return;
  for (const c of sheet.getCharts()) sheet.removeChart(c);
  const anchorCol = width + 2;

  if (layout.pocketCount > 0) {
    bestEffort('budget chart', () => {
      const chart = sheet.newChart()
        .setChartType(Charts.ChartType.COLUMN)
        .addRange(sheet.getRange(layout.pocketHeader, 2, layout.pocketCount + 1, 1))
        .addRange(sheet.getRange(layout.pocketHeader, 4, layout.pocketCount + 1, 2))
        .setNumHeaders(1)
        .setOption('title', 'Budget vs actual (limit and spent per pocket)')
        .setPosition(1, anchorCol, 0, 0)
        .build();
      sheet.insertChart(chart);
    });
  }
  bestEffort('spouse chart', () => {
    const chart = sheet.newChart()
      .setChartType(Charts.ChartType.PIE)
      .addRange(sheet.getRange(layout.spouseHeader, 1, layout.spouseCount + 1, 2))
      .setNumHeaders(1)
      .setOption('title', 'Spend by spouse')
      .setPosition(18, anchorCol, 0, 0)
      .build();
    sheet.insertChart(chart);
  });
  if (layout.monthCount > 0) {
    bestEffort('trend chart', () => {
      const chart = sheet.newChart()
        .setChartType(Charts.ChartType.COLUMN)
        .addRange(sheet.getRange(layout.monthHeader, 1, layout.monthCount + 1, 2))
        .setNumHeaders(1)
        .setOption('title', 'Total spend, month over month')
        .setPosition(35, anchorCol, 0, 0)
        .build();
      sheet.insertChart(chart);
    });
  }
}

/** Write the report block and (re)build the native charts. Called by the daily trigger. */
export function renderReport(sheet, { pockets, transactions, now = new Date(), users = USERS }) {
  const month = monthKey(now);
  const daysInMonth = daysInLocalMonth(now);
  const { rows, layout } = buildReport({ pockets, transactions, month, now, daysInMonth, users });
  const width = rows[0].length;

  sheet.clearContents();
  sheet.getRange(1, 1, rows.length, width).setValues(rows);

  bestEffort('formatting', () => {
    sheet.getRange(1, 1, 1, width).setFontWeight('bold');
    sheet.getRange(layout.spouseHeader, 1, 1, 3).setFontWeight('bold');
    sheet.getRange(layout.monthHeader, 1, 1, 2).setFontWeight('bold');
    if (layout.pocketCount > 0) {
      sheet.getRange(2, 4, layout.pocketCount, 4).setNumberFormat('"R"#,##0.00');
      sheet.getRange(2, 10, layout.pocketCount, 1).setNumberFormat('"R"#,##0.00');
    }
  });
  rebuildCharts(sheet, layout, width);
  return { month, rowCount: rows.length };
}
