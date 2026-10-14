# T12 · `getState` returns this month's adjustments

**Milestone:** M2 · **Type:** backend · **Depends on:** T10

## Change
In `getState`, add `adjustments: readAdjustments({ month })` to the payload, newest first. It's
`[]` when the sheet doesn't exist.

## Read
`backend/05_Api.gs.js` `getState` (the final `ok({...})`).

## Tests (`tests/api.test.js`)
- Without an Adjustments sheet → `adjustments` is `[]`.
- With rows for two months → only the current month's, newest first.

## Verify
```bash
node --test tests/api.test.js
npm run check
```

## Done-check (used when resuming)
```bash
grep -q "adjustments: readAdjustments" backend/05_Api.gs.js
```

## Commit
`v2(T12): getState returns adjustments`
