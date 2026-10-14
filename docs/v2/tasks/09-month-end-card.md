# Task 09: Month-end card

**Milestone:** M2 · **Size:** M · **Depends on:** 05, 06, 08 · **Mockups:** "Home · first day of a
new month" (the card) and "Month-end review"

## Why
Couples don't think about leftovers until the month turns over. The rollover already did the work,
so the app should say plainly what happened and make it easy to change.

## What
1. **Backend:** in the first 7 days of a month, `getState` returns
   `monthEnd: { fromMonth: '2026-10', items: [{ pocketId, name, type, amount, toPocketId, toName }],
   totals: { carried, swept, forfeited } }`, built from this month's adjustments whose type is
   `carry`, `sweep` or `forfeit`. Otherwise `monthEnd` is `null`.
2. **Home card** at the top, shown when `monthEnd` is set and this device hasn't dismissed it for
   that month (localStorage key `pb.monthEndSeen`, holding the month; wrap the access in try/catch,
   as `addform.js` does for `pb.user`):
   - "October wrapped up" and "R4,055 left over in 6 pockets."
   - Up to 5 lines, biggest first: "Car Service R3,000 → carried", "Dining Out R45 → Savings",
     "Petrol R30 → reset" (amber).
   - Buttons: **Review & change** (opens the review screen) and **Looks good** (dismisses). There
     is also an ✕ to dismiss.
3. **Review screen** (`view-monthend`): every item as a row: name, amount, what happened.
   - Carried or swept items have a **Move…** button that opens Move money (task 05) with `from` =
     that pocket (for a sweep, `from` = the target pocket that now holds the money).
   - If any active pocket still has the Reset rule, show a banner: "Petrol and Kids still reset at
     month end." with a **Switch to carry over** button. It calls `updatePocket({ rule: 'Carry' })`
     for each of them, then refreshes.
   - Three totals at the bottom (Carried, To Savings, Reset) and a **Done** button.

## Deliberately simpler than the mockup
The mockup shows **Keep** on money already lost by a Reset pocket. That would mean creating money
from nothing, so it's **not built**. "Switch to carry over" stops it happening next month instead.
(It's listed in task 21 if the owner wants it later.)

## Tests
- Backend: `monthEnd` is present on day 1 and day 7, and `null` on day 8. Items and totals match
  the adjustments. Transfers are not included.
- Frontend: the card shows once; after dismissing it, it stays hidden on refresh; a new month shows
  it again. "Switch to carry over" calls `updatePocket` once per Reset pocket.

## Done when
- [ ] After a forced rollover on the test Sheet, the card and review screen match the mockups.
- [ ] Smoke test step added: "after a rollover, the month-end card appears once per phone".
