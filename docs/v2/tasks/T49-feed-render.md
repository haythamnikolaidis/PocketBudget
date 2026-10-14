# T49 · Activity feed: grouped splits, transfers, filters

**Milestone:** M3 · **Type:** frontend · **Depends on:** T47, T48

## Goal
Mockup: `docs/v2/mockups/Activity.html` (without the Undo toast, which is T50).

## Change
1. `app/js/render.js`:
   - export the pure `feedItemHtml(item, pocketNames, { expanded, now })`:
     - an expense with one line looks like today's `activityRowHtml`;
     - an expense with several lines: "<note> · N pockets" and the total, plus a chevron button
       (`data-action="toggle-group"`, `aria-expanded`). When expanded, show one line per pocket and a
       button `data-action="delete-group" data-group-id` with the text "Delete all N";
     - a transfer: a pale "Move" tag, "<from> → <to>", the amount, and **no delete button**;
   - export the pure `filterFeed(feed, filter)`, where `filter` is `'all'`, a user name or `'moves'`;
   - `renderActivity(container, transactions, names, opts)`: use `opts.feed` when present, otherwise
     render as today.
2. `app/index.html`: `<div id="activity-filters"></div>` above `#activity`.
3. `app/js/app.js`:
   - render the filter chips (Everyone, each user, Moves) and keep the current filter in a variable;
   - keep a `Set` of expanded group ids; `toggle-group` toggles it and re-renders;
   - pass `payload.feed`;
   - `delete-group` → `api.deleteGroup` (for now with the existing `confirmDelete`; T50 replaces it).

## Tests (`tests/render.test.js`)
Each item kind, expanded vs collapsed, escaping, `filterFeed`.

## Verify
```bash
node --test tests/render.test.js
npm run check
```

## Done-check (used when resuming)
```bash
grep -q "export function feedItemHtml" app/js/render.js
```

## Commit
`v2(T49): grouped activity feed`
