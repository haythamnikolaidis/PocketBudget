# T03 · Roll over on the first read of a month; trigger at midnight

**Milestone:** M1 · **Type:** backend · **Depends on:** T02

## Goal
Opening the app on the 1st shows the new month straight away. The nightly trigger becomes a backup.

## Read
- `backend/05_Api.gs.js`: `getState`.
- `backend/07_Entry.gs.js`: `grep -n "atHour" -B6 -A3`.

## Change
1. In `getState`, right after the token check:
   ```js
   const props = PropertiesService.getScriptProperties();
   if (shouldRollover(props.getProperty('LAST_ROLLOVER_KEY'))) {
     const lock = LockService.getScriptLock();
     if (lock.tryLock(LOCK_TIMEOUT_MS)) {
       try { rolloverIfDue(); } finally { unlock(lock); }
     }   // busy: skip; the next request will do it
   }
   ```
   When the month hasn't changed, **no lock is taken** (reads stay fast).
2. In `setup()`, change `.atHour(2)` to `.atHour(0)`, and update the nearby comment ("backup; the
   first request of a month normally rolls over").

## Tests (add to `tests/rollover-timing.test.js`)
1. New month: `getState` rolls over (the balance is reset, the key is updated).
2. Same month: `getState` never calls `tryLock`. Count the calls with a wrapped lock.
3. Lock busy (`tryLock` returns false): `getState` still returns `ok`, and nothing is rolled over.

## Verify
```bash
node --test tests/rollover-timing.test.js
npm run check
```

## Done-check (used when resuming)
```bash
grep -q "atHour(0)" backend/07_Entry.gs.js
grep -A15 "export function getState" backend/05_Api.gs.js | grep -q rolloverIfDue
```

## Commit
`v2(T03): roll over on first read of the month; trigger at midnight`
