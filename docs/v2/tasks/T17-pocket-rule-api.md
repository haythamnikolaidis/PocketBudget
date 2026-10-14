# T17 · Pocket rule in `createPocket` / `updatePocket`

**Milestone:** M2 · **Type:** backend · **Depends on:** T07

## Goal
Pockets can be created and edited with a leftover rule. New pockets default to **Carry**. A R0 limit
is allowed unless the rule is Reset.

## Read
`backend/05_Api.gs.js` `createPocket`, `updatePocket`; `backend/03_Sheets.gs.js` `appendPocket`,
`updatePocketRow`.

## Change
1. `appendPocket({ name, account, limit, rule = 'Carry', sweepTo = '', kind = 'Spend' })` writes all
   10 columns (I = 0) and returns them too.
2. `updatePocketRow` also accepts `rule` and `sweepTo` (columns G and H).
3. In `05_Api.gs.js`, add a helper `checkRule(rule, sweepTo, limitCents, selfId)` → an error envelope
   or null:
   - the rule must be `Carry`, `Reset` or `Sweep` (`INVALID_RULE`);
   - Sweep needs `sweepTo` to be an Active pocket that isn't `selfId` (`INVALID_RULE`);
   - `limitCents === 0 && rule === 'Reset'` → `INVALID_AMOUNT`, 'A pocket that resets needs a
     monthly limit above R0.'
4. `createPocket`: `rule` defaults to `'Carry'`. Replace the "limit must be greater than zero" check
   with `checkRule`.
5. `updatePocket`: accept `rule` and `sweepTo`. Check the **effective** rule and limit (new values,
   or the pocket's current ones) with `checkRule`.

## Tests (`tests/manage.test.js` or a new `tests/pocket-rule.test.js`)
- Create with no rule → stored as `Carry`; R0 + Carry allowed; R0 + Reset refused.
- Sweep to itself, to an unknown pocket or to an archived pocket → refused.
- Update rule to Sweep with a valid target → G and H written.
- **Allowed change to an existing test:** any test expecting `createPocket` with limit 0 to fail
  must now pass `rule: 'Reset'`. The `updatePocket` limit-0 tests in `money-path.test.js` stay as
  they are (those pockets are Reset).

## Verify
```bash
npm run check
```

## Done-check (used when resuming)
```bash
grep -q "function checkRule" backend/05_Api.gs.js
```

## Commit
`v2(T17): leftover rule on create/update pocket`
