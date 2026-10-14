# Task 08: Home: carried-in bars, Savings section

**Milestone:** M2 · **Size:** S · **Depends on:** 06 · **Mockup:** "Home · first day of a new month"

## What
Home shows where each pocket's money came from, and gives Savings its own section.

## Where
`app/js/render.js` (`pocketRowHtml`, `summaryHtml`, `renderPockets`), `backend/05_Api.gs.js`
(`getState` summary), and `app/index.html` if new containers are needed.

## Changes
1. **Pocket bar:** the bar's full width is now `available` (limit + carried in), not `limit`.
   Draw two segments: green for this month's money left, and pale green (`#a7f3d0`) for the carried
   part.
   - `carriedLeft = min(carriedIn, balance)`; `ownLeft = balance - carriedLeft`. Widths are
     `ownLeft / available` and `carriedLeft / available`. Clamp the total at 100% (a transfer in can
     push the balance above `available`).
   - Below the list, a small legend: "This month's budget" and "Carried in".
2. **Pills:** "+R120 from Oct" when `carriedIn > 0`. A grey "Reset" pill on pockets whose rule is
   Reset, so the couple can see which ones still lose their leftover.
3. **Amount text:** pockets with carried money show only the amount left (`R4,120`), because
   "/ R4,000" would look wrong. Others keep "R1,200 / R1,200".
4. **Savings section:** pockets with `kind === 'Savings'` are left out of the main list and drawn
   under a "Savings" heading below it. There's no bar, just the balance and the line "No monthly
   limit · fed by leftovers and transfers". A Savings pocket with R0 must **not** look "depleted".
5. **Summary:** in `getState`, leave Savings pockets out of `totalLimit`, `totalBalance` and
   `totalSpent`, and add `totalCarriedIn`. The header reads "of R15,280 · includes R3,980 carried
   in" when `totalCarriedIn > 0`.

## Tests (`tests/render.test.js`)
- Bar widths for: no carry; carry with nothing spent; carry partly spent; balance above available.
- The pill text uses the previous month's short name, worked out from `payload.month`.
- Savings is rendered in its own section and never with the depleted style.
- The summary leaves Savings out (backend test in `api.test.js`).

## Done when
- [ ] Home on the test Sheet, after a forced rollover (see task 06), matches the mockup.
- [ ] Text is still readable on a small phone (360px wide).
