# T21 · Leftover rule on the pocket form

**Milestone:** M2 · **Type:** frontend · **Depends on:** T17, T20

## Goal
The create and edit pocket form offers "At month end, what's left…". Mockup:
`docs/v2/mockups/PocketSettings.html`.

## Read
`app/index.html` `#manage-form`; `app/js/manage.js` (`grep -n "create\|update\|limitInput\|submit" app/js/manage.js`).

## Change
1. `app/index.html`: inside `#manage-form`, after the limit input:
   - a hint `<p>`: "R0 is fine for a pocket that only collects leftovers, like Savings.";
   - a `<fieldset id="manage-rule">` with three `<input type="radio" name="rule">` + `<label>`
     (values `Carry`, `Sweep`, `Reset`; labels "Carries over" + a "Default" tag, "Goes to another
     pocket", "Resets");
   - a `<select id="manage-sweep">` shown only while Sweep is checked.
2. `app/js/manage.js`:
   - export the pure `ruleProblem({ rule, limitCents })` → the message 'A pocket that resets needs a
     monthly limit above R0.' or null;
   - export `sweepTargets(state, selfId)` → active pockets except self, Savings (`kind === 'Savings'`)
     first;
   - Create: Carry is checked by default, and a limit of 0 is allowed unless `ruleProblem` says no.
     Send `rule`, and `sweepTo` when the rule is Sweep, to `createPocket` / `updatePocket`.

## Tests (`tests/manage.test.js`)
`ruleProblem`, `sweepTargets` ordering; create sends `rule: 'Carry'` by default; Sweep sends `sweepTo`.

## Verify
```bash
node --test tests/manage.test.js
npm run check
```

## Done-check (used when resuming)
```bash
grep -q "manage-rule" app/index.html
grep -q "export function ruleProblem" app/js/manage.js
```

## Commit
`v2(T21): leftover rule on the pocket form`
