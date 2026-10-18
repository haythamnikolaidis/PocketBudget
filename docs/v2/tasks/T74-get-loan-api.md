# T74 · `getLoan` API action

**Milestone:** M5 · **Type:** backend · **Depends on:** T73

## API
`getLoan { token, loanId }` → `ok({ loan, months, events })`. A read: no lock. Archived loans can be
read too. Unknown id → `LOAN_NOT_FOUND`.
- `loan`: `summariseLoan(...)` (T71).
- `months`: the replay's month lines, **newest first**, at most 24, in rands:
  `{ month, opening, interest, instalments, extras, adjust, closing }`.
- `events`: every event of the loan, newest effective date first (for the same date, the later
  sheet row first): `{ id, type, effectiveDate, user, note, timestamp }` plus `ratePercent`
  (`value / 100`) for a `rate` event, or `amount` (rands) for the other three types.

## Read
- `backend/05_Api.gs.js`: `getPocket` (a read action), `getState`'s loans block from T72.
- `backend/09_Loans.gs.js`: `replayLoan`, `summariseLoan`.

## Change (`backend/05_Api.gs.js`, plus `ACTIONS`, `HANDLERS`, `makeApi`)
1. Export the pure `presentLoanDetail(loan, events, now = new Date())` → `{ loan, months, events }`
   as above, so the shape can be tested without sheets. Replay once and reuse it for the summary
   (give `summariseLoan` an optional precomputed replay, or split out a helper; don't replay twice).
2. The handler: verify the token, find the loan with `readLoans({ includeArchived: true })`, read its
   events with `readLoanEvents({ loanId })`, return `ok(presentLoanDetail(...))`.
3. `app/js/api.js`: `getLoan(loanId)`.

## Tests (new file `tests/get-loan.test.js`)
With the T70 base loan and the fixed time `2026-04-30T10:00:00Z`:
- The base loan alone: `months` is `[2026-04, 2026-03]`; April has `instalments 1500`, `interest 924.93`,
  `closing 100234.93`; the month-line identity holds in rands to the cent.
- A second loan with events added through `addLoanEvent` (rate on `2026-03-15`, then an extra on
  `2026-04-10`): `events` order is the extra on `2026-04-10`, then a rate on `2026-03-15`, then the two opening events
  (the instalment row after the rate row in the sheet comes first); `ratePercent` / `amount` set on
  the right ones.
- 30 months of history returns 24 lines.
- An archived loan still reads; an unknown id → `LOAN_NOT_FOUND`; a bad token → `UNAUTHORIZED`.
- `tests/api-client.test.js`: `getLoan` posts `loanId` with the token.

## Verify
```bash
node --test tests/get-loan.test.js
npm run check
```

## Done-check (used when resuming)
```bash
grep -q "export function getLoan" backend/05_Api.gs.js
grep -q "getLoan" app/js/api.js
```

## Commit
`v2(T74): getLoan action`
