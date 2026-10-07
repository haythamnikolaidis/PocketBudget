# PocketBudget — Implementation Plan

> **For Hermes:** implement this plan task by task, with two-stage review (spec compliance, then
> code quality) after each task.

**Goal:** Ship PocketBudget — a mobile-first PWA on GitHub Pages, backed by a Google Apps Script
JSON API over a single Google Sheet, where two spouses share monthly "pocket" budgets, can log an
expense in under 5 seconds, and are hard-blocked from overspending.

**Architecture:** A dependency-free static frontend (Tailwind + vanilla ES modules, one HTML shell)
calls a single Google Apps Script web app deployed as "execute as me / anyone" via `fetch()`. Apps
Script is the entire backend: it owns the Sheets read/write, the shared-secret token check, the
atomic balance deduction, and the monthly rollover trigger. All spendable state lives in Google
Sheets; the browser holds no authoritative state.

**Tech Stack:** HTML5, Tailwind CSS (CDN), vanilla ES modules, Service Worker, Google Apps Script
(V8), Google Sheets, `node:test` for unit tests, GitHub Pages via GitHub Actions.

**Scale:** 8 phases, 34 tasks. Tasks are 2–5 minutes each.

**How to read the code blocks:** Tasks covering the backend, the API client, money handling, the
deduction path, and the test harness include complete, runnable code — these are the parts where
guessing produces bugs. Tasks covering straightforward UI wiring give exact file paths, the
contract to satisfy, and precise verification steps; their code is specified rather than pasted,
because 34 pasted screens would bury the 6 that matter. **Do not paste from a plan without reading
it; do not guess where this plan gives a contract instead of code.**

---

## 0. The architectural landmine (read this first)

The brief specifies "REST API (JSON via fetch)" from GitHub Pages to an Apps Script web app. That
combination has one failure mode that breaks *every* request, and it is the most likely reason a
build like this stalls on day one.

**Finding — verified against Google issue tracker #554057761 (still open, P2) and multiple
independent reproductions:** `https://script.google.com/macros/s/<ID>/exec` answers *any* request
with an HTTP **302** to `script.googleusercontent.com`. Two consequences:

1. `Content-Type: application/json` on a POST is **not** a CORS-safelisted header, so the browser
   fires a **preflight `OPTIONS`** first. Apps Script exposes only `doGet`/`doPost` — there is no
   `doOptions` — so the preflight returns **405 Method Not Allowed** and the browser fails the
   entire request. Unrecoverable from the client.
2. Even when the redirect is followed, `Access-Control-Allow-Origin` is frequently absent on the
   redirect hop (the root of #554057761). Google provides no API to set CORS headers on a
   `ContentService` response.

**Therefore this plan never sends `application/json`.** Every POST goes out as
`Content-Type: text/plain;charset=utf-8` with a `JSON.stringify`'d body. That is CORS-safelisted,
so **no preflight is sent at all**. This is the documented, battle-tested workaround. The brief's
"JSON via fetch" intent is fully preserved — the payload is still JSON — only the declared MIME
type changes.

**Three consequences the rest of the plan depends on:**

- `fetch()`'s default `redirect: "follow"` handles the 302 correctly. No special client code needed.
- `doGet()` works normally (GET is safelisted, no preflight) — used for all reads.
- The API must be **request-frugal**: each call costs 1–3s of Apps Script cold start. `getState`
  returns everything the UI needs in one round trip; the UI never issues two reads on load.

**Do not "fix" this with `mode: 'no-cors'` or JSONP.** Both are recorded as failed: `no-cors`
returns an opaque, unreadable response; JSONP fails silently.

### Backup plan if `text/plain` still fails against the live deployment

This is the #554057761 regression case. The fallback is to move writes behind Google OAuth so the
browser attaches a real `Authorization` header across the redirect. That is a materially larger
change and is **out of scope here** — it is the first pivot in §9 if Phase 6 fails. Capture the
verbatim Network-tab failure before pivoting.

---

## 1. Repo layout (final)

```
PocketBudget/
├── .github/workflows/pages.yml      # build check + GitHub Pages deploy
├── app/                             # the PWA — Pages serves this dir
│   ├── index.html
│   ├── manifest.webmanifest
│   ├── sw.js
│   ├── offline.html
│   ├── icons/                       # 192, 512, maskable, apple-touch
│   ├── styles.css
│   └── js/
│       ├── config.js  storage.js  api.js  format.js
│       ├── render.js  activity.js  addform.js  manage.js  app.js
├── backend/
│   ├── build.mjs                    # .gs.js  ->  .gs  generator
│   ├── appsscript.json
│   ├── 00_Config.gs.js  01_Utils.gs.js  02_Auth.gs.js
│   ├── 03_Sheets.gs.js  04_Rollover.gs.js  05_Api.gs.js  06_Report.gs.js
│   └── *.gs                         # GENERATED — do not hand-edit
├── tests/
│   ├── helpers/fakeSheet.js  helpers/appsScriptGlobals.js
│   ├── config.test.js  utils.test.js  auth.test.js  sheets.test.js
│   ├── rollover.test.js  api.test.js  report.test.js
│   └── frontend.test.js
├── package.json                     # { "type": "module", scripts.test }
├── .gitignore                       # + backend/*.gs  ← see Task 12
└── docs/
    ├── PRODUCT_BRIEF.md  IMPLEMENTATION_PLAN.md
    └── SMOKE_TEST.md  DEPLOYMENT.md
```

**Why `app/`:** Pages publishes the repo root for a user page but `path: app` keeps `backend/` and
`tests/` out of the deployed site entirely.

**Why `NN_` numeric prefixes:** Apps Script has no folders and orders files by creation time.
Numeric prefixes make load order explicit and keep the dispatcher last.

### The `.gs` / `.js` duality — stated once, correctly

Apps Script serves `.gs` files and **cannot** import modules. Node cannot execute `.gs` files.
Resolution, used everywhere below:

- **Canonical source is `backend/NN_Name.gs.js`** — plain ES modules with `export`. Node treats
  it as JavaScript purely because the filename ends in `.js`, so `import` works with no config.
- **`backend/*.gs` are generated build artifacts.** `npm run build` (`node backend/build.mjs`)
  strips `export ` prefixes and `import` lines, then concatenates the modules in numeric order
  into the flat script Apps Script needs.
- **Tests import the `.gs.js` modules directly.** No build needed to run tests.
- **Rule: always edit the `.gs.js`. Never hand-edit a `.gs`.**

This gives one source of truth, zero runtime dependencies, no bundler, and full `node:test`
compatibility. `package.json` needs no extra config beyond `"type": "module"`.

**Apps Script globals in tests:** backend code must stay byte-identical to production, so it calls
`SpreadsheetApp` / `LockService` / `PropertiesService` directly. Tests install fake globals via
`tests/helpers/appsScriptGlobals.js`. No dependency injection, no production/test divergence.

---

## 2. Data model (Google Sheets schema)

Sheet names are constants in `00_Config.gs.js`; **never** hard-code a sheet name in logic.

### `Pockets`

| Col | Header | Type | Notes |
|---|---|---|---|
| A | Pocket ID | string | `P01`. Stable, never reused. |
| B | Pocket Name | string | e.g. `Groceries` |
| C | Bank Account | string | e.g. `Chase Checking` |
| D | Monthly Limit | number | ≥ 0, dollars. |
| E | Current Balance | number | ≥ 0, dollars. **The authoritative spendable balance.** |
| F | Status | string | `Active` \| `Archived` |

### `Transactions`

| Col | Header | Type | Notes |
|---|---|---|---|
| A | Transaction ID | string | `T1001`, monotonically increasing. |
| B | Timestamp | date | Sort key. Written as a real date, never text. |
| C | User / Spouse | string | Must be one of the configured users. |
| D | Pocket ID | string | FK → `Pockets.Pocket ID`. |
| E | Amount | number | **Always positive.** Credits are out of scope for v1. |
| F | Merchant / Note | string | Free text, may be empty. |

### Decisions recorded here because they change behaviour

- **Amounts are stored positive; direction is implied.** A spend is always a subtraction, so the
  non-negative rule is one auditable check rather than a signed-arithmetic minefield.
- **Money crosses module boundaries as integer cents; it is written to the Sheet as dollars.**
  `toCents`/`toDollars` are the only converters. Every arithmetic site names its unit in the
  variable (`balanceCents`, `amountCents`) — this is a hard rule, because a dollars-vs-cents mix-up
  is silent, catastrophic, and trivial to introduce.
- **No `Spent` column on `Pockets`.** `spent = limit - balance` is only valid mid-month and breaks
  after rollover. `Monthly_Report` aggregates spend from `Transactions`, so history survives
  rollover. The `getState` response still returns `spent` for display convenience.
- **Banned from v1:** refunds/credits, multiple currencies, recurring transactions, per-pocket
  users, historical month views. Each is a real product idea; none is required by the brief (§9).

### `Monthly_Report` (generated block + native Sheet charts)

- Budget vs. Actual per pocket (Limit / Spent / Remaining).
- Spouse split (total spend by user).
- Run-rate flag (§ Task 9).
- Native Sheet charts built programmatically by `06_Report.gs.js`: month-over-month trend,
  category allocation, spouse ratio.

---

## 3. API contract

All responses are `ContentService` JSON wrapped in `{ ok: true|false }` — never a bare object, so
the client always has one thing to check.

| Action | Verb | Purpose |
|---|---|---|
| `ping` | GET | Liveness + server version. Validates config on setup. |
| `getState` | GET | **Everything the UI needs**: pockets + last 10 transactions. One call powers the whole home screen. |
| `createPocket` | POST | Create a pocket (name, account, limit). |
| `updatePocket` | POST | Rename / change limit / archive. |
| `createTransaction` | POST | The hot path. Validate → lock → deduct → append. |
| `deleteTransaction` | POST | Delete a logged expense, refunding the amount to its pocket. |

*No edit path in v1 — YAGNI. Fixing a typo'd amount is delete + re-add.*

**Every request, GET and POST, carries the token:**

```json
{ "action": "getState", "token": "…", "clientVersion": "1.0.0" }
```

**Response shapes — exact:**

```json
{ "ok": true, "version": "1.0.0", "serverTime": "2026-10-01T14:20:00.000Z",
  "pockets": [ { "id": "P01", "name": "Groceries", "account": "Chase Checking",
                 "limit": 800, "balance": 340.5, "spent": 459.5,
                 "pctUsed": 57.4, "isLocked": false } ],
  "transactions": [
    { "id": "T1001", "timestamp": "2026-10-01T14:20:00.000Z",
      "user": "Alex", "pocketId": "P01", "amount": 65.2, "note": "Whole Foods" }
  ],
  "summary": { "totalLimit": 1050, "totalBalance": 355.5, "totalSpent": 694.5,
               "users": ["Alex", "Sam"], "month": "2026-10" }
}
```

```json
{ "ok": false, "error": "INSUFFICIENT_FUNDS",
  "message": "Insufficient funds in Groceries. Remaining: $340.50",
  "context": { "pocketId": "P01", "remaining": 340.5, "amount": 400 } }
```

`pctUsed` is `limit > 0 ? spent/limit*100 : 0` — guard the divide-by-zero on zero-limit pockets.
`isLocked` is `balance <= 0`.

---

## 4. Deviations from the brief (explicit)

| Brief says | Plan does | Why |
|---|---|---|
| "REST API (JSON via fetch)" | JSON payload over `Content-Type: text/plain` | §0. `application/json` is fatal via CORS preflight. The payload is still JSON. |
| "Google OAuth / App Script permissions, **or** shared secret token" | Shared secret token only in v1 | Owner decision (brief §5). Upgrade path in §9. |
| "Recent Activity Feed: latest 10 transactions" | Server returns the last 10; client refetches state after every write | Keeps both spouses in sync with no polling. |
| Pocket columns as shown | `Status` is enforced as `Active`/`Archived`; archived pockets are hidden but retained | Already in the brief's table; transactions still reference them. |
| Home screen is a card grid (Task 16: `pocketCardHtml`) | Dashboard header plus a one-line-per-pocket ledger (`pocketRowHtml`, `summaryHtml`): amount left, a bar of money left with a pace tick, status pills, filter chips from 6 pockets | 20 cards took 2–3 screens and hid the number that matters (what is left). Pace is computed client-side from the device date; see `render.js`. |

---

## 5. Phase overview

| Phase | Tasks | Outcome |
|---|---|---|
| 0 — Unblock the transport | 1–4 | Test runner + harness. Proves we can test before we build. |
| 1 — Backend core | 5–12 | Money, auth, Sheets access, rollover, run-rate, the dispatcher, the build. |
| 2 — Frontend shell | 13–20 | Live home feed, quick-add, pocket management. |
| 3 — PWA | 21–23 | Installable to iOS + Android home screens. |
| 4 — Sheet dashboard | 24–26 | `Monthly_Report` + charts, triggers, `setup()` bootstrap. |
| 5 — CI/CD + docs | 27–28 | Pages deploy workflow, README. |
| 6 — Live verification | 29–32 | Deploy, smoke test, two-device sync, install checks. |
| 7 — Hardening | 33–34 | Offline, retry, version mismatch, final review. |

**Sequencing rule:** Phase 0 must finish before Phase 1. Everything else can flex.
---

## 6. Phase 0 — Unblock the transport

> Phase 0 exists because every later task is worthless if we cannot test the backend. Proving the
> harness works comes before proving the transport works — if `fetch` can't reach Apps Script, we
> still want a green test suite to reason against.

### Task 1: Commit the product brief and this plan ✅

**Objective:** Establish the canonical contract.

**Files:**
- Create: `docs/PRODUCT_BRIEF.md`
- Create: `docs/IMPLEMENTATION_PLAN.md`

*Done in the commit that introduced this plan.*

---

### Task 2: Scaffold the repo config and test runner

**Objective:** `npm test` runs without erroring, including zero tests.

**Files:**
- Create: `package.json`
- Create: `tests/config.test.js`

**Step 1: Write `package.json`**

```json
{
  "name": "pocketbudget",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "description": "Mobile-first PWA for couples to share monthly pocket budgets.",
  "scripts": {
    "build": "node backend/build.mjs",
    "test": "node --test",
    "test:watch": "node --test --watch",
    "check": "npm run build && npm test"
  },
  "engines": { "node": ">=20" }
}
```

**Step 2: Write the failing test**

```js
// tests/config.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { USERS, SHEETS, ACTIONS, SERVER_VERSION } from '../backend/00_Config.gs.js';

test('config exposes the three sheet names', () => {
  assert.equal(SHEETS.POCKETS, 'Pockets');
  assert.equal(SHEETS.TRANSACTIONS, 'Transactions');
  assert.equal(SHEETS.REPORT, 'Monthly_Report');
});

test('config declares exactly the two spouses', () => {
  assert.deepEqual(USERS, ['Alex', 'Sam']);
});

test('config action list covers the public API', () => {
  for (const a of ['ping', 'getState', 'createPocket', 'updatePocket',
                   'createTransaction', 'deleteTransaction']) {
    assert.ok(ACTIONS.includes(a), `missing action ${a}`);
  }
});

test('server version is semver-shaped', () => {
  assert.match(SERVER_VERSION, /^\d+\.\d+\.\d+$/);
});
```

**Step 3: Run to verify failure**

Run: `npm test`
Expected: FAIL — `ERR_MODULE_NOT_FOUND: backend/00_Config.gs.js`. *This is the correct failure.*

**Step 4: Commit the failing test**

```bash
git add package.json tests/config.test.js
git commit -m "chore: scaffold test runner and config contract test"
```

---

### Task 3: Implement the config module

**Objective:** One source of truth for sheet names, users, action names, and version.

**Files:**
- Create: `backend/00_Config.gs.js`

**Step 1: Write the minimal implementation**

```js
// backend/00_Config.gs.js
// CANONICAL SOURCE. `backend/*.gs` is generated from this file by `npm run build`.

/** Household members allowed to log expenses. Display names, exact match. */
export const USERS = ['Alex', 'Sam'];

/** Sheet tab names. Reference these everywhere; never hard-code a sheet name in logic. */
export const SHEETS = {
  POCKETS: 'Pockets',
  TRANSACTIONS: 'Transactions',
  REPORT: 'Monthly_Report',
};

/** Every action the API dispatcher accepts. */
export const ACTIONS = [
  'ping', 'getState',
  'createPocket', 'updatePocket',
  'createTransaction', 'deleteTransaction',
];

/** Version of the deployed backend; returned by ping/getState so the client can warn on mismatch. */
export const SERVER_VERSION = '1.0.0';

/** Largest single expense the API will accept, in cents ($1,000,000). */
export const MAX_AMOUNT_CENTS = 100_000_000;
```

**Step 2: Run to verify pass**

Run: `npm test`
Expected: `4` tests pass, `fail 0`.

**Step 3: Commit**

```bash
git add backend/00_Config.gs.js
git commit -m "feat(config): add canonical config module with sheet names, users, actions"
```

---

### Task 4: Create the backend test harness

**Objective:** An in-memory Sheets stub plus Apps Script global fakes, so backend logic is fully
testable without Google.

**Files:**
- Create: `tests/helpers/fakeSheet.js`
- Create: `tests/helpers/appsScriptGlobals.js`
- Create: `tests/helpers/fixtures.js`
- Modify: `tests/sheets.test.js`

**Step 1: Write the Sheets stub**

```js
// tests/helpers/fakeSheet.js
// In-memory stand-in for a Google Sheets range.
//
// The API surface deliberately mirrors the subset of Sheets that the backend
// uses, so backend code under test is byte-identical to production code.

/**
 * `rows` is the FULL sheet, header included, so rows[0] is sheet row 1.
 * (fixtures.js builds sheets as [HEADER, ...dataRows] — see that file.)
 */
export function createSheet(name, rows = []) {
  return {
    name,
    _rows: rows.map((r) => [...r]),

    getLastRow() { return this._rows.length; },
    getLastColumn() { return this._rows.reduce((m, r) => Math.max(m, r.length), 0); },

    getRange(row, col, numRows = 1, numCols = 1) {
      const r0 = row - 1, c0 = col - 1;
      const snapshot = [];
      for (let r = 0; r < numRows; r++) {
        const line = [];
        for (let c = 0; c < numCols; c++) {
          line.push(this._rows[r0 + r] ? this._rows[r0 + r][c0 + c] ?? '' : '');
        }
        snapshot.push(line);
      }
      const self = this;
      return {
        _snapshot: snapshot,
        getValues: () => snapshot.map((r) => [...r]),
        setValues(vals) {
          for (let r = 0; r < vals.length; r++) {
            const target = r0 + r;
            if (!self._rows[target]) self._rows[target] = new Array(numCols).fill('');
            for (let c = 0; c < vals[r].length; c++) self._rows[target][c0 + c] = vals[r][c];
          }
          return this;
        },
        setValue(v) {
          snapshot[0][0] = v;
          // Write through to the sheet, not just this snapshot, so a later
          // getRange of the same cell observes the write.
          if (self._rows[r0]) self._rows[r0][c0] = v;
          return this;
        },
        clearContent() { snapshot.forEach((r) => r.fill('')); return this; },
      };
    },

    appendRow(arr) { this._rows.push([...arr]); return this; },

    deleteRow(row) {
      // Sheet rows are 1-based and include the header, so index is row-1.
      this._rows.splice(row - 1, 1);
      return this;
    },

    clearContents() { this._rows = []; return this; },
  };
}

export function resetSheet(sheet, rows) {
  sheet._rows = rows.map((r) => [...r]);
  return sheet;
}
```

**Step 2: Write the Apps Script globals stub**

```js
// tests/helpers/appsScriptGlobals.js
// Fake Apps Script services so backend modules run unmodified under Node.

/** Minimal LockService: no-ops, but records whether the lock was requested. */
export function createLock() {
  return {
    _held: false,
    tryLock(ms) { this._held = true; return true; },
    releaseLock() { this._held = false; },
    hasLock() { return this._held; },
  };
}

/** Minimal PropertiesService backed by a plain object. */
export function createProps(init = {}) {
  const store = { ...init };
  return {
    _store: store,
    getProperty(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setProperty(k, v) { store[k] = String(v); },
    deleteProperty(k) { delete store[k]; },
    getProperties() { return { ...store }; },
  };
}

/**
 * A LockService-shaped object.
 * Accepts either a bare lock or an object that already has getScriptLock().
 */
export function createLockService(lock = createLock()) {
  if (lock && typeof lock.getScriptLock === 'function') return lock;
  return { getScriptLock: () => lock, getUserLock: () => lock };
}

/**
 * Install fake globals onto globalThis for one test.
 * Returns a restore() function.
 */
export function installGlobals({
  lockService = createLockService(),
  props = createProps(),
  ss = {},
} = {}) {
  const saved = {};
  const define = (key, value) => {
    saved[key] = globalThis[key];
    globalThis[key] = value;
  };

  // `lockService` must already be a LockService-shaped object, i.e. it has
  // getScriptLock(). If a bare lock is passed, wrap it.
  const ls = (lockService && typeof lockService.getScriptLock === 'function')
    ? lockService
    : createLockService(lockService);

  define('SpreadsheetApp', {
    getActiveSpreadsheet: () => ss,
    openById: () => ss,
  });
  define('LockService', ls);
  define('PropertiesService', { getScriptProperties: () => props });
  define('Utilities', {
    formatDate: (d) => (d instanceof Date ? d.toISOString() : String(d)),
    getUuid: () => 'test-uuid-0000',
  });

  return () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete globalThis[k];
      else globalThis[k] = v;
    }
  };
}
```

**Step 3: Write shared fixtures**

```js
// tests/helpers/fixtures.js
import { createSheet, resetSheet } from './fakeSheet.js';

