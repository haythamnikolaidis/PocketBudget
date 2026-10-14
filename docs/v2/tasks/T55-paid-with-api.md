# T55 · "Paid with" on expenses (backend)

**Milestone:** M4 · **Type:** backend · **Depends on:** T54, T42

## Change (`backend/05_Api.gs.js`)
1. `recordExpense` accepts `paidWith` (optional). When it's non-empty, it must be an **Active**
   account from `readAccounts()`, or the result is `fail('INVALID_ACCOUNT', 'Unknown or archived account.')`.
   Check this **before** writing. Pass it to `appendTransactions` for every line.
2. `createTransaction` and `createExpense` pass `params.paidWith` through.
3. `buildMerchants` adds `paidWith`: the most recent non-blank one for that store.
   (`buildFeed` already carries `paidWith` from T47; check it.)

## Tests
`paidWith` is stored on every line of a split; an unknown or archived account is refused with no
rows written; omitting it still works (old phones); merchants carry `paidWith`.

## Verify
```bash
npm run check
```

## Done-check (used when resuming)
```bash
grep -q "INVALID_ACCOUNT" backend/05_Api.gs.js
```

## Commit
`v2(T55): paid-with on expenses`
