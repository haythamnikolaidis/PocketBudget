# Task 19: Cards on Home + card detail

**Milestone:** M4 · **Size:** M · **Depends on:** 17, 18 · **Mockups:** "Home" (Cards section),
"Credit card"

## The idea (read this first)
Every card swipe was already taken out of a pocket, and pockets can't go negative, so **every
logged card expense is already covered**. The card view doesn't budget anything. It shows what's
owed and when, using the expenses the couple already logs.

## Backend: a new pure module `backend/08_Cards.gs.js`
Write these as pure functions with lots of tests:
- `cycleFor(statementDay, now)` → `{ start, end, closeKey }`. The current statement cycle in
  household time. Example: statement day 25 on 10 Nov → 26 Oct 00:00 to 25 Nov 23:59, `closeKey`
  `2026-11-25`.
- `previousCycle(statementDay, now)`: the cycle before that, i.e. the last statement.
- `dueDate(closeKey, dueDay)`: the first `dueDay` after the close date.
- `summariseCard(account, transactions, payments, now)` →
  ```
  { id, name, creditLimit,
    cycle: { start, end, total, count },
    statement: { closeKey, dueDate, total, paid, paidAmount, owing },
    availableCredit }          // null when there is no credit limit
  ```
  `total` adds up the transactions with `paidWith === account.id` and a timestamp in the range.
  `paid` is true when the card payments (task 20) for that `closeKey` add up to at least `total`.
  `owing = max(0, total − paidAmount)`.
  `availableCredit = creditLimit − cycle.total − statement.owing`.

The build script concatenates every `backend/*.gs.js` file in name order, so the new file is picked
up automatically. Check that the generated bundle includes it.

## Backend: wiring
- `getState` returns `cards: [summariseCard(...)]` for active `card` accounts. It needs
  transactions back to the start of the previous cycle (up to about 2 months), so call
  `readRecentTransactions` with the month of that start date.
- A new read action, `getCard { accountId }`: the summary plus this cycle's transactions, newest
  first, and `byPocket: [{ pocketId, name, total }]`.

## Frontend
1. **Home:** a "Cards" section under Savings. One row per card: name, the cycle total, then either
   "statement R3,980 due 15 Nov" with an amber "Due in N days" pill, or "Last statement paid in
   full" with a "Covered" pill. Tapping a row opens card detail.
2. **Card detail** (`view-card`), per the mockup:
   - the cycle total and expense count, with the green line "All of it is already covered by your
     pockets";
   - the statement card (amount, due date, **Mark paid**, which task 20 builds);
   - available credit, if there is a limit;
   - the by-pocket bars;
   - recent expenses on the card.

## Tests
- `cycleFor` across a month boundary, a year boundary, statement day 28 in February, and `now`
  exactly on the statement day.
- `summariseCard` totals; paid / unpaid / part-paid; available credit with and without a limit.
- `getCard` `byPocket` adds up to the cycle total.

## Done when
- [ ] On the test Sheet, with backdated card expenses (task 11), the totals match a hand count.