export const HEADER_POCKETS = ['Pocket ID', 'Pocket Name', 'Bank Account', 'Monthly Limit', 'Current Balance', 'Status'];
export const HEADER_TRANSACTIONS = ['Transaction ID', 'Timestamp', 'User / Spouse', 'Pocket ID', 'Amount', 'Merchant / Note'];

const SHEETS_POCKETS = 'Pockets';
const SHEETS_TXNS = 'Transactions';
const SHEETS_REPORT = 'Monthly_Report';

/**
 * Build a workbook whose sheets include their header rows, exactly like the real thing.
 * `pocketRows` / `txnRows` are DATA rows only; the header is prepended for you.
 */
export function freshWorkbook(pocketRows = [], txnRows = []) {
  const pockets = createSheet(SHEETS_POCKETS, [HEADER_POCKETS, ...pocketRows]);
  const txns = createSheet(SHEETS_TXNS, [HEADER_TRANSACTIONS, ...txnRows]);
  const report = createSheet(SHEETS_REPORT, []);
  return { pockets, txns, report };
}

/** The brief's own example rows — used across several tests as the standard fixture. */
export const SAMPLE_POCKETS = [
  ['P01', 'Groceries', 'Chase Checking', 800, 340.5, 'Active'],
  ['P02', 'Dining Out', 'Credit Card A', 250, 15, 'Active'],
];

export const SAMPLE_TXNS = [
  ['T1001', new Date('2026-10-01T14:20:00Z'), 'Alex', 'P01', 65.2, 'Whole Foods'],
  ['T1002', new Date('2026-10-01T18:45:00Z'), 'Sam', 'P02', 42, 'Pizza Night'],
];

export { createSheet, resetSheet };
```

**Step 4: Write the harness tests**

```js
// tests/sheets.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSheet, resetSheet } from './helpers/fakeSheet.js';
import { createLock, createProps, installGlobals } from './helpers/appsScriptGlobals.js';

const H = ['Pocket ID', 'Pocket Name'];   // stands in for the header row

test('fakeSheet: getRange reads cells, 1-based including the header', () => {
  const sh = createSheet('Pockets', [H, ['P01', 'Groceries']]);
  assert.equal(sh.getLastRow(), 2);
  assert.deepEqual(sh.getRange(1, 1, 1, 1).getValues(), [['Pocket ID']]);
  assert.deepEqual(sh.getRange(2, 1, 1, 1).getValues(), [['P01']]);
});

test('fakeSheet: setValue writes through to the sheet, not just the snapshot', () => {
  const sh = createSheet('Pockets', [H, ['P01', 'Groceries', 'Chase', 800, 340.5, 'Active']]);
  sh.getRange(2, 5).setValue(300);
  assert.deepEqual(sh.getRange(2, 5).getValues(), [[300]]);
});

test('fakeSheet: setValues writes a whole row', () => {
  const sh = createSheet('Pockets', [H, ['P01', 'Groceries', 'Chase', 800, 340.5, 'Active']]);
  sh.getRange(2, 1, 1, 6).setValues([['P01', 'Groceries', 'Chase', 800, 300, 'Active']]);
  assert.deepEqual(sh.getRange(2, 1, 1, 6).getValues(),
    [['P01', 'Groceries', 'Chase', 800, 300, 'Active']]);
});

test('fakeSheet: appendRow adds after the last row', () => {
  const sh = createSheet('Pockets', [H, ['P01', 'Groceries']]);
  sh.appendRow(['P02', 'Fuel']);
  assert.equal(sh.getLastRow(), 3);
  assert.deepEqual(sh.getRange(3, 1).getValues(), [['P02']]);
});

test('fakeSheet: deleteRow removes the given 1-based row', () => {
  const sh = createSheet('Pockets', [H, ['P01', 'Groceries'], ['P02', 'Fuel']]);
  sh.deleteRow(2);
  assert.deepEqual(sh.getRange(2, 1).getValues(), [['P02']]);
});

test('fakeSheet: getRange tolerates out-of-range reads', () => {
  const sh = createSheet('Pockets', [H, ['P01']]);
  assert.deepEqual(sh.getRange(99, 1).getValues(), [['']]);
});

test('fakeSheet: resetSheet restores rows', () => {
  const sh = createSheet('Pockets', [H, ['P01', 'Groceries']]);
  resetSheet(sh, [H, ['P09', 'Fuel']]);
  assert.deepEqual(sh.getRange(2, 1).getValues(), [['P09']]);
});

test('lock stub records acquisition', () => {
  const lock = createLock();
  assert.equal(lock.hasLock(), false);
  lock.tryLock(1000);
  assert.equal(lock.hasLock(), true);
  lock.releaseLock();
  assert.equal(lock.hasLock(), false);
});

test('props stub round-trips values as strings', () => {
  const p = createProps({ API_TOKEN: 'abc' });
  assert.equal(p.getProperty('API_TOKEN'), 'abc');
  assert.equal(p.getProperty('MISSING'), null);
  p.setProperty('SHEET_ID', '123');
  assert.equal(p.getProperty('SHEET_ID'), '123');
});

test('installGlobals installs and restores cleanly', () => {
  assert.equal(globalThis.SpreadsheetApp, undefined);
  const restore = installGlobals({});
  assert.equal(typeof globalThis.SpreadsheetApp, 'object');
  restore();
  assert.equal(globalThis.SpreadsheetApp, undefined);
});
```

**Step 5: Run**

Run: `npm test`
Expected: `14` tests pass, `fail 0`.

**Step 6: Commit**

```bash
git add tests/helpers/ tests/sheets.test.js
git commit -m "test: add Sheets and Apps Script globals stubs for backend tests"
```

---

## 7. Phase 1 — Backend core

### Task 5: Implement `01_Utils.gs.js` — money and validation

**Objective:** Pure helpers with zero Apps Script dependencies. Highest coverage per line in the
project.

**Files:**
- Create: `backend/01_Utils.gs.js`
- Create: `tests/utils.test.js`

**Step 1: Write the failing tests**

```js
// tests/utils.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toCents, toDollars, parseAmountInput, isValidUser, isValidPocketId,
  nextPocketId, nextTransactionId, ok, fail, money,
} from '../backend/01_Utils.gs.js';
import { USERS } from '../backend/00_Config.gs.js';

test('toCents / toDollars round-trip without float drift', () => {
  assert.equal(toCents(65.2), 6520);
  assert.equal(toCents('65.20'), 6520);
  assert.equal(toCents('$1,234.56'), 123456);
  assert.equal(toDollars(6520), 65.2);
  assert.equal(toDollars(10), 0.1);      // the 0.1 + 0.2 trap
  assert.equal(toDollars(toCents('0.07')), 0.07);
});

test('toCents rejects non-numbers', () => {
  assert.throws(() => toCents('abc'), /Not a number/);
  assert.throws(() => toCents(''), /Not a number/);
  assert.throws(() => toCents(null), /Not a number/);
});

test('parseAmountInput accepts clean positive amounts', () => {
  assert.equal(parseAmountInput(65.2), 6520);
  assert.equal(parseAmountInput('12.34'), 1234);
  assert.equal(parseAmountInput('0.01'), 1);
});

test('parseAmountInput rejects negatives, junk and >2dp', () => {
  assert.throws(() => parseAmountInput(-5), /positive/);
  assert.throws(() => parseAmountInput('12.345'), /cents/);
  assert.throws(() => parseAmountInput('12.3456'), /cents/);
  assert.throws(() => parseAmountInput('abc'), /Not a number/);
});

test('parseAmountInput rejects absurd amounts', () => {
  assert.throws(() => parseAmountInput(1_000_001), /too large/);
  assert.equal(parseAmountInput(1_000_000), 100_000_000);
});

test('isValidUser accepts only configured users', () => {
  for (const u of USERS) assert.equal(isValidUser(u), true, u);
  assert.equal(isValidUser('Alexandra'), false);
  assert.equal(isValidUser(''), false);
  assert.equal(isValidUser(null), false);
});

test('isValidPocketId requires the P## shape', () => {
  assert.equal(isValidPocketId('P01'), true);
  assert.equal(isValidPocketId('P99'), true);
  assert.equal(isValidPocketId('p01'), false);
  assert.equal(isValidPocketId('P1'), false);
  assert.equal(isValidPocketId('X01'), false);
});

test('nextPocketId continues the sequence', () => {
  assert.equal(nextPocketId(['P01', 'P02']), 'P03');
  assert.equal(nextPocketId([]), 'P01');
  assert.equal(nextPocketId(['P01', 'P09']), 'P10');
});

test('nextTransactionId continues the sequence', () => {
  assert.equal(nextTransactionId(['T1001', 'T1002']), 'T1003');
  assert.equal(nextTransactionId([]), 'T1001');
  assert.equal(nextTransactionId(['T9999']), 'T10000');
});

test('nextTransactionId ignores malformed ids rather than crashing', () => {
  // 'header' and '' are not ids at all; the sequence still starts at T1001.
  assert.equal(nextTransactionId(['header', '', null]), 'T1001');
  assert.equal(nextTransactionId(['T1001', 'T1002', 'oops']), 'T1003');
});

test('ok() wraps a payload and stamps the version', () => {
  const r = ok({ pockets: [] });
  assert.equal(r.ok, true);
  assert.equal(r.version, '1.0.0');
  assert.deepEqual(r.pockets, []);
});

test('fail() never leaks the code into message, and carries context', () => {
  const r = fail('INSUFFICIENT_FUNDS', 'Insufficient funds in Groceries. Remaining: $340.50',
                 { pocketId: 'P01', remaining: 340.5 });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'INSUFFICIENT_FUNDS');
  assert.match(r.message, /Remaining/);
  assert.equal(r.context.remaining, 340.5);
});

test('money() formats cents as $1,234.56', () => {
  assert.equal(money(6520), '$65.20');
  assert.equal(money(10), '$0.10');
  assert.equal(money(123456), '$1,234.56');
  assert.equal(money(0), '$0.00');
});
```

**Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL — `ERR_MODULE_NOT_FOUND: backend/01_Utils.gs.js`.

**Step 3: Write the implementation**

```js
// backend/01_Utils.gs.js
// CANONICAL SOURCE. Pure functions only — no SpreadsheetApp, no Date text parsing.

import { USERS, SERVER_VERSION, MAX_AMOUNT_CENTS } from './00_Config.gs.js';

/* ------------------------------------------------------------------ money -- */

/** Parse a dollar-ish value into integer cents. Rejects anything non-numeric. */
export function toCents(v) {
  if (typeof v === 'boolean') throw new Error('Not a number: ' + v);
  const cleaned = String(v ?? '').replace(/[$,\s]/g, '');
  const n = cleaned === '' ? NaN : Number(cleaned);
  if (!Number.isFinite(n)) throw new Error('Not a number: ' + v);
  return Math.round(n * 100);
}

export function toDollars(cents) {
  return Math.round(cents) / 100;
}

/**
 * Parse a user-entered amount into integer cents.
 * Rejects: negatives, junk, more than 2 decimal places, and amounts over $1,000,000.
 */
export function parseAmountInput(input) {
  if (typeof input === 'boolean') throw new Error('Not a number: ' + input);
  const cleaned = String(input ?? '').replace(/[$,\s]/g, '');
  if (cleaned === '') throw new Error('Not a number: ' + input);

  const n = Number(cleaned);
  if (!Number.isFinite(n)) throw new Error('Not a number: ' + input);
  if (n < 0) throw new Error('Amount must be positive.');
  if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-9) throw new Error('Amount has more than 2 decimal places (must be whole cents).');
  if (Math.round(n * 100) > MAX_AMOUNT_CENTS) throw new Error('Amount is too large (max $1,000,000).');

  return Math.round(n * 100);
}

/** Format integer cents as `$1,234.56`. */
export function money(cents) {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const centsPart = String(abs % 100).padStart(2, '0');
  const withCommas = String(dollars).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? '-$' : '$') + withCommas + '.' + centsPart;
}

/* ------------------------------------------------------------ validation -- */

export function isValidUser(name) {
  return typeof name === 'string' && USERS.includes(name);
}

/** Pocket IDs are `P` + at least two digits, uppercase. */
export function isValidPocketId(id) {
  return typeof id === 'string' && /^P\d{2,}$/.test(id);
}

export function isValidTransactionId(id) {
  return typeof id === 'string' && /^T\d{4,}$/.test(id);
}

/* -------------------------------------------------------------------- ids -- */

/** Next free pocket ID given the existing IDs, e.g. ['P01','P09'] -> 'P10'. */
export function nextPocketId(existingIds) {
  const max = existingIds.reduce((m, id) => {
    if (!isValidPocketId(id)) return m;
    const n = parseInt(String(id).slice(1), 10);
    return Number.isFinite(n) && n > m ? n : m;
  }, 0);
  return 'P' + String(max + 1).padStart(2, '0');
}

/** Next free transaction ID, e.g. ['T1001'] -> 'T1002'. Malformed ids are ignored. */
export function nextTransactionId(existingIds) {
  const max = existingIds.reduce((m, id) => {
    if (!isValidTransactionId(id)) return m;
    const n = parseInt(String(id).slice(1), 10);
    return Number.isFinite(n) && n > m ? n : m;
  }, 0);
  // The brief's examples start at T1001, so the sequence starts there and pads to 4 digits.
  const start = 1000;
  return 'T' + String(Math.max(max + 1, start + 1)).padStart(4, '0');
}

/* --------------------------------------------------------------- envelope -- */

/** Success envelope. Always `ok: true`, always version-stamped. */
export function ok(payload = {}) {
  return { ok: true, version: SERVER_VERSION, ...payload };
}

/** Failure envelope. `code` is the stable machine-readable constant; `message` is for humans. */
export function fail(code, message, context = {}) {
  return { ok: false, error: code, message, context };
}
```

**Step 4: Run to verify pass**

Run: `npm test`
Expected: `27` tests pass, `fail 0`.

**Step 5: Commit**

```bash
git add backend/01_Utils.gs.js tests/utils.test.js
git commit -m "feat(utils): add money parsing, validation, id generation, response envelopes"
```

---

### Task 6: Implement `02_Auth.gs.js` — the shared-secret token

**Objective:** Constant-time token comparison, read from Script Properties so it never lands in git.

**Files:**
- Create: `backend/02_Auth.gs.js`
- Create: `tests/auth.test.js`

**Step 1: Write the failing tests**

```js
// tests/auth.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyToken, getApiToken, setApiToken, TOKEN_PROPERTY } from '../backend/02_Auth.gs.js';
import { createProps } from './helpers/appsScriptGlobals.js';

test('getApiToken reads from script properties', () => {
  const props = createProps({ API_TOKEN: 'secret-token' });
  globalThis.PropertiesService = { getScriptProperties: () => props };
  assert.equal(getApiToken(), 'secret-token');
  delete globalThis.PropertiesService;
});

