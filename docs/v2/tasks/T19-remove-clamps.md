# T19 · Stop capping balances at the monthly limit

**Milestone:** M2 · **Type:** backend+frontend · **Depends on:** T15

## Goal
With carry-over, a balance can be bigger than its limit. Two places would throw that money away.

## Read
`backend/01_Utils.gs.js` `balanceAfterLimitChange`; `app/js/format.js` `balanceAfterLimitChange`
(a frontend copy; `tests/frontend.test.js` checks the two match); `backend/05_Api.gs.js`
`deleteTransaction` (look for `Math.min(pocket.limit`).

## Change
1. Both copies of `balanceAfterLimitChange(balance, oldLimit, newLimit)`: return
   `Math.max(0, bal + (newC - oldC)) / 100` (cents). Remove the `Math.min(newC, …)` upper cap.
2. `deleteTransaction`: `refunded = r2(pocket.balance + record.amount)` (remove the clamp to limit).
3. Update the comments that describe the old clamp (in `manage.js` too: `grep -n "clamp" app/js/manage.js`).
   The UI warning texts stay correct.

## Tests
- **Allowed change:** update the existing `balanceAfterLimitChange` expectations that relied on the
  cap.
- New: balance 4120 / limit 4000 → limit 3500 gives 3620; → limit 5000 gives 5120.
- Delete-refund on a pocket above its limit refunds the full amount.

## Verify
```bash
npm run check
```

## Done-check (used when resuming)
```bash
! grep -q "Math.min(pocket.limit" backend/05_Api.gs.js
```

## Commit
`v2(T19): balances may exceed the limit`
