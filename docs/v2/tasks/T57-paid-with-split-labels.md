# T57 · "Paid with" in split mode, and account names in lists

**Milestone:** M4 · **Type:** frontend · **Depends on:** T56

## Change
1. `app/index.html` / `app/js/split.js`: one "Paid with" chip row (`#split-paidwith`) for the whole
   split. Reuse `orderAccounts` / `defaultPaidWith` from `addform.js`. `open()` takes `paidWith` from
   the single form. Send it in `createExpense`, and include it in the fingerprint.
2. `app/js/render.js` `feedItemHtml` and `app/js/pocket.js` `pocketDetailHtml`: when an item has
   `paidWith`, add the account name to the grey meta line ("Petrol · Today · Sam's Visa"). Pass an
   `accountNames` map (id → name) in from `app.js`. Unknown ids are left out.

## Tests
Split payload includes `paidWith`; feed and detail meta show the name; escaping.

## Verify
```bash
node --test tests/split.test.js tests/render.test.js
npm run check
```

## Done-check (used when resuming)
```bash
grep -q "split-paidwith" app/index.html
```

## Commit
`v2(T57): paid-with in split and lists`
