# T48 · Delete a whole split

**Milestone:** M3 · **Type:** backend · **Depends on:** T40

## Change (`backend/05_Api.gs.js` `deleteTransaction`)
Accept `{ groupId }` as an alternative to `{ txnId }`:
- Inside the lock: find every row with that Group ID (read with `readRecentTransactions` and filter;
  a group is always recent enough) → else `TRANSACTION_NOT_FOUND`.
- For each line in the **current month**: refund `balance + amount` to its pocket, adding up when
  several lines share a pocket. Then `deleteTransactionRows(ids)`.
- If the delete throws, restore every refunded balance, then rethrow.
- Return `{ deleted: [...], refunded: boolean, pockets: [...] }`.

The `txnId` path is unchanged. Update `makeApi`: `deleteGroup: (groupId) => call('deleteTransaction', { groupId })`.

## Tests (`tests/delete-group.test.js`)
All lines are removed and every pocket refunded; a group from an earlier month → rows removed, no
refund; an unknown group → error; a failure while deleting → the balances are restored.

## Verify
```bash
node --test tests/delete-group.test.js
npm run check
```

## Done-check (used when resuming)
```bash
grep -q "deleteGroup" app/js/api.js
```

## Commit
`v2(T48): delete a whole split`
