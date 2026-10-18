# T68 · HUMAN: deploy and check M4

**Milestone:** M4 · **Type:** HUMAN · **Depends on:** T67

## For the agent
**Stop here.** Report: "M4 ready for human checkpoint T68."

## For the human
Merge, deploy a new backend version, run `migrateV2()` (it seeds Accounts), run the full smoke test,
then mark T68 `done` and restart the agent for M5.

## Verify
```bash
true
```

## Done-check (used when resuming)
```bash
grep -q "| T68 .*| done |" docs/v2/PROGRESS.md
```

## Commit
`(human: mark done in PROGRESS.md)`
