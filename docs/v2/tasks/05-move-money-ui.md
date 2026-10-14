# Task 05: Move money screen

**Milestone:** M2 · **Size:** S · **Depends on:** 04 · **Mockup:** "Move money between pockets"

## What
A screen to move money between pockets, using `api.transferFunds`.

## Where
- `app/index.html`: new `<section id="view-move">`.
- New file `app/js/move.js`, built like `manage.js`: `mountMove({ root, api, state, onDone, toast })`
  plus an `open({ fromPocketId })` method.
- `app/js/app.js`: add `'move'` to `VIEWS`, mount it, and add a temporary **Move money** button on
  Home under the pocket list. Task 10 also opens it from pocket detail, and task 09 from the
  month-end card.

## Layout (top to bottom, per the mockup)
1. Close button and the title "Move money".
2. **From** and **To**: two `<select>`s listing active pockets as "Dining Out — R385.00 left". A
   swap button switches them. Savings is listed too.
3. **Amount**: a large text input (`inputmode="decimal"`, the same parsing as the add form via
   `format.js`). Quick chips: R100, R200, R300, and "All R385" (the whole `from` balance).
4. **Why (optional)**: a note input, max 120 characters.
5. **Preview**: "Dining Out R385.00 → R185.00" and "Groceries R1,780.00 → R1,980.00", updated as
   the user types.
6. The line "Monthly limits stay the same."
7. A button: "Move R200.00".

## Behaviour
- The button is disabled when the amount is invalid, the pockets are the same, or the amount is
  more than the `from` balance. In that last case show the reason inline, as the add form does.
- Generate a `requestId` per attempt, and reuse it for a retry of the same values (copy
  `pendingAttempt` from `addform.js`).
- On success: a toast "Moved R200.00 to Groceries.", refresh state, and return to Home.
- On `INSUFFICIENT_FUNDS`: show the server message as it is, then refresh.

## Tests (`tests/move.test.js`, using `tests/helpers/fakeBrowser.js` the way `addform.test.js` does)
- The preview numbers are right; the "All" chip fills the full balance.
- The button is disabled for the same pocket, for zero, and for over-balance.
- A double tap sends one request.
- The payload carries the right fields and a requestId.

## Done when
- [ ] It works against your test Sheet, and both pockets update on Home.
- [ ] A smoke test step is added: "Move R10 between two pockets; both balances change; the limits
      don't."
