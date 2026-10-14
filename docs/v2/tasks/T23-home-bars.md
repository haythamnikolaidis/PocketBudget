# T23 · Home: carried-in bar segment and pills

**Milestone:** M2 · **Type:** frontend · **Depends on:** T20

## Goal
Each pocket row shows this month's money and carried-in money separately. Mockup:
`docs/v2/mockups/Main.html` (the "Spending pockets" list).

## Read
`app/js/render.js` `pocketRowHtml`, `barHtml`, `leftPct`; `app/js/app.js` `grep -n "renderPockets(" app/js/app.js`.

## Change (`app/js/render.js`)
1. Export the pure `barSegments(p)` → `{ own, carried }` percentages of `available` (fall back to
   `limit` when `available` is missing):
   `carriedLeft = min(carriedIn, balance)`, `ownLeft = balance − carriedLeft`. Clamp so
   own + carried ≤ 100.
2. Export the pure `carryPillText(p, month)` → `'+R120 from Oct'` (the month **before** `month`
   `YYYY-MM`, as a 3-letter English name; amounts through `formatRand`/`formatMoney`, whichever the
   file uses for whole rands), or `''` when `carriedIn <= 0`.
3. `pocketRowHtml(p, pace, opts = {})`: two fill spans in the bar (green as today, then pale green
   `#a7f3d0`, via a `pb-carry` class added to `app/styles.css`); the carry pill (pale green); a grey
   `Reset` pill when `p.rule === 'Reset'`; when `carriedIn > 0` the amount shows only the balance
   (no "/ limit").
4. `renderPockets` passes `opts.month` through; `app.js` passes `payload.month`.
5. A legend below the list: "This month's budget" (green swatch) and "Carried in" (pale swatch),
   shown only when some pocket has `carriedIn > 0`.

## Tests (`tests/render.test.js`)
`barSegments` (no carry; carry, unspent; carry, partly spent; balance above available);
`carryPillText` across a year boundary (`2027-01` → `Dec`); the pills appear in the HTML; existing
render tests still pass.

## Verify
```bash
node --test tests/render.test.js
npm run check
```

## Done-check (used when resuming)
```bash
grep -q "export function barSegments" app/js/render.js
```

## Commit
`v2(T23): carried-in bar segments and pills`
