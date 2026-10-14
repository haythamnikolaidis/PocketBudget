# T02 · Run the rollover before every write

**Milestone:** M1 · **Type:** backend · **Depends on:** T01

## Goal
Fix the bug where spending between midnight and the 02:00 trigger on the 1st is lost. Every write
handler rolls the month over first, inside its lock.

## Read
- `backend/05_Api.gs.js`: `createTransaction`, `deleteTransaction`, `createPocket`,
  `updatePocket`. Find the line in each straight after the successful `lock.tryLock(...)`.

## Change
In each of those 4 handlers, add `rolloverIfDue();` as the **first statement inside the `try`**
that follows a successful `tryLock`. Nothing else changes.

## Tests (new file `tests/rollover-timing.test.js`)
Copy the `setup()` helper from the top of `tests/money-path.test.js`. Use
`t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-31T22:30:00Z') })` (00:30 on 1 Nov,
household time).
1. Props `LAST_ROLLOVER_KEY: '2026-10'`, pocket `['P01','Groceries','Chase',800,0,'Active']`.
   `createTransaction` of R50 → `ok`, balance **750**, `LAST_ROLLOVER_KEY === '2026-11'`.
2. The same setup, then `dailyRollover()` at the same time → the balance is still 750.
3. Same month (`LAST_ROLLOVER_KEY: '2026-11'`) → `createTransaction` doesn't touch the other
   pockets' balances.
4. `deleteTransaction` in a new month also rolls over first.

## Verify
```bash
node --test tests/rollover-timing.test.js
npm run check
```

## Done-check (used when resuming)
```bash
test -f tests/rollover-timing.test.js
[ $(grep -c "rolloverIfDue();" backend/05_Api.gs.js) -ge 4 ]
```

## Commit
`v2(T02): roll the month over before any write`
