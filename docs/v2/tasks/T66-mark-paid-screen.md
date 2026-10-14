# T66 · Mark statement paid screen

**Milestone:** M4 · **Type:** frontend · **Depends on:** T64, T65

## Goal
Mockup: `docs/v2/mockups/MarkPaid.html`.

**Deliberately simpler than the mockup:** there's no "Fees → Bank Fees" option. "Something we forgot
to log, or fees" opens the add form instead.

## Change
1. `app/index.html`: `<section id="view-paycard" class="hidden">` with these ids:
   `paycard-close`, `paycard-title`, `paycard-statement` (amount input), `paycard-compare`,
   `paycard-gap` (a radio group: `forgot` / `leave`), `paycard-full` / `paycard-part` (radios),
   `paycard-paid` (an amount input shown for part), `paycard-from` (select), `paycard-submit`.
2. New file `app/js/paycard.js`:
   - export the pure `paymentGap(loggedTotal, statementText)` → `{ gapCents, statementCents }` or null;
   - export `mountPayCard({ root, api, getUser, onDone, onLogGap, toast })` → `{ open(card) }`:
     - pre-fill the statement amount with `card.statement.total`;
     - the compare box: "Logged in PocketBudget R…", "On the statement R…", and, when the gap is
       non-zero, an amber "Not logged R…";
     - the gap question shows only when the gap > 0;
     - `paycard-from` lists active bank and cash accounts;
     - the line "Paying the card moves money that your pockets already set aside, so no pocket
       balance changes.";
     - submit uses an in-flight guard and a requestId, and calls
       `api.recordCardPayment({ accountId, closeKey, statementAmount, paidAmount, fromAccountId, user, requestId })`;
     - then a toast; if "forgot" was chosen and the gap > 0, call `onLogGap({ amount, paidWith: card.id })`;
       otherwise `onDone()`.
3. `app/js/app.js`: `'paycard'` goes in `VIEWS`; `card-pay` opens it. `onDone` → refresh, then the card
   view again. `onLogGap` → the add view with the amount, the note "Card: unlogged / fees" and Paid
   with set (add a small `prefill({ amount, note, paidWith })` method to the add form handle).

## Tests (new file `tests/paycard.test.js`)
`paymentGap` in cents; a double submit sends once; a part payment needs an amount; "forgot" calls
`onLogGap` with the gap.

## Verify
```bash
node --test tests/paycard.test.js
npm run check
```

## Done-check (used when resuming)
```bash
test -f app/js/paycard.js
grep -q "view-paycard" app/index.html
```

## Commit
`v2(T66): mark statement paid screen`
