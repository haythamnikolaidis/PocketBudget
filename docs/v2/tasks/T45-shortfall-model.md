# T45 · Cover the shortfall: pure logic

**Milestone:** M3 · **Type:** frontend · **Depends on:** T43

## Change (new file `app/js/shortfall.js`)
```js
export function shortfallOptions(pockets, selectedId, amountCents, isLocked)
  // null unless 0 < selected.balance AND amountCents > selected balance (in cents).
  // else { selected, shortCents, candidates }: up to 3 other pockets that aren't locked and have
  // balance >= short, highest balance first (Savings is allowed)
export function shortfallLines(selected, candidate, amountCents)
  // [{ pocketId: selected.id, amount: <selected balance> }, { pocketId: candidate.id, amount: <short> }] as '12.34' strings
```

## Tests (new file `tests/shortfall.test.js`)
null when the amount fits or the pocket is empty; candidates leave out the selected, locked and
too-small pockets; order; at most 3; the lines add up to the total exactly (in cents).

## Verify
```bash
node --test tests/shortfall.test.js
npm run check
```

## Done-check (used when resuming)
```bash
test -f app/js/shortfall.js
```

## Commit
`v2(T45): shortfall logic`
