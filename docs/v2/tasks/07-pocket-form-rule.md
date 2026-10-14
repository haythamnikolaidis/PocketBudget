# Task 07: Leftover rule on the pocket form

**Milestone:** M2 · **Size:** S · **Depends on:** 06 · **Mockup:** "Pocket settings · leftover rule"

## What
The create and edit pocket form in Manage gets an **"At month end, what's left…"** choice.

## Where
`app/index.html` (`#manage-form`) and `app/js/manage.js`.

## Layout
Below the limit field, three radio options as large tappable cards (real
`<input type="radio">` + `<label>`):
1. **Carries over** with a "Default" tag: "Added to next month, no limit on how much builds up."
2. **Goes to another pocket**: "This pocket starts fresh each month." When chosen, show a `<select>`
   of the other active pockets, with Savings first and pre-selected.
3. **Resets**: "Back to R800 on the 1st. Anything left is not kept." (Use the typed limit in the text.)

Under the limit field: "R0 is fine for a pocket that only collects leftovers, like Savings."

## Behaviour
- Creating: Carry is pre-selected. A limit of 0 is allowed unless Resets is chosen; in that case
  show "A pocket that resets needs a monthly limit above R0."
- Editing: show the pocket's current rule (`pocket.rule`, `pocket.sweepTo` from `getState`).
- Send `rule` and `sweepTo` to `createPocket` / `updatePocket`.
- Each pocket row in the manage list shows its rule in small text: "Carries over", "Resets", or
  "Goes to Savings".

## Tests (extend `tests/manage.test.js`)
- Create sends `rule: 'Carry'` by default.
- Choosing Sweep sends `sweepTo` and defaults it to the Savings pocket.
- Zero limit + Reset is blocked with the message; zero + Carry is allowed.
- Editing shows the existing rule selected.

## Done when
- [ ] Creating and editing on the test Sheet saves the rule (check columns G and H).
- [ ] `npm run check` is green; Tailwind and the service worker version are regenerated.
