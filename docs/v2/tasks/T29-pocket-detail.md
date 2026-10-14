# T29 · Pocket detail screen

**Milestone:** M2 · **Type:** frontend · **Depends on:** T28, T14

## Goal
Tapping a pocket opens its detail. Mockup: `docs/v2/mockups/PocketDetail.html`.

**Behaviour change (approved):** a row tap used to open the add form. Now it opens the detail, which
has an **Add expense** button.

## Change
1. `app/index.html`: `<section id="view-pocket" class="hidden">` with `pocket-back`,
   `pocket-settings`, `#pocket-body`, `pocket-add` and `pocket-move`.
   **Remove** `#home-move` (from T14).
2. New file `app/js/pocket.js`:
   - export the pure `pocketDetailHtml(data, month)`:
     - a header line "Funded from <account> · <Month>";
     - "Left" and the bar (reuse `barSegments`);
     - the breakdown lines, hiding zeros: Monthly limit; Carried in from <prev month> (+);
       Moved in (+); Moved out (−); Spent (N expenses) (−); Left;
     - "At month end" + the rule label;
     - "This month": transactions and adjustments merged newest first (20 max). Adjustments get a
       pale tag ("Moved" / "Carried") instead of a user tag.

     Escape everything.
   - export `mountPocket({ root, api, onAdd, onMove, onSettings })` → `{ open(pocketId) }`, which
     calls `api.getPocket` and renders.
3. `app/js/app.js`:
   - `'pocket'` goes in `VIEWS`;
   - change the `select-pocket` click handler (`grep -n "select-pocket" app/js/app.js`) to open the
     pocket view;
   - `pocket-add` → the add view + `selectPocket(id)` (the old behaviour);
   - `pocket-move` → the move screen `open(id)`;
   - `pocket-settings` → the manage view in edit mode for that pocket, if manage exposes a way to
     do that (otherwise just open manage);
   - remove the `#home-move` wiring.

## Tests
`pocketDetailHtml` (zero lines hidden, merge order, escaping). **Allowed change:** update any
existing test in `tests/app.test.js` that asserts a pocket-row tap opens the add view, so it now
expects the pocket view.

## Verify
```bash
node --test tests/app.test.js
npm run check
```

## Done-check (used when resuming)
```bash
test -f app/js/pocket.js
! grep -q "home-move" app/index.html
```

## Commit
`v2(T29): pocket detail screen`
