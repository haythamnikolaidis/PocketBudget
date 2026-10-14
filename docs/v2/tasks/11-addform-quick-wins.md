# Task 11: Quick wins on the add form

**Milestone:** M3 · **Size:** M · **Depends on:** 01 · **Mockup:** "Quick add · one pocket"

## Why
The product promises an expense in under 5 seconds. Today most entries start by changing the
pocket, and there's no way to log yesterday's coffee. These are four small changes; do them as
four commits in one PR.

## A. Remember the last pocket, per person
- In `app/js/addform.js`, after a successful save, store the pocket ID in localStorage under
  `pb.lastPocket.<user>`. Copy the try/catch pattern of `rememberUser`.
- In `renderOptions`, the order of preference is: the current selection, then this user's last
  pocket (if it exists and isn't locked), then the first open pocket.

## B. Pocket chips
- **Backend:** `presentPocket` gets `txnCount`, this month's number of expenses for the pocket.
  `getState` already loops over this month's transactions, so count there.
- **Frontend:** above the existing `<select>`, show chips for the 4 most-used pockets that aren't
  locked (ties go to the higher balance). Each chip shows the name and "R1,420 left". Tapping a chip
  sets `pocketEl.value` and runs `syncSubmitState()`. The selected pocket's chip is highlighted.
  A 5th chip, **More…**, shows the `<select>` (hide the select until then). Keep the select as the
  source of truth; the chips only set it.
- Leave Savings out of the chips; it's still in the select.

## C. "When": Today / Yesterday / Pick a day
- **Backend** (`createTransaction`): accept an optional `date` of `YYYY-MM-DD`. Refuse it
  (`INVALID_DATE`) if it's in the future or not in the **current** month (household time; use
  `monthKey` and `localParts`). Store it as 12:00 household time on that day. No `date` means now,
  as today.
- **Frontend:** a row of chips, Today (default), Yesterday, Pick a day. "Pick a day" shows
  `<input type="date">` limited to the 1st of this month through today. After each save, reset to
  Today.
- Hide Yesterday on the 1st of the month.
- Include `date` in the retry fingerprint.

## D. A home-screen shortcut straight to "Add"
- `app/manifest.webmanifest`: add
  `"shortcuts": [{ "name": "Add expense", "url": "./index.html?view=add", "icons": [...] }]`,
  reusing the 192px icon.
- `app/js/app.js` `boot`: if the URL has `?view=add`, open the add view after the first state load.
- Update `tests/manifest.test.js`.

## Also: make the user picker smaller
Move the "Who" select into a compact "Sam ▾" control at the top right of the form, as in the
mockup. Behaviour is unchanged (it's still remembered per device).

## Tests
- A: the last pocket is preferred on mount, ignored if locked, and stored per user.
- B: chip order, locked pockets left out, a tap updates the select and the submit state.
- C: backend accepts yesterday and the 1st, and refuses tomorrow, last month and a bad format; the
  stored timestamp is 12:00 local. Frontend sends `date` only when it isn't Today.
- D: the manifest test, and the boot test with `?view=add`.

## Done when
- [ ] From a cold start on a phone, logging the usual coffee is: type amount → Save.
- [ ] A smoke test step is added for backdating.
