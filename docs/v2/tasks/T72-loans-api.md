# T72 · `createLoan` / `updateLoan` + `getState.loans`

**Milestone:** M5 · **Type:** backend · **Depends on:** T71

## Rule
A loan **never changes a pocket**. These handlers don't read or write Pockets, so they don't call
`rolloverIfDue`; otherwise they follow the lock pattern (rule 2) exactly.

## Read
- `backend/05_Api.gs.js`: `checkText`, `createPocket`, `updatePocket`, `getState`, `HANDLERS`.
- `backend/01_Utils.gs.js`: `parseAmountInput`, `isValidUser`.
- `backend/02_Auth.gs.js`: `getUsers`.
- `app/js/api.js`: `makeApi`; `tests/api-client.test.js`.

## Change
1. `00_Config.gs.js`: add `'createLoan', 'updateLoan'` to `ACTIONS`, and
   ```js
   export const MAX_LOAN_CENTS = 10_000_000_000;   // R100,000,000: a loan may exceed MAX_AMOUNT_CENTS
   export const MAX_LOAN_RATE_BP = 3000;           // 30% a year
   export const MAX_LOAN_NOTE_LENGTH = 100;
   ```
2. `01_Utils.gs.js`:
   - `parseAmountInput(input, maxCents = MAX_AMOUNT_CENTS)`. With the default the behaviour and the
     error text are unchanged; with another cap the message is
     `'Amount is too large (max ' + money(maxCents) + ').'`.
   - `export function parseRateInput(input)` → integer basis points, or throws. Trim; drop one
     trailing `%`; accept `^\d{1,2}([.,]\d{1,2})?$` (a comma is the decimal mark); build the number
     from the digit strings, never by multiplying a float; refuse above `MAX_LOAN_RATE_BP`.
     `'10.75'` → 1075, `'10,75'` → 1075, `'7.5%'` → 750, `'0'` → 0, `11.25` (a number) → 1125;
     `'30.01'`, `'10.755'`, `'-1'`, `''`, `'abc'` throw.
3. `05_Api.gs.js`:
   - `checkLoan({ name, openingBalance, openingDate, billingDay, debitOrderDay, rate, instalment }, today)`
     → `{ problem }` or `{ values }` with code `INVALID_LOAN`:
     - `name` via `checkText(name, 'Loan name', true)`; no other **active** loan has the same name
       (case-insensitive). This also stops a retried create from making a second loan;
     - `openingBalance` = `parseAmountInput(…, MAX_LOAN_CENTS)` > 0;
     - `openingDate` passes `isLoanDateKey`, is ≥ `'2000-01-01'` and ≤ `today` (household);
     - `billingDay`, `debitOrderDay`: whole numbers 1–28;
     - `rate` via `parseRateInput`; `instalment` = `parseAmountInput(…, MAX_LOAN_CENTS)` > 0.
   - `createLoan { token, user, name, openingBalance, openingDate, billingDay, debitOrderDay, rate, instalment }`:
     verify → `isValidUser(user, getUsers())` → `checkLoan` → lock → re-check the name inside the
     lock → `appendLoan` → `appendLoanEvents` with two rows effective `openingDate`:
     `{ type: 'rate', value: rateBp, note: 'Opening rate' }` and
     `{ type: 'instalment', value: toDollars(instalmentCents), note: 'Opening instalment' }` →
     `ok({ loan: summariseLoan(loan, events) })` → `finally unlock(lock)`.
   - `updateLoan { token, loanId, name?, billingDay?, debitOrderDay?, archive?, unarchive? }`: merge
     with the stored loan (archived included), validate the merged name and days with the same rules,
     write with `updateLoanRow`, return `ok({ loan })`. Unknown id → `LOAN_NOT_FOUND`. Opening balance
     and date can't change: a balance correction does that job.
   - `getState` adds `loans`: `summariseLoan` for each **active** loan, with that loan's events from
     one `readLoanEvents()` call. `[]` when the sheets don't exist yet (before `migrateV2`).
4. `app/js/api.js`: `createLoan(fields)` and `updateLoan(fields)`, posting like `updatePocket`.

## Tests (new file `tests/loans-api.test.js`; copy `setup()` from `tests/money-path.test.js` and run `migrateV2()` in it)
- Each `INVALID_LOAN` case: blank and 61-character names, a duplicate active name (an archived one
  with that name is fine), balance 0 and over R100,000,000, `2026-02-30`, a future date, day 0 and
  29, rate `'31'`, instalment 0.
- `parseRateInput` and `parseAmountInput` with a cap: every case listed above; the default message
  is unchanged.
- `createLoan` writes one Loans row and the two opening events, returns a summary whose `balance`
  equals the opening balance on the opening date, and the lock is released (also when it fails).
- **No pocket changes:** the Pockets sheet deep-equals its copy from before `createLoan` and
  `updateLoan`.
- `updateLoan` renames, changes the billing day, archives (then `getState.loans` leaves it out) and
  unarchives. Unknown id → `LOAN_NOT_FOUND`. A bad token → `UNAUTHORIZED`.
- `getState.loans` is `[]` on a workbook that has never run `migrateV2()`.
- `tests/api-client.test.js`: `createLoan` and `updateLoan` post their fields with the token.

## Verify
```bash
node --test tests/loans-api.test.js
npm run check
```

## Done-check (used when resuming)
```bash
grep -q "export function createLoan" backend/05_Api.gs.js
grep -q "updateLoan" app/js/api.js
```

## Commit
`v2(T72): loan actions and getState.loans`
