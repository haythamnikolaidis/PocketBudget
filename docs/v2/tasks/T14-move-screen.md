# T14 · Move money screen

**Milestone:** M2 · **Type:** frontend · **Depends on:** T13

## Goal
The Move money screen, wired to `api.transferFunds`. Mockup: `docs/v2/mockups/MoveMoney.html`.

## Read
- `app/index.html`: an existing `<section id="view-manage">` for patterns.
- `app/js/app.js`: `grep -n "VIEWS\|mountManage\|function refresh\|switchView(" app/js/app.js`
  (read about 20 lines around each hit only).
- `app/js/addform.js`: `pendingAttempt` and `newRequestId` (the retry pattern).

## Change
1. `app/index.html`: `<section id="view-move" class="hidden">` with these ids:
   - `move-close`;
   - `move-from` and `move-to` (`<select>` + `<label>`);
   - `move-swap`, `move-amount` (`inputmode="decimal"`), `move-quick` (a container for chips);
   - `move-note` (maxlength 120), `move-preview`, `move-reason`, `move-submit`.

   Add `<button id="home-move">Move money</button>` under the pocket list on Home; it's temporary
   and removed in T29.
2. `app/js/move.js`: `export function mountMove({ root, api, getState, getUser, onDone, toast, doc })`,
   which returns `{ open(fromId) }`.
   - `open` fills both selects ("Dining Out — R385.00 left") and selects `fromId`.
   - Every input redraws the preview and quick chips (via `textContent` / created elements) and the
     reason, and enables or disables submit.
   - Submit: a double-tap guard (in-flight flag), and a requestId reused for the same values (copy
     `pendingAttempt`). Call `api.transferFunds({ user: getUser(), fromPocketId, toPocketId, amount, note, requestId })`.
   - On ok: toast `Moved R… to <name>.` and `onDone()`. On error: toast `err.message` as it is.
3. `app/js/app.js`: add `'move'` to `VIEWS`. Mount it after state first loads (as `mountManage`
   is). `#home-move` → `switchView(..., 'move')` + `open(firstPocketId)`. Close → home. `onDone` →
   refresh, then home. The user is whatever the add form uses (the remembered `pb.user`); find how
   addform reads it.

## Tests (`tests/move.test.js`)
Use the fake DOM pattern from `tests/addform.test.js` (or `tests/helpers/fakeBrowser.js`):
- A double submit calls `transferFunds` once.
- The payload has every field and a requestId; a retry with the same values reuses the requestId.

## Verify
```bash
node --test tests/move.test.js
npm run check
```

## Done-check (used when resuming)
```bash
grep -q "view-move" app/index.html
grep -q "export function mountMove" app/js/move.js
```

## Commit
`v2(T14): move money screen`
