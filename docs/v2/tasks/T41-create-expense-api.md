# T41 · `createExpense` API action

**Milestone:** M3 · **Type:** backend · **Depends on:** T40, T35

## API
```
createExpense { token, user, note, requestId, date?, lines: [{ pocketId, amount }] }
→ ok({ groupId, transactions: [...], pockets: [presentPocket...] })
```
All or nothing: either every line is saved and deducted, or nothing is.

## Read
`backend/05_Api.gs.js` `createTransaction` (copy its structure).

## Change
1. Write an internal `recordExpense({ user, note, requestId, date, lines, paidWith })`; the handler
   calls it after verifying the token.
   - **Validate:** the user; the note (trim, max 120); the requestId; `date` through
     `parseExpenseDate` (T35). `lines` must be an array of 1–10 items, each with a non-empty
     `pocketId` and an amount (`parseAmountInput`) > 0. Merge lines with the same pocket (add the
     cents).
   - **Lock**, then `rolloverIfDue()`.
   - **Idempotency:** `findTransactionsByRequestId`. If any rows are found and the pockets and
     amounts (in cents, as sets) match → return them with `duplicate: true`. If they differ →
     `INVALID_REQUEST`, 'requestId was already used for a different expense.'
   - **Re-read** every pocket; each must be Active (`POCKET_NOT_FOUND`). Find all the short lines.
     If any → `fail('INSUFFICIENT_FUNDS', <exact message for the first short pocket>,
     { pocketId, remaining, amount, shortfalls: [{ pocketId, remaining, amount }] })`. Write nothing.
   - **Write:** `appendTransactions` (groupId `'FIRST'` when there are 2+ lines, `''` for one), then
     `writeBalance` for each pocket. If a balance write throws: restore the balances already
     written, `deleteTransactionRows(ids)`, then rethrow.
   - Return the result.
2. Add `'createExpense'` to `ACTIONS`, `HANDLERS` and `makeApi` (`createExpense: (p) => call('createExpense', p)`).

## Tests (new file `tests/create-expense.test.js`)
- 3 lines → 3 rows sharing a group ID; 3 balances; `ok`.
- One short line → nothing written; the exact message; `shortfalls` is right.
- An exact-zero balance is allowed; 0 lines and 11 lines are refused; duplicate pockets are merged.
- The same requestId → `duplicate: true`, no double deduction; a different payload with the same id
  → `INVALID_REQUEST`.
- A `writeBalance` failure on the 2nd pocket → all balances restored and no rows left.
- The lock is released and flushed on every path.

## Verify
```bash
node --test tests/create-expense.test.js
npm run check
```

## Done-check (used when resuming)
```bash
grep -q "export function createExpense" backend/05_Api.gs.js
grep -q "createExpense" app/js/api.js
```

## Commit
`v2(T41): createExpense action`
