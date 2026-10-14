# Task 21: Later (only when the product owner asks)

These were proposed in `docs/RECOMMENDATIONS.md`. They're left out of v2 to keep it small. Don't
start any of them without a go-ahead, and write a proper task file first, using the same template.

| Idea | Notes for whoever picks it up |
|---|---|
| **Edit an expense** (amount, pocket, note), current month | A new `updateTransaction` action inside the lock: refund the old line and deduct the new one in one step, with the same non-negative check. Task 16 left a hidden **Edit** button ready. |
| **Edit or delete expenses from earlier months** | The owner called this a nice-to-have. The open question is what it does to amounts that were already carried over. Simplest answer: change history only, never balances. |
| **Refunds / returns** | A negative line credited to a pocket. Probably a `kind: 'refund'` on `createExpense`. The report needs to subtract it. |
| **"Keep" money lost at reset** | From the month-end mockup. A `restore` adjustment, allowed once per pocket per month in the first 7 days. |
| **Report blocks for cards** | `Monthly_Report`: "Spend by payment method" and "Card owed vs paid", both built from Transactions and Adjustments. |
| **CSV statement import (matching only)** | Upload a card statement CSV and list the lines with no matching logged expense. Never store bank credentials. |