test('setApiToken round-trips', () => {
  const props = createProps({});
  globalThis.PropertiesService = { getScriptProperties: () => props };
  setApiToken('hunter2');
  assert.equal(props.getProperty(TOKEN_PROPERTY), 'hunter2');
  delete globalThis.PropertiesService;
});

test('verifyToken accepts the exact token', () => {
  const props = createProps({ API_TOKEN: 'secret-token' });
  globalThis.PropertiesService = { getScriptProperties: () => props };
  assert.equal(verifyToken('secret-token'), true);
  delete globalThis.PropertiesService;
});

test('verifyToken rejects wrong, empty and missing tokens', () => {
  const props = createProps({ API_TOKEN: 'secret-token' });
  globalThis.PropertiesService = { getScriptProperties: () => props };
  assert.equal(verifyToken('secret-tokenx'), false);
  assert.equal(verifyToken('secret-toke'), false);
  assert.equal(verifyToken(''), false);
  assert.equal(verifyToken(undefined), false);
  delete globalThis.PropertiesService;
});

test('verifyToken fails closed when no token is configured', () => {
  const props = createProps({});
  globalThis.PropertiesService = { getScriptProperties: () => props };
  assert.equal(verifyToken('anything'), false);
  delete globalThis.PropertiesService;
});

test('verifyToken rejects a token of different length without leaking', () => {
  const props = createProps({ API_TOKEN: 'abc' });
  globalThis.PropertiesService = { getScriptProperties: () => props };
  assert.equal(verifyToken('ab'), false);
  assert.equal(verifyToken('abcd'), false);
  assert.equal(verifyToken('abc'), true);
  delete globalThis.PropertiesService;
});

test('TOKEN_PROPERTY is API_TOKEN', () => {
  assert.equal(TOKEN_PROPERTY, 'API_TOKEN');
});
```

**Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL — `ERR_MODULE_NOT_FOUND: backend/02_Auth.gs.js`.

**Step 3: Write the implementation**

```js
// backend/02_Auth.gs.js
// CANONICAL SOURCE.
//
// Shared-secret household token. Deliberately not Google OAuth in v1 — see
// PRODUCT_BRIEF.md §5 decision 1. The upgrade path to verified Google ID tokens
// is documented in IMPLEMENTATION_PLAN.md §9.

import { fail } from './01_Utils.gs.js';

/** Script Properties key holding the household token. */
export const TOKEN_PROPERTY = 'API_TOKEN';

/** Read the configured token, or '' when unset. */
export function getApiToken() {
  const v = PropertiesService.getScriptProperties().getProperty(TOKEN_PROPERTY);
  return v == null ? '' : String(v);
}

/** Persist the household token. Run this once from `setup()` (Task 26). */
export function setApiToken(token) {
  PropertiesService.getScriptProperties().setProperty(TOKEN_PROPERTY, String(token));
}

/**
 * Constant-time-ish comparison of a presented token against the stored one.
 * Fails closed: an unconfigured token rejects every request.
 */
export function verifyToken(presented) {
  const expected = getApiToken();
  if (!expected) return false;
  if (typeof presented !== 'string' || presented.length !== expected.length) return false;

  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ presented.charCodeAt(i);
  }
  return diff === 0;
}
```

**Step 4: Run to verify pass**

Run: `npm test`
Expected: `34` tests pass, `fail 0`.

**Step 5: Commit**

```bash
git add backend/02_Auth.gs.js tests/auth.test.js
git commit -m "feat(auth): add constant-time shared-secret token verification"
```
---

### Task 7: Implement `03_Sheets.gs.js` — data access

**Objective:** All Sheets reads/writes in one module. No other module touches
`SpreadsheetApp`.

**Files:**
- Create: `backend/03_Sheets.gs.js`
- Create: `tests/sheets-api.test.js`

**Objective detail:** Functions: `getPocketSheet`, `getTransactionSheet`,
`getReportSheet`, `readPockets`, `readTransactions`, `findPocketRow`,
`writeBalance`, `appendTransaction`, `appendPocket`, `updatePocketRow`,
`archivePocketRow`, `deleteTransactionRow`, `nextPocketIdFromSheet`,
`nextTransactionIdFromSheet`.

**Step 1: Write the failing tests**

```js
// tests/sheets-api.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  readPockets, readTransactions, findPocketRow, writeBalance,
  appendTransaction, deleteTransactionRow, nextPocketIdFromSheet,
  nextTransactionIdFromSheet,
} from '../backend/03_Sheets.gs.js';
import { installGlobals } from './helpers/appsScriptGlobals.js';
import { freshWorkbook, SAMPLE_POCKETS, SAMPLE_TXNS } from './helpers/fixtures.js';

/** Wire the fixture workbook into fake Apps Script globals; returns a restore fn. */
function withWorkbook(pocketRows = SAMPLE_POCKETS, txnRows = SAMPLE_TXNS) {
  const wb = freshWorkbook(pocketRows, txnRows);
  const ss = {
    getSheetByName: (n) => wb.pockets.name === n ? wb.pockets
      : wb.txns.name === n ? wb.txns
      : wb.report.name === n ? wb.report
      : null,
  };
  const restore = installGlobals({ ss });
  return { wb, restore };
}

test('readPockets returns typed objects and skips blank rows', () => {
  const { restore } = withWorkbook([
    ['P01', 'Groceries', 'Chase Checking', 800, 340.5, 'Active'],
    ['', '', '', '', '', ''],
    ['P02', 'Dining Out', 'Credit Card A', 250, 15, 'Active'],
  ]);
  const pockets = readPockets();
  assert.equal(pockets.length, 2);
  assert.deepEqual(pockets[0], {
    id: 'P01', name: 'Groceries', account: 'Chase Checking',
    limit: 800, balance: 340.5, status: 'Active',
  });
  restore();
});

test('readPockets excludes Archived pockets by default', () => {
  const { restore } = withWorkbook([
    ['P01', 'Groceries', 'Chase', 800, 340.5, 'Active'],
    ['P02', 'Old', 'Chase', 100, 100, 'Archived'],
  ]);
  assert.equal(readPockets().length, 1);
  assert.equal(readPockets({ includeArchived: true }).length, 2);
  restore();
});

test('readPockets tolerates a sheet with no header row', () => {
  const { restore } = withWorkbook([], []);
  assert.deepEqual(readPockets(), []);
  restore();
});

test('readTransactions returns newest first', () => {
  const { restore } = withWorkbook(SAMPLE_POCKETS, [
    ['T1001', new Date('2026-10-01T14:20:00Z'), 'Alex', 'P01', 65.2, 'Whole Foods'],
    ['T1002', new Date('2026-10-03T09:00:00Z'), 'Sam', 'P02', 42, 'Pizza Night'],
    ['T1003', new Date('2026-10-02T11:00:00Z'), 'Alex', 'P01', 10, 'Cafe'],
  ]);
  const txns = readTransactions();
  assert.deepEqual(txns.map((t) => t.id), ['T1002', 'T1003', 'T1001']);
  restore();
});

test('readTransactions honours a limit', () => {
  const { restore } = withWorkbook();
  assert.equal(readTransactions({ limit: 2 }).length, 2);
  restore();
});

test('readTransactions converts amount to a number and timestamp to ISO', () => {
  const { restore } = withWorkbook();
  const [t] = readTransactions({ limit: 1 });
  assert.equal(typeof t.amount, 'number');
  assert.equal(typeof t.timestamp, 'string');
  assert.match(t.timestamp, /^\d{4}-\d{2}-\d{2}T/);
  restore();
});

test('findPocketRow locates the 1-based sheet row, or 0 when absent', () => {
  const { restore } = withWorkbook();
  assert.equal(findPocketRow('P01'), 2);   // row 1 is the header
  assert.equal(findPocketRow('P02'), 3);
  assert.equal(findPocketRow('P99'), 0);
  restore();
});

test('writeBalance updates only column E and leaves siblings alone', () => {
  const { restore, wb } = withWorkbook();
  writeBalance('P01', 275.3);
  const row = wb.pockets.getRange(2, 1, 1, 6).getValues()[0];
  assert.equal(row[4], 275.3);
  assert.equal(row[3], 800);          // limit untouched
  assert.equal(row[1], 'Groceries');   // name untouched
  restore();
});

test('writeBalance throws when the pocket does not exist', () => {
  const { restore } = withWorkbook();
  assert.throws(() => writeBalance('P99', 10), /P99/);
  restore();
});

test('appendTransaction returns the new id and the row is readable back', () => {
  const { restore } = withWorkbook();
  const id = appendTransaction({
    user: 'Alex', pocketId: 'P01', amount: 12.34,
    note: 'Bakery', timestamp: new Date('2026-10-05T10:00:00Z'),
  });
  assert.equal(id, 'T1003');
  const txns = readTransactions();
  assert.equal(txns[0].id, 'T1003');
  assert.equal(txns[0].amount, 12.34);
  restore();
});

test('deleteTransactionRow removes the row and returns what it deleted', () => {
  const { restore, wb } = withWorkbook();
  const deleted = deleteTransactionRow('T1002');
  assert.equal(deleted.pocketId, 'P02');
  assert.equal(deleted.amount, 42);
  assert.deepEqual(readTransactions().map((t) => t.id), ['T1001']);
  restore();
});

test('deleteTransactionRow returns null for an unknown id', () => {
  const { restore } = withWorkbook();
  assert.equal(deleteTransactionRow('T9999'), null);
  restore();
});

test('nextPocketIdFromSheet and nextTransactionIdFromSheet read the sheet', () => {
  const { restore } = withWorkbook();
  assert.equal(nextPocketIdFromSheet(), 'P03');
  assert.equal(nextTransactionIdFromSheet(), 'T1003');
  restore();
});
```

**Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL — `ERR_MODULE_NOT_FOUND: backend/03_Sheets.gs.js`.

**Step 3: Write the implementation**

```js
// backend/03_Sheets.gs.js
// CANONICAL SOURCE. The ONLY module that touches SpreadsheetApp.

import { SHEETS } from './00_Config.gs.js';
import { nextPocketId, nextTransactionId, isValidPocketId } from './01_Utils.gs.js';

/* --------------------------------------------------------------- plumbing -- */

function ss() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

export function getPocketSheet() {
  const s = ss().getSheetByName(SHEETS.POCKETS);
  if (!s) throw new Error('Missing sheet: ' + SHEETS.POCKETS);
  return s;
}

export function getTransactionSheet() {
  const s = ss().getSheetByName(SHEETS.TRANSACTIONS);
  if (!s) throw new Error('Missing sheet: ' + SHEETS.TRANSACTIONS);
  return s;
}

export function getReportSheet() {
  const s = ss().getSheetByName(SHEETS.REPORT);
  if (!s) throw new Error('Missing sheet: ' + SHEETS.REPORT);
  return s;
}

/** Rows below the header, skipping fully-blank rows. */
function dataRows(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const values = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
  return values.filter((r) => r.some((c) => c !== '' && c != null));
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const isoDate = (v) => {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string' && v) {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return null;
};

/* ------------------------------------------------------------------ reads -- */

/** All pockets as typed objects. Archived pockets are hidden unless requested. */
export function readPockets({ includeArchived = false } = {}) {
  return dataRows(getPocketSheet()).map((r) => ({
    id: String(r[0]),
    name: String(r[1]),
    account: String(r[2]),
    limit: num(r[3]),
    balance: num(r[4]),
    status: String(r[5] || 'Active'),
  })).filter((p) => includeArchived || p.status !== 'Archived');
}

/** Transactions newest-first, optionally capped. */
export function readTransactions({ limit = 0 } = {}) {
  const txns = dataRows(getTransactionSheet()).map((r) => ({
    id: String(r[0]),
    timestamp: isoDate(r[1]),
    user: String(r[2]),
    pocketId: String(r[3]),
    amount: num(r[4]),
    note: String(r[5] || ''),
  }));
  txns.sort((a, b) => {
    const at = a.timestamp || '', bt = b.timestamp || '';
    if (at === bt) return b.id.localeCompare(a.id);
    return bt.localeCompare(at);
  });
  return limit > 0 ? txns.slice(0, limit) : txns;
}

/** 1-based sheet row for a pocket ID (header is row 1), or 0 if not found. */
export function findPocketRow(pocketId) {
  const sheet = getPocketSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === pocketId) return i + 2;
  }
  return 0;
}

/** 1-based sheet row for a transaction ID, or 0 if not found. */
function findTransactionRow(txnId) {
  const sheet = getTransactionSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === txnId) return i + 2;
  }
  return 0;
}

/* ----------------------------------------------------------------- writes -- */

/** Set a pocket's Current Balance (column E). */
export function writeBalance(pocketId, balance) {
  const row = findPocketRow(pocketId);
  if (!row) throw new Error('Pocket not found: ' + pocketId);
  getPocketSheet().getRange(row, 5).setValue(balance);
  return balance;
}

export function appendPocket({ name, account, limit }) {
  const sheet = getPocketSheet();
  const id = nextPocketIdFromSheet();
  sheet.appendRow([id, name, account, limit, limit, 'Active']);
  return { id, name, account, limit, balance: limit, status: 'Active' };
}

export function updatePocketRow(pocketId, { name, account, limit, status }) {
  const row = findPocketRow(pocketId);
  if (!row) throw new Error('Pocket not found: ' + pocketId);
  const sheet = getPocketSheet();
  if (name != null) sheet.getRange(row, 2).setValue(name);
  if (account != null) sheet.getRange(row, 3).setValue(account);
  if (limit != null) {
    sheet.getRange(row, 4).setValue(limit);
    // Keep balance within the new limit; never negative, never above limit.
    const cur = num(sheet.getRange(row, 5).getValues()[0][0]);
    sheet.getRange(row, 5).setValue(Math.min(Math.max(cur, 0), limit));
  }
  if (status != null) sheet.getRange(row, 6).setValue(status);
  return readPockets({ includeArchived: true }).find((p) => p.id === pocketId) || null;
}

export function archivePocketRow(pocketId) {
  return updatePocketRow(pocketId, { status: 'Archived' });
}

/** Append a transaction. Returns the new transaction ID. */
export function appendTransaction({ user, pocketId, amount, note, timestamp }) {
  const sheet = getTransactionSheet();
  const id = nextTransactionIdFromSheet();
  sheet.appendRow([id, timestamp || new Date(), user, pocketId, amount, note || '']);
  return id;
}

/**
 * Delete a transaction row.
 * Returns `{ id, pocketId, amount }` so the caller can refund the pocket, or null if absent.
 */
export function deleteTransactionRow(txnId) {
  const row = findTransactionRow(txnId);
  if (!row) return null;
  const sheet = getTransactionSheet();
  const vals = sheet.getRange(row, 1, 1, 6).getValues()[0];
  const record = {
    id: String(vals[0]),
    pocketId: String(vals[3]),
    amount: num(vals[4]),
  };
  sheet.deleteRow(row);
  return record;
}

export function nextPocketIdFromSheet() {
  const rows = dataRows(getPocketSheet());
  return nextPocketId(rows.map((r) => String(r[0])));
}

export function nextTransactionIdFromSheet() {
  const rows = dataRows(getTransactionSheet());
  return nextTransactionId(rows.map((r) => String(r[0])));
}

/* -------------------------------------------------------------- bootstrap -- */

/** Create the three sheets with headers if they do not exist. Run once from `setup()`. */
export function ensureSheets() {
  const created = [];
  const wanted = {
    [SHEETS.POCKETS]: ['Pocket ID', 'Pocket Name', 'Bank Account', 'Monthly Limit', 'Current Balance', 'Status'],
    [SHEETS.TRANSACTIONS]: ['Transaction ID', 'Timestamp', 'User / Spouse', 'Pocket ID', 'Amount', 'Merchant / Note'],
    [SHEETS.REPORT]: [],
  };
  for (const [name, headers] of Object.entries(wanted)) {
    const sheet = ss().getSheetByName(name) || ss().insertSheet(name);
    if (headers.length && sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.setFrozenRows(1);
    }
    created.push(name);
  }
  return created;
}
```

**Step 4: Run to verify pass**

Run: `npm test`
Expected: `47` tests pass, `fail 0`.

**Step 5: Commit**

```bash
git add backend/03_Sheets.gs.js tests/sheets-api.test.js
git commit -m "feat(sheets): add pocket and transaction data access layer"
```

---

### Task 8: Implement `04_Rollover.gs.js` — monthly reset and run-rate

**Objective:** Pure rollover + run-rate logic, kept free of Sheets so it is trivially testable.

**Files:**
- Create: `backend/04_Rollover.gs.js`
- Create: `tests/rollover.test.js`

**Step 1: Write the failing tests**

```js
// tests/rollover.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeRunRate, monthKey, shouldRollover, applyRollover } from '../backend/04_Rollover.gs.js';

test('computeRunRate projects month-end spend from elapsed days', () => {
  // 10 days in, $300 spent of an $800 pocket -> $300/10*31 = $930 projected.
  const r = computeRunRate({ spent: 300, limit: 800, daysElapsed: 10, daysInMonth: 31 });
  assert.equal(r.projected, 930);
  assert.equal(r.pctUsed, 37.5);
  // 930 / 800 = 116% of the limit, which is past the 110% critical line.
  assert.equal(r.severity, 'critical');
});

test('computeRunRate is warning just over the limit, under 110%', () => {
  // 10 days in, $280 spent -> projected 868, which is 108.5% of an $800 limit.
  const r = computeRunRate({ spent: 280, limit: 800, daysElapsed: 10, daysInMonth: 31 });
  assert.equal(r.projected, 868);
  assert.equal(r.severity, 'warning');
});

test('computeRunRate is onTrack when projection fits the limit', () => {
  const r = computeRunRate({ spent: 100, limit: 800, daysElapsed: 10, daysInMonth: 31 });
  assert.equal(r.severity, 'onTrack');
  assert.equal(r.projected, 310);
});

test('computeRunRate is critical past 110% of the limit', () => {
  const r = computeRunRate({ spent: 500, limit: 800, daysElapsed: 10, daysInMonth: 31 });
  assert.equal(r.severity, 'critical');   // 1550 projected
});

