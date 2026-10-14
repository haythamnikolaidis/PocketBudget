# T52 · HUMAN: deploy and check M3

**Milestone:** M3 · **Type:** HUMAN · **Depends on:** T51

## For the agent
**Stop here.** Report: "M3 ready for human checkpoint T52."

## For the human
Merge, deploy a new backend version, run the smoke test, then mark T52 `done`.

## Verify
```bash
true
```

## Done-check (used when resuming)
```bash
grep -q "| T52 .*| done |" docs/v2/PROGRESS.md
```

## Commit
`(human: mark done in PROGRESS.md)`
