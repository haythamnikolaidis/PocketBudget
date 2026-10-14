# T58 · Accounts screen: list, type, card fields

**Milestone:** M4 · **Type:** frontend · **Depends on:** T54

## Goal
Manage → "Accounts & cards". Mockup: `docs/v2/mockups/Accounts.html`.

## Change
1. `app/index.html`: a link button `#manage-accounts` in `view-manage`, and
   `<section id="view-accounts" class="hidden">` with `accounts-back` and `#accounts-list`.
2. New file `app/js/accounts.js`:
   - export the pure `accountProblem({ type, statementDay, dueDay, creditLimitText })` → a message
     or null (the same rules as the backend `checkAccount`);
   - export `mountAccounts({ root, api, getState, onChanged, toast })` → `{ open() }`. For each active
     account, a row with the name, a Bank / Card / Cash switch (three `<button aria-pressed>`), and
     when the type is Card, three inputs with labels: Statement day, Due day, Credit limit. Under them
     the hint "Credit limit is optional. Your pockets are the real limit."
   - Changing the type, or blurring an input, validates with `accountProblem` (shown inline), then
     `api.updateAccount(...)` → `onChanged()` (refresh). Errors are toasted.
3. `app/js/app.js`: `'accounts'` goes in `VIEWS`; `#manage-accounts` opens it; Back → manage.

## Tests (new file `tests/accounts-ui.test.js`)
`accountProblem` cases; switching to Card shows the fields; a blur with valid values calls
`updateAccount` with numbers.

## Verify
```bash
node --test tests/accounts-ui.test.js
npm run check
```

## Done-check (used when resuming)
```bash
grep -q "view-accounts" app/index.html
test -f app/js/accounts.js
```

## Commit
`v2(T58): accounts screen`
