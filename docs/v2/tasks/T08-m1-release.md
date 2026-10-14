# T08 · M1 release prep

**Milestone:** M1 · **Type:** docs · **Depends on:** T01–T07

## Goal
Version bump and documentation for milestone M1.

## Change
1. `SERVER_VERSION = '2.1.0'` in `backend/00_Config.gs.js`, and `CLIENT_VERSION = '2.1.0'` in
   `app/js/app.js`.
2. Tests that hard-code `'1.0.0'` as **the current** client or server version (`tests/boot.test.js`,
   `tests/app.test.js`; see `grep -rn "1.0.0" tests`) may be updated to `'2.1.0'` or to import
   `CLIENT_VERSION`. **Don't** change the `isServerStale` tests that compare literal strings to each
   other.
3. `docs/SMOKE_TEST.md` §11 *Monthly rollover*: replace the steps with: set `LAST_ROLLOVER_KEY` to
   last month → open the app → the balances reset on that first load → open it again → nothing
   changes.
4. `docs/DEPLOYMENT.md` *Redeploying after a code change*: add step 3, "If the release notes say so,
   run `migrateV2()` once from the editor (safe to repeat)."

## Verify
```bash
npm run check
```

## Done-check (used when resuming)
```bash
grep -q "2.1.0" backend/00_Config.gs.js
```

## Commit
`v2(T08): M1 release prep (2.1.0)`
