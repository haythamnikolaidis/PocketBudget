# T09 · HUMAN: deploy and check M1

**Milestone:** M1 · **Type:** HUMAN · **Depends on:** T08

## For the agent
**Stop here.** Don't change anything. Report: "M1 ready for human checkpoint T09."

## For the human
1. Open a PR from the agent's branch to `master`, review it and merge. CI publishes the app.
2. Paste the new `Backend.bundle.gs` (CI artifact) into Apps Script, then **Deploy → Manage
   deployments → ✏️ → New version**.
3. Run `migrateV2()` from the editor and check the log.
4. Run `docs/SMOKE_TEST.md`, including the new §11.
5. Set this task to `done` in `docs/v2/PROGRESS.md`, commit, and restart the agent.

## Verify
```bash
true
```

## Done-check (used when resuming)
```bash
grep -q "| T09 .*| done |" docs/v2/PROGRESS.md
```

## Commit
`(human: mark done in PROGRESS.md)`
