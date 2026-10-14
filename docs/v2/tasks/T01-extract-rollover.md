# T01 · Move the rollover into a reusable `rolloverIfDue()`

**Milestone:** M1 · **Type:** backend · **Depends on:** —

## Goal
A pure refactor with **no behaviour change**. Move the code that actually performs the monthly
rollover out of `dailyRollover()` into an exported `rolloverIfDue(now)` in `05_Api.gs.js`, so the
API handlers can call it in T02 and T03.

## Context
Today `dailyRollover()` (07_Entry) runs at about 02:00. It: reads `LAST_ROLLOVER_KEY`; if it's
missing, records the month and stops; if `shouldRollover(lastKey, now)`, takes the lock, applies
`applyRollover`, writes changed balances, sets the key, flushes and unlocks; then calls
`refreshReport(now)`.

## Read
- `backend/07_Entry.gs.js`: `grep -n "export function dailyRollover" -A 50`
- `backend/05_Api.gs.js`: the imports at the top and the `unlock` helper.

## Change
1. In `05_Api.gs.js`, add:
   ```js
   /** Roll the month over if it has changed. CALLER MUST HOLD THE SCRIPT LOCK. Returns true if it rolled. */
   export function rolloverIfDue(now = new Date()) { … }
   ```
   It does: read the props; if there's no key → set `LAST_ROLLOVER_KEY = monthKey(now)` and return
   false; if `!shouldRollover(key, now)` → return false; otherwise read pockets
   (`includeArchived: true`), `applyRollover`, `writeBalance` for each active pocket whose balance
   changed, set the key, `Logger.log` the same message as today (guard with
   `typeof Logger !== 'undefined'`), and return true. It does **not** lock, flush or refresh the report.
2. Import what it needs in `05_Api.gs.js`: `applyRollover` and `shouldRollover` from 04,
   `writeBalance` from 03 (check what's already imported).
3. Rewrite `dailyRollover()` so its behaviour is identical:
   - no key → record the month without locking (as today);
   - due → `tryLock` (throw the same `'Rollover postponed: could not get the script lock.'` if that
     fails), `try { rolloverIfDue(now) } finally { flushWrites(); lock.releaseLock(); }`;
   - always `refreshReport(now)` at the end.
4. Remove the imports 07_Entry no longer uses.

## Tests
No new tests. The existing rollover tests in `tests/money-path.test.js`, `tests/rollover.test.js`
and `tests/setup.test.js` must pass **unchanged**.

## Verify
```bash
npm run check
```

## Done-check (used when resuming)
```bash
grep -q "export function rolloverIfDue" backend/05_Api.gs.js
grep -q "rolloverIfDue" backend/07_Entry.gs.js
```

## Commit
`v2(T01): extract rolloverIfDue from dailyRollover`
