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

const cents = (rands) => Math.round(Number(rands) * 100) || 0;
const rands = (c) => c / 100;

/**
 * Apply each active pocket's leftover rule at month end. Pure: the caller persists the results.
 *
 *   Carry  -> balance = limit + leftover, carriedIn = leftover
 *   Reset  -> balance = limit, carriedIn = 0 (a missing rule counts as Reset)
 *   Sweep  -> balance = limit, carriedIn = 0, and the leftover is added to the target pocket
 *
 * A Sweep whose target is missing, not Active, or the pocket itself behaves as Carry.
 * Sweeps are applied after every pocket has its new base balance. All maths is in integer cents;
 * pockets and adjustment amounts are in rands, as `readPockets` returns them.
 *
 * Returns `{ pockets, adjustments, resetCount, skippedCount }`. Each adjustment is
 * `{ type, fromPocketId?, toPocketId?, amount, note }` and exists only when something was left over.
 */
export function applyRollover(pockets, { fromMonthLabel = '' } = {}) {
  const note = fromMonthLabel ? 'Left over from ' + fromMonthLabel : 'Left over';
  const activeIds = new Set(pockets.filter((p) => p.status === 'Active').map((p) => p.id));
  const adjustments = [];
  const sweeps = [];
  const balanceCents = new Map();
  let resetCount = 0;
  let skippedCount = 0;

  const out = pockets.map((p) => {
    if (p.status !== 'Active') {
      skippedCount++;
      return p;
    }
    resetCount++;
    const limitC = cents(p.limit);
    const leftC = Math.max(0, cents(p.balance));
    let rule = p.rule || 'Reset';
    if (rule === 'Sweep' && (!p.sweepTo || p.sweepTo === p.id || !activeIds.has(p.sweepTo))) rule = 'Carry';

    if (rule === 'Carry') {
      balanceCents.set(p.id, limitC + leftC);
      if (leftC > 0) adjustments.push({ type: 'carry', toPocketId: p.id, amount: rands(leftC), note });
      return { ...p, carriedIn: rands(leftC) };
    }
    balanceCents.set(p.id, limitC);
    if (leftC > 0) {
      if (rule === 'Sweep') {
        adjustments.push({ type: 'sweep', fromPocketId: p.id, toPocketId: p.sweepTo, amount: rands(leftC), note });
        sweeps.push({ to: p.sweepTo, amountC: leftC });
      } else {
        adjustments.push({ type: 'forfeit', fromPocketId: p.id, amount: rands(leftC), note });
      }
    }
    return { ...p, carriedIn: 0 };
  });

  sweeps.forEach(({ to, amountC }) => balanceCents.set(to, balanceCents.get(to) + amountC));
  const result = out.map((p) => (p.status === 'Active' ? { ...p, balance: rands(balanceCents.get(p.id)) } : p));
  return { pockets: result, adjustments, resetCount, skippedCount };
}
