# Task 15: Cover the shortfall

**Milestone:** M3 · **Size:** S · **Depends on:** 14 · **Mockup:** "Cover the shortfall"

## Why
When Groceries has R340 and the shop is R400, today the Save button just greys out. That's a dead
end. The rule (no pocket below zero) stays; we just offer a fix.

## What (frontend only, in `addform.js`)
In single-pocket mode, when the typed amount is **more than** the selected pocket's balance **and**
that balance is above 0:

1. Show an amber panel instead of the disabled-button message:
   - "Groceries only has R340.00"
   - "Take the other R60.00 from:"
   - Up to 3 chips for other unlocked pockets whose balance is ≥ the shortfall, highest balance
     first, including Savings. Each shows "Household R210 → R150".
   - A last chip, **Split it myself**: opens split mode (task 14) with line 1 = this pocket at its
     full balance and nothing else.
2. Choosing a pocket chip shows a summary ("Groceries R340.00 · empties the pocket", "Household
   R60.00"), and the button becomes "Save R400.00 across 2 pockets".
3. Save calls `api.createExpense` with those two lines.
4. If no single pocket can cover the shortfall, show only **Split it myself**.
5. Changing the amount or pocket clears the choice. A locked pocket (balance 0) keeps today's
   behaviour.

## Tests
- The panel appears only when amount > balance > 0.
- The chips leave out the selected pocket, locked pockets and pockets that are too small; order and
  number are right.
- Choosing a chip and saving sends two lines whose amounts add up to the total.
- Split it myself opens split mode pre-filled.

## Done when
- [ ] On the test Sheet, overspending a pocket by a little is one extra tap.
