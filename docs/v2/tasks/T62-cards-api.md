# T62 · `getState.cards` and `getCard`

**Milestone:** M4 · **Type:** backend · **Depends on:** T61, T55

## Change (`backend/05_Api.gs.js`, plus `ACTIONS`, `HANDLERS`, `makeApi`)
1. `getState`:
   - work out the active card accounts;
   - the read must go back to the start of the earliest `previousCycle(...).start` of any card, so
     call `readRecentTransactions({ month: <the earlier of month and monthKey(that start)>, minRows: 200 })`.
     This is the **single** read that is already there; just change the month passed in;
   - payments = `readAdjustments()` (unfiltered) filtered to `type === 'card_payment'`;
   - add `cards: activeCards.map(a => summariseCard(a, everyTransaction, payments))`.

   Check that the month totals still only count `month` (they filter by monthKey already).
2. A new read action, `getCard { token, accountId }` → `ok({ card: summariseCard(...),
   transactions: <this cycle's transactions for the card, newest first>, byPocket: [{ pocketId, name, total }] })`,
   with `byPocket` sorted by total, high first. Unknown or non-card account → `ACCOUNT_NOT_FOUND`.

## Tests (new file `tests/cards-api.test.js`)
`getState.cards` for one card with transactions spanning two cycles; month totals unaffected by the
longer read; `getCard.byPocket` adds up to `cycle.total`.

## Verify
```bash
node --test tests/cards-api.test.js
npm run check
```

## Done-check (used when resuming)
```bash
grep -q "export function getCard" backend/05_Api.gs.js
grep -q "getCard" app/js/api.js
```

## Commit
`v2(T62): cards in getState and getCard`
