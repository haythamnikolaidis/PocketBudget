# T78 · Record a rate change, instalment, extra payment or balance

**Milestone:** M5 · **Type:** frontend · **Depends on:** T77, T73

## Goal
The four buttons on the loan detail (T77) open one small form that records a loan event. No
mockup: use the add form's inputs and the Move screen's submit button styles.

## Read
- `app/js/move.js`: `submit()` (the in-flight guard and the `pendingAttempt` requestId reuse; copy
  it), `newRequestId`.
- `app/js/loan.js` (T77) and `view-loan` in `app/index.html`.
- `app/js/format.js`: `parseAmountText`, `isValidAmount`.

## Change
1. `app/js/format.js`: export the pure `parseRateText(text)` → integer basis points or `NaN`, the
   same rules as the backend `parseRateInput` (T72): one trailing `%` allowed, a comma or point
   decimal mark, at most 2 decimals, 0–30.
2. `app/index.html`, inside `view-loan` under the actions row, a hidden `<form id="loan-form" novalidate>`:
   `<h2 id="loan-form-title">`, a date input `loan-form-date` (`type="date"`), a text input
   `loan-form-value` (`inputmode="decimal"`) with `<label id="loan-form-value-label">`, a note input
   `loan-form-note` (`maxlength="100"`, placeholder `Note (optional)`), `<p id="loan-form-hint">`,
   `<p id="loan-form-reason" class="hidden …">` (the `manage-reason` style), and the buttons
   `loan-form-cancel` and `loan-form-submit` (`Save`).
3. `app/js/loan.js`:
   - export the pure `loanFormCopy(type)` → `{ title, valueLabel, hint }`:

     | type | title | valueLabel | hint |
     |---|---|---|---|
     | `rate` | Rate change | New rate (% a year) | From this date interest uses the new rate. Earlier months keep the old one. |
     | `instalment` | New instalment | New monthly instalment | The debit order from this date on. Banks re-quote it after a rate change or an extra payment. |
     | `extra` | Extra payment | Amount paid in | Money paid into the loan on top of the debit order, such as a bonus. No pocket changes. |
     | `balance` | Correct balance | Balance on the statement | Use the closing balance and date from your statement. Everything after that date is worked out from there. |

   - export the pure `loanEventProblem({ type, dateText, valueText, openingDate, today })` → a
     message or null, mirroring the backend:
     - no date → `Pick a date.`; on or before `openingDate` →
       `The date must be after the opening date (1 Mar 2026).` (`dayMonthYearText`); after `today`
       → `The date can't be in the future.`;
     - `rate`: `parseRateText` is NaN → `Enter a rate between 0 and 30, like 10.75.`;
     - `instalment` / `extra`: not a valid amount above 0 → `Enter an amount greater than zero.`;
     - `balance`: not a valid amount ≥ 0 → `Enter the balance, or 0 if it's paid off.`
   - extend `mountLoan` with `record(type)`: shows the form with that copy, the date defaulting to
     `today` (household date, as `loanDateKey` does on the server), `min` = opening date + 1 day,
     `max` = today, the value empty (for `rate` and `instalment`, the placeholder is the current
     value). Cancel hides it.
   - submit: `loanEventProblem` (shown in `loan-form-reason`) → the move.js guard and requestId
     pattern → `api.addLoanEvent({ loanId, user, type, effectiveDate, value, note, requestId })`.
     `value` is the text as typed for `rate`, and the parsed rands for the others. Then hide the form,
     toast `Saved. Paid off by Nov 2034.` (or `Saved. Won't be paid off at this instalment.` /
     `Saved. Paid off.`), re-render from a fresh `getLoan`, and call `onSaved()` so Home refreshes.
4. `app/js/app.js`: pass `getUser`, `toast` and `onSaved: refresh` to `mountLoan`, and wire the
   `loan-record` buttons to `record(type)` instead of the T77 no-op.

## Tests (`tests/loan-ui.test.js`)
`parseRateText` (`'10.75'`, `'10,75'`, `'7.5%'`, `'0'`, `'30.01'`, `'10.755'`, `''`); `loanFormCopy`
for all four types; every `loanEventProblem` message; with a fake api and DOM (`fakeBrowser.js`):
a double tap on Save sends one `addLoanEvent`; a retry after a timeout reuses the requestId; a
`rate` sends the typed text and an `extra` sends a number.

## Verify
```bash
node --test tests/loan-ui.test.js
npm run check
```

## Done-check (used when resuming)
```bash
grep -q "export function loanEventProblem" app/js/loan.js
grep -q "loan-form" app/index.html
```

## Commit
`v2(T78): record loan events`
