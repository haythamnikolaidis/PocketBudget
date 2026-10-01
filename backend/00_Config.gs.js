// CANONICAL SOURCE. `backend/*.gs` is generated from this file by `npm run build`.

/** Household members allowed to log expenses. Display names, exact match. */
export const USERS = ['Alex', 'Sam'];

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

/** Largest single expense the API will accept, in cents ($1,000,000). */
export const MAX_AMOUNT_CENTS = 100_000_000;