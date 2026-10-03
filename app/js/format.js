// app/js/format.js
// Presentation helpers. Pure and tested — formatting bugs are silent and annoying.

/** South African rand. One place to change if the currency ever does. */
export const CURRENCY_SYMBOL = 'R';

/**
 * Reduce a typed amount to plain digits and an optional decimal point. Mirror of
 * normaliseAmountText in backend/01_Utils.gs.js — keep the two identical.
 *
 *   'R1 234,56' -> '1234.56'   leading R or $, and space thousands, are dropped
 *   '1,234.56'  -> '1234.56'   a comma is a thousands separator...
 *   '12,50'     -> '12.50'     ...unless exactly 1-2 digits follow it: that is the
 *                              decimal comma South African keypads type. Deleting it
 *                              instead made R12,50 read as R1250.
 */
export function normaliseAmountText(input) {
  const s = String(input ?? '').replace(/^\s*[Rr$]\s*/, '').replace(/[\s\u00a0\u202f]/g, '');
  if (/^\d+,\d{1,2}$/.test(s)) return s.replace(',', '.');
  return s.replace(/,/g, '');
}

/** A typed amount as a Number, or NaN when it is not one. */
export function parseAmountText(input) {
  const s = normaliseAmountText(input);
  return s === '' ? NaN : Number(s);
}

/**
 * Balance after a limit change: it moves with the limit (what was spent stays
 * spent), within 0..newLimit. Mirror of balanceAfterLimitChange in
 * backend/01_Utils.gs.js — the server is authoritative, this only previews it.
 */
export function balanceAfterLimitChange(balance, oldLimit, newLimit) {
  const bal = Math.round(Number(balance) * 100);
  const oldC = Math.round(Number(oldLimit) * 100);
  const newC = Math.round(Number(newLimit) * 100);
  return Math.max(0, Math.min(newC, bal + (newC - oldC))) / 100;
}

/** Rand amount as 'R1,234.56' (negatives as '-R1,234.56'). */
export function formatMoney(dollars) {
  const n = Number(dollars) || 0;
  const neg = n < 0;
  const abs = Math.abs(n);
  const whole = Math.floor(abs);
  const cents = String(Math.round((abs - whole) * 100)).padStart(2, '0');
  const withCommas = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? '-' : '') + CURRENCY_SYMBOL + withCommas + '.' + cents;
}

export function formatPct(pct) {
  const n = Number(pct) || 0;
  if (n === 0) return '0%';
  return (Math.round(n * 10) / 10).toFixed(1) + '%';
}

/** Mirror of the backend's parseAmountInput rules, for instant client-side feedback. */
export function isValidAmount(input) {
  const n = parseAmountText(input);
  if (!Number.isFinite(n)) return false;
  if (n < 0) return false;
  if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-9) return false;
  return n > 0;
}

/** 'Today' | 'Yesterday' | 'Sep 28' */
export function relativeDay(iso, now = new Date()) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  // The viewer's own calendar: a phone in Johannesburg at 01:30 on the 3rd is on
  // the 3rd, even though UTC is still the 2nd. (Compared as UTC-of-local-date so
  // the day count is exact across any clock change.)
  const a = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const b = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((b - a) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return MON[d.getMonth()] + ' ' + d.getDate();
}