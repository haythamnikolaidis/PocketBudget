# Task 13: `createExpense` API (multi-pocket)

**Milestone:** M3 · **Size:** M · **Depends on:** 01, 03, 11

## Why
One shop often covers several pockets. It should be **one** entry that either saves completely or
not at all, never "Groceries saved but Household failed".

## The API
```jsonc
{ "action": "createExpense", "user": "Sam", "note": "Checkers", "requestId": "…",
  "date": "2026-11-14",            // optional, same rules as task 11
  "lines": [ { "pocketId": "P01", "amount": "900" },
             { "pocketId": "P07", "amount": "290" } ] }
```
It returns `ok({ groupId, transactions: [...], pockets: [...] })`.

## Data
Each line is a normal Transactions row. Lines of the same expense share a **Group ID** (column H).
Group ID = the ID of the first row (e.g. `T1050`), set on every row of the group. A single-line
expense leaves column H blank. Everything that reads Transactions (report, spouse split, monthly
totals) keeps working without changes. That's the reason for this design.

## Steps
1. Validate: the token, user, note and requestId as in `createTransaction`; 1–10 lines; each
   pocketId present; each amount > 0 in cents. Lines with the **same pocket are merged** into one.
2. Lock, then `rolloverIfDue()`.
3. Idempotency: if rows with this requestId exist (`findTransactionByRequestId` must now return
   **all** rows with that id), return the original group with `duplicate: true`. If the original
   was different (other pockets or amounts), return `INVALID_REQUEST`, as today.
4. Re-read every pocket. Each must be Active. Check **every** line before writing anything. If any
   are short, return `INSUFFICIENT_FUNDS` with the exact standard message for the **first** short
   pocket, plus `details.shortfalls: [{ pocketId, remaining, amount }]` for all of them. Write nothing.
5. Write all rows with **one** `setValues` (add `appendTransactions(rows)` to `03_Sheets.gs.js`;
   it issues IDs the same way `appendTransaction` does). Then write each balance.
6. If any balance write fails: put back the balances already written, delete the new rows, and
   throw. Copy the rollback style of `createTransaction`.
7. Change `createTransaction` to call the same internal function with one line, and **keep its
   response shape exactly** (`pocket`, `transaction`), so old phones keep working. All the existing
   `createTransaction` tests must still pass unchanged.
8. `readTransactions`, `readRecentTransactions` and `findTransactionByRequestId` return `groupId`.

## Tests (`tests/create-expense.test.js`)
- 3 lines: 3 rows, one shared Group ID, 3 balances updated, one `getRange().setValues` for the rows.
- One pocket short → nothing written, the message matches exactly, and `shortfalls` lists the
  short pocket(s).
- Exactly spending a pocket to zero is allowed.
- Duplicate pockets are merged; 11 lines are refused; 0 lines are refused.
- A retry with the same requestId → `duplicate: true` and no double deduction.
- A balance write failure part-way → every balance is back where it was and no rows are left.
- The lock is released and flushed on every path.

## Done when
- [ ] Tests pass and `npm run check` is green. The existing suite is unchanged.
- [ ] `api.createExpense(p)` exists in `app/js/api.js`.
