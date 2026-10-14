# T07 · Pocket defaults + v2 fields in `readPockets`

**Milestone:** M1 · **Type:** backend · **Depends on:** T06

## Goal
Existing pockets get their v2 defaults, and the code can read the new columns.

## Read
- `backend/03_Sheets.gs.js`: `ensureV2Schema` (from T06), `readPockets`.
- `tests/helpers/fixtures.js`.

## Change
1. `ensureV2Schema()` also fills **blank** G/I/J cells on every pocket data row: G=`Reset`, I=`0`,
   J=`Spend` (H stays blank). Read `getRange(2,7,n,4)`, change only the blanks, and write back with
   **one** `setValues`, and only if something changed. Push `'Pockets: filled defaults on N rows'`.
2. `readPockets()` adds `rule: String(r[6] || 'Reset')`, `sweepTo: String(r[7] || '')`,
   `carriedIn: num(r[8])`, `kind: String(r[9] || 'Spend')`.
3. `tests/helpers/fixtures.js`: add and export
   `v2Pocket({ id, name, limit, balance, account = '', status = 'Active', rule = 'Carry', sweepTo = '', carriedIn = 0, kind = 'Spend' })`,
   which returns the 10-cell row array. Don't change the existing exports.

## Tests (`tests/migration.test.js`)
- An old workbook → after migration, rows have `Reset`, `0` and `Spend`; a second run reports no change.
- `readPockets()` on a 6-column sheet (no migration) returns the defaults.
- `readPockets()` on `v2Pocket({... rule:'Sweep', sweepTo:'P09', carriedIn:120, kind:'Savings'})` returns those values.

## Verify
```bash
node --test tests/migration.test.js
npm run check
```

## Done-check (used when resuming)
```bash
grep -q "carriedIn" backend/03_Sheets.gs.js
grep -q "export function v2Pocket" tests/helpers/fixtures.js
```

## Commit
`v2(T07): pocket v2 defaults and fields`
