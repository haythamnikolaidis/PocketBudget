# Task 06: Leftover rules in the rollover

**Milestone:** M2 · **Size:** M · **Depends on:** 01, 03, 04

## Why
At month end, every pocket is reset to its limit and the leftover is lost. The owner decided:
- Each pocket has a rule: **Carry** (keep the leftover, no cap), **Sweep** (send it to another
  pocket, usually Savings), or **Reset** (today's behaviour).
- New pockets default to **Carry**. Existing pockets stay **Reset** until someone switches them.
- **Savings** is a normal pocket with a R0 limit.

## The rules (for each Active pocket, at rollover)
`leftover` = the balance just before the rollover, in cents.

| Rule | New balance | Carried In (col I) | Adjustment row |
|---|---|---|---|
| Carry | `limit + leftover` | `leftover` | `carry`, to = this pocket (only if leftover > 0) |
| Reset | `limit` | `0` | `forfeit`, from = this pocket (only if leftover > 0) |
| Sweep | `limit` | `0` | `sweep`, from = this pocket, to = target. The target's balance goes up by `leftover` |

- A Sweep whose target is missing, archived or itself is treated as **Carry**, so money is never
  lost silently, and it's logged.
- Several pockets can sweep into the same target; add them all.
- Archived pockets are skipped, as today.
- Every adjustment row gets Month = the **new** month, User = `system`, Note = "Left over from
  October" (use the old month's name).

## Where
- `backend/04_Rollover.gs.js`: rewrite `applyRollover(pockets, { fromMonthLabel })` as a pure
  function returning `{ pockets, adjustments }`. Do everything in cents.
- `backend/05_Api.gs.js`: `rolloverIfDue` writes the balances and Carried In of every active
  pocket, then appends all adjustments in one call.
- `backend/03_Sheets.gs.js`: add `writePocketRollover(pocketId, balance, carriedIn)` (or batch
  them all in one `setValues`, which is better if you're comfortable with it).
- `backend/07_Entry.gs.js` `migrateV2()`: now create the Savings pocket if no pocket has Kind
  `Savings` (name `Savings`, limit 0, balance 0, Active, rule Carry, kind Savings).

## Also change, because balances can now be bigger than the limit
1. `createPocket`: accept `rule` (default `Carry`) and `sweepTo`. A limit of **0 is allowed unless
   the rule is Reset** (a Reset pocket with R0 would be useless).
2. `updatePocket`: accept `rule` and `sweepTo`. Validate that `sweepTo` is an active pocket and
   isn't the pocket itself. The same zero-limit rule applies.
3. `01_Utils balanceAfterLimitChange`: remove the upper clamp to the new limit. Keep "balance moves
   by the limit difference, never below 0". Otherwise raising or lowering a limit would destroy
   carried money. Update its tests and the warning text in `manage.js` (`clampWarning`).
4. `deleteTransaction`: refund exactly the deleted amount (`balance + amount`). Remove the
   `Math.min(pocket.limit, …)` clamp; it would eat carried money.
5. `presentPocket` (05_Api): also return `rule`, `sweepTo`, `carriedIn`, `kind`, and
   `available = limit + carriedIn`. Base `pctUsed` on `available`.

## Tests
- `applyRollover` (pure, in `rollover.test.js`): each rule, sweep into Savings, two pockets
  sweeping into one target, a broken sweep target (falls back to Carry), leftover 0 (no adjustment
  row), archived pockets untouched, cents-exact (R0.10 + R0.20 sweeps give exactly R0.30).
- End to end through `rolloverIfDue`: the sheet balances, column I, and the Adjustments rows are all
  correct, and running it again in the same month changes nothing.
- `createPocket` defaults to Carry; it allows R0 for Carry and refuses R0 for Reset.
- Lowering a limit on a pocket holding carried money keeps that money.
- Delete-and-refund on a pocket above its limit refunds the full amount.
- Migration adds exactly one Savings pocket, even when run twice.

## Done when
- [ ] Tests pass and `npm run check` is green.
- [ ] On the test Sheet, set `LAST_ROLLOVER_KEY` to last month in Project Settings → Script
      Properties, open the app, and check that the balances and Adjustments rows match the rules.
- [ ] Smoke test step 11 is updated to cover all three rules.
- [ ] `docs/PRODUCT_BRIEF.md` §4A *Monthly Rollover* and success criterion 6 are updated to the new
      wording in `docs/RECOMMENDATIONS.md` §2.
