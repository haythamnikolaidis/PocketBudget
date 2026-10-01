// backend/06_Report.gs.js
// CANONICAL SOURCE. Aggregates Transactions -> Monthly_Report.
// Spend is scoped to the report month; history survives rollover because it is
// derived from Transactions, never from Current Balance.

import { USERS } from './00_Config.gs.js';
import { computeRunRate, monthKey } from './04_Rollover.gs.js';

/** Days elapsed in the reporting month (1-based, capped at daysInMonth). */
export function daysElapsedInMonth(now = new Date(), daysInMonth = 31) {
  const day = now instanceof Date ? now.getUTCDate() : new Date(now).getUTCDate();
  return Math.min(Math.max(1, day), daysInMonth);
}

/** Total spend within `month`, broken down by pocket and by user. */
export function summariseSpend(transactions, pockets, month) {
  const known = new Set(pockets.map((p) => p.id));
  const byPocket = {};
  const byUser = {};
  for (const u of USERS) byUser[u] = 0;

  let total = 0;
  let count = 0;

  for (const t of transactions) {
    if (!t.timestamp || !t.timestamp.startsWith(month)) continue;
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

/**
 * The full row layout written to Monthly_Report.
 * Columns: Month | Pocket | Bank Account | Monthly Limit | Spent | Remaining |
 *          Balance Now | Pct Used | Severity | Projected
 */
export function buildReportRows({ pockets, transactions, month, now = new Date(), daysInMonth = 31 }) {
  const spend = summariseSpend(transactions, pockets, month);
  const elapsed = daysElapsedInMonth(now, daysInMonth);

  const rows = [[
    'Month', 'Pocket', 'Bank Account', 'Monthly Limit', 'Spent', 'Remaining',
    'Balance Now', 'Pct Used', 'Severity', 'Projected',
  ]];

  for (const p of pockets) {
    const spent = spend.byPocket[p.id] || 0;
    const rr = computeRunRate({ spent, limit: p.limit, daysElapsed: elapsed, daysInMonth });
    rows.push([
      month,
      p.name,
      p.account,
      p.limit,
      Math.round(spent * 100) / 100,
      Math.round((p.limit - spent) * 100) / 100,
      p.balance,
      rr.pctUsed,
      rr.severity,
      Math.round(rr.projected * 100) / 100,
    ]);
  }

  rows.push([]);
  rows.push(['SPOUSE SPLIT', 'Total Spend', 'Share']);
  for (const u of USERS) {
    const amt = spend.byUser[u] || 0;
    const share = spend.total > 0 ? Math.round((amt / spend.total) * 1000) / 10 : 0;
    rows.push([u, Math.round(amt * 100) / 100, share + '%']);
  }

  rows.push([]);
  rows.push(['Month', 'Total Limit', 'Total Spent', 'Total Balance']);
  const totalLimit = pockets.reduce((s, p) => s + p.limit, 0);
  const totalBalance = pockets.reduce((s, p) => s + p.balance, 0);
  rows.push([month, Math.round(totalLimit * 100) / 100,
             spend.total, Math.round(totalBalance * 100) / 100]);

  return rows;
}

/* ------------------------------------------------------- sheet rendering -- */

/** Write the report block and (re)build the native charts. Called by the daily trigger. */
export function renderReport(sheet, { pockets, transactions, now = new Date() }) {
  const month = monthKey(now);
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const rows = buildReportRows({ pockets, transactions, month, now, daysInMonth });

  sheet.clearContents();
  sheet.getRange(1, 1, rows.length, 10).setValues(rows);
  return { month, rowCount: rows.length };
}