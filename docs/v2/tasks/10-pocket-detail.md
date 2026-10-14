# Task 10: Pocket detail screen

**Milestone:** M2 · **Size:** M · **Depends on:** 04, 06, 08 · **Mockup:** "Pocket detail"

## What
Tapping a pocket on Home opens its detail screen: where its money came from, its rule, and this
month's history.

> **Behaviour change:** today, tapping a pocket jumps straight to the add form with that pocket
> picked. Now it opens the detail screen, which has a big **Add expense** button. That button calls
> the existing `selectPocket`, so adding is still one extra tap away.

## Backend
A new action, `getPocket { pocketId, month }`. It returns:
- `pocket`: from `presentPocket`.
- `transactions`: this month's transactions for the pocket, newest first. Use the
  `readRecentTransactions` list from task 02, filtered by pocket.
- `adjustments`: this month's adjustments where the pocket is `from` or `to`.
- `breakdown: { limit, carriedIn, movedIn, movedOut, spent, left }`. `movedIn` / `movedOut` add up
  the `transfer` and `sweep` adjustments. `left` must equal the pocket's balance; add a test for it.

It's a read, so there's no lock. Remember to update `ACTIONS` and `api.js`.

## Frontend (`view-pocket`, new file `app/js/pocket.js`)
1. Back button, the pocket name, "Funded from FNB Cheque · November", and a settings icon that opens
   Manage with this pocket in edit mode.
2. A card with "Left R1,980.00", the two-segment bar from task 08, and the breakdown lines: Monthly
   limit; Carried in from October (+); Moved in (+); Moved out (−); Spent (N expenses) (−); Left.
   Hide any line that is zero.
3. Buttons: **Add expense** (green) and **Move money** (opens task 05 with `from` = this pocket).
4. "At month end": the rule in words. Tapping it opens the edit form.
5. "This month": expenses and adjustments merged by time. Adjustments get a pale "Moved" or
   "Carried" tag instead of a user tag. Show 20 and then "Show all".

## Tests
- Backend: the breakdown adds up to the balance, for a pocket with a carry, a transfer in, a
  transfer out and expenses.
- Frontend: lines with zero are hidden; Add expense picks the pocket in the add form.

## Done when
- [ ] It matches the mockup on the test Sheet.
- [ ] Home's temporary "Move money" button from task 05 is removed (it now lives here).
