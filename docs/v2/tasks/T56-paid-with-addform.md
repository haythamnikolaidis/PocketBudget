# T56 · "Paid with" chips on the add form

**Milestone:** M4 · **Type:** frontend · **Depends on:** T55

## Goal
Mockup: `docs/v2/mockups/QuickAdd.html` (the "Paid with" row).

## Change
1. `app/index.html`: `<div id="add-paidwith"></div>` under the pocket chips (and the label "Paid with").
2. `app/js/addform.js`:
   - export the pure `orderAccounts(accounts)`: Active only, cards first, then bank, then cash, each
     group in sheet order;
   - export `defaultPaidWith(accounts, remembered)`: the remembered id if it's still active, else
     the first `bank`, else the first account, else `''`;
   - render the chips (`textContent`); the selected chip is highlighted;
   - the selection is remembered per user under `'pb.paidWith.' + user` after a successful save;
   - a merchant suggestion (T39) that has `paidWith` selects it, unless the user picked one this entry;
   - send `paidWith` in the `createTransaction` / `createExpense` payloads (the shortfall path too),
     and add it to the fingerprint;
   - with no accounts, hide the row and send nothing.

## Tests (`tests/addform.test.js`)
Ordering; defaults; remembered per user; the payload includes it; a suggestion sets it only when
untouched.

## Verify
```bash
node --test tests/addform.test.js
npm run check
```

## Done-check (used when resuming)
```bash
grep -q "add-paidwith" app/index.html
grep -q "export function defaultPaidWith" app/js/addform.js
```

## Commit
`v2(T56): paid-with on add form`
