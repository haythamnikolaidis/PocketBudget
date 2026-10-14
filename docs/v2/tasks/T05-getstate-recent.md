# T05 · Use `readRecentTransactions` in `getState`

**Milestone:** M1 · **Type:** backend · **Depends on:** T04

## Goal
`getState` stops reading the whole Transactions sheet.

## Read
- `backend/05_Api.gs.js`: `getState`. Look for `readTransactions()`.

## Change
Replace `const everyTransaction = readTransactions();` with
`const everyTransaction = readRecentTransactions({ month });`. Update the import. The feed (first
10) and the month totals keep using `everyTransaction`. Update the comment above it.

## Tests
The existing `getState` tests in `tests/api.test.js` must pass unchanged; that proves the output is
the same. Add one test: with 300 rows from older months and 3 from this month, `getState` returns the
right month totals.

## Verify
```bash
node --test tests/api.test.js
npm run check
```

## Done-check (used when resuming)
```bash
grep -q "readRecentTransactions({ month })" backend/05_Api.gs.js
```

## Commit
`v2(T05): getState reads only recent transactions`
