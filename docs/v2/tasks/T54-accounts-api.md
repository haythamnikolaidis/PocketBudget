# T54 · `createAccount` / `updateAccount` + `getState.accounts`

**Milestone:** M4 · **Type:** backend · **Depends on:** T53

## Change (`backend/05_Api.gs.js`, plus `ACTIONS`, `HANDLERS`, `makeApi`)
1. A shared validator, `checkAccount({ name, type, statementDay, dueDay, creditLimit })` → an error
   envelope or null:
   - `name` is 1–60 characters after trimming;
   - `type` is one of `bank`/`card`/`cash`;
   - for a `card`, `statementDay` and `dueDay` are whole numbers 1–28;
   - `creditLimit` is empty, or `parseAmountInput` > 0.

   Use code `INVALID_ACCOUNT`.
2. `createAccount { token, name, type, statementDay?, dueDay?, creditLimit? }`: inside the lock, it
   appends and returns `{ account }`.
3. `updateAccount { token, accountId, …fields, archive?, unarchive? }`: merge with the existing
   account, validate the merged result, and write. Unknown id → `ACCOUNT_NOT_FOUND`.
4. `getState` adds `accounts: readAccounts()` (all of them, including archived; the client filters).

## Tests (`tests/accounts.test.js`)
Validation cases; create; update to a card with days; archive; a bad token.

## Verify
```bash
node --test tests/accounts.test.js
npm run check
```

## Done-check (used when resuming)
```bash
grep -q "export function createAccount" backend/05_Api.gs.js
grep -q "updateAccount" app/js/api.js
```

## Commit
`v2(T54): account actions`
