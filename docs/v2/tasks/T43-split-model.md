# T43 · Split: pure model

**Milestone:** M3 · **Type:** frontend · **Depends on:** T41

## Goal
The rules of the split screen as pure, immutable functions (the screen comes in T44). Mockup:
`docs/v2/mockups/Split.html`.

## Change (new file `app/js/split.js`)
All amounts are integer **cents** inside the model. Use `parseAmountText` from `format.js` to turn
text into rands, then convert to cents.
```js
export const MAX_LINES = 10;
export function newSplit(totalCents, firstPocket)            // { totalCents, lines: [{ pocketId, cents }] }; line 1 = min(total, balance)
export function unallocated(split)                            // totalCents − sum(lines)
export function addLine(split, pocket)                        // pre-fill min(unallocated, balance); no-op at MAX_LINES or for a duplicate pocket
export function setLine(split, pocketId, cents)
export function removeLine(split, pocketId)
export function lineProblem(line, pocket)                     // null | `Only ${formatMoney(balance)} left`
export function canSave(split, pockets)                       // every line > 0, no problems, unallocated === 0, 1..10 lines
export function toPayloadLines(split)                         // [{ pocketId, amount: '12.34' }]
```

## Tests (new file `tests/split.test.js`)
Every function, including R0.10 + R0.20 = R0.30, the max-lines no-op, a duplicate pocket no-op, and
`canSave` false for an over-balance line.

## Verify
```bash
node --test tests/split.test.js
npm run check
```

## Done-check (used when resuming)
```bash
test -f app/js/split.js
test -f tests/split.test.js
```

## Commit
`v2(T43): split model`
