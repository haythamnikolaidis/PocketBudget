# PocketBudget v2: implementation plan

Start here. This folder is everything you need to build v2. You don't need any context beyond this
page, the task files, and the code.

- **What and why:** [`../RECOMMENDATIONS.md`](../RECOMMENDATIONS.md) (the product review and the
  owner's decisions).
- **What it should look like:** the approved UI mockups:
  https://claude.ai/artifact/5RFSUKgZ2QWi1powXwQkYo (ask the product owner to share it with you).
  Each task names the mockup screen it builds.
- **How to build it:** this page, then the task files in [`tasks/`](tasks/), **in order**.

---

## 1. What we are building

PocketBudget is a phone app for a couple. They split their monthly money into **pockets**
(Groceries, Petrol…), log every expense against a pocket, and the app refuses any expense that
would take a pocket below zero. v2 adds four things:

1. **Leftovers carry over.** At month end, a pocket's leftover rolls into next month, moves to
   another pocket (usually Savings), or resets. Money can also be moved between pockets at any time.
2. **One shop, several pockets.** A single expense can be split across up to 10 pockets. When a
   pocket is short, the app offers to take the difference from another pocket.
3. **Faster entry.** The app remembers your pocket and card, suggests a pocket from the store
   name, lets you log yesterday's coffee, and gives you Undo instead of "Are you sure?".
4. **Credit cards.** Each expense records what paid for it. The app shows what's owed on each card
   and lets you record paying it.

## 2. The ten-minute tour of the code

```
app/                 the phone app (plain JS modules, no framework, no build step)
  index.html         every screen is a <section id="view-…"> in this one file
  js/app.js          wiring: boot, refresh, switching views, click handlers
  js/api.js          talks to the backend. One method per backend action
  js/render.js       home screen HTML (pocket rows, summary ring, activity feed)
  js/addform.js      the "Add an expense" form
  js/manage.js       the pocket management screen
  js/format.js       money formatting / parsing (R1,234.56)
  sw.js              service worker (offline shell). Its cache version is generated
backend/             Google Apps Script, written as ES modules so Node can test it
  00_Config.gs.js    constants, including the ACTIONS list the API accepts
  01_Utils.gs.js     money parsing (always integer CENTS), validation
  02_Auth.gs.js      household token check
  03_Sheets.gs.js    THE ONLY FILE that touches the spreadsheet
  04_Rollover.gs.js  month maths and the month-end rollover (pure functions)
  05_Api.gs.js       one function per API action, plus the dispatcher
  06_Report.gs.js    builds the Monthly_Report sheet
  07_Entry.gs.js     doGet/doPost, the nightly trigger, setup()
tests/               node:test. helpers/ has a fake spreadsheet and fake Apps Script globals
```

**The data lives in one Google Sheet.** Sheet tabs are database tables, rows are records. Today
there are `Pockets`, `Transactions`, and the generated `Monthly_Report`. v2 adds `Adjustments` and
`Accounts`, and a few columns.

**How a request flows:** phone → `app/js/api.js` POSTs `{action, token, …}` → `07_Entry doPost`
→ `05_Api handleRequest` → the handler → `03_Sheets` reads and writes the sheet → JSON comes back.
After any write, the app calls `getState` again to redraw everything.

**Read these files first, in this order** (about an hour): `05_Api.gs.js` `createTransaction`
(the most important function in the app), `03_Sheets.gs.js`, `04_Rollover.gs.js`,
`app/js/addform.js`, then `tests/money-path.test.js` to see how backend tests are written.

## 3. Rules you must not break

These are what make the app trustworthy. Every PR is reviewed against them, and most have tests
already.

1. **A pocket balance never goes below zero.** Every money write re-reads the balance *inside the
   lock* and refuses if it would go negative.
2. **Every write goes inside the script lock, and the lock is released in `finally` via
   `unlock(lock)`** (which flushes first). Copy the shape of `createTransaction`:
   `auth → validate → lock → re-read → check → write → unlock`.
3. **Money is integer cents inside the backend.** Use `parseAmountInput` (returns cents) and
   `toDollars`. Never add floats like `0.1 + 0.2`.
4. **Retries must not double-spend.** Every money-moving action takes a `requestId`; if a row with
   that id already exists, return the original result and change nothing.
5. **The insufficient-funds message is exact:** `Insufficient funds in [Pocket Name]. Remaining:
   R[Balance]`. Reuse the existing `fail('INSUFFICIENT_FUNDS', …)` code.
6. **Only `03_Sheets.gs.js` calls `SpreadsheetApp`.** Handlers call functions in it.
7. **No `innerHTML` with user text.** Names and notes come from a spreadsheet anyone can type into.
   Use `esc()` from `render.js` when building HTML strings, or `textContent`.
8. **Don't change the `text/plain` Content-Type in `api.js`.** See the README for why.
9. **Old phones keep working.** Never remove or rename an existing action or response field; only add.

## 4. How to do a task

1. Read the task file and look at its mockup screen.
2. Create a branch: `git checkout -b v2/NN-short-name`.
3. **Write the backend test first** where there is backend work, then make it pass.
4. Run, before every commit:
   ```bash
   npm run check                 # builds the Apps Script bundle and runs every test
   ```
   If you changed anything in `app/`:
   ```bash
   npm run build:css             # only if you used a Tailwind class not used anywhere before
   node backend/sw-version.mjs   # regenerates the service worker cache version
   ```
   CI fails if either is stale.
5. Try it in the browser: `npm run dev` serves the app at http://localhost:8080. Point it at a
   **test copy** of the Sheet (see §6), never the couple's real one.
6. Open a PR to `master` titled `v2 task NN: …`. Keep it to one task. Fill in "Done when" from
   the task as a checklist.

**Adding a new API action** always touches the same places:

| Where | What |
|---|---|
| `backend/00_Config.gs.js` | add the name to `ACTIONS` |
| `backend/05_Api.gs.js` | write the handler, add it to `HANDLERS` |
| `backend/03_Sheets.gs.js` | any new reads and writes |
| `app/js/api.js` | add a method to the object `makeApi` returns |
| `tests/` | a test file for the handler, and an `api-client` test for the method |

**Adding a new screen:** add a `<section id="view-NAME" class="hidden">` to `app/index.html`, add
`'NAME'` to `VIEWS` in `app/js/app.js`, and open it with `switchView(views, tabs, 'NAME')`. Screens
without a tab (pocket detail, move money, card detail…) need a Back button that goes to `home`.

**Adding a column or a sheet:** add it in `migrateV2()` (task 03). Append new columns to the end of
a sheet; never insert in the middle, because existing code reads by column number.

## 5. Order of work

Each milestone ends with something the couple can use, so ship (deploy) at the end of each one.
Tasks within a milestone go in number order unless the task says otherwise.

| Milestone | Tasks | The couple gets |
|---|---|---|
| **M1: Correct & fast** | 00–03 | Correct balances on the 1st; faster loading; schema ready for v2 |
| **M2: Leftovers & moving money** | 04–10 | Carry-over, Savings, Move money, month-end card, pocket detail |
| **M3: Faster entry & splits** | 11–16 | Remembered choices, store suggestions, splits, shortfall cover, undo |
| **M4: Credit cards** | 17–20 | Paid-with, card view, mark paid |
| **Later** (only if asked) | 21 | Edit expense, refunds, edits to earlier months |

| # | Task | Size |
|---|---|---|
| 00 | [Get set up and learn the code](tasks/00-orientation.md) | S |
| 01 | [Fix the rollover timing bug](tasks/01-rollover-timing-fix.md) | M |
| 02 | [Read only this month's transactions in getState](tasks/02-bounded-reads.md) | S |
| 03 | [`migrateV2()`: one place for schema changes](tasks/03-migration.md) | S |
| 04 | [Adjustments sheet + `transferFunds` API](tasks/04-transfers-api.md) | M |
| 05 | [Move money screen](tasks/05-move-money-ui.md) | S |
| 06 | [Leftover rules in the rollover](tasks/06-leftover-rules.md) | M |
| 07 | [Leftover rule on the pocket form](tasks/07-pocket-form-rule.md) | S |
| 08 | [Home: carried-in bars, Savings section](tasks/08-home-carry-display.md) | S |
| 09 | [Month-end card](tasks/09-month-end-card.md) | M |
| 10 | [Pocket detail screen](tasks/10-pocket-detail.md) | M |
| 11 | [Quick wins on the add form](tasks/11-addform-quick-wins.md) | M |
| 12 | [Store name → pocket suggestions](tasks/12-merchant-suggestions.md) | S |
| 13 | [`createExpense` API (multi-pocket)](tasks/13-create-expense-api.md) | M |
| 14 | [Split screen](tasks/14-split-ui.md) | M |
| 15 | [Cover the shortfall](tasks/15-cover-shortfall.md) | S |
| 16 | [Activity: grouped splits, group delete, Undo](tasks/16-activity-grouping-undo.md) | M |
| 17 | [Accounts sheet + "paid with" on expenses](tasks/17-accounts-paid-with-api.md) | M |
| 18 | [Paid-with chips + Accounts screen](tasks/18-paid-with-ui.md) | M |
| 19 | [Cards on Home + card detail](tasks/19-card-view.md) | M |
| 20 | [Mark statement paid](tasks/20-mark-paid.md) | M |
| 21 | [Later: edit, refunds, earlier months](tasks/21-later.md) | — |

S = about a day, M = two to four days, for someone new to the code.

## 6. Test Sheet, deploying and checking a milestone

**Never develop against the couple's real Sheet.** Make a copy: open the real Sheet → File → Make a
copy. The copy gets its own Apps Script project. Follow [`../DEPLOYMENT.md`](../DEPLOYMENT.md)
sections 2–5 for the copy and use that URL and token in `npm run dev`.

**Shipping a milestone** (the product owner does this, or you do it with them):

1. Merge the milestone's PRs to `master`. GitHub Pages publishes `app/` automatically.
2. Download the `Backend.bundle.gs` artifact from the CI run, paste it into the **real** Apps Script
   project, then **Deploy → Manage deployments → ✏️ → New version**. Skipping "new version" is the
   most common reason a fix "doesn't work". See [`../DEPLOYMENT.md`](../DEPLOYMENT.md).
3. Run `migrateV2()` once from the Apps Script editor (it is safe to run again).
4. Bump `SERVER_VERSION` in `backend/00_Config.gs.js` and `CLIENT_VERSION` in `app/js/app.js`
   together (`2.1.0` for M1, `2.2.0` for M2, and so on), so a phone with an old cached app shows
   the "update available" banner.
5. Run [`../SMOKE_TEST.md`](../SMOKE_TEST.md) plus the milestone checks listed at the bottom of
   that milestone's last task. Each task that adds behaviour also adds its steps to the smoke test.

## 7. Keep it simple

- Build what the task says. If something seems missing or wrong, **ask** before building more.
- Prefer one more column or one more small function over a clever abstraction.
- The mockups are the target for layout and wording. Where a task says it deliberately does less
  than the mockup, follow the task.
- If you're stuck for more than an hour, write down what you tried and ask.
