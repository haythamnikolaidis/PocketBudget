# Later (not scheduled; for humans)

These are out of v2 on purpose. Don't start one without the product owner's go-ahead, and turn it
into task files (same template, next free T-numbers) before giving it to the agent.

| Idea | Notes |
|---|---|
| Edit an expense (current month) | An `updateTransaction` action inside the lock: refund the old line and deduct the new one in one step, with the same non-negative check. |
| Edit or delete earlier months | Owner: nice-to-have. Simplest rule: change history only, never balances. |
| Refunds / returns | A negative line credited to a pocket. The report must subtract it. |
| "Keep" money lost at reset | From the month-end mockup: a `restore` adjustment, once per pocket per month, in the first 7 days. |
| Report blocks for cards | `Monthly_Report`: spend by payment method; card owed vs paid. |
| CSV statement import | Match the lines of a statement against logged expenses and list what's missing. Never store bank credentials. |
| Compact "Sam ▾" user picker | A cosmetic change from the Quick add mockup. |
