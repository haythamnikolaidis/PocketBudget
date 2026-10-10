# PocketBudget — Product Review & Recommendations

> Status: **Proposal.** Written against `master` at `535af4f`. Nothing here is built yet.
> Where a recommendation changes the contract in [`PRODUCT_BRIEF.md`](./PRODUCT_BRIEF.md), it
> says so, so the brief can be amended before the work starts.

The v1 app works well on the path it was built for: one expense, one pocket, one month. It is
fast, both phones see the same numbers, and the server will not let a pocket go negative. Those
guarantees are worth keeping, and nothing below weakens them.

Real household spending doesn't look like that path. This review covers the two gaps the owner
raised, one correctness bug found while reviewing them, and the smaller sources of friction that
add up over a month of daily use.

---

## TL;DR — what to build, in order

| # | Recommendation | Why | Size |
|---|---|---|---|
| 0 | **Fix the rollover timing bug** | Spending between midnight and the 02:00 trigger on the 1st is wiped from the new month's balance | S |
| 1 | **Pocket-to-pocket transfers + an Adjustments ledger** | Needed by both features below; it also removes today's limit-editing workaround | M |
| 2 | **Leftover rules per pocket (Reset / Carry / Sweep) + a month-end review card** | Leftover money is currently forfeited without anyone being told | M |
| 3 | **Multi-pocket expenses (split one purchase across pockets)** | One shop = one entry instead of N entries with the note retyped | M |
| 4 | **"Cover the shortfall" on insufficient funds** | Turns the hard block from a dead end into one tap, and no pocket goes negative | S (once 3 exists) |
| 5 | Quick wins: remembered pocket, merchant → pocket suggestions, undo, edit, backdate, refunds | Each one saves seconds on the path the product is judged on | S each |
| 6 | Keep `getState` fast as the sheet grows | Every refresh reads the whole Transactions sheet, so the 5-second goal gets harder every month | S |

---

## 0. Bug: the rollover can wipe out the first hours of a month

**Where:** `backend/07_Entry.gs.js` `dailyRollover()`, `backend/04_Rollover.gs.js` `applyRollover()`,
`backend/07_Entry.gs.js` `setup()` (`.atHour(2)`).

Month boundaries use household-local time (`monthKey`), so an expense logged at 00:30 on the 1st
counts toward the **new** month. But the balance reset only happens when the daily trigger fires
around 02:00, and `applyRollover` then sets `balance = limit` without checking anything. So:

1. **00:30, 1 Nov:** Sam spends R200 on Groceries. It is deducted from **October's** leftover
   balance. If October's Groceries was already empty, Sam is wrongly blocked.
2. **~02:00:** the rollover sets Groceries back to the full limit. The R200 is gone from the
   balance, but `getState` still reports it as November spending. From then on, `balance` and
   `spent` disagree for the whole month.
3. If the trigger fails to get the lock, it throws and next runs **24 hours later**, so a whole
   day of spending is forgiven. The code comment calls this "self-healing"; it actually loses a
   day of deductions.

**Fix, which leftover rules (§2) need anyway:**

- **Roll over lazily, inside the lock.** At the start of every locked write (`createTransaction`,
  `deleteTransaction`, transfers), and in `getState`, check `LAST_ROLLOVER_KEY` against
  `monthKey(now)`. If the month has changed, roll over first, under the same lock. The nightly
  trigger stays as a backup for months when nobody opens the app.
- **Compute the opening balance; don't overwrite it:**
  `opening = limit + carriedIn − (spend already recorded in the new month)`. Then a late rollover
  can never forgive spending.
- Add a test for exactly this scenario: an expense at 00:30 on the 1st, then the rollover at 02:00.

> The brief's success criterion 6 ("the rollover restores every active pocket to its full monthly
> limit") stays true for **Reset** pockets. For the others, it needs rewording; see §2.

---

## 1. Foundation: transfers and an Adjustments ledger

Today, the only way to move money between pockets is to **edit the monthly limits**: lower
Entertainment, raise Groceries. That permanently changes both budgets for every future month,
because `balanceAfterLimitChange` moves the balance with the limit, and nothing records why the
balance changed. Carry-over (§2) and month-end sweeps also need a way to move money. Build that
mechanism once.

