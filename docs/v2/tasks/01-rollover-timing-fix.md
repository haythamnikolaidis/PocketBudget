# Task 01: Fix the rollover timing bug

**Milestone:** M1 · **Size:** M · **Depends on:** 00

## Why
Months change at midnight (South African time), but balances are only reset when the nightly
trigger runs at about 02:00. So:

- An expense at 00:30 on the 1st is deducted from **last** month's balance, then wiped out when
  the reset runs at 02:00. It counts as this month's spending, but the balance never reflects it.
- If last month's pocket was empty, that 00:30 expense is wrongly refused.
- If the trigger can't get the lock, the next try is 24 hours later, so a whole day is lost.

## The fix in one sentence
Before any request does anything else, check whether the month has changed since the last
rollover, and if it has, run the rollover first, inside the lock.

## Where
- `backend/07_Entry.gs.js`: `dailyRollover()` holds the rollover code today.
- `backend/05_Api.gs.js`: the write handlers and `getState`.
- `backend/04_Rollover.gs.js`: `shouldRollover`, `applyRollover` (pure; leave them alone).

## Steps
1. In `05_Api.gs.js`, add and export `rolloverIfDue(now = new Date())`. **The caller must already
   hold the script lock.** Move into it the body of the `else if (shouldRollover…)` branch from
   `dailyRollover`, without the lock handling: read pockets, `applyRollover`, write changed
   balances, set `LAST_ROLLOVER_KEY`. Keep the "no key yet → just record this month" branch too.
   Return `true` if it rolled over.
2. Make `dailyRollover()` take the lock, call `rolloverIfDue(now)`, and unlock. It stays as the
   backup for months when nobody opens the app.
3. Call `rolloverIfDue()` as the **first line inside the lock** in `createTransaction`,
   `deleteTransaction`, `createPocket` and `updatePocket`.
4. In `getState` (which takes no lock today): if `shouldRollover(props.LAST_ROLLOVER_KEY)` is
   true, take the lock, call `rolloverIfDue()`, and `unlock(lock)`. Otherwise don't lock, so normal
   page loads stay fast. If the lock isn't available, carry on without rolling over; the next
   request will do it.
5. Change the trigger in `setup()` from `.atHour(2)` to `.atHour(0)`, and update the comment. It is
   only a backup now.

## Tests (`tests/rollover-timing.test.js`)
Control the clock with `t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-31T22:30:00Z') })`
(that is 00:30 on 1 November in South Africa). Copy the setup helper from `tests/money-path.test.js`.

- The scenario: `LAST_ROLLOVER_KEY` is `2026-10`, Groceries has limit 800 and balance 0. At 00:30
  on 1 Nov, spending R50 **succeeds**, the balance ends at 750, and `LAST_ROLLOVER_KEY` is `2026-11`.
- A later `dailyRollover()` the same day changes nothing (the balance stays 750).
- `getState` on a new month rolls over; `getState` in the same month does not take the lock.
- No `LAST_ROLLOVER_KEY` → records the month and does not reset (existing behaviour, keep it).
- The existing tests in `money-path.test.js` and `rollover.test.js` still pass.

## Done when
- [ ] All of the above tests pass, and `npm run check` is green.
- [ ] Smoke test step 11 ("Monthly rollover") is updated: the rollover happens on the first request
      of the month, not at 02:00.

## Watch out
- Don't call `rolloverIfDue` without holding the lock: a rollover racing an expense can overwrite
  the deduction.
- Task 06 replaces "reset to limit" with leftover rules. Keep this task to the timing only.
