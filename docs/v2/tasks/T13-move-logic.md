# T13 · Move money: pure logic module

**Milestone:** M2 · **Type:** frontend · **Depends on:** T11

## Goal
The logic behind the Move money screen, as pure functions (the screen comes in T14).
Mockup: `docs/v2/mockups/MoveMoney.html`.

## Change (new file `app/js/move.js`)
Import `formatMoney` and `parseAmountText` from `./format.js` (check their exact names with `grep -n "export" app/js/format.js`).
```js
export function activePockets(state)                  // state.pockets that aren't archived, in their order
export function moveProblem(state, fromId, toId, amountText)
  // null when OK, otherwise one of:
  // 'Choose two different pockets.' | 'Enter an amount greater than zero.' | `Only ${formatMoney(bal)} left in ${name}.`
export function movePreview(state, fromId, toId, amountText)
  // { from: { name, before, after }, to: { name, before, after } } in rands, or null if the amount is invalid
export function quickAmounts(balance)                 // [100, 200, 300] filtered to <= balance, then { all: balance } when balance > 0
```

## Tests (new file `tests/move.test.js`)
Each problem message; preview numbers (use amounts like 0.10 + 0.20 to prove you work in cents);
`quickAmounts(150)` → `[100, { all: 150 }]`.

## Verify
```bash
node --test tests/move.test.js
npm run check
```

## Done-check (used when resuming)
```bash
test -f app/js/move.js
test -f tests/move.test.js
```

## Commit
`v2(T13): move money logic`
