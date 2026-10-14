# T50 · Undo instead of confirm on delete

**Milestone:** M3 · **Type:** frontend · **Depends on:** T49

## Goal
A delete happens 6 seconds after the tap, unless the user taps Undo. The `confirm()` box goes away.

## Change
1. New file `app/js/undo.js`: export
   `createUndoQueue({ send, delayMs = 6000, timers = globalThis })` → `{ schedule(key, payload), undo(key), flush() }`.
   - `schedule` starts a timer that calls `send(payload)`. A second `schedule` flushes the pending
     one first.
   - `undo` cancels it.
   - `flush` sends whatever is pending straight away.
2. `app/js/app.js`:
   - remove `confirmDelete` and its use (`grep -n "confirmDelete" app/js/app.js`);
   - on `delete-txn` / `delete-group`: hide that row (add `hidden` to its closest `li`), show a toast
     "Deleted <note> R<amount>." with an **Undo** button, and `schedule`. You may need to extend
     `showToast` to take an optional `{ actionLabel, onAction }`; do it without `innerHTML`;
   - Undo → `undo(key)` and re-render the state;
   - `send` → the api delete → a toast (as today) → refresh;
   - on `visibilitychange` to hidden → `flush()`.

## Tests
`tests/undo.test.js` with `t.mock.timers.enable({ apis: ['setTimeout'] })`: nothing sent before
6 seconds; sent after 6 seconds; Undo cancels; a second schedule flushes the first; `flush` sends
straight away.
**Allowed change:** remove or adjust the tests in `tests/app.test.js` that assert the confirm dialog.

## Verify
```bash
node --test tests/undo.test.js
npm run check
```

## Done-check (used when resuming)
```bash
test -f app/js/undo.js
! grep -q "confirmDelete" app/js/app.js
```

## Commit
`v2(T50): undo instead of confirm`
