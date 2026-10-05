// backend/04_Rollover.gs.js
// CANONICAL SOURCE. Pure functions — the caller does the Sheets writes.

import { UTC_OFFSET_MINUTES } from './00_Config.gs.js';

/** Calendar parts of an instant in the household's timezone: `{ year, month (1-12), day }`. */
export function localParts(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const shifted = new Date(d.getTime() + UTC_OFFSET_MINUTES * 60000);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

/** Days in the household-local month containing `date`. */
export function daysInLocalMonth(date = new Date()) {
  const { year, month } = localParts(date);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * `YYYY-MM` in the household's timezone, the key used to decide whether a rollover
 * has happened and which month an expense belongs to. (It was UTC, so anything
 * logged between midnight and 02:00 SAST on the 1st landed in the previous month.)
 */
export function monthKey(date = new Date()) {
  const { year, month } = localParts(date);
  return year + '-' + String(month).padStart(2, '0');
}

/**
 * Has the month rolled over since `lastRolloverKey`?
 * A missing key means the app has never rolled over, so yes.
 */
export function shouldRollover(lastRolloverKey, now = new Date()) {
  if (!lastRolloverKey) return true;
  return monthKey(now) !== lastRolloverKey;
}

/**
 * Spending-velocity projection.
 * severity: 'onTrack' | 'warning' (will exceed limit) | 'critical' (>110% of limit).
 */
export function computeRunRate({ spent, limit, daysElapsed, daysInMonth }) {
  const spentN = Number(spent) || 0;
  const limitN = Number(limit) || 0;
  const days = Math.max(0, Number(daysElapsed) || 0);
  const total = Math.max(1, Number(daysInMonth) || 1);

  const pctUsed = limitN > 0 ? (spentN / limitN) * 100 : 0;
  const rawProjected = days > 0 ? (spentN / days) * total : spentN;
  const projected = Math.max(spentN, Math.round(rawProjected));

  let severity = 'onTrack';
  if (limitN > 0) {
    if (projected > limitN * 1.1) severity = 'critical';
    else if (projected > limitN) severity = 'warning';
  }

  return { projected, pctUsed: Math.round(pctUsed * 100) / 100, severity };
}

/**
 * Reset active pockets' balances to their monthly limit.
 * Returns `{ pockets, resetCount, skippedCount }` — the caller persists `pockets`.
 */
export function applyRollover(pockets) {
  let resetCount = 0;
  let skippedCount = 0;
  const out = pockets.map((p) => {
    if (p.status !== 'Active') {
      skippedCount++;
      return p;
    }
    resetCount++;
    return { ...p, balance: p.limit };
  });
  return { pockets: out, resetCount, skippedCount };
}