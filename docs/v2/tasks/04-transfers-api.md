# Task 04: Adjustments sheet + `transferFunds` API

**Milestone:** M2 · **Size:** M · **Depends on:** 01, 03

## Why
Today the only way to move money between pockets is to edit their monthly limits, which changes
every future month too. We need a real "move R200 from Dining Out to Groceries" that records why
the balances changed. The same record type (an **adjustment**) is used by the month-end rollover
(task 06) and card payments (task 20), so build it once here.

## What
- A new API action, `transferFunds { fromPocketId, toPocketId, amount, note, user, requestId }`.
- Every money movement that isn't an expense becomes one row in the `Adjustments` sheet:
  `Adj ID | Timestamp | User | Month | Type | From Pocket | To Pocket | Amount | Note | Request ID | Account ID`.
  For a transfer, `Type` is `transfer`. IDs look like `A1001`; copy how transaction IDs are issued.

## Where
- `backend/03_Sheets.gs.js`: add `appendAdjustments(rows)` (one `setValues` for many rows; it
  returns the new IDs), `readAdjustments({ month })`, and `findAdjustmentByRequestId(requestId)`.
- `backend/05_Api.gs.js`: add the `transferFunds` handler.
- `backend/00_Config.gs.js`: add `transferFunds` to `ACTIONS`.
- `app/js/api.js`: add a `transferFunds(p)` method.

## Steps
Follow the shape of `createTransaction` exactly:
1. Check the token. Validate the user (`isValidUser`), both pocket IDs (present and different),
   the amount (`parseAmountInput`, > 0), the note (trim, max 120 characters) and the requestId
   (`isValidRequestId`).
2. Lock, then `rolloverIfDue()`.
3. If `findAdjustmentByRequestId` finds a row, return that original result with
   `duplicate: true` and change nothing.
4. Re-read both pockets. Both must exist and be `Active`. If `from` would go below zero, return
   `INSUFFICIENT_FUNDS` with the exact standard message, using the `from` pocket's name.
5. Append the adjustment row (Month = `monthKey(now)`), then write both balances. If a balance
   write fails, put back whatever was already written and delete the row (look at how
   `createTransaction` undoes itself).
6. Return `ok({ adjustment, from: presentPocket(...), to: presentPocket(...) })`.
7. `getState` adds `adjustments: readAdjustments({ month })`, newest first. Tasks 09, 10 and 16
   use it.

## Tests (`tests/transfer.test.js`)
- Moving R200 from a pocket with R385 to another: balances become 185 and +200, and one
  Adjustments row is written with the right fields.
- Moving more than the `from` balance → `INSUFFICIENT_FUNDS` with the exact message; nothing changes.
- Moving exactly the whole balance is allowed (`from` ends at 0).
- Same pocket twice, an archived pocket, an unknown pocket, a zero or negative amount, or a bad
  token → a clear error and no writes.
- The same requestId twice → the second call returns `duplicate: true` and balances move once.
- The lock is released and the writes are flushed on every path (copy the event-log pattern from
  `money-path.test.js`).
- Limits are unchanged after a transfer.

## Done when
- [ ] Tests pass and `npm run check` is green.
- [ ] Calling it from the browser console against your test Sheet moves the money and writes a row.

## Watch out
A transfer is **not spending**. Don't add it to Transactions, and don't let it change the `spent`
figures in `getState` or the report.