**New sheet, `Adjustments`** (append-only, one row per money movement that isn't an expense):

| Adj ID | Timestamp | User | Month | Type | From Pocket | To Pocket | Amount | Note | Request ID |
|---|---|---|---|---|---|---|---|---|---|
| A1001 | 2026-10-14 19:02 | Alex | 2026-10 | `transfer` | P04 | P01 | 200.00 | Big braai | … |
| A1002 | 2026-11-01 00:05 | system | 2026-11 | `carry` | — | P01 | 120.00 | Oct leftover | … |
| A1003 | 2026-11-01 00:05 | system | 2026-11 | `sweep` | P02 | P09 | 45.00 | Oct leftover | … |
| A1004 | 2026-11-01 00:05 | system | 2026-11 | `forfeit` | P03 | — | 30.00 | Oct leftover | … |

**New action, `transferFunds { fromPocketId, toPocketId, amount, note, requestId }`:**
auth → validate → lock → (lazy rollover) → re-read both balances → refuse if `from` would go
negative (same `INSUFFICIENT_FUNDS` envelope and verbatim text) → append the Adjustments row →
write both balances → roll back on failure. This is the same order and the same idempotency
scheme as `createTransaction`, so it can reuse its helpers.

**UI:** a "Move money" action on a pocket row, and the shortfall prompt in §4.

Why a ledger, not just balance writes: the balance is a single mutable cell. Without a record,
neither spouse can answer "why does Groceries have R1,320 when its limit is R1,200?" The report
can also total the ledger, for example "R310 rolled forward, R30 forfeited this year".

---

## 2. Leftover money at month end

### The problem

`applyRollover()` resets every active pocket to its limit. Whatever was left is silently
forfeited. For a couple, that's the wrong default in at least three common cases:

- **Sinking funds:** car service, birthdays, school fees, annual insurance. You set aside R500 a
  month for a R6,000 bill. Today that pattern is impossible, because the pocket never holds more
  than R500.
- **Lumpy categories:** a Groceries pocket that is R80 under in October because of a big shop on
  30 September. The R80 belongs to November.
- **Rewarding discipline:** money left in Dining Out could go to a savings or holiday pocket. Losing
  it gives the couple a reason to spend it before the 1st.

### Recommendation: a per-pocket leftover rule

Each pocket gets **At month end** with three options:

| Rule | What happens to the leftover | Good for |
|---|---|---|
| **Reset** (today's behaviour) | Forfeited. Balance = limit. | Strict monthly allowances |
| **Carry over** (optional cap) | Added to next month. Balance = limit + leftover, capped at `limit × cap` (e.g. 2×) if a cap is set. Cap overflow is swept or forfeited. | Groceries, sinking funds (no cap) |
| **Sweep to…** another pocket | Moved to a named pocket (e.g. "Savings" or "Holiday"). This pocket resets. | Discretionary pockets |

**Defaults:** existing pockets stay on **Reset**, so nothing changes for a household until they
opt in. The create-pocket form asks the question with **Carry over** pre-selected, which is what
most households expect.

**Pockets sheet:** append columns `G Leftover Rule`, `H Sweep To`, `I Carry Cap`, `J Carried In`.
Columns are appended, so existing rows and every current read (`readPockets` uses A–F) keep working.

### The month-end review card (where the friction is actually removed)

A settings toggle alone doesn't help much, because couples don't think about leftovers until the
month turns over. So on the **first app open of a new month**, show a dismissible card at the top
of Home:

```
October wrapped up                                   ✕
R 1,240 left over across 6 pockets
  Groceries      R 120   → carried into November
  Dining Out     R  45   → swept to Holiday
  Petrol         R  30   → reset (forfeited)          [Keep it instead]
[ Review ]
```

- Every line says what the rule **did**, so nothing happens silently.
- **One-tap overrides for the first 7 days** ("Keep it instead", "Move to Holiday"), done as
  ordinary `transfer` / `carry` rows in the Adjustments ledger. Because the rollover already
  wrote the ledger rows, an override is just one more row, never an edit.
- Seen-state lives per device in `localStorage`, so each spouse sees the card once.

### Code that assumes `balance ≤ limit` and has to change

Carry-over breaks the assumption `balance ≤ limit`. Introduce **`available = limit + carriedIn`**
and use it in these places:

| Location | Today | Change to |
|---|---|---|
| `04_Rollover applyRollover` | `balance = limit` | per rule; see §0 for the formula |
| `05_Api deleteTransaction` | refund clamps to `pocket.limit` | clamp to `available` |
| `05_Api updatePocket` (unarchive) | `limit − spent` | `available − spent` |
| `01_Utils balanceAfterLimitChange` | clamps to the new limit | clamp to `newLimit + carriedIn` |
| `05_Api presentPocket` | `pctUsed = spent / limit` | `spent / available`; also return `carriedIn` and `available` |
| `06_Report buildReport` | Remaining = `limit − spent` | `available − spent`; add a "Carried In" column; run rate against `available` |
| `render.js leftPct` / bar | bar = `balance / limit`, clamped to 100% | bar = `balance / available`; show the carried part as a different shade so a "R1,320 of R1,200" pocket isn't confusing |

**Brief changes:** §4A *Monthly Rollover*: "reset balances to full limit" becomes "apply each
pocket's leftover rule". Success criterion 6 becomes "the rollover gives every active pocket its
limit plus whatever its leftover rule carries in, and never forgives spending already recorded
in the new month". **Zero Negative Balances is unaffected**, because carry is always ≥ 0. A
deficit carry-over is deliberately left out: overspending can't happen by design.

---

## 3. One purchase, several pockets (split expenses)

### The problem

A R1,240 shop at Checkers covers groceries, toiletries, and a birthday card. Today that means
three passes through the form: amount, pick a pocket, retype "Checkers", submit, three times.
The three rows have no link to each other, so deleting the shop means finding and deleting three
rows, and each delete has its own confirm dialog. Couples will skip the split and dump the whole
amount into one pocket, which makes the budget wrong.

### Recommendation: a multi-line expense, all-or-nothing

**API: new action `createExpense`.** `createTransaction` stays as a one-line wrapper so phones
running the cached old frontend keep working.

```jsonc
{
  "action": "createExpense",
  "user": "Sam",
  "note": "Checkers",
  "requestId": "…",
  "lines": [
    { "pocketId": "P01", "amount": "900" },
    { "pocketId": "P07", "amount": "290" },
    { "pocketId": "P05", "amount": "50" }
  ]
}
```

Server, under **one** lock:

1. Validate every line (1–10 lines, amounts > 0, pockets active). Duplicate pockets are merged.
2. Lazy rollover check (§0). Re-read all balances.
3. Check **every** line before writing anything. If any pocket is short, return the usual
   `INSUFFICIENT_FUNDS` envelope with the brief's verbatim message for the first short pocket,
   plus a `shortfalls: [{ pocketId, remaining, amount }]` array so the UI can offer fixes for
   all of them at once. **No balance changes.**
4. Append every row in **one** `setValues` call (not N `appendRow`s; each Sheets call costs
   ~100–300 ms on the hot path). Then write the balances. If anything fails, delete the rows
   and restore the balances, as `createTransaction` does today.
5. Idempotency: the same `requestId` is written on every line, so a retry finds the group and
   returns the original result.

**Transactions sheet:** append column `H Group ID`. Each line stays a normal Transactions row,
so **the report, the spouse split, month-over-month totals and every existing reader need no
changes**. That is the main reason to model splits as grouped rows rather than as a new
"receipt" entity.

### The UI

The single-pocket form stays the default. Most expenses aren't splits, and that path is the one
that has to stay under 5 seconds.

```
Amount          [ R 1,240.00 ]          ← total first, as on the slip
Note            [ Checkers   ]
──────────────────────────────────────
Groceries   R 900.00   (R1,100 left)  ✕
Toiletries  R 290.00   (R  310 left)  ✕
Gifts       R  50.00   (R  200 left)  ✕
──────────────────────────────────────
R 0.00 to allocate ✓
+ [Household] [Dining] [Kids] …        ← chips: one tap adds a line
[ Save R1,240 across 3 pockets ]
```

- **"Split" link** under the pocket picker turns the selected pocket into the first line.
- **Tapping a chip adds a line pre-filled with whatever is still unallocated**, capped at that
  pocket's balance, so most splits are type the total → tap chips → adjust one number → save.
- The last line can be set to **"the rest"**, so you don't have to do the arithmetic.
- Save is enabled only when the lines add up to the total. Each line shows its pocket's live
  balance, and a line over its balance turns red before submission, just like today's locked
  pocket.
- After saving, the form resets to single-pocket mode with the first pocket still selected.

### Activity feed and delete

- Lines with the same Group ID show as **one row**: "Checkers · R1,240 · Groceries, Toiletries,
  Gifts". Tap to expand.
- Delete removes the **whole group** in one locked call (`deleteExpense { groupId }`), refunding
  every pocket together. Deleting a single line stays possible from the expanded view.
- The feed currently returns the newest 10 **rows**, so one 4-way split would push 3 other
  expenses off the screen. Change it to the newest 10 **expenses** (groups).

---

## 4. "Cover the shortfall": make the hard block useful

The block on overspending is the product's core rule, and it stays. But today, when Groceries
has R340 and the shop is R400, the user hits a dead end: the submit button is disabled (or the
server rejects with the verbatim alert), and they have to work out the fix themselves.

With §3 in place, when the typed amount is more than the selected pocket's balance, show this
instead of just a disabled button:

```
Groceries only has R340.00.
Take the other R60.00 from:  [Household R200]  [Dining Out R85]  [Split manually]
```

One tap turns it into a two-line split (R340 + R60) and submits. No pocket goes negative, both
pockets show what happened, and the couple has made a visible choice instead of fudging it. If
the other phone spends first, the server still refuses with the exact brief text, and the form
reloads balances as it does today (`onStale`).

---

## 5. Quick wins on the 5-second path

Each of these is small on its own. Together they cut the time and the taps of most entries.

| # | Change | Today | Where |
|---|---|---|---|
| 5a | **Remember the last pocket per user** (localStorage, like `pb.user`) | A cold start defaults to the first pocket with money, so most entries begin by changing the pocket | `addform.js renderOptions` |
| 5b | **Merchant suggestions:** a `<datalist>` of recent notes; choosing one pre-selects the pocket last used with that merchant ("Engen" → Petrol) | The note is typed from scratch, then the pocket picked separately | `addform.js`; data comes from the transactions `getState` already loads |
| 5c | **Pocket chips for the 4 most-used pockets** above the `<select>` | Picking a pocket means a native dropdown of every pocket | `addform.js` |
| 5d | **Undo instead of confirm on delete:** delete straight away, then show a 6-second "Deleted · Undo" toast | A blocking `confirm()` on every delete | `app.js` activity click handler |
| 5e | **Edit an expense** (amount, pocket, note) as one locked call | The only fix is delete, then re-enter | new `updateTransaction` action |
| 5f | **Backdate within the current month** ("Yesterday", or a date picker), checked server-side: same month, not in the future | Server-stamped "now" only, so yesterday's forgotten coffee is recorded as today | `createTransaction` / `createExpense` |
| 5g | **Refunds/returns:** a "Refund" toggle that credits a pocket (capped at `available`), recorded as a negative line | Returns can't be recorded; deleting the original is wrong if only part was returned | `createExpense` with `kind: 'refund'` |
| 5h | **Pocket detail:** this month's expenses for one pocket (long-press or chevron on a row) | Only the last 10 expenses across all pockets are visible in the app | `render.js` plus a `getPocketActivity` action |
| 5i | **Home-screen shortcut** "Add expense" via manifest `shortcuts` + a `?view=add` deep link | Every entry starts on Home | `manifest.webmanifest`, `app.js` boot |

---

## 6. Keep the refresh fast as the data grows

`getState` calls `readTransactions()`, which reads **every row ever recorded**, maps and sorts it,
all to get 10 feed rows and this month's per-pocket spend. At ~150 expenses a month that is
~1,800 rows a year, and the cost lands on every refresh and directly on the "under 5 seconds from
cold start" criterion.

The server stamps every row in order, so the sheet is already chronological. **Read from the
bottom up in chunks until a row from an earlier month appears.** That is one or two small range
reads instead of the whole sheet. The report job (nightly) can still read everything. Splits
(§3) and the ledger (§1) make this matter more, because they add rows.

---

## Suggested delivery plan

| Release | Contents | Notes |
|---|---|---|
| **1.1 — Correct** | §0 rollover fix, §6 bounded reads | Bug fix plus performance; no user-visible change except correct numbers on the 1st |
| **1.2 — Fast** | §5a–5d, 5i | Frontend only; no API or schema change |
| **1.3 — Flexible money** | §1 transfers + ledger, §2 leftover rules + month-end card | Schema: Pockets G–J, new Adjustments sheet. `setup()` adds them idempotently, the same way it already adds the Request ID header |
| **1.4 — Real shops** | §3 split expenses, §4 cover the shortfall, grouped feed | Schema: Transactions H. Keep `createTransaction` for old clients; bump `SERVER_VERSION` so the stale-client banner shows |
| **1.5 — Corrections** | §5e edit, 5f backdate, 5g refunds, 5h pocket detail | |

Invariants that every release must keep, with tests: auth before any read; no balance ever below
zero; every write under the script lock and flushed before release; every retry idempotent via
`requestId`; the insufficient-funds message exactly as the brief words it.

---

## Open questions for the product owner

1. **Default leftover rule for new pockets:** Carry over (recommended) or Reset?
2. **Carry cap:** is a cap needed at all in v1, or is "Carry (no cap)" vs "Reset" enough?
3. **Sweep target:** should "Savings" be a real spendable pocket, or a non-spendable "Saved"
   total shown on Home?
4. **Split limits:** is 10 lines per expense enough? (A big monthly shop rarely touches more than 5 pockets.)
5. **Edits after month end:** may a previous month's expense be edited or deleted? Today a delete
   is allowed but doesn't refund. With carry-over it arguably should adjust the carried amount.
   Recommendation: lock earlier months against edits, and allow delete only as a history fix.
