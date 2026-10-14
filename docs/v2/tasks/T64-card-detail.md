# T64 · Card detail screen

**Milestone:** M4 · **Type:** frontend · **Depends on:** T63

## Goal
Mockup: `docs/v2/mockups/CardDetail.html`.

## Change
1. `app/index.html`: `<section id="view-card" class="hidden">` with `card-back` and `#card-body`.
2. New file `app/js/card.js`:
   - export the pure `cardDetailHtml(data, now)`, built from `getCard`:
     - the name and "Statement closes on the Nth · due on the Mth";
     - the cycle card: "This cycle · 26 Oct – 25 Nov", the total, "N expenses", and the green line
       "All of it is already covered by your pockets.";
     - the statement card: the amount, the due date or "paid", "R… still owing" for a part payment,
       and a `<button data-action="card-pay">Mark paid</button>` when it's unpaid;
     - available credit (only when there's a limit);
     - "This cycle by pocket": bars proportional to the largest;
     - "Recent on this card": up to 10 transactions.

     Escape everything;
   - export `mountCard({ root, api })` → `{ open(accountId) }`.
3. `app/js/app.js`: `'card'` goes in `VIEWS`; `open-card` → open it; Back → home. `card-pay` stays
   inert until T66.

## Tests (new file `tests/card-ui.test.js`)
`cardDetailHtml` paid vs unpaid vs part-paid; no credit line without a limit; bar widths; escaping.

## Verify
```bash
node --test tests/card-ui.test.js
npm run check
```

## Done-check (used when resuming)
```bash
test -f app/js/card.js
grep -q "view-card" app/index.html
```

## Commit
`v2(T64): card detail screen`
