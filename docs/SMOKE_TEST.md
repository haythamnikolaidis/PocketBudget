# Smoke test — live deployment

Everything in the automated suite passes locally, but **one thing cannot be
verified without a real Apps Script deployment**: whether `text/plain` actually
survives the cross-origin redirect. Step 1 is the whole point of this document.

Run these in order. **Stop at the first failure** and record the Network-tab
details before changing anything.

---

## Before you start

- [ ] `npm run check` is green locally
- [ ] The backend is deployed (see [DEPLOYMENT.md](./DEPLOYMENT.md))
- [ ] You have the `/exec` URL and the household token
- [ ] GitHub Pages is live, or you are running `npm run dev` locally

Open DevTools before step 1 and keep the **Network** tab open.

---

## 1. The transport (do not skip)

This proves or disproves the central design decision.

1. Open the app. If you see the setup screen, enter the `/exec` URL and token, tap
   **Test connection**.
2. In the Network tab, filter to **Fetch/XHR**.
3. Trigger a state load (the app loads automatically once configured, or tap
   **Add** then back to **Pockets**).

**Pass looks like:**

- One `GET` to `script.google.com/macros/s/…/exec`
- Followed by a **302** to `script.googleusercontent.com`
- Then **200** with a JSON response
- **No `OPTIONS` request anywhere in the list**
- No red CORS error in the console

**The failure to watch for:** an `OPTIONS` request followed by a 405. That means
something set `Content-Type: application/json`. Go to `app/js/api.js`, find
`SAFE_HEADERS`, and confirm it says `text/plain;charset=utf-8`.

> If this fails, everything below will fail too. Record the exact request and
> response headers before touching code, then see §0 of the implementation plan
> for the fallback.

---

## 2. Reading state

- [ ] The home feed renders every pocket with a balance and a progress bar
- [ ] The summary line totals are present
- [ ] The activity feed shows the most recent transactions

---

## 3. Writing (instant deduction)

1. Log an R10.00 expense.
2. Confirm the `POST` went out with `Content-Type: text/plain;charset=utf-8`
3. Confirm **no `OPTIONS` request appeared**
4. Confirm the pocket balance dropped by exactly R10.00
5. Confirm the new row appears at the top of the activity feed with your user tag

---

## 4. The blocking rule (the product's whole point)

1. Pick the **Dining Out** pocket (R15.00 remaining in the fixture data).
2. Try to log R9,999.99.
3. Confirm the alert reads **exactly**:

   > Insufficient funds in Dining Out. Remaining: R15.00

4. Confirm the balance **did not move**
5. Confirm **no transaction was created** (the feed is unchanged)

---

## 5. Zero-balance lock

1. Spend a pocket down to exactly R0.00 (log its full remaining balance).
2. Confirm the card shows a **Depleted** badge and switches colour
3. Confirm the pocket is disabled in the Add screen's pocket list
4. Confirm any further submission is blocked with the insufficient-funds alert

---

## 6. Exact-balance spend is allowed

This is the boundary case that must **succeed**, not fail:

1. Note a pocket's remaining balance, e.g. R12.34
2. Log exactly R12.34
3. Confirm **success**
4. Confirm the pocket is now locked at R0.00

> If this rejects, the non-negative check is using `>=` where it must use `>`.

---

## 7. Two-device sync

1. Open the app on a second phone (or a private window)
2. Enter the same endpoint and token
3. On phone A, log an expense
4. On phone B, bring the app to the foreground
5. Confirm the new balance **and** the feed entry appear within one refresh
6. Repeat in the other direction

---

## 8. Concurrent writes

Two phones submitting at the same moment must never produce a wrong balance.

1. On two devices, log an R5 expense into the same pocket at the same instant
2. Confirm **both** transactions are recorded
3. Confirm the balance dropped by exactly R10.00
4. If you see a `BUSY` rejection on one device, that is acceptable — retrying is
   correct behaviour, and the balance must still be right

---

## 9. Auth

1. Enter a deliberately wrong token on one device
2. Confirm every request fails with a readable message
3. Confirm **no** pocket balances, names, or transaction data are disclosed

---

## 10. Offline

1. Put the device in airplane mode
2. Reload the app
3. Confirm the shell still loads and shows the offline notice
4. Confirm you **cannot** log an expense (intentional — a queued write that
   reconciles out of order is a correctness problem, see the plan §14)

---

## 11. Monthly rollover

1. In Apps Script → Project Settings → Script Properties, set `LAST_ROLLOVER_KEY`
   to last month (e.g. `2026-01`)
2. Run `dailyRollover()` from the editor
3. Confirm the log says `reset N pockets`
4. Confirm every **active** pocket is back to its full monthly limit
5. Confirm **archived** pockets were not touched
6. Run `dailyRollover()` again immediately — it must do **nothing** (idempotent)
7. Confirm `Monthly_Report` has fresh rows

---

## 12. Installability

| Platform | Check |
|---|---|
| Android Chrome | Menu → "Install app"; icon on the home screen; opens with no browser chrome |
| iOS Safari | Share → Add to Home Screen; opens standalone; **no white flash** |
| Both | Offline shell loads |
| Both | Content is not hidden behind the notch or the home indicator |

> iOS Safari never fires `beforeinstallprompt`, so there is no install *button*
> there — the app must show plain "Share → Add to Home Screen" instructions.
> If iOS shows no install path at all, that is a bug.

---

## 13. The 5-second entry

1. Close the app completely
2. Reopen it on a phone
3. Log one expense, start to finish

**Target: under 5 seconds**, including the network round trip.

---

## Result

Record the outcome of each step. If everything passes, the product brief's success
criteria in [`PRODUCT_BRIEF.md` §6](./PRODUCT_BRIEF.md) are met.