# T06 · Schema: new headers, new sheets, `migrateV2()`

**Milestone:** M1 · **Type:** backend · **Depends on:** —

## Goal
One idempotent upgrade function, `migrateV2()`, which the owner runs once from the Apps Script
editor. This task adds headers and sheets only.

## Context
The schema is in `docs/v2/README.md` §7. New installs get it through `setup()`; existing sheets
through `migrateV2()`.

## Read
- `backend/00_Config.gs.js`: `SHEETS`.
- `backend/03_Sheets.gs.js`: `ensureSheets`, `ss()`.
- `backend/07_Entry.gs.js`: `setup()`.

## Change
1. `SHEETS` gains `ADJUSTMENTS: 'Adjustments'` and `ACCOUNTS: 'Accounts'`.
2. `03_Sheets.gs.js`: `export function ensureV2Schema()` returns an array of change descriptions:
   - Pockets headers G–J: `Leftover Rule`, `Sweep To`, `Carried In`, `Kind`.
   - Transactions headers H–I: `Group ID`, `Paid With`.
   - For each header cell: write it only if the cell is blank (`getRange(1,col).getValues()[0][0] === ''`).
   - Create the `Adjustments` and `Accounts` sheets if missing, with the headers from README §7 and
     `setFrozenRows(1)`.
   - Each actual change pushes a string such as `'Pockets: added header Leftover Rule'`.
3. `07_Entry.gs.js`: `export function migrateV2()` calls `ensureV2Schema()`, logs the changes
   (`'PocketBudget migrateV2: ' + (changes.join('; ') || 'nothing to do')`), and returns them. Call
   `migrateV2()` in `setup()` right after `ensureSheets()`.

## Tests (new file `tests/migration.test.js`)
Build the fake spreadsheet as `tests/setup.test.js` does (it supports `insertSheet`).
- An old-style workbook → every header is present, both sheets exist, and the changes list is non-empty.
- Running it a second time → the changes list is empty.
- The A–F / A–G data is unchanged (deep-equal against a copy).

## Verify
```bash
node --test tests/migration.test.js
npm run check
```

## Done-check (used when resuming)
```bash
grep -q "export function ensureV2Schema" backend/03_Sheets.gs.js
grep -q "export function migrateV2" backend/07_Entry.gs.js
```

## Commit
`v2(T06): add migrateV2 with new headers and sheets`
