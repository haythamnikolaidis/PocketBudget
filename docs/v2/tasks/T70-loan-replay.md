# T70 · Loan engine: replay the events (pure)

**Milestone:** M5 · **Type:** backend · **Depends on:** T69

## Goal
Turn a loan and its events into today's balance and a line per calendar month, in integer cents,
in a new pure module. The build concatenates every `backend/*.gs.js` in name order, so
`09_Loans.gs.js` is picked up automatically. The bundle is **one script scope**: every top-level
name in this file must be new (`tests/bundle.test.js` fails on a duplicate), so prefix helpers with
`loan`.

## Read
- `docs/v2/README.md` §7 (Loans, Loan Events) and §8 (the loan decisions).
- `backend/04_Rollover.gs.js`: `localParts`.
- `backend/01_Utils.gs.js`: `toCents`.

## The rules (exact; T71 reuses them)
Dates are household-day keys `YYYY-MM-DD`. Do date maths on the key with `Date.UTC` only, never
with local time.

The opening balance is the amount owed at the **end** of the opening date, so the replay starts on
the day **after** it. For each day `d` from `openingDate + 1` to `asOfKey` inclusive, in this order:
1. **Debit order:** if `d`'s day of month is `debitOrderDay` and the balance is > 0, pay the
   instalment in force on `d` (see *Paying* below). Add what was taken to the month's `instalments`.
2. **Extras:** each `extra` event effective on `d`, in sheet order, is paid the same way. Add what
   was taken to the month's `extras`.
3. **Accrue:** `units += balanceCents × rateBp`, with the rate in force on `d`. `units` is an
   integer, so this is exact (R100,000,000 × 30% × 31 days stays below 2^53).
4. **Bill:** if `d`'s day of month is `billingDay`: `interest = Math.round(units / 3650000)`
   (10,000 basis points × 365 days), `balance += interest`, `units = 0`. Add it to the month's
   `interest`.
5. **Correction:** each `balance` event effective on `d`, in sheet order: add `value − balance` to
   the month's `adjust`, then `balance = value`, `units = 0`. The correction is the whole amount
   owed at the end of `d`, including interest.

**Paying** an amount `P`: if `balance` is 0, nothing is taken. If `P ≥ balance`, first bill the
accrued interest now (`interest = Math.round(units / 3650000)`, add it to the balance and to the
month's `interest`, `units = 0`). Then take `min(P, balance)`. The balance never goes below 0.

**In force on `d`:** the `rate` (or `instalment`) event with the latest effective date ≤ `d`;
for the same date, the later sheet row wins. Sort the events by effective date with a **stable**
sort so sheet order breaks ties.

`paidOffOn` is the day the balance reached 0 (step 1, 2 or 5), and goes back to null if a later
correction makes the balance positive again.

Each calendar month the replay touches gets one line:
`{ month: 'YYYY-MM', openingCents, interestCents, instalmentsCents, extrasCents, adjustCents, closingCents }`
where `openingCents` is the balance before the month's first replayed day and `closingCents` the
balance after its last replayed day. So for every line:
`opening + interest − instalments − extras + adjust = closing`.

## Change (new file `backend/09_Loans.gs.js`)
```js
export const LOAN_INTEREST_DIVISOR = 3650000;
export function loanDateKey(date = new Date())   // 'YYYY-MM-DD' of an instant in household time (localParts)
export function loanAddDays(key, n)               // '2026-02-28', 1 → '2026-03-01'
export function isLoanDateKey(text)               // a real calendar date in YYYY-MM-DD form ('2026-02-30' → false)
export function loanStepDay(state, day, terms, eventsToday)
  // one day of the rules above; mutates and returns state = { balanceCents, units, paidOffOn, line }
  // terms = { rateBp, instalmentCents, billingDay, debitOrderDay }; eventsToday = { extras: [cents], balances: [cents] }
export function replayLoan(loan, events, asOfKey)
  // → { balanceCents, units, rateBp, instalmentCents, paidOffOn, months }
```
- `loan` is a `readLoans()` object; `events` are `readLoanEvents()` objects for that loan. Convert
  values once: `rate` → `Math.round(Number(value))`; the others → `toCents(value)`.
- `rateBp` and `instalmentCents` in the result are the ones in force on `asOfKey`.
- `months` is oldest first. When `asOfKey ≤ openingDate` the result is the opening balance, `units`
  0 and `months: []`.
- Walk the days once, keeping a pointer into the sorted rate and instalment lists and a map of
  extras and corrections by date, so a 30-year loan is one pass (about 11,000 steps).
- `loanStepDay` is the single implementation of steps 1–5; `replayLoan` and T71 both call it.

## Tests (new file `tests/loans-engine.test.js`)
All with: opening R100,000.00 on `2026-03-01`, billing day 28, debit order day 1, a `rate` event
`1095` and an `instalment` event `1500.00` both effective `2026-03-01`. At 10.95% a day costs exactly
0.03%, so R100,000.00 accrues 3,000 cents a day.
- **Daily interest, cents exact:** `asOf '2026-03-28'` → 27 days (2–28 Mar) × 3,000 = interest
  `81000`, balance `10081000`, `units 0`; one month line `2026-03` with instalments 0.
- **Into the next month:** `asOf '2026-04-30'` → the April line has instalments `150000`, interest
  `92493`, closing `10023493`; `units 21951449670` (29–30 Apr not billed yet).
- **Rate change mid-month:** add `rate 1460` effective `2026-03-15` (0.04% a day) → March interest
  13 × 3,000 + 14 × 4,000 = `95000`, balance `10095000`. Adding a second event `rate 2000` for
  `2026-03-15` in an earlier sheet row than the `1460` one gives the same result (later row wins).
- **Extra payment:** add `extra 50000.00` on `2026-03-15` → extras `5000000`, interest
  13 × 3,000 + 14 × 1,500 = `60000`, balance `5060000`.
- **Balance correction:** add `balance 99000.00` on `2026-03-15` → the 14 days before it are
  dropped, then 13 × 2,970 = interest `38610`, adjust `-100000`, balance `9938610`.
- **Instalment change:** add `instalment 2000.00` effective `2026-04-01` → April instalments
  `200000`, interest `92073`, closing `9973073`.
- **Paid off:** opening R3,000.00, instalment R1,000.00, rate 1095, `asOf '2026-07-31'` → March
  interest `2430`; April / May / June closings `204403` / `105403` / `5543`; on 1 July the
  final payment bills `3` cents of accrued interest and takes `5546`; balance 0,
  `paidOffOn '2026-07-01'`, and no instalment is taken after that.
- The month-line identity holds for every line of every case above.
- `asOfKey` equal to the opening date → opening balance, `months: []`.
- `loanAddDays` across a month end, a year end and 29 Feb 2028; `isLoanDateKey` rejects
  `2026-02-30`, `2026-13-01` and `26-03-01`; `loanDateKey(new Date('2026-10-31T22:30:00Z'))` →
  `'2026-11-01'`.

## Verify
```bash
node --test tests/loans-engine.test.js
npm run check
```

## Done-check (used when resuming)
```bash
test -f backend/09_Loans.gs.js
grep -q "export function replayLoan" backend/09_Loans.gs.js
```

## Commit
`v2(T70): loan replay engine`
