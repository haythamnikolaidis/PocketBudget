# T79 · Manage: add and archive loans

**Milestone:** M5 · **Type:** frontend · **Depends on:** T78, T72

## Goal
A "Loans" section on the Manage tab, above "Household": the active loans, an archive button on
each, and a form to add one. No mockup: copy the "Household" section's markup and the
`manage-reason` error style.

## Read
- `app/index.html`: `view-manage` (the Household section).
- `app/js/household.js` (a small pure module the Manage tab uses) and how `app.js` wires it:
  `grep -n "household" app/js/app.js`.
- `app/js/format.js`: `parseAmountText`, `isValidAmount`, `parseRateText`.

## Change
1. `app/index.html`, in `view-manage` above Household:
   - `<h2>Loans</h2>`, the hint `A mortgage or car loan. It is paid by debit order, so it never touches a pocket.`;
   - `<div id="loans-manage-list">`: a row per active loan with the name, `formatRand(balance)` and a
     small `Archive` button (`data-action="archive-loan" data-loan-id`);
   - a `+ Add loan` button that shows `<form id="loan-new-form" novalidate>` with these inputs, each
     with a visible label:
     `loan-new-name` (`Name`, placeholder `Home loan`, maxlength 60),
     `loan-new-balance` (`Balance owing`), `loan-new-date` (`Balance date`, `type="date"`, max today),
     `loan-new-rate` (`Interest rate (% a year)`), `loan-new-instalment` (`Monthly instalment`),
     `loan-new-billing` (`Interest billed on day`, 1–28), `loan-new-debit` (`Debit order on day`, 1–28);
     the hint `Use the balance and date from your latest statement. The debit order is assumed paid on its day every month.`;
     `<p id="loan-new-reason" class="hidden …">`; and `loan-new-submit` (`Add loan`).
2. New file `app/js/loanmanage.js`:
   - export the pure `newLoanProblem(fields, today)` → a message or null, the backend `checkLoan`
     rules: `Give the loan a name.`; `A loan called <name> already exists.` (case-insensitive, among
     the active loans passed in `fields.existingNames`); `Enter the balance owing.`;
     `Pick the balance date.` / `The date can't be in the future.`;
     `Enter a rate between 0 and 30, like 10.75.`; `Enter the monthly instalment.`;
     `Days must be whole numbers from 1 to 28.`
   - export `mountLoanManage({ root, api, getState, getUser, onChanged, toast })` → `{ render() }`:
     the list from `getState().loans`; the form submit validates, then with an in-flight guard calls
     `api.createLoan({ user, name, openingBalance, openingDate, billingDay, debitOrderDay, rate, instalment })`
     (`rate` as typed, money as numbers, days as numbers) → toast `Loan added.`, reset and hide the
     form, `onChanged()`; Archive → `api.updateLoan({ loanId, archive: true })` → toast
     `<name> archived.` → `onChanged()`. Errors are toasted with the server's message.
3. `app/js/app.js`: mount it next to the household section and call `render()` whenever the state
   refreshes.

## Tests (new file `tests/loanmanage.test.js`)
Every `newLoanProblem` message, and null for a valid loan; with a fake api and DOM: submit sends
`createLoan` once with numbers for money and days and the text for the rate; Archive sends
`updateLoan` with `archive: true`; an archived loan isn't listed.

## Verify
```bash
node --test tests/loanmanage.test.js
npm run check
```

## Done-check (used when resuming)
```bash
test -f app/js/loanmanage.js
grep -q "loan-new-form" app/index.html
```

## Commit
`v2(T79): add and archive loans`