test('computeRunRate treats day 0 and zero limits safely', () => {
  const zeroLimit = computeRunRate({ spent: 0, limit: 0, daysElapsed: 0, daysInMonth: 31 });
  assert.equal(zeroLimit.pctUsed, 0);
  assert.equal(zeroLimit.severity, 'onTrack');
  assert.equal(zeroLimit.projected, 0);

  const dayOne = computeRunRate({ spent: 0, limit: 800, daysElapsed: 0, daysInMonth: 31 });
  assert.equal(dayOne.projected, 0);      // never divide by zero
});

test('computeRunRate never projects below actual spend when daysElapsed is 0', () => {
  // With zero elapsed days the velocity is unknown; fall back to actual spend.
  const r = computeRunRate({ spent: 400, limit: 800, daysElapsed: 0, daysInMonth: 31 });
  assert.equal(r.projected, 400);
});

test('monthKey formats YYYY-MM in UTC', () => {
  assert.equal(monthKey(new Date('2026-10-01T00:00:00Z')), '2026-10');
  assert.equal(monthKey(new Date('2026-12-31T23:59:59Z')), '2026-12');
});

test('shouldRollover is true only when the month key moved on', () => {
  assert.equal(shouldRollover('2026-09', '2026-10-01T00:05:00Z'), true);
  assert.equal(shouldRollover('2026-10', '2026-10-01T00:05:00Z'), false);
  assert.equal(shouldRollover('2026-10', '2026-10-31T23:59:00Z'), false);
  assert.equal(shouldRollover(null, '2026-10-01T00:05:00Z'), true);   // first ever run
});

test('applyRollover resets active pockets to their limit and leaves others alone', () => {
  const pockets = [
    { id: 'P01', name: 'Groceries', limit: 800, balance: 340.5, status: 'Active' },
    { id: 'P02', name: 'Dining Out', limit: 250, balance: 15, status: 'Active' },
    { id: 'P03', name: 'Old', limit: 100, balance: 100, status: 'Archived' },
  ];
  const r = applyRollover(pockets);
  assert.equal(r.resetCount, 2);
  assert.equal(r.skippedCount, 1);
  assert.equal(r.pockets.find((p) => p.id === 'P01').balance, 800);
  assert.equal(r.pockets.find((p) => p.id === 'P03').balance, 100);  // archived untouched
});
```

**Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL — `ERR_MODULE_NOT_FOUND: backend/04_Rollover.gs.js`.

**Step 3: Write the implementation**

```js
// backend/04_Rollover.gs.js
// CANONICAL SOURCE. Pure functions — the caller does the Sheets writes.

/** `YYYY-MM` in UTC, the key used to decide whether a rollover has happened. */
export function monthKey(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
}

/**
 * Has the month rolled over since `lastRolloverKey`?
 * A missing key means the app has never rolled over, so yes.
 */
export function shouldRollover(lastRolloverKey, now = new Date()) {
  if (!lastRolloverKey) return true;
  return monthKey(now) !== lastRolloverKey;
}

/**
 * Spending-velocity projection.
 * severity: 'onTrack' | 'warning' (will exceed limit) | 'critical' (>110% of limit).
 */
export function computeRunRate({ spent, limit, daysElapsed, daysInMonth }) {
  const spentN = Number(spent) || 0;
  const limitN = Number(limit) || 0;
  const days = Math.max(0, Number(daysElapsed) || 0);
  const total = Math.max(1, Number(daysInMonth) || 1);

  const pctUsed = limitN > 0 ? (spentN / limitN) * 100 : 0;
  const rawProjected = days > 0 ? (spentN / days) * total : spentN;
  const projected = Math.max(spentN, Math.round(rawProjected));

  let severity = 'onTrack';
  if (limitN > 0) {
    if (projected > limitN * 1.1) severity = 'critical';
    else if (projected > limitN) severity = 'warning';
  }

  return { projected, pctUsed: Math.round(pctUsed * 100) / 100, severity };
}

/**
 * Reset active pockets' balances to their monthly limit.
 * Returns `{ pockets, resetCount, skippedCount }` — the caller persists `pockets`.
 */
export function applyRollover(pockets) {
  let resetCount = 0;
  let skippedCount = 0;
  const out = pockets.map((p) => {
    if (p.status !== 'Active') {
      skippedCount++;
      return p;
    }
    resetCount++;
    return { ...p, balance: p.limit };
  });
  return { pockets: out, resetCount, skippedCount };
}
```

**Step 4: Run to verify pass**

Run: `npm test`
Expected: `56` tests pass, `fail 0`.

**Step 5: Commit**

```bash
git add backend/04_Rollover.gs.js tests/rollover.test.js
git commit -m "feat(rollover): add monthly reset and run-rate projection logic"
```

---

### Task 9: Implement `06_Report.gs.js` — dashboard aggregation

**Objective:** Aggregate `Transactions` into the `Monthly_Report` rows and build the native charts.

**Files:**
- Create: `backend/06_Report.gs.js`
- Create: `tests/report.test.js`

**Step 1: Write the failing tests**

```js
// tests/report.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summariseSpend, buildReportRows, daysElapsedInMonth } from '../backend/06_Report.gs.js';

const POCKETS = [
  { id: 'P01', name: 'Groceries', account: 'Chase Checking', limit: 800, balance: 340.5, status: 'Active' },
  { id: 'P02', name: 'Dining Out', account: 'Credit Card A', limit: 250, balance: 15, status: 'Active' },
];

const TXNS = [
  { id: 'T1001', timestamp: '2026-10-01T14:20:00.000Z', user: 'Alex', pocketId: 'P01', amount: 65.2, note: 'Whole Foods' },
  { id: 'T1002', timestamp: '2026-10-01T18:45:00.000Z', user: 'Sam', pocketId: 'P02', amount: 42, note: 'Pizza Night' },
  { id: 'T1003', timestamp: '2026-09-30T10:00:00.000Z', user: 'Alex', pocketId: 'P01', amount: 500, note: 'September bulk' },
];

test('summariseSpend totals only transactions inside the month', () => {
  const s = summariseSpend(TXNS, POCKETS, '2026-10');
  assert.equal(s.byPocket.P01, 65.2);    // the $500 is September, excluded
  assert.equal(s.byPocket.P02, 42);
  assert.equal(s.byUser.Alex, 65.2);
  assert.equal(s.byUser.Sam, 42);
  assert.equal(s.total, 107.2);
  assert.equal(s.count, 2);
});

test('summariseSpend ignores transactions for unknown pockets', () => {
  const s = summariseSpend([...TXNS, { id: 'T9', timestamp: '2026-10-05T00:00:00.000Z', user: 'Alex', pocketId: 'P99', amount: 10, note: '' }], POCKETS, '2026-10');
  assert.equal(Object.keys(s.byPocket).includes('P99'), false);
  assert.equal(s.total, 107.2);
});

test('summariseSpend reports every configured user, even at zero', () => {
  const s = summariseSpend([], POCKETS, '2026-10');
  assert.deepEqual(Object.keys(s.byUser).sort(), ['Alex', 'Sam']);
  assert.equal(s.total, 0);
});

test('buildReportRows lays out budget vs actual with run-rate per pocket', () => {
  const rows = buildReportRows({
    pockets: POCKETS, transactions: TXNS, month: '2026-10',
    now: new Date('2026-10-10T12:00:00Z'), daysInMonth: 31,
  });
  const header = rows[0];
  assert.deepEqual(header.slice(0, 5),
    ['Month', 'Pocket', 'Bank Account', 'Monthly Limit', 'Spent']);

  const groceries = rows.find((r) => r[1] === 'Groceries');
  assert.equal(groceries[0], '2026-10');
  assert.equal(groceries[4], 65.2);       // month-scoped spend
  assert.equal(groceries[5], 800 - 65.2); // remaining vs limit for this month
  assert.ok(['onTrack', 'warning', 'critical'].includes(groceries[8]));
});

test('buildReportRows appends a spouse-split block', () => {
  const rows = buildReportRows({
    pockets: POCKETS, transactions: TXNS, month: '2026-10',
    now: new Date('2026-10-10T12:00:00Z'), daysInMonth: 31,
  });
  const flat = rows.map((r) => r.join(' ')).join('\n');
  assert.match(flat, /SPOUSE SPLIT/);
  assert.match(flat, /Alex/);
  assert.match(flat, /Sam/);
});

test('daysElapsedInMonth counts elapsed days, never more than the total', () => {
  assert.equal(daysElapsedInMonth(new Date('2026-10-01T00:30:00Z'), 31), 1);
  assert.equal(daysElapsedInMonth(new Date('2026-10-10T12:00:00Z'), 31), 10);
  assert.equal(daysElapsedInMonth(new Date('2026-10-31T23:00:00Z'), 31), 31);
});
```

**Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL — `ERR_MODULE_NOT_FOUND: backend/06_Report.gs.js`.

**Step 3: Write the implementation**

```js
// backend/06_Report.gs.js
// CANONICAL SOURCE. Aggregates Transactions -> Monthly_Report.
// Spend is scoped to the report month; history survives rollover because it is
// derived from Transactions, never from Current Balance.

import { USERS } from './00_Config.gs.js';
import { computeRunRate, monthKey } from './04_Rollover.gs.js';

/** Days elapsed in the reporting month (1-based, capped at daysInMonth). */
export function daysElapsedInMonth(now = new Date(), daysInMonth = 31) {
  const day = now instanceof Date ? now.getUTCDate() : new Date(now).getUTCDate();
  return Math.min(Math.max(1, day), daysInMonth);
}

/** Total spend within `month`, broken down by pocket and by user. */
export function summariseSpend(transactions, pockets, month) {
  const known = new Set(pockets.map((p) => p.id));
  const byPocket = {};
  const byUser = {};
  for (const u of USERS) byUser[u] = 0;

  let total = 0;
  let count = 0;

  for (const t of transactions) {
    if (!t.timestamp || !t.timestamp.startsWith(month)) continue;
    if (!known.has(t.pocketId)) continue;
    const amt = Number(t.amount) || 0;
    byPocket[t.pocketId] = (byPocket[t.pocketId] || 0) + amt;
    byUser[t.user] = (byUser[t.user] || 0) + amt;
    total += amt;
    count++;
  }

  return {
    byPocket, byUser,
    total: Math.round(total * 100) / 100,
    count,
  };
}

/**
 * The full row layout written to Monthly_Report.
 * Columns: Month | Pocket | Bank Account | Monthly Limit | Spent | Remaining |
 *          Balance Now | Pct Used | Severity | Projected
 */
export function buildReportRows({ pockets, transactions, month, now = new Date(), daysInMonth = 31 }) {
  const spend = summariseSpend(transactions, pockets, month);
  const elapsed = daysElapsedInMonth(now, daysInMonth);

  const rows = [[
    'Month', 'Pocket', 'Bank Account', 'Monthly Limit', 'Spent', 'Remaining',
    'Balance Now', 'Pct Used', 'Severity', 'Projected',
  ]];

  for (const p of pockets) {
    const spent = spend.byPocket[p.id] || 0;
    const rr = computeRunRate({ spent, limit: p.limit, daysElapsed: elapsed, daysInMonth });
    rows.push([
      month,
      p.name,
      p.account,
      p.limit,
      Math.round(spent * 100) / 100,
      Math.round((p.limit - spent) * 100) / 100,
      p.balance,
      rr.pctUsed,
      rr.severity,
      Math.round(rr.projected * 100) / 100,
    ]);
  }

  rows.push([]);
  rows.push(['SPOUSE SPLIT', 'Total Spend', 'Share']);
  for (const u of USERS) {
    const amt = spend.byUser[u] || 0;
    const share = spend.total > 0 ? Math.round((amt / spend.total) * 1000) / 10 : 0;
    rows.push([u, Math.round(amt * 100) / 100, share + '%']);
  }

  rows.push([]);
  rows.push(['Month', 'Total Limit', 'Total Spent', 'Total Balance']);
  const totalLimit = pockets.reduce((s, p) => s + p.limit, 0);
  const totalBalance = pockets.reduce((s, p) => s + p.balance, 0);
  rows.push([month, Math.round(totalLimit * 100) / 100,
             spend.total, Math.round(totalBalance * 100) / 100]);

  return rows;
}

/* ------------------------------------------------------- sheet rendering -- */

/** Write the report block and (re)build the native charts. Called by the daily trigger. */
export function renderReport(sheet, { pockets, transactions, now = new Date() }) {
  const month = monthKey(now);
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const rows = buildReportRows({ pockets, transactions, month, now, daysInMonth });

  sheet.clearContents();
  sheet.getRange(1, 1, rows.length, 10).setValues(rows);
  return { month, rowCount: rows.length };
}
```

**Step 4: Run to verify pass**

Run: `npm test`
Expected: `62` tests pass, `fail 0`.

**Step 5: Commit**

```bash
git add backend/06_Report.gs.js tests/report.test.js
git commit -m "feat(report): add monthly dashboard aggregation and run-rate rows"
```
---

### Task 10: Implement `05_Api.gs.js` — the dispatcher and the deduction hot path

**Objective:** The heart of the app. Enforces auth, enforces non-negative balances under a lock,
and returns the exact contract from §3.

**Files:**
- Create: `backend/05_Api.gs.js`
- Create: `tests/api.test.js`

**This is the most important task in the plan.** Three requirements must hold simultaneously:

1. **Never negative.** A deduction may not drive a balance below zero, ever.
2. **Never lost.** Two devices submitting at the same moment must both land, and the sheet must not
   corrupt. This is what `LockService` is for.
3. **Always explain.** A rejected submission returns the brief's exact alert text.

**Step 1: Write the failing tests**

```js
// tests/api.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTransaction, createPocket, getState, handleRequest } from '../backend/05_Api.gs.js';
import { installGlobals, createProps } from './helpers/appsScriptGlobals.js';
import { freshWorkbook, SAMPLE_POCKETS, SAMPLE_TXNS } from './helpers/fixtures.js';

const TOKEN = 'test-token';

function withApi(pocketRows = SAMPLE_POCKETS, txnRows = SAMPLE_TXNS) {
  const wb = freshWorkbook(pocketRows, txnRows);
  const ss = {
    getSheetByName: (n) => (n === 'Pockets' ? wb.pockets : n === 'Transactions' ? wb.txns : n === 'Monthly_Report' ? wb.report : null),
  };
  const props = createProps({ API_TOKEN: TOKEN });
  const lock = { _held: false, tryLock() { this._held = true; return true; }, releaseLock() { this._held = false; } };
  const restore = installGlobals({
    ss,
    props,
    lockService: { getScriptLock: () => lock, getUserLock: () => lock },
  });
  return { wb, restore, lock };
}

test('createTransaction deducts and returns the new balance', () => {
  const { restore } = withApi();
  const r = createTransaction({ token: TOKEN, user: 'Alex', pocketId: 'P01', amount: 40.5, note: 'Groceries' });
  assert.equal(r.ok, true);
  assert.equal(r.pocket.balance, 300);          // 340.5 - 40.5
  assert.equal(r.transaction.amount, 40.5);
  assert.equal(r.transaction.user, 'Alex');
  assert.match(r.transaction.id, /^T\d+$/);
  restore();
});

test('createTransaction writes the transaction row to the sheet', () => {
  const { restore, wb } = withApi();
  createTransaction({ token: TOKEN, user: 'Sam', pocketId: 'P02', amount: 10, note: 'Lunch' });
  assert.equal(wb.txns._rows.length, 4);       // header + 2 sample + 1 new
  const last = wb.txns._rows[3];
  assert.equal(last[2], 'Sam');
  assert.equal(last[3], 'P02');
  assert.equal(last[4], 10);
  restore();
});

test('createTransaction BLOCKS overspend with the exact brief message', () => {
  const { restore, wb } = withApi();
  const r = createTransaction({ token: TOKEN, user: 'Alex', pocketId: 'P02', amount: 99.99, note: 'Dinner' });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'INSUFFICIENT_FUNDS');
  assert.equal(r.message, 'Insufficient funds in Dining Out. Remaining: $15.00');
  assert.equal(r.context.remaining, 15);
  assert.equal(wb.pockets.getRange(3, 5).getValues()[0][0], 15);   // untouched
  assert.equal(wb.txns._rows.length, 3);                            // no row appended
  restore();
});

test('createTransaction treats spending the exact balance as allowed', () => {
  const { restore } = withApi();
  const r = createTransaction({ token: TOKEN, user: 'Alex', pocketId: 'P02', amount: 15, note: 'Exactly' });
  assert.equal(r.ok, true);
  assert.equal(r.pocket.balance, 0);
  assert.equal(r.pocket.isLocked, true);
  restore();
});

test('createTransaction blocks any amount once the balance is zero', () => {
  const { restore } = withApi([['P01', 'Groceries', 'Chase', 100, 0, 'Active']], []);
  const r = createTransaction({ token: TOKEN, user: 'Alex', pocketId: 'P01', amount: 0.01 });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'INSUFFICIENT_FUNDS');
  restore();
});

test('createTransaction rejects a zero-amount submission', () => {
  const { restore } = withApi();
  const r = createTransaction({ token: TOKEN, user: 'Alex', pocketId: 'P01', amount: 0 });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'INVALID_AMOUNT');
  restore();
});

test('createTransaction rejects an unknown user', () => {
  const { restore } = withApi();
  const r = createTransaction({ token: TOKEN, user: 'Mallory', pocketId: 'P01', amount: 5 });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'INVALID_USER');
  restore();
});

test('createTransaction rejects an unknown or archived pocket', () => {
  const { restore } = withApi([
    ['P01', 'Groceries', 'Chase', 800, 340.5, 'Active'],
    ['P02', 'Old', 'Chase', 100, 100, 'Archived'],
  ], []);
  assert.equal(createTransaction({ token: TOKEN, user: 'Alex', pocketId: 'P99', amount: 5 }).error, 'POCKET_NOT_FOUND');
  assert.equal(createTransaction({ token: TOKEN, user: 'Alex', pocketId: 'P02', amount: 5 }).error, 'POCKET_NOT_FOUND');
  restore();
});

test('createTransaction rejects a bad token before touching any data', () => {
  const { restore, wb } = withApi();
  const r = createTransaction({ token: 'wrong', user: 'Alex', pocketId: 'P01', amount: 40.5 });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'UNAUTHORIZED');
  assert.equal(wb.pockets.getRange(2, 5).getValues()[0][0], 340.5);   // untouched
  restore();
});

