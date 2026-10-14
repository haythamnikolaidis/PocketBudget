# T63 · Cards section on Home

**Milestone:** M4 · **Type:** frontend · **Depends on:** T62

## Goal
Mockup: `docs/v2/mockups/Main.html` (the "Cards" section).

## Change
1. `app/index.html`: `<h2>Cards</h2><div id="cards"></div>` under the Savings section (hide both when
   there are no cards).
2. `app/js/render.js`: export the pure `cardRowHtml(card, now)`. It's a `<button data-action="open-card" data-account-id>`
   with the name and `cycle.total` ("This cycle"), then:
   - when the statement is unpaid: "statement R3,980 due 15 Nov" plus an amber pill "Due in N days"
     ("Overdue" when it's past due);
   - when it's paid: "Last statement paid in full" plus a pill "Covered";
   - when `statement.total === 0`: "No statement due".

   Also export `renderCards(container, cards, now)`.
3. `app/js/app.js`: call `renderCards` in `renderState`. `open-card` stays inert until T64.

## Tests (`tests/render.test.js`)
Each state of `cardRowHtml`; the days-until arithmetic; escaping.

## Verify
```bash
node --test tests/render.test.js
npm run check
```

## Done-check (used when resuming)
```bash
grep -q "export function cardRowHtml" app/js/render.js
```

## Commit
`v2(T63): cards on Home`
