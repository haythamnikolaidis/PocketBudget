# T73 · `addLoanEvent` API action

**Milestone:** M5 · **Type:** backend · **Depends on:** T72

## Rule
Recording a rate, instalment, extra payment or balance **never changes a pocket**. An extra payment
is money the owner paid into the loan from the bank, not out of a pocket.

## API
`addLoanEvent { token, user, loanId, type, effectiveDate, value, note?, requestId }`
→ `ok({ event, loan: summariseLoan(...) })`. On a repeated `requestId`:
`ok({ event: <the original>, loan, duplicate: true })` and nothing is written (rule 4).

## Read
- `backend/05_Api.gs.js`: `transferFunds` (lock + idempotency shape), `checkLoan`, `createLoan`.
- `backend/03_Sheets.gs.js`: `appendLoanEvents`, `findLoanEventByRequestId`.

## Change (`backend/05_Api.gs.js`, plus `ACTIONS`, `HANDLERS`, `makeApi`)
1. Validate, in this order, with code `INVALID_LOAN_EVENT` unless noted:
   - the user (`isValidUser(user, getUsers())`) and `isValidRequestId(requestId)`;
   - `loanId` is an **active** loan → else `LOAN_NOT_FOUND`;
   - `type` is one of `rate` / `instalment` / `extra` / `balance`;
   - `effectiveDate` passes `isLoanDateKey`, is **after** the loan's opening date and ≤ today
     (household, `loanDateKey(new Date())`). The messages: `'The date must be after the opening date (<openingDate>).'`
     and `'The date can't be in the future.'`;
   - `value`: `rate` → `parseRateInput`; `instalment` and `extra` → `parseAmountInput(…, MAX_LOAN_CENTS)`
     > 0; `balance` → `parseAmountInput(…, MAX_LOAN_CENTS)` ≥ 0 (0 means paid off);
   - `note`: optional, trimmed, ≤ `MAX_LOAN_NOTE_LENGTH`.
2. `verifyToken → validate → lock.tryLock → findLoanEventByRequestId (duplicate) → re-read the loan
   (still active) → appendLoanEvents([{ user, loanId, effectiveDate, type, value, note, requestId }])
   → finally unlock(lock)`. Store `value` as README §7 says: basis points for `rate`,
   `toDollars(cents)` for the rest.
3. Return the event and the loan summarised from a fresh `readLoanEvents({ loanId })`.
4. `app/js/api.js`: `addLoanEvent(fields)`.

## Tests (`tests/loans-api.test.js`)
Fixed time: `t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-03-28T10:00:00Z') })`, loan
created as in the T70 tests (R100,000.00 on `2026-03-01`, billing day 28, debit order day 1,
`'10.95'`, `'1500'`). Each of the next three bullets uses a fresh loan.
- An `extra` of `'50000'` on `2026-03-15` writes one row (type, value `50000`, user, request id) and
  returns `loan.balance` `50600` (T70's R50,600.00).
- A `rate` of `'14.6'` on `2026-03-15` stores `1460` and returns balance `100950`.
- A `balance` of `'99000'` on `2026-03-15` returns balance `99386.1`; a `balance` of `'0'` returns
  `projection.state 'paid_off'`.
- The same `requestId` twice → one row only, the second reply has `duplicate: true`.
- **No pocket changes:** the Pockets sheet deep-equals its copy from before the four calls above.
- Refused: a date equal to the opening date, a date tomorrow, `2026-02-30`, type `'fee'`, rate
  `'31'`, an extra of `'0'`, a 101-character note, an archived loan (`LOAN_NOT_FOUND`), an unknown
  user, a missing requestId. Each leaves the sheet unchanged and the lock released.
- `BUSY` when the lock can't be taken.
- `tests/api-client.test.js`: `addLoanEvent` posts its fields with the token.

## Verify
```bash
node --test tests/loans-api.test.js
npm run check
```

## Done-check (used when resuming)
```bash
grep -q "export function addLoanEvent" backend/05_Api.gs.js
grep -q "addLoanEvent" app/js/api.js
```

## Commit
`v2(T73): addLoanEvent action`
