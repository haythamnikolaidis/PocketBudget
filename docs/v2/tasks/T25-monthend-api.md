# T25 · `getState.monthEnd`

**Milestone:** M2 · **Type:** backend · **Depends on:** T12, T16

## Change (`backend/05_Api.gs.js`)
1. Export the pure `buildMonthEnd(adjustments, pockets, now)`:
   - if `localParts(now).day > 7` → return null;
   - items = adjustments of type `carry`, `sweep` or `forfeit` →
     `{ pocketId, name, type, amount, toPocketId, toName }`. `pocketId` is the pocket the money
     left (`fromPocketId`), or for carry the `toPocketId`. Look names up in `pockets`. Sort by amount,
     biggest first;
   - no items → null;
   - otherwise return `{ fromMonth: <previous month key>, items, totals: { carried, swept, forfeited, all } }`,
     with sums in rands calculated in cents.
2. `getState` adds `monthEnd: buildMonthEnd(adjustments, everyPocket, new Date())`.

## Tests (`tests/api.test.js` or `tests/monthend.test.js`)
Present on day 1 and day 7, null on day 8; transfers are left out; totals are right; `fromMonth` for
January is the previous December.

## Verify
```bash
npm run check
```

## Done-check (used when resuming)
```bash
grep -q "export function buildMonthEnd" backend/05_Api.gs.js
```

## Commit
`v2(T25): monthEnd in getState`
