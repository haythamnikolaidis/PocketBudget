# T34 · Pocket chips on the add form

**Milestone:** M3 · **Type:** frontend · **Depends on:** T32, T33

## Goal
The 4 most-used pockets as one-tap chips. The `<select>` stays as the source of truth, behind "More…".
Mockup: `docs/v2/mockups/QuickAdd.html`.

## Change
1. `app/index.html`: `<div id="add-chips"></div>` just above `#add-pocket`. The select's wrapper
   gets hidden by default.
2. `app/js/addform.js`:
   - export the pure `topPockets(pockets, isLocked, n = 4)`: leave out locked pockets and
     `kind === 'Savings'`; sort by `txnCount` (high first), then balance (high first);
   - render the chips with created elements (`textContent`): the name, plus a small line
     "R1,420 left". The selected chip gets a highlight class;
   - a chip tap → `pocketEl.value = id; syncSubmitState(); renderChips()`;
   - the last chip, "More…", shows the select's wrapper;
   - re-render the chips in `renderOptions` and on `pocketEl` change.

## Tests (`tests/addform.test.js`)
`topPockets` filtering and order; a chip tap changes the select and the submit state; More… reveals
the select.

## Verify
```bash
node --test tests/addform.test.js
npm run check
```

## Done-check (used when resuming)
```bash
grep -q "add-chips" app/index.html
grep -q "export function topPockets" app/js/addform.js
```

## Commit
`v2(T34): pocket chips on add form`
