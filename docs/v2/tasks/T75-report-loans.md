# T75 · Loans on the Monthly_Report

**Milestone:** M5 · **Type:** backend · **Depends on:** T71

## Goal
One line per active loan in `Monthly_Report`: closing balance, interest charged this month, paid
this month (instalments + extras) and the projected paid-off date. The owner reads it in the sheet.

## Read
- `backend/06_Report.gs.js` (all of it, 209 lines): `buildReport`, `renderReport`, `padRows`.
- `backend/07_Entry.gs.js`: `refreshReport`.
- `backend/09_Loans.gs.js`: `replayLoan`, `projectLoan`, `loanDateKey`.
- `tests/report.test.js`: its fixtures.

## Change
1. `06_Report.gs.js`: export the pure `loanReportRows(loans, loanEvents, month, now = new Date())`.
   For each loan (in the order given), replay its events to `loanDateKey(now)` and project, then
   return one row:
   ```
   [ escapeCell(name), month, closing, interestCharged, paid, projectedPaidOff ]
   ```
   - the figures come from the replay's month line for `month`, in rands (`toDollars`):
     `closing` = `closingCents`, `interestCharged` = `interestCents`,
     `paid` = `instalmentsCents + extrasCents`. When the loan has no line for that month (opened
     today, or opened later than `month`), use the replay balance and 0, 0;
   - `closing` is today's balance while the month is still running, which is what the nightly
     rebuild shows;
   - `projectedPaidOff`: the `YYYY-MM-DD` paid-off date for `on_track`,
     `'Not at this instalment'` for `never`, `'Paid off'` for `paid_off`.
2. `buildReport({ …, loans = [], loanEvents = [] })`: when `loans` is non-empty, append **after** the
   month-over-month block: a blank row, the header
   `['LOANS', 'Month', 'Closing Balance', 'Interest Charged', 'Paid', 'Projected Paid Off']`, then the
   rows. Record `layout.loanHeader` (1-based row) and `layout.loanCount`. With no loans the rows and
   layout are exactly as before, so every existing report test passes unchanged.
3. `renderReport` passes `loans` / `loanEvents` through; in its formatting step make the loan header
   bold and give columns C–E of the loan rows the `"R"#,##0.00` format (inside `bestEffort`).
4. `07_Entry.gs.js` `refreshReport`: pass `loans: readLoans()` (active only) and
   `loanEvents: readLoanEvents()`.

## Tests (`tests/report.test.js`)
- No loans → the rows deep-equal what `buildReport` returned before this task (call it without the
  new arguments and with `loans: []`).
- The T70 base loan, `month '2026-04'`, `now = new Date('2026-04-30T10:00:00Z')` → the row
  `['Home loan', '2026-04', 100234.93, 924.93, 1500, '2034-11-01']` after the header, which sits
  right below the month-over-month block.
- A loan with an extra of R50,000.00 on `2026-04-10` → `paid` is `51500`.
- `never` and `paid_off` loans show their words; a loan named `=SUM(A1)` is escaped.
- `renderReport` with a loan still writes a rectangular range (the existing "enforces the range size"
  sheet).

## Verify
```bash
node --test tests/report.test.js
npm run check
```

## Done-check (used when resuming)
```bash
grep -q "export function loanReportRows" backend/06_Report.gs.js
grep -q "readLoanEvents" backend/07_Entry.gs.js
```

## Commit
`v2(T75): loans on the monthly report`
