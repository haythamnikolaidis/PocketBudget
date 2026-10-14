# T24 · Home: Savings section and summary line

**Milestone:** M2 · **Type:** frontend · **Depends on:** T23

## Change
1. `app/index.html`: under the pocket list, add `<h2>Savings</h2><div id="savings"></div>` (hide both
   when there are no Savings pockets).
2. `app/js/render.js`:
   - `renderPockets` leaves out `kind === 'Savings'`;
   - new `export function renderSavings(container, pockets)`: for each Savings pocket, the name, the
     balance, a carry pill if any, and "No monthly limit · fed by leftovers and transfers". **Never**
     the depleted or locked style, even at R0. Rows are `data-action="select-pocket"` buttons like
     pocket rows.
3. `summaryHtml`: when `summary.totalCarriedIn > 0`, the "of R…" line ends with
   ` · includes R3,980 carried in`.
4. `app/js/app.js`: call `renderSavings` next to `renderPockets` (`grep -n "renderPockets(" app/js/app.js`).

## Tests (`tests/render.test.js`)
Savings is left out of the main list; renders in its section without the depleted style at R0;
summary text with and without carry.

## Verify
```bash
node --test tests/render.test.js
npm run check
```

## Done-check (used when resuming)
```bash
grep -q "export function renderSavings" app/js/render.js
```

## Commit
`v2(T24): Savings section and carried-in summary`
