# T15 · Leftover rules in `applyRollover` (pure)

**Milestone:** M2 · **Type:** backend · **Depends on:** T07

## Goal
At month end each pocket's leftover follows its rule: Carry, Reset or Sweep. This task is the pure
calculation only; T16 writes the results.

## Read
`backend/04_Rollover.gs.js`: `applyRollover`. `tests/rollover.test.js`: its existing applyRollover test.

## Change
Rewrite `applyRollover(pockets, { fromMonthLabel = '' } = {})`. Pockets are as `readPockets` returns
them (`rule`, `sweepTo`, `carriedIn`, `kind`; treat a missing `rule` as `Reset`). It returns
`{ pockets, adjustments, resetCount, skippedCount }`, and keeps those two counts working as today.
All maths in integer cents. For each **Active** pocket, `left = balance`:

| rule | new balance | carriedIn | adjustment (only when left > 0) |
|---|---|---|---|
| Carry | limit + left | left | `{ type:'carry', toPocketId:id, amount:left }` |
| Reset | limit | 0 | `{ type:'forfeit', fromPocketId:id, amount:left }` |
| Sweep | limit | 0 | `{ type:'sweep', fromPocketId:id, toPocketId:target, amount:left }`, and target.balance += left |

- Sweep target missing, not Active, or itself → behave as **Carry**.
- Apply sweeps **after** every pocket has its new base balance, so a target that is itself Carry
  ends with `limit + its own left + swept in`.
- Every adjustment gets `note: 'Left over from ' + fromMonthLabel` (or `'Left over'` when the label
  is empty).
- Archived pockets are returned unchanged and counted in `skippedCount`.

## Tests (`tests/rollover.test.js`, adding to the existing tests, which must still pass)
Each rule; two pockets sweeping into Savings; a broken target → Carry; left 0 → no adjustment;
archived untouched; cents exact (0.10 + 0.20 swept = 0.30); a Carry pocket that is also a sweep target.

## Verify
```bash
node --test tests/rollover.test.js
npm run check
```

## Done-check (used when resuming)
```bash
grep -q "type: 'sweep'\|type:'sweep'" backend/04_Rollover.gs.js
```

## Commit
`v2(T15): leftover rules in applyRollover`
