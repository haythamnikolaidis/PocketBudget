# T81 · HUMAN: deploy and check M5

**Milestone:** M5 · **Type:** HUMAN · **Depends on:** T80

## For the agent
**Stop here.** Report: "M5 ready for human checkpoint T81. v2 is complete."

## For the human
1. Open a PR from the agent's branch to `master`, review it and merge. CI publishes the app.
2. Paste the new `Backend.bundle.gs` (CI artifact) into Apps Script, then **Deploy → Manage
   deployments → ✏️ → New version**.
3. Run `migrateV2()` from the editor; the log lists `Created sheet Loans` and
   `Created sheet Loan Events`.
4. Run the *Loans* section of `docs/SMOKE_TEST.md`, then these checks against the real mortgage:
   - add it with the balance and date from the latest statement, the current rate, the debit-order
     amount, the statement (billing) day and the debit-order day;
   - after the next statement, compare the app's balance and the month's interest with the statement.
     A difference of a few cents is rounding; more means the billing day or the rate is wrong. Fix it
     with **Correct balance** on the statement date;
   - the `Loan Events` sheet has one row per thing you entered, and the `Pockets` sheet didn't change;
   - the paid-off date is close to the one the bank quotes (banks round differently, so allow a month).
5. Delete the test loan's rows from `Loans` and `Loan Events` if you don't want them kept.
6. Set this task to `done` in `docs/v2/PROGRESS.md` and commit. Later ideas are in `docs/v2/LATER.md`.

## Verify
```bash
true
```

## Done-check (used when resuming)
```bash
grep -q "| T81 .*| done |" docs/v2/PROGRESS.md
```

## Commit
`(human: mark done in PROGRESS.md)`
