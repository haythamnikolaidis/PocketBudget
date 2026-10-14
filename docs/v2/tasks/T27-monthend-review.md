# T27 · Month-end review screen

**Milestone:** M2 · **Type:** frontend · **Depends on:** T14, T26

## Goal
The full list of what happened, with "Move…" and "Switch to carry over". Mockup:
`docs/v2/mockups/MonthEnd.html`.

**Deliberately not built:** the mockup's "Keep" button for money lost at reset.

## Change
1. `app/index.html`: `<section id="view-monthend" class="hidden">` with a Back button
   (`monthend-back`), `#monthend-banner`, `#monthend-list`, `#monthend-totals`, and `monthend-done`.
2. `app/js/render.js`: export the pure `monthEndReviewHtml(monthEnd, pockets)`:
   - one row per item: name, amount, "Carried into <month>" | "Swept to <toName>" | "Lost at reset".
     Carry and sweep rows get a `data-action="monthend-move"` button with `data-pocket-id`: for a
     carry, the pocket itself; for a sweep, the **target** (where the money is now);
   - `resetBannerHtml(pockets)`: when any active, non-Savings pocket has rule Reset: "<names> still
     reset at month end." plus a `data-action="monthend-switch"` button "Switch to carry over".
   - The totals: Carried, To Savings (sweeps), Reset (forfeits).
3. `app/js/app.js`:
   - `'monthend'` goes in `VIEWS`; `monthend-review` (from T26) opens it;
   - `monthend-move` → the move screen's `open(pocketId)`;
   - `monthend-switch` → `updatePocket({ pocketId, rule: 'Carry' })` for each Reset pocket, one
     after another, then refresh;
   - `monthend-done` / `monthend-back` → mark the month seen and go home.

## Tests
The pure HTML functions (rows per type, button targets, banner names, totals).

## Verify
```bash
node --test tests/render.test.js
npm run check
```

## Done-check (used when resuming)
```bash
grep -q "view-monthend" app/index.html
```

## Commit
`v2(T27): month-end review screen`
