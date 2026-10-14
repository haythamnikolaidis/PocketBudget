# T67 · M4 release prep

**Milestone:** M4 · **Type:** docs · **Depends on:** T53–T66

## Change
1. Versions → `'2.4.0'` (and the test fixtures, as in T08).
2. `docs/SMOKE_TEST.md`: add the card loop:
   - mark an account as a card (statement day = yesterday's date, due day = any);
   - backdate two expenses on it (T36);
   - Home shows the statement due;
   - Mark paid with a statement R5 higher → "Not logged R5.00" → choose forgot → the add form opens
     pre-filled;
   - the card shows paid, and **no pocket balance changed** because of the payment.
3. `docs/DEPLOYMENT.md`: note that M4 requires running `migrateV2()` (it seeds Accounts).

## Verify
```bash
npm run check
```

## Done-check (used when resuming)
```bash
grep -q "2.4.0" backend/00_Config.gs.js
```

## Commit
`v2(T67): M4 release prep (2.4.0)`
