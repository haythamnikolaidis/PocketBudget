# Task 14: Split screen

**Milestone:** M3 · **Size:** M · **Depends on:** 11, 13 · **Mockup:** "Split one shop across pockets"

## What
A second mode of the add form for spreading one shop over several pockets. The single-pocket form
stays the default; splitting is one tap away.

## Where
`app/index.html` (a `#add-split` block inside `view-add`) and `app/js/addform.js`. If the file gets
too long, move the split logic into `app/js/split.js` and call it from `addform.js`.

## Layout (per the mockup)
- Title "Split an expense" and a **One pocket** link back.
- "Total on the slip" (amount) and "Store" (note) side by side.
- The lines: pocket name, "R2,880 left", an amount input, and a remove (✕) button.
- A status bar: "R340.00 left to allocate" (amber) or "All R1,240.00 allocated ✓" (green).
- "Add a pocket": chips of unused, unlocked pockets.
- A button: "Save R1,240.00 across 3 pockets".

## Behaviour
- **Entering split mode** (the "Split across pockets" link under the pocket chips): carry over the
  amount and note. The current pocket becomes line 1, with amount `min(total, balance)`.
- **Tapping a chip** adds a line pre-filled with `min(unallocated, that pocket's balance)`. At most
  10 lines; hide the chips at 10.
- A line whose amount is more than its pocket's balance turns red with "Only R310 left".
- **Save is enabled only when** every line is > 0 and within its balance, and the lines add up to
  the total exactly (compare in cents).
- Submit calls `api.createExpense` with the same requestId and retry fingerprint pattern as the
  single form (the fingerprint includes every line).
- `INSUFFICIENT_FUNDS`: show the server message as it is, refresh state (the balances changed on
  the other phone), and keep the lines so they can be adjusted.
- After success: a toast "Saved R1,240.00 across 3 pockets.", then back to single mode with the
  form cleared.

## Tests
- Entering split mode carries the amount, note and first pocket over.
- Chip pre-fill uses the unallocated amount capped at the balance.
- The Save rules (sums in cents: R0.10 + R0.20 = R0.30), the 10-line limit, and red over-balance lines.
- The payload has the right `lines`; a double tap sends once.

## Done when
- [ ] A 3-pocket split on the test Sheet gives 3 rows with one Group ID.
- [ ] A smoke test step is added: "split a shop across 3 pockets; all three balances drop".