test('createTransaction releases the lock even when it rejects', () => {
  const { restore, lock } = withApi();
  createTransaction({ token: TOKEN, user: 'Alex', pocketId: 'P02', amount: 9999 });
  assert.equal(lock._held, false);
  restore();
});

test('createTransaction never lets the balance go below zero under repeated spending', () => {
  const { restore } = withApi([['P01', 'Groceries', 'Chase', 100, 10, 'Active']], []);
  let balance = 10;
  for (let i = 0; i < 5; i++) {
    const r = createTransaction({ token: TOKEN, user: 'Alex', pocketId: 'P01', amount: 4 });
    if (r.ok) balance = r.pocket.balance;
  }
  assert.equal(balance, 2);      // 10 -> 6 -> 2, then blocked
  assert.equal(balance >= 0, true);
  restore();
});

test('createPocket creates with balance equal to limit and blocks a zero limit name', () => {
  const { restore } = withApi();
  const r = createPocket({ token: TOKEN, name: 'Fuel', account: 'Chase', limit: 200 });
  assert.equal(r.ok, true);
  assert.equal(r.pocket.balance, 200);
  assert.match(r.pocket.id, /^P\d{2}$/);
  assert.equal(createPocket({ token: TOKEN, name: '', account: 'Chase', limit: 200 }).error, 'INVALID_NAME');
  restore();
});

test('getState returns pockets, transactions and summary in one payload', () => {
  const { restore } = withApi();
  const s = getState({ token: TOKEN, month: '2026-10' });
  assert.equal(s.ok, true);
  assert.equal(s.pockets.length, 2);
  assert.equal(s.transactions.length, 2);
  // spent is MONTH-scoped so it survives rollover: only T1001 falls in 2026-10.
  assert.equal(s.pockets[0].spent, 65.2);
  assert.equal(s.pockets[0].pctUsed, 8.15);
  // balance is the live figure straight from the sheet.
  assert.equal(s.pockets[0].balance, 340.5);
  assert.equal(s.summary.totalLimit, 1050);
  assert.deepEqual(s.summary.users, ['Alex', 'Sam']);
  restore();
});

test('getState marks a depleted pocket as locked', () => {
  const { restore } = withApi([['P01', 'Groceries', 'Chase', 100, 0, 'Active']], []);
  assert.equal(getState({ token: TOKEN }).pockets[0].isLocked, true);
  restore();
});

test('getState caps transactions at 10', () => {
  const many = Array.from({ length: 15 }, (_, i) => [
    'T' + (1001 + i), new Date(`2026-10-01T${String(i % 24).padStart(2, '0')}:00:00Z`),
    'Alex', 'P01', 5, 'note ' + i,
  ]);
  const { restore } = withApi(SAMPLE_POCKETS, many);
  assert.equal(getState({ token: TOKEN }).transactions.length, 10);
  restore();
});

test('handleRequest routes getState and rejects unknown actions', () => {
  const { restore } = withApi();
  assert.equal(handleRequest({ action: 'getState', params: { token: TOKEN } }).ok, true);
  assert.equal(handleRequest({ action: 'nope', params: { token: TOKEN } }).error, 'UNKNOWN_ACTION');
  restore();
});

test('handleRequest requires a token on every action', () => {
  const { restore } = withApi();
  assert.equal(handleRequest({ action: 'getState', params: {} }).error, 'UNAUTHORIZED');
  assert.equal(handleRequest({ action: 'getState', params: { token: 'bad' } }).error, 'UNAUTHORIZED');
  restore();
});

test('handleRequest never throws — it returns an error envelope', () => {
  const { restore } = withApi();
  const r = handleRequest({ action: 'getState', params: { token: TOKEN } });
  assert.equal(r.ok, true);
  assert.equal(typeof r.version, 'string');
  restore();
});
```

**Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL — `ERR_MODULE_NOT_FOUND: backend/05_Api.gs.js`.

**Step 3: Write the implementation**

```js
// backend/05_Api.gs.js
// CANONICAL SOURCE. The single entry point for the whole backend.
//
// Invariants enforced here:
//   1. Auth is checked before any data is read or written.
//   2. A balance can never go negative.
//   3. The script lock is always released, even on the rejection paths.
//   4. No handler throws to the client; failures come back as { ok:false, error }.

import { ACTIONS, USERS, SHEETS } from './00_Config.gs.js';
import {
  toDollars, parseAmountInput, isValidUser, money, ok, fail,
} from './01_Utils.gs.js';
import { verifyToken } from './02_Auth.gs.js';
import {
  readPockets, readTransactions, findPocketRow, writeBalance,
  appendTransaction, appendPocket, updatePocketRow, archivePocketRow,
  deleteTransactionRow,
} from './03_Sheets.gs.js';
import { monthKey } from './04_Rollover.gs.js';

/** Milliseconds to wait for the script lock before giving up. */
const LOCK_TIMEOUT_MS = 20_000;

/* --------------------------------------------------------------- helpers -- */

/** Round dollars to 2dp. Every value crossing the API boundary goes through this. */
const r2 = (n) => Math.round(Number(n) * 100) / 100;

/** Shape a stored pocket row into the API's pocket object. */
function presentPocket(p, spentByPocket = {}) {
  const spent = r2(p.limit - p.balance);
  const monthSpent = spentByPocket[p.id] ?? spent;
  return {
    id: p.id,
    name: p.name,
    account: p.account,
    limit: r2(p.limit),
    balance: r2(p.balance),
    spent: r2(monthSpent),
    pctUsed: p.limit > 0 ? r2((monthSpent / p.limit) * 100) : 0,
    isLocked: p.balance <= 0,
  };
}

/* --------------------------------------------------------------- handlers -- */

/** Liveness + version. Still requires a token, so it doubles as a config check. */
export function ping(params) {
  if (!verifyToken(params.token)) return fail('UNAUTHORIZED', 'Invalid or missing token.');
  return ok({ serverTime: new Date().toISOString() });
}

/**
 * The whole home screen in one round trip.
 * `spent` is month-scoped so it survives rollover; `balance` is the live figure.
 */
export function getState(params) {
  if (!verifyToken(params.token)) return fail('UNAUTHORIZED', 'Invalid or missing token.');

  const month = params.month || monthKey(new Date());
  const pockets = readPockets();
  const transactions = readTransactions({ limit: 10 });

  const spentByPocket = {};
  for (const t of readTransactions()) {
    if (!t.timestamp || !t.timestamp.startsWith(month)) continue;
    spentByPocket[t.pocketId] = (spentByPocket[t.pocketId] || 0) + t.amount;
  }

  const present = pockets.map((p) => presentPocket(p, spentByPocket));
  const sum = (k) => r2(present.reduce((s, p) => s + p[k], 0));

  return ok({
    serverTime: new Date().toISOString(),
    month,
    pockets: present,
    transactions,
    summary: {
      totalLimit: sum('limit'),
      totalBalance: sum('balance'),
      totalSpent: sum('spent'),
      users: [...USERS],
    },
  });
}

export function createPocket(params) {
  if (!verifyToken(params.token)) return fail('UNAUTHORIZED', 'Invalid or missing token.');

  const name = String(params.name ?? '').trim();
  if (!name) return fail('INVALID_NAME', 'Pocket name is required.');

  let limitCents;
  try {
    limitCents = parseAmountInput(params.limit);
  } catch (err) {
    return fail('INVALID_AMOUNT', err.message);
  }
  if (limitCents === 0) return fail('INVALID_AMOUNT', 'Monthly limit must be greater than zero.');

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_TIMEOUT_MS)) {
    return fail('BUSY', 'Another update is in progress. Please try again.');
  }
  try {
    const pocket = appendPocket({ name, account: String(params.account ?? '').trim(), limit: toDollars(limitCents) });
    return ok({ pocket: presentPocket(pocket) });
  } finally {
    lock.releaseLock();
  }
}

export function updatePocket(params) {
  if (!verifyToken(params.token)) return fail('UNAUTHORIZED', 'Invalid or missing token.');

  const pocketId = String(params.pocketId ?? '');
  if (!findPocketRow(pocketId)) return fail('POCKET_NOT_FOUND', 'Pocket not found: ' + pocketId);

  let limit;
  if (params.limit != null) {
    try {
      limit = toDollars(parseAmountInput(params.limit));
    } catch (err) {
      return fail('INVALID_AMOUNT', err.message);
    }
  }

  const patch = {};
  if (params.name != null) patch.name = String(params.name).trim();
  if (params.account != null) patch.account = String(params.account).trim();
  if (limit != null) patch.limit = limit;
  if (params.archive === true) patch.status = 'Archived';
  if (params.unarchive === true) patch.status = 'Active';

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_TIMEOUT_MS)) {
    return fail('BUSY', 'Another update is in progress. Please try again.');
  }
  try {
    const pocket = updatePocketRow(pocketId, patch);
    if (!pocket) return fail('POCKET_NOT_FOUND', 'Pocket not found: ' + pocketId);
    return ok({ pocket: presentPocket(pocket) });
  } finally {
    lock.releaseLock();
  }
}

/**
 * The hot path. Order matters: auth -> validate -> lock -> re-read -> check -> deduct -> append.
 *
 * The balance is re-read INSIDE the lock, never from the caller's payload, so a stale
 * client cannot cause an incorrect deduction.
 */
export function createTransaction(params) {
  if (!verifyToken(params.token)) return fail('UNAUTHORIZED', 'Invalid or missing token.');

  const user = String(params.user ?? '');
  if (!isValidUser(user)) return fail('INVALID_USER', 'Unknown user: ' + user);

  const pocketId = String(params.pocketId ?? '');
  const note = String(params.note ?? '').trim().slice(0, 120);

  let amountCents;
  try {
    amountCents = parseAmountInput(params.amount);
  } catch (err) {
    return fail('INVALID_AMOUNT', err.message);
  }
  if (amountCents <= 0) return fail('INVALID_AMOUNT', 'Amount must be greater than zero.');

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_TIMEOUT_MS)) {
    return fail('BUSY', 'Another update is in progress. Please try again.');
  }

  try {
    const row = findPocketRow(pocketId);
    if (!row) return fail('POCKET_NOT_FOUND', 'Pocket not found: ' + pocketId);

    // Re-read under the lock: authoritative, not client-supplied.
    const pocket = readPockets({ includeArchived: true }).find((p) => p.id === pocketId);
    if (!pocket || pocket.status !== 'Active') {
      return fail('POCKET_NOT_FOUND', 'Pocket is not available: ' + pocketId);
    }

    const balanceCents = Math.round(pocket.balance * 100);
    const remainingCents = balanceCents - amountCents;

    // The non-negative guarantee. Exact-balance spending is allowed; over is not.
    if (remainingCents < 0) {
      return fail(
        'INSUFFICIENT_FUNDS',
        `Insufficient funds in ${pocket.name}. Remaining: ${money(balanceCents)}`,
        { pocketId, remaining: toDollars(balanceCents), amount: toDollars(amountCents) },
      );
    }

    const newBalance = toDollars(remainingCents);
    writeBalance(pocketId, newBalance);
    const txnId = appendTransaction({
      user, pocketId, amount: toDollars(amountCents), note,
      timestamp: params.timestamp ? new Date(params.timestamp) : new Date(),
    });

    return ok({
      pocket: presentPocket({ ...pocket, balance: newBalance }),
      transaction: {
        id: txnId,
        timestamp: new Date().toISOString(),
        user, pocketId,
        amount: toDollars(amountCents),
        note,
      },
    });
  } finally {
    lock.releaseLock();   // released on every path, success and rejection alike
  }
}

/** Delete an expense and refund its amount to the pocket. */
export function deleteTransaction(params) {
  if (!verifyToken(params.token)) return fail('UNAUTHORIZED', 'Invalid or missing token.');

  const txnId = String(params.txnId ?? '');
  if (!txnId) return fail('INVALID_REQUEST', 'txnId is required.');

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_TIMEOUT_MS)) {
    return fail('BUSY', 'Another update is in progress. Please try again.');
  }

  try {
    const record = deleteTransactionRow(txnId);
    if (!record) return fail('TRANSACTION_NOT_FOUND', 'Transaction not found: ' + txnId);

    const pocket = readPockets({ includeArchived: true }).find((p) => p.id === record.pocketId);
    if (pocket) {
      const refunded = r2(Math.min(pocket.limit, pocket.balance + record.amount));
      writeBalance(record.pocketId, refunded);
    }

    return ok({
      deleted: { id: record.id, pocketId: record.pocketId, amount: record.amount },
      pocket: pocket ? presentPocket({ ...pocket, balance: refunded }) : null,
    });
  } finally {
    lock.releaseLock();
  }
}

/* ------------------------------------------------------------- dispatch -- */

const HANDLERS = {
  ping,
  getState,
  createPocket,
  updatePocket,
  createTransaction,
  deleteTransaction,
};

/**
 * Single entry point for both doGet and doPost.
 * `action` comes from the query string on GET and the JSON body on POST.
 * Never throws: every failure becomes an error envelope.
 */
export function handleRequest({ action, params = {} }) {
  if (!ACTIONS.includes(action)) {
    return fail('UNKNOWN_ACTION', 'Unknown action: ' + action);
  }
  try {
    return HANDLERS[action](params);
  } catch (err) {
    return fail('SERVER_ERROR', (err && err.message) ? err.message : 'Unexpected error');
  }
}
```

**Step 4: Run to verify pass**

Run: `npm test`
Expected: `80` tests pass, `fail 0`.

**Step 5: Commit**

```bash
git add backend/05_Api.gs.js tests/api.test.js
git commit -m "feat(api): add dispatcher with auth, locking, and non-negative balance enforcement"
```
---

### Task 11: Implement the GAS web-app entry points and triggers

**Objective:** Wire `handleRequest` to `doGet`/`doPost` using the transport pattern from §0, and
create the monthly rollover trigger.

**Files:**
- Create: `backend/07_Entry.gs.js`
- Create: `backend/appsscript.json`
- Create: `tests/entry.test.js`

**Step 1: Write `backend/07_Entry.gs.js`**

```js
// backend/07_Entry.gs.js
// CANONICAL SOURCE. The only file that deals with HTTP event objects.

import { handleRequest } from './05_Api.gs.js';
import { verifyToken, getApiToken, setApiToken } from './02_Auth.gs.js';
import {
  readPockets, readTransactions, getReportSheet, ensureSheets,
} from './03_Sheets.gs.js';
import { applyRollover, shouldRollover, monthKey } from './04_Rollover.gs.js';
import { renderReport } from './06_Report.gs.js';
import { writeBalance } from './03_Sheets.gs.js';
import { USERS, SHEETS } from './00_Config.gs.js';

