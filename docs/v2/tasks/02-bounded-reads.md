# Task 02: Read only this month's transactions in `getState`

**Milestone:** M1 · **Size:** S · **Depends on:** 00

## Why
Every app refresh calls `getState`, which reads **every transaction ever logged** and sorts them,
only to show 10 rows and this month's totals. The sheet grows by about 150 rows a month, so the app
gets slower every month. The product promises an expense can be logged in under 5 seconds.

## The idea
The server stamps each transaction as it's appended, so rows are already in time order. Read from
the **bottom** of the sheet upwards in chunks until you reach a row from an earlier month, then
stop.

## Where
- `backend/03_Sheets.gs.js`: add the new read next to `readTransactions`.
- `backend/05_Api.gs.js`: `getState`.

## Steps
1. Add `readRecentTransactions({ month, minRows = 30, chunk = 200 })` to `03_Sheets.gs.js`. It
   reads chunks of `chunk` rows from the bottom with one `getRange` per chunk, maps them exactly as
   `readTransactions` does, and stops when it has gone past the start of `month` **and** has at least
   `minRows` rows. Return them newest first, in the same shape as `readTransactions`.
2. In `getState`, replace `readTransactions()` with `readRecentTransactions({ month })`. The feed
   (first 10) and the per-pocket month totals come from that list.
3. Leave `readTransactions()` for the nightly report, which needs all history.

## Tests
- A sheet with 3 months of rows returns every row of the current month and nothing older, apart
  from the extra rows needed to reach `minRows`.
- A month with only 2 rows still returns 30 rows, so the feed isn't empty on the 1st.
- An empty sheet and a header-only sheet return `[]`.
- Count `getRange` calls on the fake sheet: a sheet of 2,000 rows with 100 this month uses one or
  two calls.
- Existing `getState` tests still pass unchanged. That proves the output didn't change.

## Done when
- [ ] Tests pass and `npm run check` is green.
- [ ] On your test Sheet with a few hundred fake rows, the home screen loads at least as fast as
      before.

## Watch out
A row someone typed into the Sheet by hand could be out of order. That's acceptable: the nightly
report still reads everything. Don't build anything for it.
