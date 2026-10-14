# T47 · `getState.feed`

**Milestone:** M3 · **Type:** backend · **Depends on:** T12, T40

## Change (`backend/05_Api.gs.js`)
1. Export the pure `buildFeed(transactions, adjustments, limit = 10)` → items, newest first:
   - `{ kind: 'expense', id, groupId, user, note, timestamp, total, paidWith, lines: [{ id, pocketId, amount }] }`,
     one per group (rows with the same non-blank `groupId`; a blank groupId is its own group, with
     `id` = the txn id). `timestamp` is the group's newest one, `total` is summed in cents, and
     `paidWith` comes from the first line;
   - `{ kind: 'transfer', id, user, note, timestamp, amount, fromPocketId, toPocketId }` for adjustments
     with type `transfer`.
2. `getState` adds `feed: buildFeed(everyTransaction, adjustments)`. **Keep** `transactions` as it is.

## Tests
Grouping (3 lines → 1 item, the right total), single expenses, transfers merged in by time, the
limit of 10, and `transactions` unchanged.

## Verify
```bash
npm run check
```

## Done-check (used when resuming)
```bash
grep -q "export function buildFeed" backend/05_Api.gs.js
```

## Commit
`v2(T47): feed in getState`