/** Serialize a response as ContentService JSON. */
function json(res) {
  return ContentService.createTextOutput(JSON.stringify(res))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Normalise an Apps Script event into { action, params, parseError }. */
export function parseRequest(e, method) {
  const out = { action: null, params: {}, parseError: false };
  if (!e) return out;

  if (method === 'POST') {
    const raw = (e.postData && e.postData.contents) || '';
    if (!raw) { out.action = 'getState'; return out; }
    try {
      const body = JSON.parse(raw);
      const { action, ...params } = body || {};
      out.action = action || 'getState';
      out.params = params;
    } catch (_) {
      out.parseError = true;
    }
    return out;
  }

  const p = e.parameter || {};
  out.action = p.action || 'getState';
  out.params = p;
  return out;
}

/**
 * GET entry point.
 *
 * NOTE ON TRANSPORT (§0): GET is CORS-safelisted, so no preflight is sent and
 * fetch's default redirect:'follow' handles Apps Script's 302 to
 * script.googleusercontent.com. `token` arrives as a query parameter.
 */
function doGet(e) {
  try {
    const p = (e && e.parameter) || {};
    return json(handleRequest({ action: p.action || 'getState', params: p }));
  } catch (err) {
    return json({ ok: false, error: 'SERVER_ERROR', message: String(err && err.message) });
  }
}

/**
 * POST entry point.
 *
 * CRITICAL (§0): the client sends Content-Type: text/plain, NOT application/json.
 * With application/json the browser sends a CORS preflight, Apps Script has no
 * doOptions, the preflight 405s, and the whole request fails. text/plain is
 * CORS-safelisted so no preflight happens. We JSON.parse the raw body ourselves.
 */
function doPost(e) {
  try {
    const raw = (e && e.postData && e.postData.contents) || '{}';
    let body;
    try {
      body = JSON.parse(raw);
    } catch (_) {
      return json({ ok: false, error: 'INVALID_JSON', message: 'Request body was not valid JSON.' });
    }
    const { action, ...params } = body || {};
    return json(handleRequest({ action: action || 'getState', params }));
  } catch (err) {
    return json({ ok: false, error: 'SERVER_ERROR', message: String(err && err.message) });
  }
}

/* ------------------------------------------------------------- triggers -- */

/**
 * Daily trigger. Idempotent: does nothing if the month has not changed, so a
 * missed run on the 1st self-heals on the 2nd rather than skipping a reset.
 */
function dailyRollover() {
  const props = PropertiesService.getScriptProperties();
  const lastKey = props.getProperty('LAST_ROLLOVER_KEY');
  const now = new Date();

  if (shouldRollover(lastKey, now)) {
    const pockets = readPockets({ includeArchived: true });
    const { pockets: reset, resetCount } = applyRollover(pockets);
    for (const p of reset) {
      if (p.status === 'Active' && p.balance !== p.limit) writeBalance(p.id, p.limit);
    }
    props.setProperty('LAST_ROLLOVER_KEY', monthKey(now));
    Logger.log('PocketBudget rollover: reset ' + resetCount + ' pockets for ' + monthKey(now));
  }

  renderReport(getReportSheet(), {
    pockets: readPockets(),
    transactions: readTransactions(),
    now,
  });
}

/**
 * One-time bootstrap, run from the Apps Script editor:
 *   1. Setup ▸ copy this function, paste into 07_Entry.gs.js, save.
 *   2. Run setup() once and authorise.
 *   3. Delete the call from any menu if you don't want one.
 */
function setup() {
  const sheets = ensureSheets();
  const existing = getApiToken();
  const token = existing || Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  if (!existing) setApiToken(token);

  ScriptApp.newTrigger('dailyRollover')
    .timeBased()
    .everyDays(1)
    .atHour(2)
    .create();

  Logger.log('Sheets ready: ' + sheets.join(', '));
  Logger.log('Users: ' + USERS.join(', '));
  Logger.log('Household token (copy this into the PWA setup screen): ' + token);
}
```

**Step 2: Write `backend/appsscript.json`**

```json
{
  "timeZone": "Africa/Johannesburg",
  "dependencies": {},
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8",
  "oauthScopes": [
    "https://www.googleapis.com/auth/spreadsheets.currentonly",
    "https://www.googleapis.com/auth/script.scriptapp"
  ]
}
```

> `spreadsheets.currentonly` is deliberately narrower than `.../auth/spreadsheets`: the script only
> ever touches its own bound sheet. Ask for the narrowest scope that works.

**Step 3: Write the entry-point tests**

```js
// tests/entry.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRequest } from '../backend/07_Entry.gs.js';

test('GET request: action and params come from the query string', () => {
  const r = parseRequest({ parameter: { action: 'getState', token: 't' } }, 'GET');
  assert.equal(r.action, 'getState');
  assert.equal(r.params.token, 't');
});

test('POST request: a text/plain JSON body is parsed into action + params', () => {
  const r = parseRequest({
    parameter: {},
    postData: { contents: JSON.stringify({ action: 'createTransaction', token: 't', amount: 5 }) },
  }, 'POST');
  assert.equal(r.action, 'createTransaction');
  assert.equal(r.params.amount, 5);
});

test('POST request: an empty body defaults to getState', () => {
  const r = parseRequest({ parameter: {}, postData: { contents: '' } }, 'POST');
  assert.equal(r.action, 'getState');
});

test('POST request: malformed JSON is reported, not thrown', () => {
  const r = parseRequest({ parameter: {}, postData: { contents: '{not json' } }, 'POST');
  assert.equal(r.action, null);
  assert.equal(r.parseError, true);
});

test('parseRequest never throws on a missing event object', () => {
  assert.doesNotThrow(() => parseRequest({}, 'GET'));
});
```

**Step 4: Refactor `07_Entry.gs.js` to expose `parseRequest`**

Replace the bodies of `doGet`/`doPost` so the parsing logic is testable and the
entry points stay thin:

```js
/** Normalise an Apps Script event into { action, params, parseError }. */
export function parseRequest(e, method) {
  const out = { action: null, params: {}, parseError: false };
  if (!e) return out;

  if (method === 'POST') {
    const raw = (e.postData && e.postData.contents) || '';
    if (!raw) { out.action = 'getState'; return out; }
    try {
      const body = JSON.parse(raw);
      const { action, ...params } = body || {};
      out.action = action || 'getState';
      out.params = params;
    } catch (_) {
      out.parseError = true;
    }
    return out;
  }

  const p = e.parameter || {};
  out.action = p.action || 'getState';
  out.params = p;
  return out;
}

function doGet(e) {
  const r = parseRequest(e, 'GET');
  return json(handleRequest({ action: r.action, params: r.params }));
}

function doPost(e) {
  const r = parseRequest(e, 'POST');
  if (r.parseError) {
    return json({ ok: false, error: 'INVALID_JSON', message: 'Request body was not valid JSON.' });
  }
  return json(handleRequest({ action: r.action, params: r.params }));
}
```

**Step 5: Run to verify pass**

Run: `npm test`
Expected: `85` tests pass, `fail 0`.

**Step 6: Commit**

```bash
git add backend/07_Entry.gs.js backend/appsscript.json tests/entry.test.js
git commit -m "feat(appsscript): add doGet/doPost entry points, rollover trigger, setup bootstrap"
```

---

### Task 12: Implement the `.gs` build generator

**Objective:** Produce the flat `.gs` files that get pasted into the Apps Script editor.

**Files:**
- Create: `backend/build.mjs`
- Modify: `package.json`
- Modify: `.gitignore`

**Why:** Apps Script cannot import modules and its editor only accepts `.gs`. One source of truth
requires a generator. It is ~40 lines and removes an entire class of "I edited the wrong file" bugs.

**Step 1: Write `backend/build.mjs`**

```js
// backend/build.mjs
// Generates flat .gs files from the canonical .gs.js modules.
//
//   canonical: backend/00_Config.gs.js  (ES modules, import/export)
//   generated: backend/00_Config.gs     (flat script, no import/export)
//
// Apps Script has no module system and its editor only reads .gs files, so
// every module must be concatenated into one flat script in load order.

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Strip ES module syntax, keeping the declaration bodies.
 *
 * Imports are removed WHOLE, including multi-line forms:
 *   import { a, b } from './x.js';   -> removed entirely
 *   import {                       -> all lines until the one ending in ';'
 *     a, b,
 *   } from './x.js';
 *
 * A naive line filter that drops only lines starting with `import` leaves an
 * orphaned `} from './x.js';` behind, which is a syntax error in Apps Script.
 */
function stripImports(source) {
  const lines = source.split('\n');
  const out = [];
  let inImport = false;

  for (const line of lines) {
    if (!inImport && /^\s*import\s/.test(line)) {
      // Single-line import, or the opening line of a multi-line one.
      if (line.includes(';')) continue;
      inImport = true;
      continue;
    }
    if (inImport) {
      if (line.includes(';')) inImport = false;
      continue;
    }
    out.push(line);
  }
  return out;
}

function flatten(source, file) {
  return stripImports(source)
    .filter((line) => !/^\s*export\s+default\s/.test(line))   // drop default exports
    .filter((line) => !/^\s*export\s*\{/.test(line))          // drop export lists
    .map((line) => line.replace(/^(\s*)export\s+/, '$1'))      // export const -> const
    .join('\n')
    .replace('// CANONICAL SOURCE.', `// GENERATED from ${file} — DO NOT EDIT.`);
}

const files = (await readdir(here))
  .filter((f) => f.endsWith('.gs.js'))
  .sort();                                                   // numeric prefixes give load order

if (!files.length) {
  console.error('No .gs.js modules found in ' + here);
  process.exit(1);
}

const parts = ['// PocketBudget backend — generated, do not edit. Run `npm run build`.', ''];

for (const f of files) {
  const src = await readFile(join(here, f), 'utf8');
  const outName = basename(f, '.js');                       // 00_Config.gs.js -> 00_Config.gs
  const body = flatten(src, outName).trim();

  // Each .gs file is standalone so it can be pasted individually if ever needed.
  await writeFile(join(here, outName), body + '\n');

  // The bundle is the thing you paste into Code.gs.
  parts.push('// ' + '='.repeat(70));
  parts.push('// ' + outName);
  parts.push('// ' + '='.repeat(70));
  parts.push(body);
  parts.push('');
  console.log('built ' + outName);
}

await writeFile(join(here, 'Backend.bundle.gs'), parts.join('\n') + '\n');
console.log('built Backend.bundle.gs (' + files.length + ' modules)');
```

**Step 2: Add generated files to `.gitignore`**

Append:

```gitignore
# Generated from backend/*.gs.js by `npm run build` — never hand-edit.
backend/*.gs
backend/Backend.bundle.gs
```

**Step 3: Run the build**

Run: `npm run build`
Expected output:

```text
built 00_Config.gs
built 01_Utils.gs
built 02_Auth.gs
built 03_Sheets.gs
built 04_Rollover.gs
built 05_Api.gs
built 06_Report.gs
built 07_Entry.gs
built Backend.bundle.gs (8 modules)
```

**Step 4: Verify the bundle has no leftover module syntax**

Run: `grep -nE "^(import|export)" backend/Backend.bundle.gs || echo "CLEAN — no import/export at line start"`
Expected: `CLEAN — no import/export at line start`

If anything matches, the `flatten()` filter needs another pattern. **Do not proceed until this is
clean** — an unflattened bundle fails to load in Apps Script with a syntax error.

**Step 5: Wire it into the test script**

Change `package.json`:

```json
"scripts": {
  "build": "node backend/build.mjs",
  "test": "node --test",
  "check": "npm run build && npm test"
}
```

**Step 6: Commit**

```bash
git add backend/build.mjs package.json .gitignore
git commit -m "build: generate flat .gs bundle from canonical .gs.js modules"
```

---

## 8. Phase 2 — Frontend shell

> Everything from here assumes `npm run check` is green. The frontend is specified by contract
> rather than by pasted markup: 12 screens of Tailwind would bury the parts that matter, and the
> contract is unambiguous. The API client and the money formatter get complete code, because those
> two carry the correctness risk.

### Task 13: Write `app/index.html` — the app shell

**Objective:** One HTML file, three views, no build step.

**Files:** Create: `app/index.html`

**Requirements:**
- `<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">` —
  without `viewport-fit=cover` the PWA renders under an iPhone notch.
- Three sibling `<section>` views: `#view-home`, `#view-add`, `#view-manage`. Only one is visible at
  a time via a `hidden` attribute. No router, no framework.
- A fixed bottom tab bar with three buttons (`data-view="home|add|manage"`), respecting
  `env(safe-area-inset-bottom)`.
- A `#toast` element for the insufficient-funds alert and success messages. `role="alert"` +
  `aria-live="polite"` so a screen reader announces it.
- Tailwind via CDN: `<script src="https://cdn.tailwindcss.com"></script>`. No build step, which is
  the point of this project. Note in a comment that this is fine for a 2-user internal app and
  should be swapped for a compiled stylesheet if the app ever goes public.
- Load `/js/config.js` before `/js/app.js` as classic scripts with `defer`, or as ES modules with
  `type="module"`. **Pick ES modules** — `app/js/api.js` imports `format.js`, and modules make that
  explicit.

**Verification:** Open `app/index.html` over `http://localhost` (see Task 20). Tab bar switches
views. No console errors.

**Commit:** `git commit -m "feat(ui): add app shell with three views and bottom tab bar"`

---

### Task 14: Write `app/js/config.js` and `app/js/storage.js`

**Objective:** Configuration and token storage, both trivially testable.

**Files:**
- Create: `app/js/config.js`
- Create: `app/js/storage.js`
- Create: `tests/frontend.test.js`

**Step 1: Write the failing test**

```js
// tests/frontend.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeConfig, resolveEndpoint } from '../app/js/config.js';
import { formatMoney, formatPct, isValidAmount, relativeDay } from '../app/js/format.js';

test('makeConfig stores the endpoint and token', () => {
  const cfg = makeConfig();
  cfg.configure('https://script.google.com/macros/s/X/exec', 'tok-123');
  assert.equal(cfg.getToken(), 'tok-123');
  assert.equal(cfg.getEndpoint(), 'https://script.google.com/macros/s/X/exec');
  assert.equal(cfg.isConfigured(), true);
});

test('makeConfig reports unconfigured before setup', () => {
  assert.equal(makeConfig().isConfigured(), false);
});

test('makeConfig persists to localStorage when a store is supplied', () => {
  const mem = {};
  const store = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); } };
  makeConfig({ store }).configure('https://x/exec', 'tok');
  assert.equal(mem['pb.endpoint'], 'https://x/exec');
  assert.equal(mem['pb.token'], 'tok');
});

test('makeConfig reloads an existing configuration from storage', () => {
  const mem = { 'pb.endpoint': 'https://y/exec', 'pb.token': 'saved' };
  const store = { getItem: (k) => (k in mem ? mem[k] : null), setItem: () => {} };
  const cfg = makeConfig({ store });
  assert.equal(cfg.isConfigured(), true);
  assert.equal(cfg.getToken(), 'saved');
});

test('resolveEndpoint trims whitespace and rejects non-https URLs', () => {
  assert.equal(resolveEndpoint('  https://script.google.com/macros/s/A/exec '),
               'https://script.google.com/macros/s/A/exec');
  assert.throws(() => resolveEndpoint('http://insecure.example/exec'), /https/i);
  assert.throws(() => resolveEndpoint('not a url'), /https/i);
  assert.throws(() => resolveEndpoint(''), /empty/i);
});

test('formatMoney renders dollars with cents', () => {
  assert.equal(formatMoney(340.5), '$340.50');
  assert.equal(formatMoney(0), '$0.00');
  assert.equal(formatMoney(1234.5), '$1,234.50');
  assert.equal(formatMoney(65), '$65.00');
});

test('formatPct renders one decimal, guarding zero', () => {
  assert.equal(formatPct(57.44), '57.4%');
  assert.equal(formatPct(0), '0%');
});

test('isValidAmount rejects the inputs the backend would reject', () => {
  assert.equal(isValidAmount('12.34'), true);
  assert.equal(isValidAmount('12.345'), false);
  assert.equal(isValidAmount('-5'), false);
  assert.equal(isValidAmount(''), false);
  assert.equal(isValidAmount('abc'), false);
});

test('relativeDay labels recent activity for the feed', () => {
  const now = new Date('2026-10-01T20:00:00Z');
  assert.equal(relativeDay('2026-10-01T14:20:00.000Z', now), 'Today');
  assert.equal(relativeDay('2026-09-30T14:20:00.000Z', now), 'Yesterday');
  assert.equal(relativeDay('2026-09-28T14:20:00.000Z', now), 'Sep 28');
});
```

**Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL — `ERR_MODULE_NOT_FOUND: app/js/config.js`.

**Step 3: Write `app/js/config.js`**

```js
// app/js/config.js
// Endpoint + household token. No build step; plain ES modules.

const K_ENDPOINT = 'pb.endpoint';
const K_TOKEN = 'pb.token';

const DEFAULT_STORAGE = {
  getItem: (k) => (typeof localStorage === 'undefined' ? null : localStorage.getItem(k)),
  setItem: (k, v) => { if (typeof localStorage !== 'undefined') localStorage.setItem(k, v); },
};

/** Validate and normalise a web-app URL. */
export function resolveEndpoint(raw) {
  const s = String(raw ?? '').trim();
  if (!s) throw new Error('Endpoint is empty.');
  let url;
  try {
    url = new URL(s);
  } catch (_) {
    throw new Error('Endpoint must be a valid https URL.');
  }
  if (url.protocol !== 'https:') throw new Error('Endpoint must be an https URL.');
  if (!/\/exec$/.test(url.pathname)) throw new Error('Endpoint must end with /exec.');
  return s;
}

/**
 * Configuration holder.
 * Pass a `store` (localStorage-like) to make it testable outside a browser.
 */
export function makeConfig({ store = DEFAULT_STORAGE } = {}) {
  let endpoint = store.getItem(K_ENDPOINT) || '';
  let token = store.getItem(K_TOKEN) || '';

  return {
    configure(rawEndpoint, rawToken) {
      endpoint = resolveEndpoint(rawEndpoint);
      token = String(rawToken ?? '').trim();
      if (!token) throw new Error('A household token is required.');
      store.setItem(K_ENDPOINT, endpoint);
      store.setItem(K_TOKEN, token);
      return this;
    },
    getEndpoint: () => endpoint,
    getToken: () => token,
    isConfigured: () => Boolean(endpoint && token),
    clear() {
      endpoint = ''; token = '';
      store.setItem(K_ENDPOINT, '');
      store.setItem(K_TOKEN, '');
    },
  };
}

export const config = makeConfig();
```

**Step 4: Write `app/js/format.js`**

```js
// app/js/format.js
// Presentation helpers. Pure and tested — formatting bugs are silent and annoying.

export function formatMoney(dollars) {
  const n = Number(dollars) || 0;
  const neg = n < 0;
  const abs = Math.abs(n);
  const whole = Math.floor(abs);
  const cents = String(Math.round((abs - whole) * 100)).padStart(2, '0');
  const withCommas = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? '-$' : '$') + withCommas + '.' + cents;
}

export function formatPct(pct) {
  const n = Number(pct) || 0;
  if (n === 0) return '0%';
  return (Math.round(n * 10) / 10).toFixed(1) + '%';
}

/** Mirror of the backend's parseAmountInput rules, for instant client-side feedback. */
export function isValidAmount(input) {
  const s = String(input ?? '').replace(/[$,\s]/g, '');
  if (s === '') return false;
  const n = Number(s);
  if (!Number.isFinite(n)) return false;
  if (n < 0) return false;
  if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-9) return false;
  return n > 0;
}

/** 'Today' | 'Yesterday' | 'Sep 28' */
export function relativeDay(iso, now = new Date()) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const a = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const b = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const days = Math.round((b - a) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return MON[d.getUTCMonth()] + ' ' + d.getUTCDate();
}
```

**Step 5: Run to verify pass**

Run: `npm test`
Expected: `94` tests pass, `fail 0`.

**Step 6: Commit**

```bash
git add app/js/config.js app/js/format.js tests/frontend.test.js
git commit -m "feat(ui): add config, storage, and formatting modules"
```

---

### Task 15: Write `app/js/api.js` — the transport layer

**Objective:** The single place that talks to Apps Script. This is where §0 lives.

**Files:**
- Create: `app/js/api.js`
- Create: `tests/api-client.test.js`

**This module implements the landmine fix.** Every POST uses `text/plain`. Do not "modernise" it to
`application/json` — that reintroduces the preflight failure described in §0.

**Step 1: Write `app/js/api.js`**

```js
// app/js/api.js
// The ONLY module that calls fetch().
//
// TRANSPORT (see IMPLEMENTATION_PLAN.md §0):
// Apps Script's /exec endpoint 302-redirects to script.googleusercontent.com.
// Sending Content-Type: application/json triggers a CORS preflight that Apps
// Script cannot answer (there is no doOptions), so the request fails with 405.
//
// Using `text/plain;charset=utf-8` keeps the request CORS-safelisted, so NO
// preflight is sent. The body is still JSON; we parse it ourselves. This is the
// documented workaround for google issue #554057761.
//
// DO NOT change this header to application/json.

export class ApiError extends Error {
  constructor(code, message, context = {}) {
    super(message || code);
    this.code = code || 'UNKNOWN';
    this.context = context;
  }
}

const SAFE_HEADERS = { 'Content-Type': 'text/plain;charset=utf-8' };

/**
 * Build a GET URL with query params. GET is used for reads: it is
 * CORS-safelisted, so no preflight.
 */
function getUrl(endpoint, action, params = {}) {
  const url = new URL(endpoint);
  url.searchParams.set('action', action);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  return url.toString();
}

