# T69 · Loans and Loan Events sheet I/O

**Milestone:** M5 · **Type:** backend · **Depends on:** T06

## Goal
Read and write the two new sheets from README §7 (`Loans`, `Loan Events`), and create them in
`migrateV2()`. No API and no maths yet.

## Read
- `backend/00_Config.gs.js`: `SHEETS`.
- `backend/01_Utils.gs.js`: `nextAdjustmentId` (copy its shape).
- `backend/03_Sheets.gs.js`: `getAdjustmentSheet`, `toAdjustment`, `readAdjustments`,
  `appendAdjustments`, `findAdjustmentByRequestId`, `issueId`, `V2_NEW_SHEETS`, `ensureV2Schema`.
- `backend/04_Rollover.gs.js`: `localParts`.

## Change
1. `00_Config.gs.js`: `SHEETS` gains `LOANS: 'Loans'` and `LOAN_EVENTS: 'Loan Events'`.
2. `01_Utils.gs.js`:
   - `export function nextLoanId(existingIds, lastIssued = 0)` → `LN01`, `LN02`… (2-digit padding,
     growing past 99 naturally; only ids matching `/^LN\d+$/` count);
   - `export function nextLoanEventId(existingIds, lastIssued = 0)` → `LE1001`, `LE1002`… (the
     `nextAdjustmentId` shape; only `/^LE\d+$/` counts).
3. `03_Sheets.gs.js`:
   - `issueId` must store the digits after a letter prefix of any length:
     `String(id).replace(/^[A-Z]+/, '')`. One-letter ids (`P`, `T`, `A`) behave exactly as before.
     If T53 already made this change, leave it.
   - A private `sheetDateKey(v)`: a `Date` (Sheets turns `2026-03-15` typed into a cell into a
     Date) → `YYYY-MM-DD` of that instant in household time via `localParts`; a string matching
     `^\d{4}-\d{2}-\d{2}$` → itself; anything else → `''`.
   - `getLoanSheet()` and `getLoanEventSheet()` → the sheet, or null when it doesn't exist.
   - `export function readLoans({ includeArchived = false } = {})` →
     `[{ id, name, openingBalance, openingDate, billingDay, debitOrderDay, status }]` in sheet order
     (numbers via `num`, rands as stored; `[]` when the sheet is missing). Archived rows are left out
     unless asked for.
   - `export function appendLoan({ name, openingBalance, openingDate, billingDay, debitOrderDay })`
     → the loan object (status `Active`, property `LAST_LOAN_NUM`, `escapeCell(name)`).
   - `export function updateLoanRow(id, patch)`: `patch` may hold any of name / billingDay /
     debitOrderDay / status. Returns the updated loan, or null for an unknown id.
   - `export function readLoanEvents({ loanId } = {})` →
     `[{ id, timestamp, user, loanId, effectiveDate, type, value, note, requestId }]` in **sheet order**
     (oldest row first; the engine relies on it for ties). `timestamp` via `isoDate`, `value` via
     `num`, `effectiveDate` via `sheetDateKey`. Optional filter by loan. `[]` when the sheet is missing.
   - `export function appendLoanEvents(items)`: one `setValues` for all rows, ids from
     `nextLoanEventId` with property `LAST_LOAN_EVENT_NUM`, `escapeCell(note)`. Each item:
     `{ timestamp, user, loanId, effectiveDate, type, value, note, requestId }`. Returns the new
     event objects in order. Throws `'Missing sheet: Loan Events. Run migrateV2().'` when absent.
   - `export function findLoanEventByRequestId(requestId, lookback = REQUEST_ID_LOOKBACK_ROWS)` → the
     event or null (same newest-rows scan as `findAdjustmentByRequestId`).
4. `V2_NEW_SHEETS` gains both sheets with the README §7 headers:
   `Loan ID, Name, Opening Balance, Opening Date, Billing Day, Debit Order Day, Status` and
   `Event ID, Timestamp, User, Loan ID, Effective Date, Type, Value, Note, Request ID`.
   `ensureV2Schema()` (and so `migrateV2()` and `setup()`) then creates them with no further change.

## Tests (new file `tests/loans-io.test.js`)
Build the fake workbook as `tests/migration.test.js` does.
- `migrateV2()` creates both sheets with exactly those headers; a second run creates nothing.
- `nextLoanId([])` → `LN01`; `nextLoanId(['LN01', 'LN07'])` → `LN08`; `nextLoanId([], 99)` → `LN100`;
  ids of other shapes are ignored. `nextLoanEventId([])` → `LE1001`; `(['LE1001'], 1005)` → `LE1006`.
- After `appendLoan` twice and deleting the second row, the next loan is still `LN03` (the property).
- An existing `T`/`A` id sequence is unchanged by the `issueId` change (append one transaction and
  one adjustment, check the ids).
- `appendLoan` → `readLoans` round-trip; `updateLoanRow` renames and archives; `readLoans()` hides the
  archived one, `readLoans({ includeArchived: true })` returns it.
- `appendLoanEvents` with two items writes both rows in one `setValues` and returns `LE1001`, `LE1002`;
  `readLoanEvents({ loanId })` filters and keeps sheet order.
- An Effective Date cell holding `new Date('2026-03-14T22:00:00Z')` reads back as `'2026-03-15'`.
- `findLoanEventByRequestId` finds the row, and returns null for an unknown id and for `''`.

## Verify
```bash
node --test tests/loans-io.test.js
npm run check
```

## Done-check (used when resuming)
```bash
grep -q "export function readLoanEvents" backend/03_Sheets.gs.js
grep -q "LOAN_EVENTS" backend/00_Config.gs.js
```

## Commit
`v2(T69): loans sheet I/O`
