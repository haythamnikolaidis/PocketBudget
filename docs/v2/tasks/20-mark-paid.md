# Task 20: Mark statement paid

**Milestone:** M4 · **Size:** M · **Depends on:** 04, 19 · **Mockup:** "Mark statement paid"

## The one rule
**Paying the card is not an expense and never changes a pocket.** The pockets already gave up that
money when each swipe was logged. A payment is just a record that the debt is settled.

## Backend
A new action, `recordCardPayment { accountId, closeKey, statementAmount, paidAmount, fromAccountId,
user, requestId }`:
- Validate: the account is an active card; `closeKey` is a date; both amounts > 0 (in cents);
  `fromAccountId`, if given, is an active bank or cash account; the requestId is valid.
- Inside the lock: idempotency through the Adjustments Request ID; append one Adjustments row:
  Type `card_payment`, Account ID = the card, Amount = `paidAmount`, Month = `monthKey(now)`, and
  Note = `closeKey|statement:<statementAmount>|from:<fromAccountId>`. Keep it simple and parse it
  back in `summariseCard`.
- **No pocket writes.** Write a test that asserts every pocket balance is unchanged.
- `summariseCard` (task 19) uses these rows to work out `paid` and `paidAmount` for each `closeKey`.

## Frontend (`view-paycard`, opened from **Mark paid** on card detail)
1. "Pay Sam's Visa", "Statement of 25 Oct · due 15 Nov".
2. **Amount on the statement**, pre-filled with the logged total and editable, because the bank's
   figure is the truth.
3. A comparison box: "Logged in PocketBudget R3,980.00", "On the statement R4,050.00", and, when
   they differ, the amber line "Not logged R70.00".
4. If there's a gap, ask "What was the R70.00?" with two options:
   - **Something we forgot to log, or fees:** after the payment is recorded, open the add form with
     amount = the gap, note "Card: unlogged / fees", and Paid with = this card, so the user just
     picks the pocket and saves.
   - **Leave it:** do nothing more.
5. **Paid:** In full (default, paid = the statement amount) or Part of it… (shows an amount input).
   **from:** a select of bank and cash accounts.
6. The line "Paying the card moves money that your pockets already set aside, so no pocket balance
   changes."
7. The button "Record R4,050.00 payment" → toast → back to card detail, which now shows "paid".
   For a part payment, card detail shows "R1,200 still owing; interest will be charged" in amber.

## Deliberately simpler than the mockup
The mockup has a third option, "Fees or interest → Bank Fees pocket". Here, the "forgot to log"
option covers fees too, and the user picks the pocket (they can create a Bank Fees pocket if they
want one). One fewer special case.

## Tests
- Backend: the row is written correctly; no pocket changes; a duplicate requestId is ignored; a
  part payment leaves `owing` > 0 in `summariseCard`.
- Frontend: the gap is calculated in cents; "forgot to log" opens the add form pre-filled; part
  payment needs an amount.

## Done when
- [ ] The full card loop works on the test Sheet: log on the card → the statement closes → mark
      paid → the card shows paid, and no pocket moved.
- [ ] Smoke test steps added for the card loop.
- [ ] **Milestone M4 check:** run the whole smoke test on the test Sheet before shipping.