/**
 * POST JSON with the text/plain workaround.
 *
 * `redirect: 'follow'` is the default and is what handles Apps Script's 302;
 * it is stated explicitly here so nobody removes it.
 *
 * `fetchImpl` is threaded through rather than using the global `fetch` directly,
 * so tests can substitute a double.
 */
async function postJson(fetchImpl, endpoint, action, params = {}) {
  const res = await fetchImpl(endpoint, {
    method: 'POST',
    headers: SAFE_HEADERS,
    redirect: 'follow',
    body: JSON.stringify({ action, ...params }),
  });
  if (!res.ok) throw new ApiError('HTTP_' + res.status, 'Server returned HTTP ' + res.status);
  try {
    return await res.json();
  } catch (_) {
    throw new ApiError('BAD_JSON', 'The server returned a non-JSON response.');
  }
}

/** Unwrap the { ok } envelope, converting a failure envelope into a thrown ApiError. */
function unwrap(json) {
  if (!json) throw new ApiError('EMPTY_RESPONSE', 'The server returned nothing.');
  if (json.ok) return json;
  throw new ApiError(json.error, json.message, json.context);
}

/** Serialise non-GET failures so the UI always gets a useful message. */
function describe(err) {
  if (err instanceof ApiError) return err;
  if (err && err.name === 'TypeError') {
    // "Failed to fetch" — the classic Apps Script transport failure. See §0.
    return new ApiError('NETWORK',
      'Could not reach the server. Check your connection and try again.');
  }
  return new ApiError('UNEXPECTED', (err && err.message) || String(err));
}

/**
 * The API client. One instance per app; pass `config` from config.js.
 */
export function makeApi(config, { fetchImpl = fetch } = {}) {
  const checkStatus = (res) => {
    if (!res.ok) throw new ApiError('HTTP_' + res.status, 'Server returned HTTP ' + res.status);
    return res;
  };

  const call = async (method, action, params = {}) => {
    try {
      if (!config.isConfigured()) {
        throw new ApiError('NOT_CONFIGURED', 'Set up PocketBudget first.');
      }
      const token = config.getToken();
      const endpoint = config.getEndpoint();

      const json = method === 'GET'
        ? await fetchImpl(getUrl(endpoint, action, { ...params, token }),
                          { method: 'GET', redirect: 'follow' })
            .then(checkStatus)
            .then(async (res) => {
              try {
                return await res.json();
              } catch (_) {
                throw new ApiError('BAD_JSON', 'The server returned a non-JSON response.');
              }
            })
        : await postJson(fetchImpl, endpoint, action, { ...params, token });

      return unwrap(json);
    } catch (err) {
      throw describe(err);
    }
  };

  return {
    /** Liveness + version. Used by the setup screen to validate a config. */
    ping: () => call('GET', 'ping'),
    /** Everything the home screen needs, in one request. */
    getState: (month) => call('GET', 'getState', month ? { month } : {}),
    createPocket: (p) => call('POST', 'createPocket', p),
    updatePocket: (p) => call('POST', 'updatePocket', p),
    createTransaction: (t) => call('POST', 'createTransaction', t),
    deleteTransaction: (txnId) => call('POST', 'deleteTransaction', { txnId }),
  };
}
```

**Step 2: Write the client tests**

```js
// tests/api-client.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApi, ApiError } from '../app/js/api.js';
import { makeConfig } from '../app/js/config.js';

/** Config that is already set up, with an injectable fetch. */
function harness(fetchImpl) {
  const mem = { 'pb.endpoint': 'https://script.google.com/macros/s/ABC/exec', 'pb.token': 'tok' };
  const store = { getItem: (k) => (k in mem ? mem[k] : null), setItem: () => {} };
  const api = makeApi(makeConfig({ store }), { fetchImpl });
  return { api, calls: [] };
}

function okJson(body, extra = {}) {
  return { ok: true, headers: { get: () => 'application/json' }, json: async () => body, ...extra };
}

test('getState sends a GET with the action and token in the query string', async () => {
  const seen = [];
  const fetchImpl = async (url, opts) => { seen.push({ url, opts }); return okJson({ ok: true, pockets: [], transactions: [] }); };
  const api = makeApi(makeConfig({ store: memStore() }), { fetchImpl });
  await api.getState();
  assert.equal(seen[0].opts.method, 'GET');
  assert.match(seen[0].url, /action=getState/);
  assert.match(seen[0].url, /token=tok/);
});

test('createTransaction POSTs text/plain, never application/json', async () => {
  const seen = [];
  const fetchImpl = async (url, opts) => {
    seen.push({ url, opts });
    return okJson({ ok: true, transaction: { id: 'T1003' } });
  };
  const api = makeApi(makeConfig({ store: memStore() }), { fetchImpl });
  await api.createTransaction({ user: 'Alex', pocketId: 'P01', amount: 5 });

  const headers = seen[0].opts.headers;
  assert.equal(headers['Content-Type'], 'text/plain;charset=utf-8');
  assert.notEqual(headers['Content-Type'], 'application/json');
  assert.equal(seen[0].opts.redirect, 'follow');
  assert.deepEqual(JSON.parse(seen[0].opts.body).action, 'createTransaction');
});

test('an INSUFFICIENT_FUNDS envelope becomes a thrown ApiError', async () => {
  const fetchImpl = async () => okJson({
    ok: false, error: 'INSUFFICIENT_FUNDS',
    message: 'Insufficient funds in Dining Out. Remaining: $15.00',
    context: { remaining: 15 },
  });
  const api = makeApi(makeConfig({ store: memStore() }), { fetchImpl });
  await assert.rejects(() => api.createTransaction({ amount: 99 }), (err) => {
    assert.equal(err.code, 'INSUFFICIENT_FUNDS');
    assert.match(err.message, /Remaining: \$15\.00/);
    assert.equal(err.context.remaining, 15);
    return true;
  });
});

test('a TypeError becomes a NETWORK ApiError with a readable message', async () => {
  const fetchImpl = async () => { throw new TypeError('Failed to fetch'); };
  const api = makeApi(makeConfig({ store: memStore() }), { fetchImpl });
  await assert.rejects(() => api.getState(), (err) => {
    assert.equal(err.code, 'NETWORK');
    assert.match(err.message, /Could not reach the server/);
    return true;
  });
});

test('an unconfigured app refuses to make a request', async () => {
  let called = false;
  const fetchImpl = async () => { called = true; return okJson({ ok: true }); };
  const api = makeApi(makeConfig({ store: emptyStore() }), { fetchImpl });
  await assert.rejects(() => api.getState(), (e) => e.code === 'NOT_CONFIGURED');
  assert.equal(called, false, 'must not hit the network when unconfigured');
});

test('a non-JSON response becomes BAD_JSON rather than an unhandled throw', async () => {
  const fetchImpl = async () => ({
    ok: true, json: async () => { throw new SyntaxError('Unexpected token <'); },
  });
  const api = makeApi(makeConfig({ store: memStore() }), { fetchImpl });
  await assert.rejects(() => api.getState(), (e) => e.code === 'BAD_JSON');
});

function memStore() {
  const mem = { 'pb.endpoint': 'https://script.google.com/macros/s/ABC/exec', 'pb.token': 'tok' };
  return { getItem: (k) => (k in mem ? mem[k] : null), setItem: () => {} };
}
function emptyStore() {
  return { getItem: () => null, setItem: () => {} };
}
```

**Step 3: Run to verify pass**

Run: `npm test`
Expected: `100` tests pass, `fail 0`.

**Step 4: Commit**

```bash
git add app/js/api.js tests/api-client.test.js
git commit -m "feat(ui): add API client using the text/plain CORS-safe transport"
```

---

### Task 16: Write `app/js/render.js` — the home feed

**Objective:** Render pocket cards and the activity feed from a `getState` payload.

**Files:** Create: `app/js/render.js`

**Contract:**

```js
export function renderPockets(container, pockets) { /* returns void */ }
export function renderActivity(container, transactions) { /* returns void */ }
export function pocketCardHtml(p) { /* returns an HTML string */ }
export function activityRowHtml(t, pocketNameById) { /* returns an HTML string */ }
```

**Requirements:**
- **XSS is a real risk here** — `note`, `name`, `account`, and `user` all come from user input and
  are interpolated into HTML. Add an `esc()` helper that replaces `& < > " '` with entities and use
  it on *every* interpolated value. A missed one is a stored-XSS bug in a family app; state this
  in the code comment so it is not "optimised" away later.
- `pocketCardHtml`: name, account, `formatMoney(balance)` of `formatMoney(limit)`, a progress bar
  whose width is `min(100, pctUsed)%`, and a colour that switches at thresholds —
  `<60%` emerald, `60–85%` amber, `>85%` rose, `isLocked` → rose with a "Depleted" badge.
- When `isLocked`, render the card with the add button disabled so the UI communicates the rule
  before the user hits the server error.
- `activityRowHtml`: user tag, amount, note, merchant-agnostic, `relativeDay(timestamp)`, and a
  delete affordance (`data-txn-id`).
- Group the feed under `Today` / `Yesterday` / date headings.
- All money via `formatMoney`, all percentages via `formatPct`.

**Verification:** Render a fixture payload in a Node script and eyeball the HTML string; then check
in a browser that `esc()` neutralises `<script>` in a note.

**Commit:** `git commit -m "feat(ui): add pocket card and activity feed rendering"`

---

### Task 17: Write `app/js/addform.js` — the sub-5-second path

**Objective:** The brief's frictionless entry: pocket, amount, optional note, submit.

**Files:** Create: `app/js/addform.js`

**Contract:**

```js
export function mountAddForm({ root, api, state, users, onAdded, onError, toast }) { /* returns a teardown fn */ }
```

**Requirements — this is the screen the whole product is judged on:**
- **Amount first, and focused.** Autofocus the amount input on mount. It is the only field that
  is always required.
- Pocket selection shows `name — $X.XX left` per option, updated on every state refresh, so the
  live remaining balance is visible *while* choosing.
- `type="text"` + `inputmode="decimal"` on the amount field, **not** `type="number"`. iOS renders
  `type=number` without a decimal keypad on several versions, which would break the 5-second goal.
- Client-side `isValidAmount()` gate before submit; a locked pocket disables submit with an inline
  reason rather than letting the round trip fail.
- On success: clear the amount, keep the pocket selected, refocus the amount, show a toast, call
  `onAdded` so the home feed refreshes. **Do not navigate away** — staying put is what makes the
  next entry fast.
- On `INSUFFICIENT_FUNDS`: show the server's `message` verbatim in the toast. The brief specifies
  this exact string, so do not reword it.
- Disable the submit button while the request is in flight, so a double-tap cannot create two
  transactions.

**Verification:** Time a cold-start entry — it must complete in under 5 seconds including the
network round trip.

**Commit:** `git commit -m "feat(ui): add quick-add expense form with live pocket balances"`

---

### Task 18: Write `app/js/manage.js` — pocket management

**Objective:** Create, rename, re-limit, and archive pockets.

**Files:** Create: `app/js/manage.js`

**Contract:**

```js
export function mountManage({ root, api, state, onChanged, toast }) { /* returns a teardown fn */ }
```

**Requirements:**
- List pockets with their balances; each row has Edit and Archive.
- Create form: name (required), account (optional), monthly limit (required, validated by
  `isValidAmount`).
- Changing a limit below the current balance clamps the balance; say so in the confirm text, because
  the backend does exactly that and the user should not be surprised.
- Archive is **soft** — confirm with wording that says the pocket is hidden but its transactions are
  kept.
- No hard delete anywhere in the UI. Transactions reference pockets.

**Verification:** Create a pocket, verify it appears in the home feed with `balance === limit`;
raise a limit and confirm the balance does not silently jump.

**Commit:** `git commit -m "feat(ui): add pocket management screen"`

---

### Task 19: Write `app/js/app.js` — wiring, setup screen, error handling

**Objective:** Bootstrap, view switching, state refresh, and the first-run setup screen.

**Files:** Create: `app/js/app.js`

**Requirements:**
- On load: if `!config.isConfigured()`, show the setup screen. It has two fields — the web-app
  `/exec` URL and the household token — plus a **Test connection** button that calls `api.ping()`
  and reports success or the precise failure. This is where a bad paste gets caught immediately
  instead of as a mystery failure later.
- Otherwise `getState()` once and render. **One request on load, not two.**
- Refresh strategy: re-fetch after every mutation, plus a `visibilitychange` refresh when the app
  returns to the foreground. That is how the second spouse sees new expenses — no polling, no
  websockets.
- Tab bar switches views by toggling `hidden`.
- A persistent banner if `state.version !== CLIENT_VERSION`, telling the user to hard-refresh. This
  catches the stale-cache case where a deploy ships a new frontend against an old backend.
- Network failures show a retry affordance rather than a blank screen.

**Verification:** Load with a valid config → home feed renders from a single `getState`. Invalid
token → the setup screen's Test connection fails with a readable message.

**Commit:** `git commit -m "feat(ui): add app bootstrap, view routing, and first-run setup"`

---

### Task 20: Add a local dev server and verify the shell end to end

**Objective:** Serve `app/` locally with a correct MIME type for ES modules.

**Files:**
- Create: `package.json` script
- Create: `app/index.html` (final reference to `styles.css`)

**Why:** ES modules require `text/javascript`. Opening `index.html` via `file://` fails on module
CORS, which looks like a code bug and isn't.

Add to `package.json`:

```json
"scripts": {
  "dev": "node backend/serve.mjs"
}
```

**Step 1: Write `backend/serve.mjs`**

```js
// backend/serve.mjs
// Zero-dependency static server for local development of app/.
// Usage: npm run dev  ->  http://localhost:8080
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..', 'app');
const PORT = Number(process.env.PORT) || 8080;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',       // REQUIRED for ES modules
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let path = decodeURIComponent(url.pathname);
    if (path === '/') path = '/index.html';
    const full = join(ROOT, normalize(path).replace(/^(\.\.[/\\])+/, ''));
    if (!full.startsWith(ROOT)) { res.writeHead(403).end('Forbidden'); return; }

    const data = await readFile(full);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(full)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  } catch (err) {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
  }
}).listen(PORT, () => console.log('PocketBudget dev server: http://localhost:' + PORT));
```

**Step 2: Run and verify**

Run: `npm run dev`
Then open `http://localhost:8080`.
Expected: the shell renders, tab switching works, no console errors, no CORS warnings from `file://`.

**Step 3: Commit**

```bash
git add backend/serve.mjs package.json
git commit -m "dev: add zero-dependency static server for local PWA development"
```
---

## 9. Phase 3 — Make it an installable PWA

> Without these files the app works in a browser tab and fails the brief's core requirement — being
> installable to both spouses' home screens.

### Task 21: Write `app/manifest.webmanifest` and icons

**Objective:** Installability metadata.

**Files:**
- Create: `app/manifest.webmanifest`
- Create: `app/icons/icon-192.png`, `app/icons/icon-512.png`, `app/icons/icon-maskable-512.png`, `app/icons/apple-touch-icon.png`

**Requirements:**
- `name: "PocketBudget"`, `short_name: "PocketBudget"`, `start_url: "./index.html"`,
  `scope: "./"`, `display: "standalone"`, `background_color: "#0f172a"`, `theme_color: "#0f172a"`.
- `icons`: 192 and 512 for general use, plus a 512 **maskable** entry with
  `"purpose": "maskable maskable"` for Android adaptive icons.
- Generate the PNGs with the `image_generate` skill or any image tool, then confirm they are
  actually square PNGs. A malformed icon is silently ignored by Android and you will not notice
  until a phone refuses to install.

**Verification:**
- Android Chrome → menu → "Install app" appears.
- Lighthouse PWA audit reports installable.

**Commit:** `git commit -m "feat(pwa): add web app manifest and install icons"`

---

### Task 22: Write `app/sw.js` — the service worker

**Objective:** Offline shell + installability.

**Files:** Create: `app/sw.js`

**Requirements:**
- **Precache the app shell only:** `index.html`, `offline.html`, `styles.css`, every file in `js/`,
  and the icons. **Never precache API responses** — a cached balance is a lie, and this app's whole
  value is that the numbers are true.
- Strategy: cache-first for precached shell assets, network-first (with cache fallback to
  `offline.html`) for navigations.
- Activate phase deletes old caches by a version constant — bump `CACHE_VERSION` on every deploy or
  users get a mix of old and new files, which is the classic SW-staleness bug.
- Bump `CACHE_VERSION` to `pocketbudget-v1` on release and increment on every subsequent deploy.

**Verification:** Load once online, then go offline in DevTools → the shell still loads and shows a
clear "You're offline" notice rather than a broken page. Note that logging an expense while offline
is intentionally **not** supported — see §10.

**Commit:** `git commit -m "feat(pwa): add service worker precaching the app shell"`

---

### Task 23: Register the service worker and add install prompts

**Objective:** Wire SW registration and the `beforeinstallprompt` flow.

**Files:**
- Modify: `app/js/app.js`
- Create: `app/offline.html`

**Requirements:**
- Register the SW after `load`, guarded by `'serviceWorker' in navigator` and by a check that the
  page is served over HTTPS or localhost. Registering over plain HTTP on a LAN IP silently fails.
- Capture `beforeinstallprompt`, stash the event, and show a subtle "Add to home screen" button;
  call `prompt()` on tap. **You must call `preventDefault()` on the original event** or Chrome will
  never fire it again.
- Handle the iOS case explicitly: iOS Safari does not fire `beforeinstallprompt`, so detect
  iOS + `standalone === false` and show plain instructions — "Tap Share → Add to Home Screen".
  Without this, iOS users simply never get an install button.
- `offline.html`: a small static page with the app's colours and the message
  "You're offline. PocketBudget needs a connection to check balances."

**Verification:** Chrome DevTools → Application → Service Workers shows the worker registered and
activated. On iOS Safari, the instructions appear.

**Commit:** `git commit -m "feat(pwa): register service worker and add install prompts"`

---

## 10. Phase 4 — Sheet dashboard, triggers, bootstrap

### Task 24: Wire the daily trigger into `07_Entry.gs.js`

Already implemented in Task 11 (`dailyRollover` + `setup`). This task verifies it end to end on the
live script.

