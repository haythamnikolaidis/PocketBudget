# T36 · "When" chips on the add form

**Milestone:** M3 · **Type:** frontend · **Depends on:** T35

## Change
1. `app/js/format.js`: export the pure `householdDay(now = new Date())` → `'YYYY-MM-DD'` in UTC+2,
   and `whenOptions(now)` → `{ today, yesterday /* null on the 1st */, min /* the 1st of the month */, max /* today */ }`.
2. `app/index.html`: `<div id="add-when">` holding three buttons (Today, Yesterday, Pick a day) and a
   hidden `<input type="date" id="add-date">`.
3. `app/js/addform.js`:
   - the selected option goes into the payload as `date`, **only when it isn't today**;
   - add `date` to the retry `fingerprint`;
   - Pick a day shows the date input with `min`/`max`;
   - after a successful save, reset to Today;
   - hide Yesterday when `yesterday` is null.

## Tests
`whenOptions` on the 1st and the 15th, and at 23:30 UTC (already the next day in household time).
The payload has `date` for Yesterday and not for Today. Reset after a save.

## Verify
```bash
node --test tests/addform.test.js tests/frontend.test.js
npm run check
```

## Done-check (used when resuming)
```bash
grep -q "add-when" app/index.html
grep -q "export function whenOptions" app/js/format.js
```

## Commit
`v2(T36): when chips on add form`
