# T31 · HUMAN: deploy and check M2

**Milestone:** M2 · **Type:** HUMAN · **Depends on:** T30

## For the agent
**Stop here.** Report: "M2 ready for human checkpoint T31."

## For the human
Merge the PR, paste the bundle and deploy a new version, run `migrateV2()` (it creates Savings), run
the smoke test, then mark T31 `done` in PROGRESS.md.

## Verify
```bash
true
```

## Done-check (used when resuming)
```bash
grep -q "| T31 .*| done |" docs/v2/PROGRESS.md
```

## Commit
`(human: mark done in PROGRESS.md)`
