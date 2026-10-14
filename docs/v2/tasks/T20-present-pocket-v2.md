# T20 · v2 fields in the API pocket object and summary

**Milestone:** M2 · **Type:** backend · **Depends on:** T07

## Change (`backend/05_Api.gs.js`)
1. `presentPocket` adds `rule`, `sweepTo`, `carriedIn: r2(p.carriedIn || 0)`, `kind`, and
   `available: r2(p.limit + (p.carriedIn || 0))`. `pctUsed` becomes
   `available > 0 ? r2(monthSpent / available * 100) : 0`.
2. `getState` summary: `totalLimit`, `totalBalance` and `totalSpent` **leave out** pockets with
   `kind === 'Savings'`. Add `totalCarriedIn` (same exclusion).

## Tests (`tests/api.test.js`)
The new fields; `pctUsed` uses `available`; the summary leaves out Savings; `totalCarriedIn`.
Existing tests use 6-column pockets, so the defaults (`Reset`, 0, `Spend`) keep their numbers unchanged.

## Verify
```bash
node --test tests/api.test.js
npm run check
```

## Done-check (used when resuming)
```bash
grep -q "totalCarriedIn" backend/05_Api.gs.js
```

## Commit
`v2(T20): v2 pocket fields and summary`
