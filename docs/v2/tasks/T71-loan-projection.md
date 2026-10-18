# T71 · Loan projection and summary (pure)

**Milestone:** M5 · **Type:** backend · **Depends on:** T70

## Goal
From today's state, work out when the loan will be paid off and how much interest is still to come,
and shape one loan for the API.

## Read
- `backend/09_Loans.gs.js` (all of it; T70).
- `backend/01_Utils.gs.js`: `toDollars`.

## The rules
The projection continues the replay with **the same `loanStepDay`**, from the day after `asOfKey`,
with the rate and instalment in force on `asOfKey` held fixed and no extras or corrections. It
starts from the replay's `balanceCents` **and** `units`, so the interest already accrued is billed
on the next billing day and counted in the interest still to pay.
- `state: 'paid_off'` when the replay balance is already 0.
- `state: 'on_track'` when a debit order brings the balance to 0: `paidOffOn` is that day,
  `monthsLeft` is how many debit orders were projected (including the last, smaller one) and
  `interestRemainingCents` is all the interest billed in the projection.
- `state: 'never'` when, on any projected billing day after the first, the balance after billing is
  ≥ the balance after the previous projected billing day (the instalment doesn't cover the
  interest), or after 600 projected billing days (50 years). `paidOffOn`, `monthsLeft` and
  `interestRemainingCents` are then null.

## Change (`backend/09_Loans.gs.js`)
```js
export function projectLoan(loan, replay, asOfKey)
  // → { state, paidOffOn, monthsLeft, interestRemainingCents }
export function summariseLoan(loan, events, now = new Date())
```
`summariseLoan` replays to `loanDateKey(now)`, projects, and returns the API object (money in rands
via `toDollars`, so the client never sees cents):
```
{ id, name, status, openingBalance, openingDate, billingDay, debitOrderDay,
  balance, accruedInterest,            // accruedInterest = toDollars(Math.round(units / LOAN_INTEREST_DIVISOR)): built up, not billed yet
  rateBp, ratePercent, instalment,     // ratePercent = rateBp / 100 (display only)
  paidOffOn,                           // the replay's paidOffOn (only set when the balance is 0)
  projection: { state, paidOffOn, monthsLeft, interestRemaining } }   // interestRemaining in rands or null
```

## Tests (`tests/loans-engine.test.js`)
Same base loan as T70 (R100,000.00 from `2026-03-01`, billing day 28, debit order day 1, 10.95%).
- **Small loan, by hand:** opening R3,000.00, instalment R1,000.00, `asOf '2026-03-28'` →
  `on_track`, `paidOffOn '2026-07-01'`, `monthsLeft 4`, `interestRemainingCents 3116`
  (1,973 + 1,000 + 140 + 3: exactly the interest T70's replay to `2026-07-31` bills after
  28 March). Write this as a check that the projection equals the later replay, not just numbers.
- **Mortgage-sized regression:** the base loan with instalment R1,500.00, `asOf '2026-03-28'` →
  `paidOffOn '2034-11-01'`, `monthsLeft 104`, `interestRemainingCents 5404769`. These follow from
  the rules; if yours differ, recheck the step order rather than the expected numbers.
- **Accrued interest counts:** `asOf '2026-04-30'` (29–30 April accrued, not billed) →
  `interestRemainingCents 5312276`. Starting the projection with `units = 0` would give less, so this
  catches dropped `units`.
- **Never paid off:** instalment R900.00 → `state 'never'`, the other three fields null.
- **The 600-period stop:** R100,000.00 at a 0% rate with instalment R0.01 goes down a cent a month,
  so only the cap ends it → `never`. The same loan with instalment R1,000.00 → `on_track`,
  `paidOffOn '2034-07-01'`, `monthsLeft 100`, `interestRemainingCents 0`.
- **Already paid:** the small loan at `asOf '2026-07-31'` → `paid_off`; `summariseLoan` has
  `balance 0` and `paidOffOn '2026-07-01'`.
- `summariseLoan` with a fixed `now`: the rands fields, `ratePercent 10.95`, `accruedInterest` for
  a mid-period `now`.

## Verify
```bash
node --test tests/loans-engine.test.js
npm run check
```

## Done-check (used when resuming)
```bash
grep -q "export function projectLoan" backend/09_Loans.gs.js
grep -q "export function summariseLoan" backend/09_Loans.gs.js
```

## Commit
`v2(T71): loan projection and summary`
