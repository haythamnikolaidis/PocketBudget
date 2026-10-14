# T46 · Cover the shortfall: UI

**Milestone:** M3 · **Type:** frontend · **Depends on:** T45, T44

## Goal
Overspending a pocket offers to take the rest from another one. Mockup:
`docs/v2/mockups/Shortfall.html`.

## Change
1. `app/index.html`: a hidden `<section id="add-shortfall">` in `view-add`, holding a heading, a
   line, a `#shortfall-chips` container and a `#shortfall-summary`.
2. `app/js/addform.js`:
   - in `syncSubmitState` (or right after it), compute `shortfallOptions`. When it's non-null, show
     the panel ("Groceries only has R340.00" / "Take the other R60.00 from:"), one chip per
     candidate ("Household R210 → R150"), and a last chip, "Split it myself";
   - choosing a candidate shows the summary lines and sets the submit text to "Save R400.00 across 2
     pockets", and submit then calls `api.createExpense` with `shortfallLines(...)`. Use the same
     requestId and fingerprint rules, and handle success and refusal the way the single save does;
   - "Split it myself" → `split.open` with line 1 = the selected pocket;
   - changing the amount or pocket clears the choice;
   - with no candidates, only "Split it myself" shows;
   - while the panel is showing and nothing is chosen, submit stays disabled.

## Tests (`tests/addform.test.js`)
The panel appears only when amount > balance > 0; choosing a candidate and submitting calls
`createExpense` with two lines; changing the amount clears the choice.

## Verify
```bash
node --test tests/addform.test.js
npm run check
```

## Done-check (used when resuming)
```bash
grep -q "add-shortfall" app/index.html
```

## Commit
`v2(T46): shortfall UI`
