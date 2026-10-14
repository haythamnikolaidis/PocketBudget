# T59 · Accounts screen: add, archive, first-run banner

**Milestone:** M4 · **Type:** frontend · **Depends on:** T58

## Change (`app/index.html`, `app/js/accounts.js`)
1. "+ Add account or card" opens an inline form (a name input and a type select) →
   `api.createAccount` → refresh.
2. Each row gets a small "Archive" button → `updateAccount({ accountId, archive: true })`. Archived
   accounts are hidden.
3. A banner at the top while **no** active account has type `card` and
   `localStorage['pb.accountsBannerSeen']` isn't set: "We found N accounts on your pockets. Mark which
   ones are credit cards so the app can track what's owed." It has a dismiss button. Use try/catch
   around storage.

## Tests (`tests/accounts-ui.test.js`)
Add calls `createAccount`; archive calls `updateAccount` with `archive: true`; the banner logic as a
pure function `showAccountsBanner(accounts, seen)`.

## Verify
```bash
node --test tests/accounts-ui.test.js
npm run check
```

## Done-check (used when resuming)
```bash
grep -q "export function showAccountsBanner" app/js/accounts.js
```

## Commit
`v2(T59): add/archive accounts and banner`
