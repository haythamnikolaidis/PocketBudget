# Task 18: Paid-with chips + Accounts screen

**Milestone:** M4 · **Size:** M · **Depends on:** 17 · **Mockups:** "Quick add · one pocket" (Paid
with), "Split one shop across pockets", "Accounts & cards"

## A. "Paid with" on the add and split forms
- A row of chips under the pocket chips, one per active account, with cards first. The selected card
  chip is blue.
- Default: this user's last choice (localStorage `pb.paidWith.<user>`), else the first `bank`
  account. Store it after each successful save.
- Picking a store suggestion (task 12) that has `paidWith` selects that account too, unless the user
  has already picked one.
- Send `paidWith` with `createExpense` / `createTransaction`, and include it in the retry fingerprint.
- Split mode shows the same choice once, for the whole expense (one swipe).
- The feed and pocket detail show the account name in the grey meta line ("Petrol · Today · Visa").

## B. The Accounts screen (Manage → "Accounts & cards")
- A new `view-accounts`, with a link to it from Manage.
- Each account is a row: name, a short usage line ("Used on 32 expenses" or "Funds 7 pockets", if
  that's easy; otherwise leave it out), and a Bank / Card / Cash switch made of three buttons with
  `aria-pressed`.
- When Card is selected, show Statement day, Due day and Credit limit (optional), with the hint
  "Credit limit is optional. Your pockets are the real limit."
- Changes save with `updateAccount` when a field loses focus or the type changes. Show a toast on
  error.
- **+ Add account or card** opens a small form (name and type) that calls `createAccount`.
- Archiving: a small "Archive" link on each row (it's hidden from the chips, and old expenses keep
  their label).
- **First-run banner** (shown while no account has type `card`, and until dismissed on this
  device): "We found N accounts on your pockets. Mark which ones are credit cards so the app can
  track what's owed."

## Tests
- Default selection order; remembered per user; a suggestion fills it in; the payload includes it.
- Changing the type to Card shows the card fields; invalid days show an inline error; saving calls
  `updateAccount` with the right fields.

## Done when
- [ ] On the test Sheet, logging with "Sam's Visa" writes the account ID in column I.
- [ ] The Accounts screen matches the mockup.
