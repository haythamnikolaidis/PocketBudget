# T76 · Loans section on Home

**Milestone:** M5 · **Type:** frontend · **Depends on:** T72

## Goal
A "Loans" section on Home: each active loan's balance and projected paid-off date. There is no
mockup; follow the Savings rows (`savingsRowHtml`) for the look, and the wording below exactly.

## Read
- `app/js/render.js`: `savingsRowHtml`, `renderSavings`, `esc`, `mount`.
- `app/js/format.js`: `formatRand`.
- `app/index.html`: the Savings heading and `#savings` (and the Cards section from T63).
- `app/js/app.js`: `grep -n "renderSavings" app/js/app.js` (the call in `renderState`).

## Change
1. `app/index.html`: under the Cards section (T63), the same heading style as Savings:
   `<h2 id="loans-heading" class="… hidden …">Loans</h2><div id="loans" class="mt-2 hidden"></div>`.
2. `app/js/format.js`, both pure and exported:
   - `monthYearText('2034-11-01')` → `'Nov 2034'`; `dayMonthYearText('2026-07-01')` → `'1 Jul 2026'`
     (build from the key's digits; no `Date` parsing, so no timezone shift);
   - `timeLeftText(months)`: `104` → `'8 yrs 8 mths'`, `12` → `'1 yr'`, `13` → `'1 yr 1 mth'`,
     `11` → `'11 mths'`, `1` → `'1 mth'`.
3. `app/js/render.js`: export the pure `loanRowHtml(loan)`, a
   `<button type="button" data-action="open-loan" data-loan-id="…">` laid out like a Savings row:
   - left: the name; right: `formatRand(loan.balance)`;
   - the second line, by `loan.projection.state`:
     - `on_track`: `Paid off by Nov 2034 · 8 yrs 8 mths to go`;
     - `never`: an amber pill `Won't be paid off at this instalment`;
     - `paid_off`: a green pill `Paid off`, and the right side shows `R0.00`;
   - `aria-label`: `Open <name>, <balance> owing`.

   Also export `renderLoans(container, loans, opts = {})`, the `renderSavings` shape: hides the
   container and `opts.heading` when there are no loans. Escape everything.
4. `app/js/app.js`: in `renderState`, `renderLoans(els.loans, payload.loans || [], { heading: els.loansHeading })`
   (an old server without `loans` hides the section). `open-loan` stays inert until T77.

## Tests (`tests/render.test.js`)
Each of the three states of `loanRowHtml`; `renderLoans` hides both elements for `[]` and for
`undefined`; a name with `<b>` is escaped; `monthYearText`, `dayMonthYearText` and every
`timeLeftText` case above.

## Verify
```bash
node --test tests/render.test.js
npm run check
```

## Done-check (used when resuming)
```bash
grep -q "export function loanRowHtml" app/js/render.js
grep -q 'id="loans"' app/index.html
```

## Commit
`v2(T76): loans on Home`
