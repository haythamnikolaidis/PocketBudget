# v2 progress

The source of truth for what's done. The agent updates the **Status** column in the same commit as
the task's code (see `README.md` §2).

Status values: `todo` · `doing` (a `wip` commit exists; see HANDOFF.md) · `done`.
Type `HUMAN` = the agent stops there and a person deploys and checks the milestone.

| ID | Task | Milestone | Type | Status |
|---|---|---|---|---|
| T01 | [Move the rollover into a reusable `rolloverIfDue()`](tasks/T01-extract-rollover.md) | M1 | backend | done |
| T02 | [Run the rollover before every write](tasks/T02-rollover-in-writes.md) | M1 | backend | done |
| T03 | [Roll over on the first read of a month; trigger at midnight](tasks/T03-rollover-in-getstate.md) | M1 | backend | done |
| T04 | [Add `readRecentTransactions()`](tasks/T04-read-recent-transactions.md) | M1 | backend | done |
| T05 | [Use `readRecentTransactions` in `getState`](tasks/T05-getstate-recent.md) | M1 | backend | done |
| T06 | [Schema: new headers, new sheets, `migrateV2()`](tasks/T06-schema-sheets.md) | M1 | backend | done |
| T07 | [Pocket defaults + v2 fields in `readPockets`](tasks/T07-pocket-v2-fields.md) | M1 | backend | done |
| T08 | [M1 release prep](tasks/T08-m1-release.md) | M1 | docs | done |
| T09 | [HUMAN: deploy and check M1](tasks/T09-m1-human.md) | M1 | HUMAN | done |
| T10 | [Adjustments sheet reads and writes](tasks/T10-adjustments-io.md) | M2 | backend | done |
| T11 | [`transferFunds` API action](tasks/T11-transfer-api.md) | M2 | backend | done |
| T12 | [`getState` returns this month's adjustments](tasks/T12-getstate-adjustments.md) | M2 | backend | done |
| T13 | [Move money: pure logic module](tasks/T13-move-logic.md) | M2 | frontend | done |
| T14 | [Move money screen](tasks/T14-move-screen.md) | M2 | frontend | done |
| T15 | [Leftover rules in `applyRollover` (pure)](tasks/T15-rollover-rules-pure.md) | M2 | backend | done |
| T16 | [Write leftover results during rollover](tasks/T16-rollover-persist.md) | M2 | backend | done |
| T17 | [Pocket rule in `createPocket` / `updatePocket`](tasks/T17-pocket-rule-api.md) | M2 | backend | done |
| T18 | [`migrateV2` creates the Savings pocket](tasks/T18-savings-pocket.md) | M2 | backend | done |
| T19 | [Stop capping balances at the monthly limit](tasks/T19-remove-clamps.md) | M2 | backend+frontend | done |
| T20 | [v2 fields in the API pocket object and summary](tasks/T20-present-pocket-v2.md) | M2 | backend | done |
| T21 | [Leftover rule on the pocket form](tasks/T21-manage-rule-form.md) | M2 | frontend | done |
| T22 | [Show the rule in the pocket list and in edit mode](tasks/T22-manage-rule-list.md) | M2 | frontend | done |
| T23 | [Home: carried-in bar segment and pills](tasks/T23-home-bars.md) | M2 | frontend | done |
| T24 | [Home: Savings section and summary line](tasks/T24-home-savings.md) | M2 | frontend | done |
| T25 | [`getState.monthEnd`](tasks/T25-monthend-api.md) | M2 | backend | done |
| T26 | [Month-end card on Home](tasks/T26-monthend-card.md) | M2 | frontend | done |
| T27 | [Month-end review screen](tasks/T27-monthend-review.md) | M2 | frontend | done |
| T28 | [`getPocket` API action](tasks/T28-getpocket-api.md) | M2 | backend | done |
| T29 | [Pocket detail screen](tasks/T29-pocket-detail.md) | M2 | frontend | done |
| T30 | [M2 release prep](tasks/T30-m2-release.md) | M2 | docs | done |
| T31 | [HUMAN: deploy and check M2](tasks/T31-m2-human.md) | M2 | HUMAN | todo |
| T32 | [Add form remembers each person's last pocket](tasks/T32-remember-pocket.md) | M3 | frontend | todo |
| T33 | [`txnCount` on each pocket](tasks/T33-txn-count.md) | M3 | backend | todo |
| T34 | [Pocket chips on the add form](tasks/T34-pocket-chips.md) | M3 | frontend | todo |
| T35 | [Backdated expenses (backend)](tasks/T35-expense-date-api.md) | M3 | backend | todo |
| T36 | ["When" chips on the add form](tasks/T36-when-chips.md) | M3 | frontend | todo |
| T37 | [Home-screen "Add expense" shortcut](tasks/T37-add-shortcut.md) | M3 | frontend | todo |
| T38 | [`getState.merchants`](tasks/T38-merchants-api.md) | M3 | backend | todo |
| T39 | [Store-name suggestions on the add form](tasks/T39-merchant-suggest.md) | M3 | frontend | todo |
| T40 | [Transactions: batch append, Group ID and Paid With fields](tasks/T40-txn-batch-io.md) | M3 | backend | todo |
| T41 | [`createExpense` API action](tasks/T41-create-expense-api.md) | M3 | backend | todo |
| T42 | [`createTransaction` uses the shared expense code](tasks/T42-create-txn-delegate.md) | M3 | backend | todo |
| T43 | [Split: pure model](tasks/T43-split-model.md) | M3 | frontend | todo |
| T44 | [Split screen](tasks/T44-split-screen.md) | M3 | frontend | todo |
| T45 | [Cover the shortfall: pure logic](tasks/T45-shortfall-model.md) | M3 | frontend | todo |
| T46 | [Cover the shortfall: UI](tasks/T46-shortfall-ui.md) | M3 | frontend | todo |
| T47 | [`getState.feed`](tasks/T47-feed-api.md) | M3 | backend | todo |
| T48 | [Delete a whole split](tasks/T48-delete-group-api.md) | M3 | backend | todo |
| T49 | [Activity feed: grouped splits, transfers, filters](tasks/T49-feed-render.md) | M3 | frontend | todo |
| T50 | [Undo instead of confirm on delete](tasks/T50-undo-delete.md) | M3 | frontend | todo |
| T51 | [M3 release prep](tasks/T51-m3-release.md) | M3 | docs | todo |
| T52 | [HUMAN: deploy and check M3](tasks/T52-m3-human.md) | M3 | HUMAN | todo |
| T53 | [Accounts sheet I/O and first-time seeding](tasks/T53-accounts-io.md) | M4 | backend | todo |
| T54 | [`createAccount` / `updateAccount` + `getState.accounts`](tasks/T54-accounts-api.md) | M4 | backend | todo |
| T55 | ["Paid with" on expenses (backend)](tasks/T55-paid-with-api.md) | M4 | backend | todo |
| T56 | ["Paid with" chips on the add form](tasks/T56-paid-with-addform.md) | M4 | frontend | todo |
| T57 | ["Paid with" in split mode, and account names in lists](tasks/T57-paid-with-split-labels.md) | M4 | frontend | todo |
| T58 | [Accounts screen: list, type, card fields](tasks/T58-accounts-screen.md) | M4 | frontend | todo |
| T59 | [Accounts screen: add, archive, first-run banner](tasks/T59-accounts-screen-2.md) | M4 | frontend | todo |
| T60 | [Card statement cycles (pure)](tasks/T60-cards-cycles.md) | M4 | backend | todo |
| T61 | [Card summary (pure)](tasks/T61-cards-summary.md) | M4 | backend | todo |
| T62 | [`getState.cards` and `getCard`](tasks/T62-cards-api.md) | M4 | backend | todo |
| T63 | [Cards section on Home](tasks/T63-cards-home.md) | M4 | frontend | todo |
| T64 | [Card detail screen](tasks/T64-card-detail.md) | M4 | frontend | todo |
| T65 | [`recordCardPayment` API action](tasks/T65-card-payment-api.md) | M4 | backend | todo |
| T66 | [Mark statement paid screen](tasks/T66-mark-paid-screen.md) | M4 | frontend | todo |
| T67 | [M4 release prep](tasks/T67-m4-release.md) | M4 | docs | todo |
| T68 | [HUMAN: deploy and check M4](tasks/T68-m4-human.md) | M4 | HUMAN | todo |
