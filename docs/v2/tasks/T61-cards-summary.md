# T61 · Card summary (pure)

**Milestone:** M4 · **Type:** backend · **Depends on:** T60

## Change (`backend/08_Cards.gs.js`)
```js
export function parsePaymentNote(note)
  // 'closeKey|statement:4050.00|from:AC01' → { closeKey, statementAmount: 4050, fromAccountId: 'AC01' } or null
export function formatPaymentNote({ closeKey, statementAmount, fromAccountId })   // the inverse
export function summariseCard(account, transactions, paymentAdjustments, now = new Date())
```
`summariseCard` returns:
```
{ id, name, statementDay, dueDay, creditLimit,
  cycle:     { start, end, closeKey, total, count },
  statement: { closeKey, dueDate, total, count, paidAmount, paid, owing },
  availableCredit }   // null when creditLimit is null
```
- `cycle` = `cycleFor`; `statement` = `previousCycle`. The totals add up transactions with
  `paidWith === account.id` and a timestamp in the range (cents).
- `paidAmount` adds up the `paymentAdjustments` (type `card_payment`, `accountId === account.id`)
  whose parsed `closeKey` equals the statement's closeKey.
- `paid = paidAmount >= total`; `owing = max(0, total − paidAmount)`;
  `availableCredit = creditLimit − cycle.total − owing`.

## Tests (`tests/cards.test.js`)
Note round-trip; totals that leave out other accounts and out-of-range dates; paid, unpaid and
part-paid; available credit with and without a limit.

## Verify
```bash
node --test tests/cards.test.js
npm run check
```

## Done-check (used when resuming)
```bash
grep -q "export function summariseCard" backend/08_Cards.gs.js
```

## Commit
`v2(T61): card summary`
