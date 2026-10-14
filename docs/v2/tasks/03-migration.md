# Task 03: `migrateV2()`, one place for schema changes

**Milestone:** M1 · **Size:** S · **Depends on:** 00

## Why
v2 adds columns and two sheets. The real Sheet already holds months of data, so the upgrade has to
be one function that is **safe to run any number of times**. Later tasks add their columns here.

## The v2 schema (all new columns are appended at the end)

**Pockets:** existing A–F, then:

| Col | Header | Values | Default for existing rows |
|---|---|---|---|
| G | Leftover Rule | `Carry` \| `Reset` \| `Sweep` | `Reset` (owner decision: existing pockets don't change by surprise) |
| H | Sweep To | a pocket ID, or blank | blank |
| I | Carried In | rands carried in at the last rollover | `0` |
| J | Kind | `Spend` \| `Savings` | `Spend` |

**Transactions:** existing A–G (G is Request ID), then `H Group ID` (task 13) and `I Paid With`
(task 17). Add both headers now; they stay empty until those tasks.

**Adjustments** (new sheet, task 04 writes to it): `Adj ID | Timestamp | User | Month | Type | From
Pocket | To Pocket | Amount | Note | Request ID | Account ID`

**Accounts** (new sheet, task 17 fills it): `Account ID | Name | Type | Statement Day | Due Day |
Credit Limit | Status`

## Where
- `backend/03_Sheets.gs.js`: add `ensureV2Schema()` next to `ensureSheets()`.
- `backend/07_Entry.gs.js`: add `migrateV2()` (calls it, logs what changed); call it from `setup()`
  as well.
- `backend/00_Config.gs.js`: add `ADJUSTMENTS: 'Adjustments'` and `ACCOUNTS: 'Accounts'` to `SHEETS`.

## Steps
1. `ensureV2Schema()`:
   - Write each missing header (check the header cell first; only write if it's blank).
   - Fill blank G/I/J cells on existing pocket rows with the defaults above, in **one**
     `setValues` call.
   - Create `Adjustments` and `Accounts` with headers if missing.
   - Return a list of what it changed, so the log says e.g. "added 4 Pockets columns, created
     Adjustments". (Task 06 adds the Savings pocket here, once the app can display it.)
2. Update `readPockets()` to return `rule`, `sweepTo`, `carriedIn` and `kind`, with the same
   defaults when a cell is blank. Nothing else reads them yet.
3. Update `tests/helpers/fixtures.js` headers and add a `V2_POCKET` helper that builds a full row.

## Tests (`tests/migration.test.js`)
- An old-style workbook (fixtures from today) → after `migrateV2()` it has every header,
  defaults are filled in, and both sheets exist.
- Running it twice changes nothing the second time.
- Existing data in A–F is byte-for-byte unchanged.
- `readPockets()` on an old-style sheet (before migrating) still works and returns the defaults.

## Done when
- [ ] Tests pass and `npm run check` is green.
- [ ] Run on a copy of the real Sheet: the columns and sheets appear, and the app still works.
- [ ] The plan's §6 shipping step 3 ("run `migrateV2()`") is accurate.

## Watch out
Existing code reads pockets by column number, A–F. Check that nothing reads "the last column" and
would now pick up column J instead (`dataRows` uses `getLastColumn()`, which is fine because it only
widens the read).
