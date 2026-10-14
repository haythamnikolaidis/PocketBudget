# T40 · Transactions: batch append, Group ID and Paid With fields

**Milestone:** M3 · **Type:** backend · **Depends on:** T06

## Goal
The sheet I/O that multi-pocket expenses need (README §7: column H Group ID, column I Paid With).

## Read
`backend/03_Sheets.gs.js`: `appendTransaction`, `toTxn` (from T04), `findTransactionByRequestId`.

## Change
1. `toTxn` and `findTransactionByRequestId` also return `groupId: String(r[7] || '')` and
   `paidWith: String(r[8] || '')`. Read at least 9 columns where the row width is chosen.
2. `export function appendTransactions(items)`. Each item is
   `{ user, pocketId, amount, note, timestamp, requestId, groupId, paidWith }`. Issue the IDs one
   after another (the same `issueId` / `LAST_TXN_NUM` logic). Write all rows with **one** `setValues`
   at `getLastRow()+1`, 9 columns, `escapeCell(note)`. If `groupId === 'FIRST'`, replace it on
   **every** row with the first issued ID. Return the IDs. Call `ensureRequestIdHeader` as
   `appendTransaction` does.
3. `export function findTransactionsByRequestId(requestId)` → **all** matching rows (oldest first) in
   the lookback window.
4. `export function deleteTransactionRows(ids)` deletes rows by ID **from the bottom up**.

## Tests (new file `tests/txn-batch.test.js`)
3 items → 3 sequential IDs, one `setValues`, and every row's Group ID = the first ID. Readers return
`groupId` / `paidWith`; old 7-column rows give `''`. `findTransactionsByRequestId` returns all.
`deleteTransactionRows` removes exactly those rows.

## Verify
```bash
node --test tests/txn-batch.test.js
npm run check
```

## Done-check (used when resuming)
```bash
grep -q "export function appendTransactions" backend/03_Sheets.gs.js
```

## Commit
`v2(T40): batch transaction I/O`
