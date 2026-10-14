# PocketBudget v2: runbook for the coding agent

> **Prompt to start or restart the agent** (the same prompt every time):
> *"Read `docs/v2/README.md` and follow it. Work through `docs/v2/PROGRESS.md` one task at a time
> until you reach a HUMAN task or run low on budget."*

You are building v2 of PocketBudget one small task at a time. Sessions can end at any moment
(token limit, container reset), so every task is **atomic**: one task = one commit, and progress is
recorded in git, not in your memory.

**Files you use:**
- `docs/v2/PROGRESS.md`: the task list and its status. This is the source of truth.
- `docs/v2/tasks/TNN-*.md`: one file per task, holding everything that task needs.
- `docs/v2/HANDOFF.md`: exists only while a task is half done.
- `docs/v2/mockups/*.html`: the approved screen designs, a reference for layout and wording.
- `docs/v2/LATER.md`: ideas that are out of scope. Never build them.

Don't read `docs/RECOMMENDATIONS.md`, `docs/IMPLEMENTATION_PLAN.md` or the other docs unless a task
tells you to. Everything you need is here and in the task file.

---

## 1. Start of every session (always, in this order)

```bash
git status --porcelain
git log --oneline -1
cat docs/v2/HANDOFF.md 2>/dev/null
grep -nE '\| (todo|doing) ' docs/v2/PROGRESS.md | head -3
```

Then decide:

| What you see | Do |
|---|---|
| Clean tree, last commit is `v2(T…)` or anything else, no HANDOFF | Start the first `todo` task in PROGRESS.md |
| Last commit starts with `wip(T…)`, HANDOFF.md exists | Resume that task from HANDOFF.md (§4) |
| Dirty tree (uncommitted changes) | Recover (§4) |
| The first open task has type `HUMAN` | **Stop.** Report: "Milestone ready for human checkpoint TNN." Do nothing else |

## 2. Doing a task

1. Read §5 (Rules) once per session, then **only** your task file.
2. Read only the code the task's **Read** list names. Find things with `grep -n`, and read with an
   offset and limit; don't read whole large files. `app/js/app.js` is over 1,000 lines; never read
   it whole.
3. Make the change described under **Change**, then write the tests listed under **Tests**.
4. Run the task's **Verify** commands until they pass. The last one is always `npm run check`
   (builds the bundle, stamps the service-worker version, and runs every test).
5. Edit `docs/v2/PROGRESS.md`: set the task's status to `done`. Delete `docs/v2/HANDOFF.md` if it
   exists.
6. Commit and push:
   ```bash
   git add -A && git commit -m "<the Commit line from the task>" && git push
   ```
7. If you still have plenty of budget, go back to §1 for the next task. Otherwise stop cleanly.

**One task, one `v2(…)` commit.** Never put two tasks in one commit. Never commit failing tests
under a `v2(…)` message.

## 3. When you're running low on budget

Stop starting new work while you still have room for these steps:

1. Write `docs/v2/HANDOFF.md`:
   ```
   Task: T14
   Done: applyRollover handles Carry and Reset; tests for both pass.
   Left: Sweep rule + broken-target fallback; tests "two pockets sweep into one", "cents exact".
   Failing now: none (or the test names)
   Next command: node --test tests/rollover.test.js
   ```
2. Set the task's status to `doing` in PROGRESS.md.
3. `git add -A && git commit -m "wip(T14): <one line>" && git push`. A WIP commit may contain
   failing tests; that's what the `wip` prefix means.

## 4. Recovery

- **Last commit is `wip(TNN)`:** read HANDOFF.md and continue from "Left". When you finish, commit
  `v2(TNN): …` as normal. The wip commit stays in history; that's fine.
- **Dirty tree, no HANDOFF** (the last session died without warning):
  1. Run the task's **Done-check** and **Verify**. If both pass, the work is finished: do steps
     5–6 of §2.
  2. Otherwise run `git diff --stat`. If under about 150 changed lines, read the diff and carry on.
  3. If it's bigger or confusing, run `git stash push -u -m "abandoned TNN"` and start the task again
     from a clean tree. Tasks are small enough to redo.
- **Never** run `git push --force`, `git reset --hard` on pushed commits, or amend pushed commits.

## 5. Rules (never break these)

1. **No pocket balance below zero.** Every money write re-reads the balance **inside the lock** and
   refuses if the result would be negative.
2. **The lock pattern.** Every handler that writes follows `createTransaction` in
   `backend/05_Api.gs.js`: `verifyToken → validate → lock.tryLock → (rolloverIfDue) → re-read →
   check → write → finally unlock(lock)`. `unlock` flushes before releasing.
3. **Money is integer cents in the backend.** `parseAmountInput()` returns cents and `toDollars()`
   converts back. Never add floats together.
4. **Retries never double-spend.** Every money-moving action takes a `requestId`. If a row with
   that id exists, return the original result with `duplicate: true` and write nothing.
5. **The insufficient-funds text is exact:** `Insufficient funds in ${name}. Remaining:
   ${money(balanceCents)}`, returned through `fail('INSUFFICIENT_FUNDS', …)`, as `createTransaction`
   does. Copy that code; don't reword it.
6. **Only `backend/03_Sheets.gs.js` touches `SpreadsheetApp`** (except the `flush` inside
   `flushWrites`).
