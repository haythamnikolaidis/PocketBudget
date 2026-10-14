# T22 · Show the rule in the pocket list and in edit mode

**Milestone:** M2 · **Type:** frontend · **Depends on:** T21

## Change (`app/js/manage.js`)
1. Export the pure `ruleLabel(pocket, pockets)` → 'Carries over' | 'Resets' | `Goes to ${targetName}`
   (with 'Goes to another pocket' if the target is unknown).
2. `rowHtml`: add the label as small grey text (escape it with `esc` / the file's existing escaping).
3. Edit mode: check the pocket's current rule radio and select its `sweepTo`.

## Tests (`tests/manage.test.js`)
`ruleLabel` for each case; edit mode preselects (with the fake DOM already used in that file).

## Verify
```bash
node --test tests/manage.test.js
npm run check
```

## Done-check (used when resuming)
```bash
grep -q "export function ruleLabel" app/js/manage.js
```

## Commit
`v2(T22): rule shown in pocket list and edit mode`
