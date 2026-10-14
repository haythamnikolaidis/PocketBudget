# T44 · Split screen

**Milestone:** M3 · **Type:** frontend · **Depends on:** T43, T34

## Goal
The split mode of the add form. Mockup: `docs/v2/mockups/Split.html`.

## Change
1. `app/index.html`, inside `view-add`:
   - a link `#add-split-open` "Split across pockets" under the pocket chips;
   - a hidden `<div id="add-split">` holding: `#split-total`, `#split-note`, `#split-lines`,
     `#split-status`, `#split-add` (chips), `#split-submit`, and a link `#split-close` "One pocket".
   The single form's fields are hidden while split mode is open.
2. `app/js/split.js`: export `mountSplit({ root, api, getState, getUser, onSaved, onStale, toast })`
   → `{ open({ totalText, note, pocketId }), close() }`.
   - Render the lines with created elements: name, "R2,880 left", an amount `<input>`
     (`aria-label`), and a remove button (`aria-label`).
   - The status reads "R340.00 left to allocate" or "All R1,240.00 allocated ✓".
   - Chips for unused, unlocked pockets.
   - Submit is disabled unless `canSave`, with an in-flight guard. The requestId is reused for the
     same fingerprint (the lines, note and user).
   - `api.createExpense({ user, note, requestId, lines: toPayloadLines(split) })`.
   - On ok: toast `Saved R… across N pockets.` → `close()` → `onSaved(result)`.
   - On `INSUFFICIENT_FUNDS`: toast the message as it is, `onStale()`, and keep the lines.
3. `app/js/addform.js`: `#add-split-open` → `split.open` with the current amount, note and pocket.
   `app.js` mounts the split next to the add form (`grep -n "mountAddForm" app/js/app.js`).

## Tests (`tests/split.test.js`, fake DOM)
`open` pre-fills line 1; a double submit sends once; the payload lines are right; a refusal keeps
the lines.

## Verify
```bash
node --test tests/split.test.js
npm run check
```

## Done-check (used when resuming)
```bash
grep -q "add-split" app/index.html
grep -q "export function mountSplit" app/js/split.js
```

## Commit
`v2(T44): split screen`
