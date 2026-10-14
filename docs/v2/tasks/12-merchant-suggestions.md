# Task 12: Store name → pocket suggestions

**Milestone:** M3 · **Size:** S · **Depends on:** 02, 11 · **Mockup:** "Quick add · one pocket" (the
list under "Store or note")

## What
As you type in "Store or note", up to 3 previous store names appear. Tapping one fills in the name
**and** selects the pocket last used with it ("Engen → Petrol").

## Backend
`getState` returns `merchants: [{ name, pocketId, count }]`, at most 50, sorted by count:
- Build it from the transactions `getState` already read. In task 02, raise `minRows` to 200 so
  there's enough history to be useful.
- Group by the note, trimmed and compared case-insensitively. Show the most recent spelling.
- `pocketId` is the pocket of the **most recent** use. Leave out notes that are blank or longer than
  40 characters (those are notes, not store names).
- Task 17 adds `paidWith` to this list later.

## Frontend (`addform.js`)
- On `input` in the note field, once at least 2 characters are typed, show up to 3 matches (names
  **starting with** the text first, then names **containing** it) as buttons under the field. Each
  shows the name on the left and "usually Petrol" on the right.
- Tapping a match sets the note, selects its pocket (if it isn't locked), hides the list, and puts
  the cursor in the amount field if it's empty.
- If the user types a name that exactly matches a store **and hasn't touched the pocket** since
  the form reset, select that pocket automatically and show "picked from 'Engen'" next to the
  Pocket label.
- Escape or tapping elsewhere hides the list. Never use `innerHTML` for these names.

## Tests
- Backend: grouping, case-insensitive matching, most recent pocket wins, long notes left out, the
  cap at 50.
- Frontend: matching order, a tap selects the pocket, the auto-select doesn't override a pocket the
  user picked themselves, and a locked pocket is never auto-selected.

## Done when
- [ ] On the test Sheet, typing "eng" offers "Engen", and tapping it picks Petrol.
