# T77 · Loan detail screen

**Milestone:** M5 · **Type:** frontend · **Depends on:** T74, T76

## Goal
Tapping a loan on Home opens its detail. There is no mockup: reuse the pocket detail screen's
layout (`view-pocket`, the `pb-pd` classes in `app/styles.css`) and the wording below exactly.

## Read
- `app/js/pocket.js` (the shape to copy: a pure `…DetailHtml` plus `mount…`).
- `app/index.html`: `view-pocket`.
- `app/js/app.js`: `grep -n "VIEWS\|pocket-back\|mountPocket" app/js/app.js`.
- `app/js/format.js`: the helpers from T76.

## Change
1. `app/index.html`: `<section id="view-loan" class="pb-pd hidden" aria-labelledby="loan-heading">`
   with a Back button `loan-back` (the `pocket-back` markup), `<h1 id="loan-heading">`, `#loan-body`,
   and an actions row (`pb-pd__actions`) with four buttons, each
   `data-action="loan-record" data-type="…"`: `Rate change` (`rate`), `New instalment`
   (`instalment`), `Extra payment` (`extra`), `Correct balance` (`balance`).
2. New file `app/js/loan.js`:
   - export the pure `loanDetailHtml(data)`, from `getLoan`, top to bottom (the figures and days
     below are examples; take them from the data):
     - **Balance card:** `Balance` and `formatRand(loan.balance)`. When `loan.accruedInterest > 0`,
       a small line: `R… interest has built up since the last bill and is added on the 25th.`
       (the billing day as an ordinal: 1st, 2nd, 3rd, 4th … 21st, 22nd, 23rd, 28th).
     - **Paid-off card**, by `projection.state`:
       - `on_track`: `Paid off by Nov 2034`, then `8 yrs 8 mths · 104 more debit orders`, then
         `R54,047.69 interest still to pay`, then the muted line
         `If the rate and the instalment stay as they are, with no extra payments.`;
       - `never`: an amber box `Won't be paid off at this instalment`, then
         `Each month's interest is more than the R900.00 debit order. Record the new instalment when the bank re-quotes it.`;
       - `paid_off`: a green box `Paid off on 1 Jul 2026` (from `loan.paidOffOn`).
     - **Terms:** three lines: `Interest rate · 10.75% a year`;
       `Instalment · R16,000.00 by debit order on the 1st`; `Interest billed on the 25th`.
     - **By month** (`months`, newest first, 12 shown): a row per month with `Oct 2026`, then
       `Interest R…`, `Paid R…` (instalments + extras) and `Balance R…` (closing). A month with an
       adjustment adds `Corrected to the statement`.
     - **History** (`events`, newest first): one line each with the date (`dayMonthYearText`), the
       user and the note in muted text:
       `Rate changed to 10.75%` · `Instalment set to R16,000.00` · `Extra payment R50,000.00` ·
       `Balance set to R1,480,000.00`.

     Escape everything.
   - export the pure `ordinal(n)` (used above).
   - export `mountLoan({ root, api, onRecord })` → `{ open(loanId), reload() }`: sets the heading
     to the loan name, shows `Loading…`, calls `api.getLoan(loanId)` and renders; an error shows
     `Couldn't load this loan.` with a `Try again` button. `loan-record` buttons call
     `onRecord(type, data)` (T78 wires it; until then app.js passes a no-op).
3. `app/js/app.js`: `'loan'` goes in `VIEWS`; the `open-loan` click (T76) →
   `switchView(views, tabs, 'loan')` + `open(loanId)`; `loan-back` → `'home'`.

## Tests (new file `tests/loan-ui.test.js`)
`loanDetailHtml` for each projection state (wording above, word for word); the accrued line only
when `accruedInterest > 0`; the corrected-month note; the history lines for each event type; a note
with `<script>` is escaped; `ordinal` for 1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 28. A `mountLoan` test
with a fake api: `open('LN01')` calls `getLoan('LN01')` and fills `#loan-body`; a rejected promise
shows the retry text.

## Verify
```bash
node --test tests/loan-ui.test.js
npm run check
```

## Done-check (used when resuming)
```bash
test -f app/js/loan.js
grep -q "view-loan" app/index.html
```

## Commit
`v2(T77): loan detail screen`
