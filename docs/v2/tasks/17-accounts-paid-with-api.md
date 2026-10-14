# Task 17: Accounts sheet + "paid with" on expenses

**Milestone:** M4 · **Size:** M · **Depends on:** 03, 13

## Why
To track credit cards, each expense needs to record **what paid for it**, separately from which
pocket it came out of. A card swipe still comes out of a pocket, as today. This task is backend only.

## Data
- **Accounts** sheet (created empty in task 03):
  `Account ID | Name | Type | Statement Day | Due Day | Credit Limit | Status`.
  IDs look like `AC01`. Type is `bank` | `card` | `cash`. Statement and Due Day are 1–28, for cards
  only. Credit Limit is optional. Status is `Active` | `Archived`.
- **Transactions** column I, **Paid With**: an Account ID, or blank for old rows.
- Pockets column C ("Bank Account") **stays free text**. Don't convert it; it is only used to seed
  the accounts list.

## Steps
1. `migrateV2()`: if Accounts has no data rows, add one `bank` account per distinct non-blank
   Pockets column C value, plus one `Cash` account of type `cash`. Running it again does nothing.
2. `03_Sheets.gs.js`: `readAccounts()`, `appendAccount()` and `updateAccountRow()`.
3. New actions `createAccount { name, type, statementDay, dueDay, creditLimit }` and
   `updateAccount { accountId, …same fields, archive }`, inside the lock. Validation: name 1–60
   characters; type is one of the three; for a card, both days are whole numbers 1–28; the credit
   limit, if given, goes through `parseAmountInput`.
4. `createExpense` and `createTransaction` accept an optional `paidWith`. If it's present, it must
   be an Active account, or the result is `INVALID_ACCOUNT`. Store it in column I on every line of
   the expense.
5. Reads return `paidWith` on transactions. `getState` returns `accounts`, and the `feed` expense
   items (task 16) and `merchants` (task 12) include `paidWith` (for merchants, the most recent one).
6. Add the new actions to `ACTIONS` and `api.js`.

## Tests
- Migration seeds the accounts from pocket text, once.
- Create and update validation; archiving an account keeps old transactions readable.
- `paidWith` is stored on every line of a split; an unknown or archived account is refused before
  anything is written.
- Omitting `paidWith` still works (old phones).

## Done when
- [ ] Tests pass and `npm run check` is green.
- [ ] Running `migrateV2()` on a copy of the real Sheet lists sensible accounts.
