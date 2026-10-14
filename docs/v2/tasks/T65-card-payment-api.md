# T65 · `recordCardPayment` API action

**Milestone:** M4 · **Type:** backend · **Depends on:** T61, T10

## Rule
Paying the card **never changes a pocket**. It's a record that a statement was settled.

## API
`recordCardPayment { token, user, accountId, closeKey, statementAmount, paidAmount, fromAccountId?, requestId }`
→ `ok({ adjustment, card: summariseCard(...) })`.

## Change (`backend/05_Api.gs.js`, plus `ACTIONS`, `HANDLERS`, `makeApi`)
- Validate: the user; `accountId` is an active `card`; `closeKey` matches `^\d{4}-\d{2}-\d{2}$`; both
  amounts go through `parseAmountInput` and are > 0; `fromAccountId`, when given, is an active
  bank/cash account; the requestId.
- Lock → idempotency via `findAdjustmentByRequestId` (`duplicate: true`) → `appendAdjustments([{ type: 'card_payment', accountId, amount: paidAmount, month: monthKey(now), user, note: formatPaymentNote({ closeKey, statementAmount, fromAccountId }), requestId }])`.
- **No** `writeBalance` calls. Unlock in `finally`.

## Tests (new file `tests/card-payment.test.js`)
The row is written right (type, amount, note); **every pocket balance is unchanged** (deep-equal the
Pockets sheet before and after); a duplicate requestId is ignored; a part payment leaves
`card.statement.owing > 0`; a non-card account is refused.

## Verify
```bash
node --test tests/card-payment.test.js
npm run check
```

## Done-check (used when resuming)
```bash
grep -q "export function recordCardPayment" backend/05_Api.gs.js
```

## Commit
`v2(T65): recordCardPayment action`
