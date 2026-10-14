# T51 · M3 release prep

**Milestone:** M3 · **Type:** docs · **Depends on:** T32–T50

## Change
1. Versions → `'2.3.0'` (and the test fixtures, as in T08).
2. `docs/SMOKE_TEST.md`: add steps for logging yesterday's expense, the store suggestion picking the
   pocket, a 3-pocket split (3 rows, one Group ID, 3 balances down), covering a shortfall, deleting a
   split with Undo (and without), and the home-screen "Add expense" shortcut (Android long-press).

## Verify
```bash
npm run check
```

## Done-check (used when resuming)
```bash
grep -q "2.3.0" backend/00_Config.gs.js
```

## Commit
`v2(T51): M3 release prep (2.3.0)`
