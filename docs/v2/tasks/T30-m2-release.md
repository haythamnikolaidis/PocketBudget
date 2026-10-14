# T30 · M2 release prep

**Milestone:** M2 · **Type:** docs · **Depends on:** T10–T29

## Change
1. `SERVER_VERSION` and `CLIENT_VERSION` → `'2.2.0'` (update the test fixtures from T08 the same way).
2. `docs/PRODUCT_BRIEF.md`:
   - §4A *Monthly Rollover*: "applies each pocket's leftover rule (Carry by default for new pockets,
     Sweep to another pocket, or Reset)";
   - success criterion 6: "The rollover gives every active pocket its limit plus whatever its
     leftover rule carries in, and never forgives spending already recorded in the new month."
3. `docs/SMOKE_TEST.md`: add steps for: moving R10 between pockets (the balances change, the limits
   don't); a forced rollover with one pocket per rule (check balances, the Adjustments rows and the
   Savings balance); the month-end card showing once per phone; pocket detail adding up.
4. `docs/DEPLOYMENT.md`: note that M2 requires running `migrateV2()` (it creates the Savings pocket).

## Verify
```bash
npm run check
```

## Done-check (used when resuming)
```bash
grep -q "2.2.0" backend/00_Config.gs.js
```

## Commit
`v2(T30): M2 release prep (2.2.0)`