7. **No `innerHTML` with user text.** Use `esc()` from `app/js/render.js` when building HTML
   strings, or `textContent`.
8. **Don't touch** the `text/plain` Content-Type in `app/js/api.js`, the generated `backend/*.gs`
   files, `package.json` dependencies (there are none; keep it that way), `docs/RECOMMENDATIONS.md`,
   or `docs/v2/mockups/`.
9. **Old phones keep working.** Never remove or rename an existing API action or response field;
   only add new ones.
10. **CSS:** CI rebuilds Tailwind and fails if `app/tailwind.css` changes, and you can't rebuild it
    offline. So only use Tailwind classes that already exist (`grep -c 'the-class' app/tailwind.css`
    must be > 0). For anything else, add plain CSS to `app/styles.css` with a `pb-` class prefix.
11. **Don't weaken existing tests.** If an existing test conflicts with your task, the task file
    says so explicitly. If it doesn't, stop, write HANDOFF.md explaining the conflict, and commit
    `wip`.
12. **Put frontend logic in small exported pure functions** and test those. Keep DOM wiring thin.

## 6. Project map

```
app/index.html     every screen is a <section id="view-NAME" class="hidden">
app/js/app.js      boot(); VIEWS list; switchView(views, tabs, name); refresh(); renderState()
app/js/api.js      makeApi(): one method per backend action
app/js/render.js   home HTML: pocketRowHtml, summaryHtml, activityRowHtml, esc()
app/js/addform.js  add-expense form: mountAddForm()
app/js/manage.js   pocket management: mountManage()
app/js/format.js   formatMoney, parseAmountText, isValidAmount
backend/00_Config.gs.js    SHEETS, ACTIONS, SERVER_VERSION, limits
backend/01_Utils.gs.js     parseAmountInput (→cents), toDollars, money(cents), ok, fail, isValid*
backend/02_Auth.gs.js      verifyToken, getUsers
backend/03_Sheets.gs.js    all sheet reads and writes
backend/04_Rollover.gs.js  monthKey, localParts, shouldRollover, applyRollover (pure)
backend/05_Api.gs.js       handlers + HANDLERS map + handleRequest
backend/06_Report.gs.js    Monthly_Report
backend/07_Entry.gs.js     doGet/doPost, dailyRollover, setup()
tests/helpers/             fakeSheet.js, fixtures.js (freshWorkbook), appsScriptGlobals.js, fakeBrowser.js
```

The household timezone is **UTC+2** (South Africa). `monthKey(date)` gives `YYYY-MM` in household time.

### Recipes

**A new API action:** add the name to `ACTIONS` (00_Config); write the handler and add it to
`HANDLERS` (05_Api); add sheet I/O in 03_Sheets; add a method to `makeApi` (app/js/api.js); test the
handler, plus one line in `tests/api-client.test.js` if that file covers each method.

**A new screen:** add `<section id="view-NAME" class="hidden">` to `app/index.html`; add `'NAME'`
to `VIEWS` in `app/js/app.js`; open it with `switchView(views, tabs, 'NAME')`. Screens without a tab
need a Back button that goes to `'home'`.

**Backend handler test:** copy the `setup()` helper at the top of `tests/money-path.test.js`. It
builds a fake workbook (`freshWorkbook`), installs the fake Apps Script globals, and logs lock and
flush events.

**Fixed time in a test:** `t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-31T22:30:00Z') })`.
That's 00:30 on 1 November in household time.

**Mockups:** `docs/v2/mockups/NAME.html` gives the layout, wording, order and colours. Their CSS
classes are **not** the app's; rebuild the layout using the app's existing patterns (rule 10).

## 7. The v2 schema (single source of truth)

New columns are always **appended**. Never insert columns or reorder them.

**Pockets** (`SHEETS.POCKETS`): `A Pocket ID | B Pocket Name | C Bank Account | D Monthly Limit |
E Current Balance | F Status` + v2: `G Leftover Rule` (`Carry`/`Reset`/`Sweep`; blank → `Reset`) ·
`H Sweep To` (pocket id) · `I Carried In` (rands; blank → 0) · `J Kind` (`Spend`/`Savings`; blank → `Spend`).

**Transactions:** `A Transaction ID | B Timestamp | C User / Spouse | D Pocket ID | E Amount |
F Merchant / Note | G Request ID` + v2: `H Group ID` (blank = single-pocket expense) · `I Paid With`
(account id).

**Adjustments** (new): `A Adj ID (A1001…) | B Timestamp | C User | D Month (YYYY-MM) | E Type
(transfer/carry/sweep/forfeit/card_payment) | F From Pocket | G To Pocket | H Amount | I Note |
J Request ID | K Account ID`.

**Accounts** (new): `A Account ID (AC01…) | B Name | C Type (bank/card/cash) | D Statement Day
(1–28) | E Due Day (1–28) | F Credit Limit | G Status (Active/Archived)`.

## 8. Decisions already made (don't revisit)

- New pockets default to **Carry**, with no cap. Pockets that existed before v2 stay **Reset**.
- Savings is an ordinary pocket (Kind `Savings`, limit R0, rule Carry), shown in its own section and
  left out of the "Left this month" totals.
- A split has at most **10 lines**. All its lines share one Group ID (= the first row's ID) and one
  Paid With.
- Paying a card **never** changes a pocket.
- Undo for deletes is a 6-second delay on the phone before the delete is sent.
- Editing earlier months is out of scope.
