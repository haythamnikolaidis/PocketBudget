// CANONICAL SOURCE. `backend/*.gs` is generated from this file by `npm run build`.

/**
 * Household members allowed to log expenses. Display names, exact match.
 * This is only the DEFAULT: the live list is the `USERS` Script Property
 * (comma-separated, e.g. "Thandi,Pieter"), read by getUsers() in 02_Auth, so
 * renaming the household does not mean editing code and redeploying.
 */
export const USERS = ['Alex', 'Sam'];

/** Script Properties key holding the comma-separated household member names. */
export const USERS_PROPERTY = 'USERS';

/** Sheet tab names. Reference these everywhere; never hard-code a sheet name in logic. */
export const SHEETS = {
  POCKETS: 'Pockets',
  TRANSACTIONS: 'Transactions',
  REPORT: 'Monthly_Report',
};

/** Every action the API dispatcher accepts. */
export const ACTIONS = [
  'ping', 'getState',
  'createPocket', 'updatePocket',
  'createTransaction', 'deleteTransaction',
];

/** Version of the deployed backend; returned by ping/getState so the client can warn on mismatch. */
export const SERVER_VERSION = '1.0.0';

/**
 * The household's offset from UTC, in minutes: South Africa is UTC+2 all year (no
 * daylight saving). MUST match "timeZone" in appsscript.json. Months, "days elapsed"
 * and the rollover all use this, so an expense logged at 00:30 on the 1st counts
 * in the new month rather than the old one. If the household ever moves, change
 * both.
 */
export const UTC_OFFSET_MINUTES = 120;

/** Milliseconds to wait for the script lock before giving up. */
export const LOCK_TIMEOUT_MS = 20000;

/**
 * How many of the newest Transactions rows are searched for a repeated
 * `requestId`. A retry follows its original within seconds or minutes, so this
 * is far more than enough and keeps the lookup to one small read.
 */
export const REQUEST_ID_LOOKBACK_ROWS = 200;

/** Currency symbol shown in server-written messages (the insufficient-funds alert). South African rand. */
export const CURRENCY_SYMBOL = 'R';

/** Longest pocket name / bank account text accepted, in characters. */
export const MAX_NAME_LENGTH = 60;

/** Largest single expense the API will accept, in cents (R1,000,000). */
export const MAX_AMOUNT_CENTS = 100000000;