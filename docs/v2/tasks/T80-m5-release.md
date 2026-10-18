# T80 · M5 release prep

**Milestone:** M5 · **Type:** docs · **Depends on:** T69–T79

## Change
1. Versions → `'2.5.0'` (and the test fixtures, as in T08).
2. `docs/SMOKE_TEST.md`: add a section *Loans*:
   - Manage → `+ Add loan`: `Test loan`, balance R10,000.00, balance date = the 1st of last month,
     rate 10.95, instalment R1,000.00, billing day 25, debit order day 1;
   - Home shows `Test loan` under Loans with a paid-off date about 11 months away;
   - open it: the balance is R10,000.00 plus the interest billed since, minus the debit orders since;
     the History shows the opening rate and instalment;
   - Extra payment R5,000.00 dated today → the toast's paid-off date is earlier, and **no pocket
     balance changed**;
   - Rate change 30 dated today, then New instalment R50.00 → `Won't be paid off at this
     instalment`; New instalment R1,000.00 again → a date returns;
   - Correct balance R0 dated today → `Paid off`;
   - PocketBudget ▸ Refresh report → `Monthly_Report` has a LOANS block with one `Test loan` line;
   - Manage → Archive the loan → it leaves Home and the report.
3. `docs/DEPLOYMENT.md`: note that M5 requires running `migrateV2()` (it creates the `Loans` and
   `Loan Events` sheets).

## Verify
```bash
npm run check
```

## Done-check (used when resuming)
```bash
grep -q "2.5.0" backend/00_Config.gs.js
```

## Commit
`v2(T80): M5 release prep (2.5.0)`
