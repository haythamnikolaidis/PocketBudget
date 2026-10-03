// CANONICAL SOURCE. Pure functions only — no SpreadsheetApp, no Date text parsing.

import { USERS, SERVER_VERSION, MAX_AMOUNT_CENTS } from './00_Config.gs.js';

/* ------------------------------------------------------------------ money -- */

/** Parse a dollar-ish value into integer cents. Rejects anything non-numeric. */
export function toCents(v) {
  if (typeof v === 'boolean') throw new Error('Not a number: ' + v);
  const cleaned = String(v ?? '').replace(/[$,\s]/g, '');
  const n = cleaned === '' ? NaN : Number(cleaned);
  if (!Number.isFinite(n)) throw new Error('Not a number: ' + v);
  return Math.round(n * 100);
}

export function toDollars(cents) {
  return Math.round(cents) / 100;
}

/**
 * Parse a user-entered amount into integer cents.
 * Rejects: negatives, junk, more than 2 decimal places, and amounts over $1,000,000.
 */
export function parseAmountInput(input) {
  if (typeof input === 'boolean') throw new Error('Not a number: ' + input);
  const cleaned = String(input ?? '').replace(/[$,\s]/g, '');
  if (cleaned === '') throw new Error('Not a number: ' + input);

  const n = Number(cleaned);
  if (!Number.isFinite(n)) throw new Error('Not a number: ' + input);
  if (n < 0) throw new Error('Amount must be positive.');
  if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-9) throw new Error('Amount has more than 2 decimal places (must be whole cents).');
  if (Math.round(n * 100) > MAX_AMOUNT_CENTS) throw new Error('Amount is too large (max $1,000,000).');

  return Math.round(n * 100);
}

/** Format integer cents as `$1,234.56`. */
export function money(cents) {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const centsPart = String(abs % 100).padStart(2, '0');
  const withCommas = String(dollars).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? '-$' : '$') + withCommas + '.' + centsPart;
}

/* ------------------------------------------------------------ validation -- */

export function isValidUser(name) {
  return typeof name === 'string' && USERS.includes(name);
}

/** Pocket IDs are `P` + at least two digits, uppercase. */
export function isValidPocketId(id) {
  return typeof id === 'string' && /^P\d{2,}$/.test(id);
}

export function isValidTransactionId(id) {
  return typeof id === 'string' && /^T\d{4,}$/.test(id);
}

/**
 * A client-generated idempotency key: 8-64 chars of letters, digits and hyphens
 * (a UUID fits). Kept strict because it is written to a sheet cell.
 */
export function isValidRequestId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(id);
}

/* -------------------------------------------------------------------- ids -- */

/** Next free pocket ID given the existing IDs, e.g. ['P01','P09'] -> 'P10'. */
export function nextPocketId(existingIds) {
  const max = existingIds.reduce((m, id) => {
    if (!isValidPocketId(id)) return m;
    const n = parseInt(String(id).slice(1), 10);
    return Number.isFinite(n) && n > m ? n : m;
  }, 0);
  return 'P' + String(max + 1).padStart(2, '0');
}

/** Next free transaction ID, e.g. ['T1001'] -> 'T1002'. Malformed ids are ignored. */
export function nextTransactionId(existingIds) {
  const max = existingIds.reduce((m, id) => {
    if (!isValidTransactionId(id)) return m;
    const n = parseInt(String(id).slice(1), 10);
    return Number.isFinite(n) && n > m ? n : m;
  }, 0);
  // The brief's examples start at T1001, so the sequence starts there and pads to 4 digits.
  const start = 1000;
  return 'T' + String(Math.max(max + 1, start + 1)).padStart(4, '0');
}

/* --------------------------------------------------------------- envelope -- */

/** Success envelope. Always `ok: true`, always version-stamped. */
export function ok(payload = {}) {
  return { ok: true, version: SERVER_VERSION, ...payload };
}

/** Failure envelope. `code` is the stable machine-readable constant; `message` is for humans. */
export function fail(code, message, context = {}) {
  return { ok: false, error: code, message, context };
}
