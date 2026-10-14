# T33 · `txnCount` on each pocket

**Milestone:** M3 · **Type:** backend · **Depends on:** T20

## Change (`backend/05_Api.gs.js`)
In `getState`, count this month's transactions per pocket in the loop that builds `spentByPocket`.
`presentPocket(p, spentByPocket, countByPocket = {})` adds `txnCount: countByPocket[p.id] || 0`.

## Tests (`tests/api.test.js`)
`txnCount` matches; it's 0 for an unused pocket.

## Verify
```bash
node --test tests/api.test.js
npm run check
```

## Done-check (used when resuming)
```bash
grep -q "txnCount" backend/05_Api.gs.js
```

## Commit
`v2(T33): txnCount per pocket`
