# T26 · Month-end card on Home

**Milestone:** M2 · **Type:** frontend · **Depends on:** T25

## Goal
On the first open of a month, Home shows what happened to last month's leftovers. Mockup:
`docs/v2/mockups/Main.html` (the "October wrapped up" card).

## Change
1. `app/index.html`: `<div id="month-end"></div>` above `#home-summary`.
2. `app/js/render.js`: export the pure `monthEndCardHtml(monthEnd)` → `''` when null. Otherwise:
   - the title "October wrapped up" (the English month name of `fromMonth`);
   - "R4,055 left over in 6 pockets. Here's where it went.";
   - up to 5 lines: `name · R amount · → carried | → <toName> | → reset (amber)`;
   - buttons: `data-action="monthend-review"` "Review & change", `data-action="monthend-dismiss"`
     "Looks good", and an ✕ (also `monthend-dismiss`, with `aria-label="Dismiss"`).

   Escape everything.
3. `app/js/app.js`:
   - render it into `#month-end` in `renderState` **only if** `localStorage['pb.monthEndSeen'] !==
     monthEnd.fromMonth` (wrap storage access in try/catch);
   - `monthend-dismiss` stores `fromMonth` and hides the card;
   - `monthend-review` is wired up in T27, so leave it inert for now.

## Tests
`monthEndCardHtml`: title, line text per type, max 5 lines, escaping. In `tests/app.test.js` (if
practical): a dismissed month isn't shown again.

## Verify
```bash
node --test tests/render.test.js
npm run check
```

## Done-check (used when resuming)
```bash
grep -q "export function monthEndCardHtml" app/js/render.js
```

## Commit
`v2(T26): month-end card on Home`
