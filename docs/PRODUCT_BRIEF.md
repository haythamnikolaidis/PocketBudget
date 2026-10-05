# PocketBudget — Product Brief

> Source: product brief as provided by the product owner.
> Status: **Approved / canonical.** This document is the contract the implementation is
> measured against. Any deliberate departure from it is recorded in
> [`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md) §4 *Deviations from the brief* with the
> reason for the change.

---

## 1. Vision & Core Philosophy

PocketBudget is a lightweight, mobile-first Progressive Web App (PWA) designed for married
couples to manage shared monthly finances, prevent overspending, and track real-time household
expenses without complex software.

- **Zero Negative Balances** — Pockets lock or block deductions when funds reach zero, to
  maintain budget discipline.
- **Instant Transparency** — Dual-user access ensures both spouses have immediate visibility into
  every expense logged.
- **Frictionless Entry** — Adding a transaction takes less than 5 seconds on mobile.

---

## 2. Technical Architecture

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
└──────────────────────────────────────────────────────────┘
```

- **Frontend:** PWA hosted on GitHub Pages (`manifest.json` + Service Worker for mobile
  installation to homescreen).
- **Backend:** Google Apps Script (GAS) deployed as an execution Web App returning JSON
  (`ContentService`).
- **Database & Reporting:** Single Google Sheet acting as both the database and the executive
  dashboard.

---

## 3. Data Structure (Google Sheets Schema)

### Sheet 1: `Pockets`

| Pocket ID | Pocket Name | Bank Account | Monthly Limit | Current Balance | Status |
|---|---|---|---|---|---|
| P01 | Groceries | Chase Checking | R800.00 | R340.50 | Active |
| P02 | Dining Out | Credit Card A | R250.00 | R15.00 | Active |

### Sheet 2: `Transactions`

| Transaction ID | Timestamp | User / Spouse | Pocket ID | Amount | Merchant / Note |
|---|---|---|---|---|---|
| T1001 | 2026-10-01 14:20 | Alex | P01 | R65.20 | Whole Foods |
| T1002 | 2026-10-01 18:45 | Sam | P02 | R42.00 | Pizza Night |

### Sheet 3: `Monthly_Report` (Dashboard)

- **Budget vs. Actual:** Visual breakdown per pocket (Limit vs. Total Spent vs. Remaining).
- **Spouse Breakdown:** Total spend split by Alex vs. Sam.
- **Run-Rate Indicator:** Automated message / colour flag showing whether monthly spending
  velocity will exceed limits before month-end.

---

## 4. Feature Requirements

### A. Pocket & Bank Account Setup

- **Pocket Creation:** Define Pocket Name, linked Bank Account name, and Monthly Limit.
- **Strict Non-Negative Enforcement:**
  - If `Amount > Current Balance`, the app blocks the submission with an alert:
    *"Insufficient funds in [Pocket Name]. Remaining: R[Balance]"*.
- **Monthly Rollover:** Automatic script trigger on the 1st of each month to reset balances back
  to full limit.

### B. Expense Entry (Mobile Optimized)

- **Quick Add Form:**
  - Select Pocket (shows live remaining balance).
  - Input Amount.
  - Optional Note / Merchant name.
  - Submit.
- **Instant Deduction:** Deducts the amount from the selected pocket immediately upon receipt.

### C. Live Sync & Dashboard View

- **Home Feed:** Shows all pockets as cards with visual progress bars (Remaining / Limit).
- **Recent Activity Feed:** Shows the latest 10 transactions across both spouses in reverse
  chronological order, with user tags.
- **Automated Monthly Report Tab (Google Sheet):** Built-in Sheet charts for month-over-month
  trends, category allocation, and spending ratio between spouses.

### D. Security & Multi-User Access

- **Authentication:** Handled via Google OAuth / App Script Web App execution permissions, or a
  shared secret API token stored in `localStorage`.
- **PWA Installation:** Installable on both iOS (Safari → Add to Home Screen) and Android
  (Chrome → Install App).

---

## 5. Decision Log (resolved with the product owner)

| # | Question | Decision |
|---|---|---|
| 1 | Which security model? | **Shared secret household token** held in `localStorage`, on each device. No Google consent screens on mobile. The plan documents the upgrade path to Google Identity Services ID tokens as a documented future option. |
| 2 | How deep is automated verification? | **Node test suite over pure logic** (zero dependencies, `node:test`) **plus** a documented manual smoke checklist for the live deployment. |
| 3 | Which currency? | **South African rand (R).** Amounts display as `R1,234.56`, including the insufficient-funds alert (`Insufficient funds in [Pocket Name]. Remaining: R[Balance]`). Typed amounts accept a leading `R`, space thousands and a decimal comma (`12,50` is R12.50). Stored values are plain numbers; only the display changed. |

### Constraint discovered during planning (deviation from §2 above)

The §2 diagram specifies "REST API (JSON via `fetch`)" from GitHub Pages to Apps Script. That
combination cannot work as literally written: `application/json` on a POST triggers a CORS preflight
that Apps Script cannot answer, and the endpoint's 302 redirect frequently drops CORS headers
(Google issue #554057761, open). The payload is still JSON — only the declared MIME type changes to
`text/plain`, which is CORS-safelisted and sends no preflight.

Full analysis, the fallback if it still fails, and the reasoning are in
[`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md) §0.

---

## 6. Success Criteria

The build is done when all of the following are true and demonstrable:

1. Both spouses can install PocketBudget to their home screen (iOS Safari and Android Chrome).
2. An expense can be logged in **under 5 seconds** from a cold app start.
3. A deduction that exceeds a pocket's current balance is **rejected server-side** with the exact
   alert text from §4A, and no balance is mutated.
4. Two devices logging expenses at the same moment can never drive a balance negative.
5. Both spouses see the same pocket balances and activity feed within one refresh.
6. The 1st-of-month rollover restores every active pocket to its full monthly limit.
7. The `Monthly_Report` sheet renders budget-vs-actual, spouse split, and a run-rate flag.