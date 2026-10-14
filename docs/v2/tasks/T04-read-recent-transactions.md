# T04 · Add `readRecentTransactions()`

**Milestone:** M1 · **Type:** backend · **Depends on:** —

## Goal
A cheap read of only the recent transactions, for `getState` (wired up in T05). Today
`readTransactions()` reads every row ever logged on every refresh.

## Context
Rows are appended in time order (the server stamps them), so reading from the bottom up and
stopping at an older month is safe.

## Read
- `backend/03_Sheets.gs.js`: `readTransactions`, `dataRows`, `isoDate`, `num`.

## Change (`backend/03_Sheets.gs.js`)
1. Pull the row→object mapping in `readTransactions` out into `function toTxn(r)`, and the sort into
   `function sortNewestFirst(txns)`. `readTransactions` uses both; its behaviour is unchanged.
2. Add:
   ```js
   /** Newest-first transactions: every row of `month` (YYYY-MM) and newer, and at least `minRows` rows. */
   export function readRecentTransactions({ month, minRows = 30, chunk = 200 } = {})
   ```
   Read chunks of `chunk` rows from the bottom (one `getRange` per chunk, width
   `Math.max(7, sheet.getLastColumn())`). Skip blank rows. Keep reading while
   `collected.length < minRows` **or** no row older than `month` has been seen yet (use `monthKey`
   from `04_Rollover.gs.js` on the timestamp). Stop at row 2. Return `sortNewestFirst(collected)`.
   Keep the older rows you read; they're harmless.

## Tests (new file `tests/read-recent.test.js`)
Use `freshWorkbook` and `installGlobals` (see `tests/sheets.test.js` for the pattern).
- 3 months of rows (5 per month): every row of the current month is returned, newest first.
- Only 2 rows this month, 100 older ones → at least 30 rows returned.
- An empty sheet and a header-only sheet → `[]`.
- 2,000 rows with 100 this month → at most 2 `getRange` calls (wrap `getRange` to count them).

## Verify
```bash
node --test tests/read-recent.test.js
npm run check
```

## Done-check (used when resuming)
```bash
grep -q "export function readRecentTransactions" backend/03_Sheets.gs.js
test -f tests/read-recent.test.js
```

## Commit
`v2(T04): add readRecentTransactions`
