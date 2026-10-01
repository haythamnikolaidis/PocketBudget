import { createSheet, resetSheet } from './fakeSheet.js';

export const HEADER_POCKETS = ['Pocket ID', 'Pocket Name', 'Bank Account', 'Monthly Limit', 'Current Balance', 'Status'];
export const HEADER_TRANSACTIONS = ['Transaction ID', 'Timestamp', 'User / Spouse', 'Pocket ID', 'Amount', 'Merchant / Note'];

const SHEETS_POCKETS = 'Pockets';
const SHEETS_TXNS = 'Transactions';
const SHEETS_REPORT = 'Monthly_Report';

/**
 * Build a workbook whose sheets include their header rows, exactly like the real thing.
 * `pocketRows` / `txnRows` are DATA rows only; the header is prepended for you.
 */
export function freshWorkbook(pocketRows = [], txnRows = []) {
  const pockets = createSheet(SHEETS_POCKETS, [HEADER_POCKETS, ...pocketRows]);
  const txns = createSheet(SHEETS_TXNS, [HEADER_TRANSACTIONS, ...txnRows]);
  const report = createSheet(SHEETS_REPORT, []);
  return { pockets, txns, report };
}

/** The brief's own example rows — used across several tests as the standard fixture. */
export const SAMPLE_POCKETS = [
  ['P01', 'Groceries', 'Chase Checking', 800, 340.5, 'Active'],
  ['P02', 'Dining Out', 'Credit Card A', 250, 15, 'Active'],
];

export const SAMPLE_TXNS = [
  ['T1001', new Date('2026-10-01T14:20:00Z'), 'Alex', 'P01', 65.2, 'Whole Foods'],
  ['T1002', new Date('2026-10-01T18:45:00Z'), 'Sam', 'P02', 42, 'Pizza Night'],
];

export { createSheet, resetSheet };