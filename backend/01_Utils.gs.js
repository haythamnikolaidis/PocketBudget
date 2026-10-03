// CANONICAL SOURCE. Pure functions only — no SpreadsheetApp, no Date text parsing.

import { USERS, SERVER_VERSION, MAX_AMOUNT_CENTS, CURRENCY_SYMBOL } from './00_Config.gs.js';

/* ------------------------------------------------------------------ money -- */

/**
 * Reduce a typed amount to plain digits and an optional decimal point.
 *
 *   'R1 234,56'  -> '1234.56'   a leading R (or $) and space thousands are dropped
 *   '1,234.56'   -> '1234.56'   a comma is a thousands separator...
 *   '12,50'      -> '12.50'     ...unless exactly 1-2 digits follow it: then it is the
 *                               decimal comma that South African phone keypads type.
 *
 * The last rule matters: with commas simply deleted, '12,50' became 1250 — a
 * hundredfold overspend that still passes the balance check if the pocket is big enough.
 */
export function normaliseAmountText(input) {
  const s = String(input ?? '').replace(/^\s*[Rr$]\s*/, '').replace(/[\s\u00a0\u202f]/g, '');
  if (/^\d+,\d{1,2}$/.test(s)) return s.replace(',', '.');
  return s.replace(/,/g, '');
}

/** Parse a rand-ish value into integer cents. Rejects anything non-numeric. */
export function toCents(v) {
  if (typeof v === 'boolean') throw new Error('Not a number: ' + v);
  const cleaned = normaliseAmountText(v);
  const n = cleaned === '' ? NaN : Number(cleaned);
  if (!Number.isFinite(n)) throw new Error('Not a number: ' + v);
  return Math.round(n * 100);
}

export function toDollars(cents) {
  return Math.round(cents) / 100;
}

/**
 * Parse a user-entered amount into integer cents.
 * Rejects: negatives, junk, more than 2 decimal places, and amounts over R1,000,000.
 */
export function parseAmountInput(input) {
  if (typeof input === 'boolean') throw new Error('Not a number: ' + input);
  const cleaned = normaliseAmountText(input);
  if (cleaned === '') throw new Error('Not a number: ' + input);

  const n = Number(cleaned);
  if (!Number.isFinite(n)) throw new Error('Not a number: ' + input);
  if (n < 0) throw new Error('Amount must be positive.');
  if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-9) throw new Error('Amount has more than 2 decimal places (must be whole cents).');
  if (Math.round(n * 100) > MAX_AMOUNT_CENTS) throw new Error('Amount is too large (max ' + CURRENCY_SYMBOL + '1,000,000).');

  return Math.round(n * 100);
}

/** Format integer cents as `R1,234.56`. */
export function money(cents) {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const centsPart = String(abs % 100).padStart(2, '0');
  const withCommas = String(dollars).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? '-' : '') + CURRENCY_SYMBOL + withCommas + '.' + centsPart;
}

/* ----------------------------------------------------------- sheet text -- */

/**
 * Make user text safe to write into a cell. Sheets treats a value that starts with
 * = + - or @ as a FORMULA (=IMPORTDATA(...), =HYPERLINK(...)), so a pocket name or
 * note could run code against the household's sheet. A leading apostrophe makes
 * the cell plain text; Sheets does not display it.
 */
export function escapeCell(value) {
  const s = String(value ?? '');
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
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
