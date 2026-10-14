# T18 · `migrateV2` creates the Savings pocket

**Milestone:** M2 · **Type:** backend · **Depends on:** T17

## Change
In `ensureV2Schema()`, after the defaults are filled in: if no pocket has `kind === 'Savings'`, call
`appendPocket({ name: 'Savings', account: '', limit: 0, rule: 'Carry', kind: 'Savings' })` and push
`'Pockets: created Savings'`.

## Tests (`tests/migration.test.js`)
One run creates exactly one Savings pocket (limit 0, balance 0, Carry, Savings); a second run creates
none; an existing pocket with Kind Savings (any name) prevents creation.

## Verify
```bash
node --test tests/migration.test.js
npm run check
```

## Done-check (used when resuming)
```bash
grep -q "name: 'Savings'" backend/03_Sheets.gs.js
```

## Commit
`v2(T18): create the Savings pocket in migrateV2`
