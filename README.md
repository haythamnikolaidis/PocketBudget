# PocketBudget

Shared pocket budgets for two spouses. Log an expense in seconds, and get
hard-blocked before you overspend.

Mobile-first PWA on GitHub Pages, backed by a Google Apps Script JSON API over a
single Google Sheet.

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                   Frontend (PWA Shell)                   │
│  Hosted on GitHub Pages (HTML5, Tailwind CSS, JS, SW)    │
└───────────────────────────┬──────────────────────────────┘
                            │
                            │ REST API (JSON via fetch)
                            ▼
┌──────────────────────────────────────────────────────────┐
│                  Backend (Google Apps Script)            │
│  doGet() / doPost() API Web App                          │
└───────────────────────────┬──────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────┐
│                   Data Store & Reports                   │
│  Google Sheets (Pockets, Transactions, Reports Dashboard)│
└───────────────────────────┬──────────────────────────────┘
```

All spendable state lives in Google Sheets. The browser holds no authoritative
state, so both spouses always see the same numbers.

### One thing to know before you touch `app/js/api.js`

Apps Script's `/exec` endpoint 302-redirects to `script.googleusercontent.com`,
and `Content-Type: application/json` would trigger a CORS preflight that Apps
Script cannot answer (there is no `doOptions`, so it returns 405). Every POST
therefore sends `Content-Type: text/plain;charset=utf-8` with a JSON body, which
is CORS-safelisted and sends no preflight.

**Do not change that header back to `application/json`.** It is guarded by tests
in `tests/api-client.test.js` and by smoke step 3 in [`docs/SMOKE_TEST.md`](docs/SMOKE_TEST.md).
Background: [Google issue #554057761](https://issuetracker.google.com/issues/554057761).

---

## Quick start

1. **Deploy the backend** — follow [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).
   You end up with an Apps Script `/exec` URL and a household token.
2. **Enable GitHub Pages** — Settings → Pages → Source: GitHub Actions. The
   workflow in `.github/workflows/pages.yml` publishes `app/` on every push to
   `master`, and only after the tests pass.
3. **Open the app**, paste the URL and token on the setup screen, tap
   **Test connection**.

Local development:

```bash
npm install     # no runtime dependencies, just enables the test runner
npm run dev     # serve app/ at http://localhost:8080
npm test        # run the full test suite
npm run check   # build the Apps Script bundle + run the tests
```

---

## Repo layout

```
app/            the PWA — this is what GitHub Pages publishes
  index.html    shell: setup / home / add / manage views
  js/           config, format, api (transport), render, addform, manage, app
  tailwind.css  compiled Tailwind (committed; `npm run build:css` regenerates it)
  sw.js         service worker — precaches the shell, never the API
  icons/        generated PNGs + verify-icons.mjs
tailwind/       Tailwind config + input for build:css (output is app/tailwind.css)
backend/        Apps Script source (canonical: *.gs.js ES modules)
  build.mjs     flattens *.gs.js into Backend.bundle.gs for pasting
  serve.mjs     local static server
tests/          node:test suites — no test framework dependency
docs/           product brief, implementation plan, deployment, smoke test
```

### The `.gs` / `.js` duality

Apps Script has no module system and its editor only reads `.gs` files, so:

- **Edit `backend/*.gs.js`** — these are the canonical ES modules.
- **CI publishes the bundle as an artifact** after compiling it and running the
  full suite. Fetch it with `scripts/fetch-bundle.sh` — that is the exact file
  CI proved loads, not a local rebuild.
- **`npm run build`** generates the same thing locally if you prefer.
- **Paste `Backend.bundle.gs` into the Apps Script editor.**
- Generated `.gs` files are gitignored. Never hand-edit one.

Tests import the `.gs.js` modules directly, so no build is needed to run them.

---

## Core rules

- **Balances can never go negative.** The server rejects an over-budget expense
  with `Insufficient funds in <Pocket>. Remaining: R<balance>` and mutates
  nothing. Spending the *exact* remaining balance is allowed and locks the pocket.
- **A retried expense is recorded once.** Each expense carries a `requestId`; if a reply is lost and the user taps Save again, the server recognises the id and returns the original instead of spending twice.
- **Concurrent writes are locked.** Deductions happen under `LockService`, with
  the balance re-read inside the lock, so two phones submitting at once cannot
  produce a lost update.
- **Money is integer cents** across module boundaries, written to Sheets as
  dollars. Variable names carry the unit (`balanceCents`, `amountCents`).
- **Spend is month-scoped**, aggregated from `Transactions` rather than derived
  from the current balance — so history survives the monthly rollover.
- **API responses are never cached** by the service worker. A stale balance shown
  as current would defeat the entire product.

---

## Testing

`npm test` runs ~440 tests with no test-framework dependency.

Coverage worth knowing about:

| Area | What is actually verified |
|---|---|
| `tests/api.test.js` | the dispatcher's happy paths |
| `tests/invariants.test.js` | the four invariants, adversarially: one cent over, exact balance, lock release on every path, a stale client trying to supply its own balance |
| `tests/api-client.test.js` | the `text/plain` transport guard |
| `tests/render.test.js` | XSS escaping of every user-entered field |
| `tests/sw.test.js` | the service worker never caches the API |
| `tests/shell.test.js` | the DOM contract between `index.html` and the modules |

---

## Scripts

| Command | What it does |
|---|---|
| `npm test` | full suite |
| `npm run build` | generate `Backend.bundle.gs` |
| `npm run check` | build + test (what CI runs) |
| `npm run build:css` | recompile `app/tailwind.css` after adding or changing a Tailwind class (CI fails if it is stale) |
| `npm run dev` | serve `app/` on :8080 |
| `node app/icons/verify-icons.mjs` | assert the PWA icons are the right size |
| `scripts/fetch-bundle.sh` | download the CI-verified bundle for Apps Script |
| `bash scripts/commit.sh --paths a b "msg"` | serialized commit helper for concurrent agents |

---

## Security notes

- The household token lives in Apps Script Script Properties and in browser
  `localStorage`. It is never in git, and it travels in the POST body, never in a URL.
- Household member names are the `USERS` Script Property (default `Alex,Sam`).
- Deploy the web app as **Execute as: Me** and **Who has access: Anyone**.
  Choosing "Anyone with a Google account" changes the auth model.
- Rotating the token is one change in Script Properties.
- To rotate: update `API_TOKEN` in the Apps Script project, then re-enter it in
  each phone's setup screen.

---

## Docs

- [`docs/PRODUCT_BRIEF.md`](docs/PRODUCT_BRIEF.md) — the canonical spec
- [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) — 34-task build plan
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — blank Sheet to running app
- [`docs/SMOKE_TEST.md`](docs/SMOKE_TEST.md) — live verification checklist