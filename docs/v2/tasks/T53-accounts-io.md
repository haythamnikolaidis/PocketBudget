# T53 · Accounts sheet I/O and first-time seeding

**Milestone:** M4 · **Type:** backend · **Depends on:** T06

## Goal
Read and write the `Accounts` sheet (README §7), and fill it once from the pockets' free-text
"Bank Account" names.

## Change
1. `01_Utils.gs.js`: `export function nextAccountId(existingIds, lastIssued = 0)` → `AC01`, `AC02`…
   (2-digit padding, growing beyond 99 naturally). Accept ids matching `/^AC\d+$/`.
2. `03_Sheets.gs.js`:
   - `getAccountSheet()` → the sheet, or null;
   - `export function readAccounts()` → `[{ id, name, type, statementDay, dueDay, creditLimit, status }]`
     (numbers via `num`; `creditLimit` is null when blank; `[]` if the sheet is missing);
   - `export function appendAccount({ name, type, statementDay = '', dueDay = '', creditLimit = '' })`
     → the account (status `Active`, property `LAST_ACCOUNT_NUM`, `escapeCell(name)`);
   - `export function updateAccountRow(id, patch)`, where `patch` may hold any of
     name/type/statementDay/dueDay/creditLimit/status.
3. `ensureV2Schema()`: if the script property `ACCOUNTS_SEEDED` isn't `'done'` **and** Accounts has no
   data rows → append one `bank` account per distinct non-blank Pockets column C value (in first-seen
   order), then `Cash` (`cash`). Set `ACCOUNTS_SEEDED = 'done'` and push `'Accounts: seeded N'`.

## Tests (new file `tests/accounts.test.js`)
Seeding from pocket names (duplicates and blanks skipped, plus Cash); a second run doesn't reseed,
even after all rows are deleted; append/read/update round-trip; the ID sequence.

## Verify
```bash
node --test tests/accounts.test.js
npm run check
```

## Done-check (used when resuming)
```bash
grep -q "export function readAccounts" backend/03_Sheets.gs.js
```

## Commit
`v2(T53): accounts sheet I/O and seeding`
