# T38 · `getState.merchants`

**Milestone:** M3 · **Type:** backend · **Depends on:** T05

## Change (`backend/05_Api.gs.js`)
1. Export the pure `buildMerchants(transactions, limit = 50)` → `[{ name, pocketId, count }]`:
   - group by the note, trimmed and lower-cased; skip blanks and notes longer than 40 characters;
   - `name` is the most recent spelling and `pocketId` the most recent pocket (the input is newest
     first);
   - sort by count, high first, and cut to `limit`.
2. `getState`: call `readRecentTransactions({ month, minRows: 200 })` (more history for
   suggestions), and add `merchants: buildMerchants(everyTransaction)`.

## Tests
Grouping, case-insensitivity, most-recent pocket wins, long notes skipped, the cap.

## Verify
```bash
npm run check
```

## Done-check (used when resuming)
```bash
grep -q "export function buildMerchants" backend/05_Api.gs.js
```

## Commit
`v2(T38): merchants in getState`