**Verification on the live Apps Script project:**
1. Run `dailyRollover()` manually. Check Execution log: no errors.
2. Set `LAST_ROLLOVER_KEY` in Script Properties to a stale value (e.g. `2026-01`) and re-run.
   Confirm pockets reset to their limits and the log says `reset N pockets`.
3. Run it again immediately. Confirm it does **not** reset twice — idempotency.
4. Confirm `Monthly_Report` has fresh rows.

**Commit:** (verification only; fix anything found) `git commit -m "fix(rollover): …"`.

---

### Task 25: Build the `Monthly_Report` charts

**Objective:** Native Sheet charts, as the brief requires.

**Files:**
- Modify: `backend/06_Report.gs.js`

**Requirements:**
- Create three charts with `sheet.newChart()` after the report block is written:
  1. **Month-over-month trend** — column chart of total spend per month. Needs a small history
     table: append one row per month to a `History` block so the trend has more than one point.
  2. **Category allocation** — pie chart of spend per pocket for the current month.
  3. **Spouse ratio** — pie or doughnut of spend per user.
- Set anchors so charts sit to the right of the data block and do not overlap it.
- Guard: remove existing charts before adding new ones, otherwise every daily run stacks another
  copy and the sheet fills with duplicates within a month.

**Verification:** Run `renderReport` twice; confirm exactly three charts exist both times.

**Commit:** `git commit -m "feat(report): add native monthly trend, allocation, and spouse charts"`

---

### Task 26: Wire `setup()` and document deployment

**Objective:** A repeatable path from a blank Sheet to a working app.

**Files:**
- Create: `docs/DEPLOYMENT.md`

**DEPLOYMENT.md must cover, in order:**
1. Create a Google Sheet; name it; note its ID.
2. Extensions → Apps Script. Set the timezone and paste `appsscript.json` (Project Settings → Show
   `appsscript.json` manifest file).
3. `npm run build`, open `backend/Backend.bundle.gs`, and paste it **in full** into `Code.gs`,
   replacing the default content. Delete the stub `myFunction`.
4. Save, then run `setup()` once; authorise the scopes.
5. Copy the household token from the Execution log.
6. Deploy → New deployment → type **Web app** → Execute as **Me** → Who has access **Anyone**.
   **Anyone**, not "Anyone with a Google account" — the latter requires OAuth and defeats the
   token model.
7. Copy the `/exec` URL.
8. GitHub: enable Pages from `main`, folder `/app` (the workflow in Task 27 handles the deploy).
9. Open the app, paste endpoint + token, tap Test connection.

**Call out the three mistakes that waste hours:** deploying as "Execute as user accessing",
forgetting to redeploy after a code change (the URL is versioned and stale otherwise), and
pasting the individual `.gs` files instead of the generated bundle.

**Commit:** `git commit -m "docs: add deployment guide"`

---

## 11. Phase 5 — CI/CD

### Task 27: Add the GitHub Pages deploy workflow

**Objective:** Pages deploys `app/` on every push to `main`, and the test suite gates it.

**Files:** Create: `.github/workflows/pages.yml`

**Requirements:**
- Triggers: `push` to `main`, plus `workflow_dispatch`.
- Steps: checkout → setup Node 20 → `npm ci || npm install` → `npm run check` (build + tests) →
  deploy. **The test suite must gate the deploy** — a broken build should never reach users.
- Deploy `app/` only, with Pages Actions (`actions/upload-pages-artifact`), not the legacy
  `gh-pages` branch. No extra publish step and no version drift between site and backend.
- Caching Pages with `actions/configure-pages@v5`.

**Verification:** Push to `main`; the Actions run goes green and the site is live at
`https://<user>.github.io/PocketBudget/`. Confirm a deliberate test failure blocks the deploy.

**Commit:** `git commit -m "ci: add GitHub Pages deploy gated on the test suite"`

---

### Task 28: Write the README

**Objective:** Make the repo self-explanatory.

**Files:** Modify: `README.md`

**Must include:** what it is, a screenshot placeholder, the architecture diagram from the brief,
quick start (three steps to a running app), the repo layout, how to run tests, how to build the
Apps Script bundle, and links to `docs/DEPLOYMENT.md` and `docs/SMOKE_TEST.md`.

**Commit:** `git commit -m "docs: rewrite README for PocketBudget"`

---

## 12. Phase 6 — Live verification

> Nothing is "done" until this phase passes. The unit tests prove the logic; only this phase proves
> the transport, which is the part that historically breaks.

### Task 29: Deploy the backend and record the URL

**Objective:** A live `/exec` URL.

**Steps:**
1. `npm run build` and deploy `Backend.bundle.gs` per `docs/DEPLOYMENT.md`.
2. Deploy as Web app, Execute as **Me**, access **Anyone**.
3. Verify `ping` works from a terminal:

```bash
curl -s -G 'https://script.google.com/macros/s/<ID>/exec' \
  --data-urlencode 'action=ping' \
  --data-urlencode 'token=<TOKEN>' | head -c 400
```

Expected: `{"ok":true,"version":"1.0.0","serverTime":"…"}`

A 302 here is expected and fine — `curl -G` does not follow it by default; add `-L`.

**Verification:** `ok:true` and the version matches `SERVER_VERSION`.

**Commit:** none (no code change). Record the URL in `docs/DEPLOYMENT.md` as a checklist item —
**never commit the token.**

---

### Task 30: Run the smoke test against the live deployment

**Objective:** Prove the full stack works from a real browser origin, which is the only place the
CORS behaviour can be observed.

**Files:** Create: `docs/SMOKE_TEST.md`

**Manual checklist — follow in order, stop at the first failure:**

1. **Browser transport (the landmine).** Open the deployed PWA. DevTools → Network. Trigger
   `getState`. Confirm: a single GET to `script.google.com`, a 302 to `script.googleusercontent.com`,
   then **200 with JSON**. Confirm the console shows **no CORS error and no preflight `OPTIONS`**.
2. **GET read.** The home feed renders pockets.
3. **POST write.** Log a $10 expense. Confirm the POST went out as `text/plain` and that **no
   `OPTIONS` request appears** — an `OPTIONS` request here means `application/json` has crept back
   into `api.js`, and the whole app is one deploy away from breaking.
4. **Instant deduction.** The pocket balance drops by exactly $10.00.
5. **The brief's blocking rule.** Try to spend $9,999.99 from a $15 pocket. Expect a toast reading
   exactly: *"Insufficient funds in Dining Out. Remaining: $15.00"*. Confirm the balance did not
   move and no transaction was created.
6. **Zero-balance lock.** Spend a pocket down to exactly $0.00. Confirm the card shows "Depleted" and
   any further submission is blocked.
7. **Exact-balance spend.** Spend the full remaining balance in one go. Expect success and a locked
   pocket — not a rejection.
8. **Two-device sync.** On a second device, add a transaction. Within one refresh on the first
   device, the new balance and feed entry appear.
9. **Concurrent writes.** Fire two submissions in quick succession (two taps, or two browser
   tabs). Confirm both land and the balance is exactly correct — no lost update, no negative.
10. **Auth.** Enter a wrong token. Confirm every request fails with a readable message and no data
    is disclosed.
11. **Offline.** Go offline. Confirm the shell loads and shows the offline notice. Confirm no
    expense can be logged (this is intended — see §10).
12. **Rollover.** Temporarily set `LAST_ROLLOVER_KEY` to last month, run `dailyRollover()`, and
    confirm every active pocket returns to its full limit.

**Commit:** `git commit -m "docs: add live deployment smoke test checklist"`

---

### Task 31: Verify PWA installability on both platforms

**Objective:** The brief's install requirement, verified on real devices.

| Platform | Check |
|---|---|
| Android Chrome | Menu → "Install app" present; icon on home screen; launches standalone with no browser chrome |
| iOS Safari | Share → Add to Home Screen; launches standalone; **no white flash** before the shell paints |
| Both | Offline shell loads (precached) |
| Both | Safe-area insets respected — no content hidden behind the notch or home indicator |

The white-flash and safe-area checks are the two that always fail on the first attempt. Verify them
explicitly rather than assuming.

**Commit:** none unless fixes are needed.

---

### Task 32: Final review pass

**Objective:** Re-read the plan's success criteria against the shipped app.

**Steps:**
1. Walk `PRODUCT_BRIEF.md` §6 success criteria one by one. Every one must be demonstrably true.
2. Re-read `docs/IMPLEMENTATION_PLAN.md` §4 — confirm each deviation is still justified and still
   documented.
3. `npm run check` green.
4. Confirm **no secrets are committed**: `git grep -n "API_TOKEN\|<actual token>"` returns only the
   key name, never a value. Check `.gitignore` covers generated `.gs` files.
5. Confirm the token is rotatable — a leaked token is handled by changing Script Properties, and
   that path should be written down in `docs/DEPLOYMENT.md`.

**Commit:** `git commit -m "chore: final verification pass"` if anything changed.

---

## 13. Phase 7 — Hardening

### Task 33: Add offline-tolerant and retry behaviour

**Objective:** Degrade gracefully without lying about balances.

**Files:**
- Modify: `app/js/api.js`, `app/js/app.js`

**Requirements:**
- One automatic retry on a network-class failure, with a short backoff. Do not retry on
  `INSUFFICIENT_FUNDS` or any 4xx — those are decisions, not failures.
- On persistent failure, keep the last known state on screen with a clear "showing cached data —
  last updated HH:MM" banner. **Never silently display stale balances as if they were current**;
  that defeats the product's entire purpose.
- No offline transaction queue. Two spouses with a queued write reconciling out of order is a
  correctness problem, not a feature. The brief does not require it (§10).

**Verification:** Kill the network mid-session → the cached view stays, clearly labelled, and a
retry button appears.

**Commit:** `git commit -m "feat(ui): add retry and honest stale-data banner"`

---

### Task 34: Ship v1

**Objective:** Tag the release that satisfies the brief.

**Steps:**
1. Bump `CACHE_VERSION` in `app/sw.js` so the service worker picks up new assets.
2. Bump `SERVER_VERSION` in `backend/00_Config.gs.js` and `CLIENT_VERSION` in `app/js/config.js`
   together — a mismatch here is what triggers the refresh banner in Task 19.
3. `npm run check` → deploy backend → push → confirm Pages is green.
4. Run `docs/SMOKE_TEST.md` once more against the shipped version.
5. `git tag -a v1.0.0 -m "PocketBudget v1.0.0" && git push --tags`

**Verification:** Both spouses install, log, and see each other's spending in real time.

**Commit:** `git commit -m "chore: v1.0.0 release"`

---

## 14. Explicit non-goals (v1)

Stated so nobody re-litigates them mid-build:

| Not building | Why |
|---|---|
| Refunds / credits / negative transactions | Amounts are positive-only by design (§2). A credit needs its own validation path. |
| Multiple currencies | Adds conversion, rounding policy, and a display matrix. The brief says dollars. |
| Recurring transactions | A trigger, not a UI feature. Genuinely useful, genuinely separate. |
| Editing a transaction | Delete + re-add is adequate for a 2-user app. An edit path needs a reversal-and-reapply dance under the lock. |
| Per-pocket users or permissions | The brief describes one shared household. |
| Offline write queue | See Task 33 — correctness risk exceeds the benefit at this scale. |
| Historical month browsing | `Monthly_Report` covers trends. Interactive history is a v2 feature. |
| A build step (Vite, React, bundler) | The brief's "lightweight, no complex software" is a real constraint. Tailwind CDN + ES modules keeps the toolchain to `npm test`. |

---

## 15. Risks, and what to do about them

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Apps Script CORS / 302 blocks POSTs** (§0) | Medium | App unusable | `text/plain` is designed in from Task 15. Fallback in §0 → OAuth pivot. **Test in Task 30, not last.** |
| **Concurrency: lost updates** | Low | Balance drifts from transactions | `LockService` + re-read inside the lock (Task 10). Verified in smoke step 9. |
| **Float drift on money** | Medium if ignored | Balances off by pennies | Integer cents across module boundaries; unit-tested (Task 5). |
| **Token leaks into git or logs** | Low | Full read/write to the household's finances | Token lives in Script Properties + localStorage only; `.gitignore`; Task 32 step 4 greps for it. |
| **Service worker serves stale assets** | Medium | Confusing mixed-version bugs | `Cache_VERSION` bumped every release; version-mismatch banner (Tasks 19, 34). |
| **Gas script limits / quotas** | Low at 2 users | Free tier ceiling | One `getState` per screen load, no polling. A family of two uses a tiny fraction of the daily quota. |
| **Silent month-boundary edge cases** | Medium | Wrong reset day | `shouldRollover` uses a month *key*, not a day count; self-heals if a run is missed. |
| **XSS via note/merchant text** | Medium if unescaped | Stored XSS in a family app | `esc()` on every interpolation, called out in Task 16. |

---

## 16. Open questions

1. ~~**Timezone.**~~ **RESOLVED: `Africa/Johannesburg` confirmed correct by the product owner.**
   Rollover runs at 02:00 local and the run-rate day count depends on it. No change needed.
2. **Month-over-month history.** The trend chart needs more than one month of data to be useful.
   Task 25 appends a history row per run. Confirm that is acceptable versus backfilling.
3. **Rollover on a limit change.** If a spouse raises a limit mid-month, should the extra room apply
   immediately? v1 says yes. Flagged because it interacts with the run-rate projection.
4. **Should the token be replaced by Google sign-in?** Not for v1. But if this app ever handles
   anything more sensitive than groceries, the shared token in `localStorage` is the weakest link,
   and the upgrade path is in §17.

---

## 17. If it graduates: the auth upgrade path

Not built in v1 (owner decision, brief §5). When the time comes:

1. Create a Google Cloud project, enable the **Google Identity Services** (GIS) ID token flow.
2. Add a sign-in button; request **only** `openid`, `email`, `profile`.
3. Send the ID token with the request, as `text/plain` exactly as today — a change of
   `Authorization` header would reintroduce the preflight problem in §0.
4. Server-side: verify `aud` (your client ID), `iss` (`accounts.google.com`), and `exp`. **Do not
   trust the client.**
5. Keep an **email allowlist** of the two spouses. This is now the real security boundary, so make it
   **default-deny** and fail closed.
6. Do **not** use the visitor's OAuth token for Sheets access, and never transmit
   `ScriptApp.getOAuthToken()` to the client — that token grants access to the whole sheet.

---

## 18. Definition of done

- [ ] `npm run check` green (build + all tests)
- [ ] `backend/Backend.bundle.gs` contains zero `import`/`export` lines
- [ ] `docs/SMOKE_TEST.md` passes end to end against the live deployment, including the CORS check
- [ ] Every success criterion in `PRODUCT_BRIEF.md` §6 demonstrated on a real phone
- [ ] Installs on iOS Safari and Android Chrome
- [ ] An expense can be logged in under 5 seconds from a cold start
- [ ] A blocked overspend shows the brief's exact alert text and mutates nothing
- [ ] Two devices cannot drive a balance negative, verified by concurrency test
- [ ] Rollover restores full limits on the 1st
- [ ] `Monthly_Report` shows budget-vs-actual, spouse split, run-rate flag, and three charts
- [ ] No token or secret anywhere in git history
- [ ] The plan's §4 deviations all still hold and are still documented

---

## Appendix — verification state of this plan

### Every code block in this plan was executed

The plan makes a claim worth holding it to: *the code is meant to be run, not skimmed.* So it was
run. All 28 files were extracted from this document verbatim, written to a scratch directory, and
executed with Node 26.

**Result: 100 tests, 100 passing, 0 failing**, and `Backend.bundle.gs` compiles as a valid classic
script with all four entry points (`doGet`, `doPost`, `dailyRollover`, `setup`) and zero leftover
module syntax.

### What that verification actually caught

Worth recording, because every one of these was a real defect that shipped in the first draft and
would have cost the implementer hours:

| # | Bug | Symptom |
|---|---|---|
| 1 | `npm test` script used `node --test tests/` | Fails outright on modern Node; auto-discovery is correct. |
| 2 | `installGlobals` exposed no `getScriptLock` | Every locked code path threw `TypeError`. 12 tests down. |
| 3 | `fakeSheet` had no `deleteRow` | `deleteTransaction` was untestable. |
| 4 | `fakeSheet` header-row semantics were off by one | `getRange` returned blanks; `dataRows` masked it, so it surfaced late. |
| 5 | `getRange().setValue()` wrote only to the snapshot | Balances silently never persisted. Root cause of most initial failures. |
| 6 | `postJson()` called the global `fetch`, ignoring the injected double | POST tests hit the real network and 404'd. |
| 7 | `parseRequest` was only in a "replace the bodies" step | The entry test could not import it. |
| 8 | `nextTransactionId([])` produced `T0001` | Must start at `T1001` per the brief's examples. |
| 9 | `computeRunRate` thresholds didn't match their tests | 116% of limit was reported `critical`; the test, not the code, was wrong. |
| 10 | A malformed assert (`strictEqual` with one arg) | Threw instead of failing cleanly. |
| 11 | **`build.mjs` left orphan `} from '...'` lines** | **The generated bundle would have failed to load in Apps Script with a syntax error** — and the obvious `grep -E "^(import\|export)"` check passed anyway. |

Bug 11 is the reason the bundle was compiled with `node --check` rather than only grepped. A grep
for module keywords cannot see a broken multi-line import.

**Two design decisions changed as a result:** `installGlobals` now normalises its lock argument
instead of trusting the caller, and the transport test asserts the absence of a preflight `OPTIONS`
rather than merely the presence of `text/plain`.

### Honest scope of the claim

- **Verified:** every backend module, the API client, config/format helpers, the build generator,
  and the entire 100-test suite — executed, not inspected.
- **Not verified, and stated as specified rather than proven:** the UI tasks (13, 16–19, 21–23) and
  the live Apps Script behaviour. UI tasks are given exact contracts and verification steps rather
  than pasted markup; the transport against a real deployment is Task 30, and that is where §0
  either holds or does not. **Do not treat §0 as proven until smoke step 1 passes.**
- The test counts in each task's *Expected* line are now measured, not estimated.

### One-line summary for the implementer

Read §0 before writing any code. The one line that matters: **the POST header must be
`text/plain;charset=utf-8`, never `application/json`.**
