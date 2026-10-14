# T39 · Store-name suggestions on the add form

**Milestone:** M3 · **Type:** frontend · **Depends on:** T34, T38

## Goal
Typing "eng" offers "Engen · usually Petrol"; a tap fills it in and picks the pocket. Mockup:
`docs/v2/mockups/QuickAdd.html`.

## Change
1. `app/index.html`: `<div id="add-suggest" class="hidden"></div>` under `#add-note`, and
   `<span id="add-picked"></span>` next to the Pocket label.
2. `app/js/addform.js`:
   - export the pure `matchMerchants(merchants, text, n = 3)`: case-insensitive, only from 2
     characters; "starts with" matches first, then "contains";
   - on input in the note field: render up to 3 `<button>`s (the name, plus "usually <pocket name>"),
     built with `textContent`;
   - a tap → set the note, select the pocket if it isn't locked, hide the list, and focus the amount
     if it's empty;
   - track `pocketTouched` (set when the user taps a chip or changes the select; reset after each
     save). An **exact** (case-insensitive) match while `!pocketTouched` auto-selects the pocket and
     sets `#add-picked` to `picked from "Engen"`;
   - Escape or blur hides the list.

## Tests
`matchMerchants` ordering and the 2-character minimum; a tap selects the pocket; auto-select never
overrides a pocket the user touched, and never picks a locked one.

## Verify
```bash
node --test tests/addform.test.js
npm run check
```

## Done-check (used when resuming)
```bash
grep -q "export function matchMerchants" app/js/addform.js
```

## Commit
`v2(T39): merchant suggestions`
