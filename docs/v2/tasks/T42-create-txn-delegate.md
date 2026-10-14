# T42 · `createTransaction` uses the shared expense code

**Milestone:** M3 · **Type:** backend · **Depends on:** T41

## Goal
One code path for spending. `createTransaction` becomes a thin wrapper around `recordExpense`,
with **exactly** the same request and response as before (old phones depend on it).

## Change
`createTransaction(params)`: verify the token, then call
`recordExpense({ …, lines: [{ pocketId: params.pocketId, amount: params.amount }] })` and map the result:
`{ pocket: pockets[0], transaction: transactions[0] }`, plus `duplicate: true` when it was a
duplicate. Map errors through unchanged. Delete the now-unused body.

## Tests
**Every existing test** for `createTransaction` (`tests/api.test.js`, `tests/money-path.test.js`,
`tests/integration.test.js`, `tests/invariants.test.js`) must pass **unchanged**. If one fails,
fix `recordExpense` or the mapping, never the test. Add one test: a single-line expense leaves Group
ID blank.

## Verify
```bash
npm run check
```

## Done-check (used when resuming)
```bash
grep -A15 "export function createTransaction" backend/05_Api.gs.js | grep -q recordExpense
```

## Commit
`v2(T42): createTransaction delegates to recordExpense`
