# Task 16: Activity: grouped splits, group delete, Undo

**Milestone:** M3 · **Size:** M · **Depends on:** 04, 13 · **Mockup:** "Activity · grouped split + undo"

## What
1. A split shows as **one** row in the feed, which opens to show its lines.
2. Transfers show in the feed.
3. Deleting a split deletes the whole thing in one go.
4. Delete uses **Undo** instead of a "Are you sure?" box.

## Backend
1. `getState` returns a new `feed` (and **keeps** `transactions` for old phones): the newest 10
   items, mixing:
   - `{ kind: 'expense', id, groupId, user, note, timestamp, total, lines: [{ id, pocketId, amount }] }`.
     One per group; a single-line expense is a group of one.
   - `{ kind: 'transfer', id, user, note, timestamp, amount, fromPocketId, toPocketId }` from
     this month's adjustments of type `transfer`.
2. `deleteTransaction` also accepts `{ groupId }`. Inside the lock it finds all rows of the group,
   refunds each current-month line to its pocket (same rules as today, no clamp; see task 06), and
   deletes the rows **from the bottom up** (deleting top-down shifts the row numbers). If anything
   fails, undo the refunds already made, as the single delete does.

## Frontend (`render.js`, `app.js`)
1. Render `feed` when present, or fall back to `transactions`.
   - An expense with several lines: "Checkers · 3 pockets" and the total (task 18 adds the card name later), plus a
     chevron that expands the lines (pocket and amount), with an **Edit** placeholder hidden for now
     and **Delete all 3**.
   - A transfer: a pale "Move" tag, "Dining Out → Groceries", and the amount. It has no delete
     button; to reverse it, move the money back.
2. Filter chips above the feed: Everyone, each user, Moves. Filtering happens on the phone.
3. **Undo:**
   - Tapping ✕ (or Delete all) hides the row at once and shows a toast: "Deleted Spar R141.00.
     Undo".
   - After 6 seconds, send the delete and refresh. Undo cancels the timer and shows the row again.
   - If the app is hidden (`visibilitychange`) or another delete starts while one is waiting, send
     the waiting delete straight away.
   - Remove `confirmDelete` and its `confirm()` call.

## Tests
- Backend: feed grouping and order; a group of one; transfers included; old `transactions`
  unchanged. Group delete refunds every pocket and removes every row; a failure part-way puts all
  balances back.
- Frontend: expand and collapse; filters; the Undo timer (use `t.mock.timers`): no request before
  6 seconds, none after Undo, one after 6 seconds, and an immediate one on `visibilitychange`.

## Done when
- [ ] Deleting a split on the test Sheet refunds all its pockets.
- [ ] Undo works, and no confirm box appears.
- [ ] The smoke test's delete step is updated for Undo.
