# T28 · `getPocket` API action

**Milestone:** M2 · **Type:** backend · **Depends on:** T12, T20

## API
`getPocket { token, pocketId, month? }` → `ok({ pocket, transactions, adjustments, breakdown })`.
A read: no lock.

## Change (`backend/05_Api.gs.js`, plus `ACTIONS`, `HANDLERS`, `api.js`)
1. Export the pure `pocketBreakdown(pocket, transactions, adjustments)` →
   `{ limit, carriedIn, movedIn, movedOut, spent, count, left }`:
   - `movedIn` = transfer + sweep adjustments **to** this pocket;
   - `movedOut` = transfer + sweep **from** it;
   - `spent` = the sum of these transactions, and `count` how many there are;
   - `left = limit + carriedIn + movedIn − movedOut − spent`.

   Do all of it in cents.
2. The handler: verify the token; find the pocket (with archived) → else `POCKET_NOT_FOUND`;
   `month = params.month || monthKey(new Date())`. Get the transactions from
   `readRecentTransactions({ month })` filtered by pocket and month. Get the adjustments from
   `readAdjustments({ month })` where `from` or `to` is this pocket. Return everything newest first.

## Tests (new file `tests/get-pocket.test.js`)
For a pocket with a carry, a transfer in, a transfer out and 3 expenses, `breakdown.left` equals the
pocket's balance after doing those operations through the real handlers. Unknown pocket → error.

## Verify
```bash
node --test tests/get-pocket.test.js
npm run check
```

## Done-check (used when resuming)
```bash
grep -q "export function getPocket" backend/05_Api.gs.js
grep -q "getPocket" app/js/api.js
```

## Commit
`v2(T28): getPocket action`
