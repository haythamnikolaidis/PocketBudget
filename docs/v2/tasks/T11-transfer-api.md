# T11 · `transferFunds` API action

**Milestone:** M2 · **Type:** backend · **Depends on:** T02, T10

## Goal
Move money between two pockets, with a record of it. Limits never change.

## API
`transferFunds { token, user, fromPocketId, toPocketId, amount, note, requestId }` →
`ok({ adjustment, from, to })`, where `from` and `to` come from `presentPocket(...)`.

## Read
- `backend/05_Api.gs.js`: `createTransaction` (copy its structure exactly), `presentPocket`, `HANDLERS`.
- `backend/00_Config.gs.js`: `ACTIONS`.
- `app/js/api.js`: the object returned by `makeApi`.

## Change
1. The handler, in this order:
   - verify the token;
   - validate the user (`isValidUser(user, getUsers())`), both pocket ids (non-empty and different →
     else `INVALID_REQUEST`), the amount (`parseAmountInput`, > 0 → else `INVALID_AMOUNT`), the note
     (trim, max 120), and the requestId (`isValidRequestId` when given);
   - lock → `rolloverIfDue()`;
   - if `findAdjustmentByRequestId(requestId)` finds a row → return the original with
     `duplicate: true`;
   - re-read both pockets: both must be Active (else `POCKET_NOT_FOUND`); if `from` would go below 0
     → the exact `INSUFFICIENT_FUNDS` message and details, as `createTransaction` builds them (use
     the from-pocket's name);
   - `appendAdjustments([{ type: 'transfer', month: monthKey(now), … }])`, then `writeBalance` for
     from and to. If a balance write throws: restore any balance already written, then rethrow.
     (Leave the adjustment row in place; a failure here is extremely unlikely, and the
     double-write is what matters.)
   - `finally unlock(lock)`.
2. Add `'transferFunds'` to `ACTIONS` and `HANDLERS`, and `transferFunds: (p) => call('transferFunds', p)`
   to `makeApi`.

## Tests (new file `tests/transfer.test.js`; the workbook needs an Adjustments sheet, so add one to the fake ss)
- Move R200 from R385 → 185 and +200; one adjustment row; the limits are unchanged.
- Over-balance → the exact message, nothing written. An exact-balance move is allowed.
- Same pocket, archived pocket, unknown pocket, 0, -5, bad token → an error and no writes.
- The same requestId twice → `duplicate: true` on the second call, and the balances move once.
- The lock is released and the writes flushed on success and on rejection (event-log pattern from
  `money-path.test.js`).

## Verify
```bash
node --test tests/transfer.test.js
npm run check
```

## Done-check (used when resuming)
```bash
grep -q "export function transferFunds" backend/05_Api.gs.js
grep -q "transferFunds" app/js/api.js
```

## Commit
`v2(T11): transferFunds action`
