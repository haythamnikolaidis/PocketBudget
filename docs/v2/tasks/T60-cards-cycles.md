# T60 · Card statement cycles (pure)

**Milestone:** M4 · **Type:** backend · **Depends on:** —

## Goal
The date maths for card statements, in a new pure module. The build concatenates every
`backend/*.gs.js` in name order, so `08_Cards.gs.js` is picked up automatically.

## Change (new file `backend/08_Cards.gs.js`; import `localParts`, `UTC_OFFSET_MINUTES` as needed)
Every date is an instant (`Date`). "Household day D" means 00:00 at UTC+2.
```js
export function cycleFor(statementDay, now = new Date())
  // the cycle that contains `now`: start = the day after the previous statement day, 00:00 household time;
  // end = the next statement day (or today, if today is the statement day), 23:59:59.999 household time.
  // returns { start, end, closeKey: 'YYYY-MM-DD' of end }
export function previousCycle(statementDay, now = new Date())   // the cycle just before cycleFor(...)
export function dueDate(closeKey, dueDay)                        // 'YYYY-MM-DD': the first dueDay strictly after closeKey
```
statementDay is 1–28, so every month has that day.

## Tests (new file `tests/cards.test.js`)
Statement day 25, now = 10 Nov → 26 Oct–25 Nov, closeKey `2026-11-25`. Now exactly on 25 Nov at
23:00 household time → the same cycle. Now 26 Nov 00:30 household time → the next cycle. A year
boundary (statement day 20, now 5 Jan). `previousCycle`. `dueDate('2026-10-25', 15)` →
`'2026-11-15'`; `dueDate('2026-10-05', 15)` → `'2026-10-15'`.

## Verify
```bash
node --test tests/cards.test.js
npm run check
```

## Done-check (used when resuming)
```bash
test -f backend/08_Cards.gs.js
grep -q "export function cycleFor" backend/08_Cards.gs.js
```

## Commit
`v2(T60): card statement cycles`
