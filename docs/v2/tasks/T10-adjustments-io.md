# T10 · Adjustments sheet reads and writes

**Milestone:** M2 · **Type:** backend · **Depends on:** T06

## Goal
Sheet I/O for the `Adjustments` sheet (README §7). It records every money movement that isn't an
expense: transfers, month-end carry/sweep/forfeit, card payments.

## Read
- `backend/03_Sheets.gs.js`: `getTransactionSheet`, `appendTransaction`, `issueId`,
  `nextTransactionIdFromSheet`, `findTransactionByRequestId`.
- `backend/01_Utils.gs.js`: `nextTransactionId`, `isValidTransactionId`.

## Change
1. `01_Utils.gs.js`: `export function nextAdjustmentId(existingIds, lastIssued = 0)`, the same as
   `nextTransactionId` but with prefix `A` (A1001, A1002…). Accept ids matching `/^A\d+$/`.
2. `03_Sheets.gs.js`:
   - `getAdjustmentSheet()` returns the sheet **or null** if it's missing (no throw).
   - `export function appendAdjustments(items)`. Each item is
     `{ timestamp, user, month, type, fromPocketId, toPocketId, amount, note, requestId, accountId }`.
     Throw `'Missing sheet: Adjustments. Run migrateV2().'` if the sheet is missing. Issue the IDs one
     after another (property key `LAST_ADJ_NUM`, same idea as `issueId`). Write **all rows with one
     `setValues`** at `getLastRow()+1`, 11 columns, `escapeCell(note)`. Return the IDs.
   - `export function readAdjustments({ month } = {})` returns `[]` if the sheet is missing.
     Otherwise it returns objects
     `{ id, timestamp, user, month, type, fromPocketId, toPocketId, amount, note, requestId, accountId }`,
     filtered by column D when `month` is given, newest first.
   - `export function findAdjustmentByRequestId(requestId)` searches the newest
     `REQUEST_ID_LOOKBACK_ROWS` rows and returns the object or null.

## Tests (new file `tests/adjustments.test.js`)
- Appending 3 items → IDs A1001–A1003, one `setValues` call, and the values land in the right columns.
- `readAdjustments({ month })` filters and sorts; a missing sheet → `[]`.
- `findAdjustmentByRequestId` finds and misses correctly.
- `nextAdjustmentId` never reuses a number below `lastIssued`.

## Verify
```bash
node --test tests/adjustments.test.js
npm run check
```

## Done-check (used when resuming)
```bash
grep -q "export function appendAdjustments" backend/03_Sheets.gs.js
test -f tests/adjustments.test.js
```

## Commit
`v2(T10): Adjustments sheet I/O`
