# T16 · Write leftover results during rollover

**Milestone:** M2 · **Type:** backend · **Depends on:** T10, T15

## Goal
`rolloverIfDue` stores what `applyRollover` calculated: balances, Carried In (column I), and the
Adjustments rows.

## Read
`backend/05_Api.gs.js` `rolloverIfDue`; `backend/03_Sheets.gs.js` `writeBalance`, `findPocketRow`.

## Change
1. `03_Sheets.gs.js`: `export function writePocketRollover(pocketId, balance, carriedIn)` writes
   column E and column I.
2. `rolloverIfDue`:
   - Work out the label: `fromMonthLabel` = the English month name of the **old** key (`'2026-10'`
     → `'October'`). Use a fixed array of month names, not `toLocaleString`.
   - Call `applyRollover(pockets, { fromMonthLabel })`.
   - Call `writePocketRollover` for **every** Active pocket.
   - If there are adjustments and the Adjustments sheet exists, call `appendAdjustments` with
     `month: monthKey(now)`, `user: 'system'`, `timestamp: now`. If the sheet is missing, `Logger.log`
     a warning and skip it.

## Tests (`tests/rollover-timing.test.js`)
Using `v2Pocket` rows (Carry, Reset, Sweep → Savings) and an Adjustments sheet:
- After `rolloverIfDue` in a new month: balances, column I and the adjustment rows (types, amounts,
  note `Left over from October`) are right.
- A second call in the same month changes nothing.
- No Adjustments sheet → the balances still roll and nothing throws.

## Verify
```bash
node --test tests/rollover-timing.test.js
npm run check
```

## Done-check (used when resuming)
```bash
grep -q "export function writePocketRollover" backend/03_Sheets.gs.js
```

## Commit
`v2(T16): persist leftover results at rollover`
