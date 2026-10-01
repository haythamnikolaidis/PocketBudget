# Deployment

From a blank Google Sheet to a running app on two phones.

---

## 1. Create the Sheet

1. Create a new Google Sheet and name it (e.g. `PocketBudget`).
2. Note the Sheet ID — it is in the URL between `/d/` and `/edit`.

---

## 2. Create the Apps Script

1. In the Sheet: **Extensions → Apps Script**.
2. **Project Settings** (gear icon) → tick **Show "appsscript.json" manifest file**.
3. Open `appsscript.json` and replace its contents with the repo's
   `backend/appsscript.json`.
4. Confirm the timezone matches the household — it defaults to
   `Africa/Johannesburg`. This matters: the rollover trigger runs at 02:00 local
   and the run-rate day count depends on it.

---

## 3. Paste the backend

```bash
npm run build
```

This writes `backend/Backend.bundle.gs` (all 8 modules flattened into one
classic script).

1. Open `Backend.bundle.gs`, copy **everything**.
2. In the Apps Script editor, open `Code.gs`, select all, delete, paste.
3. Delete the default `function myFunction() {}` stub if it survived.
4. Save (⌘/Ctrl + S).

> Paste the **bundle**, not the individual `.gs` files. The bundle is what
> `build.mjs` generates and it is the only thing guaranteed to load.

---

## 4. Run setup once

1. In the Apps Script editor, select `setup` from the function dropdown.
2. Click **Run**. Authorise the requested scopes.
3. Open **Execution log** (View → Execution log, or the ⋮ menu on the run).

You should see:

```
Sheets ready: Pockets, Transactions, Monthly_Report
Users: Alex, Sam
Household token (copy this into the PWA setup screen): <long hex string>
```

**Copy that token.** It is the only time it is shown in full. If you lose it,
delete the `API_TOKEN` script property and run `setup()` again.

---

## 5. Deploy the web app

1. **Deploy → New deployment**.
2. Click the gear next to "Select type" → enable it → choose **Web app**.
3. Click **Next**.
4. **Description:** `PocketBudget v1`.
5. **Execute as:** **Me**.
6. **Who has access:** **Anyone**.

   > Not "Anyone with a Google account". That option requires an OAuth grant and
   > defeats the shared-token model entirely.
7. **Deploy** and authorise.

Copy the **Web app URL**. It ends in `/exec`.

---

## 6. Publish the frontend

1. Push to `master`. The workflow in `.github/workflows/pages.yml` runs the
   tests and then publishes `app/`.
2. Or run it locally first: `npm run dev` → <http://localhost:8080>.

To enable Pages: **Settings → Pages → Source: GitHub Actions**.

---

## 7. Set up the phones

On each phone:

1. Open the app URL.
2. Paste the `/exec` URL into **Web app URL**.
3. Paste the household token into **Household token**.
4. Tap **Test connection** — this catches a bad paste immediately instead of as a
   mystery failure later.
5. Tap **Save**.

Then install it:

- **Android Chrome:** menu → *Install app*
- **iOS Safari:** Share → *Add to Home Screen*

---

## Verify

Follow [`SMOKE_TEST.md`](./SMOKE_TEST.md). Step 1 is the important one: it is
the first point at which the `text/plain` transport is proven rather than merely
tested.

---

## Redeploying after a code change

Apps Script deployments are **versioned**. Editing the code changes nothing for
users until you redeploy:

1. Paste the new `Backend.bundle.gs` into `Code.gs` and save.
2. **Deploy → Manage deployments → ✏️ (pencil) → Version: New version → Deploy**.

Skipping this is the single most common reason a fix appears not to work.

If you change frontend files, push to `master` — but also **bump
`CACHE_VERSION` in `app/sw.js`**, or the service worker will keep serving the old
shell. Bump `CLIENT_VERSION` in `app/js/app.js` in step with `SERVER_VERSION` in
`backend/00_Config.gs.js`.

---

## Rotating the token

If the token ever leaks:

1. Apps Script → **Project Settings → Script Properties**.
2. Edit `API_TOKEN` → set a new random string.
3. Re-enter it in each phone's setup screen.

The old token stops working immediately. No redeploy is needed.

---

## The three mistakes that waste hours

| Mistake | Symptom | Fix |
|---|---|---|
| "Execute as: user accessing the web app" | Spouses get prompted to authorise; the token model breaks | Deploy as **Me** |
| Editing code but not redeploying | Fix appears to do nothing; users still see old behaviour | **Manage deployments → New version** |
| Pasting the individual `.gs` files | Syntax errors, or `function already declared` | Paste `Backend.bundle.gs` in full |

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| "Script function not found: doGet" | The bundle was not pasted completely, or a stale version is deployed |
| Every request fails, console shows a CORS error | `Content-Type: application/json` — check `SAFE_HEADERS` in `app/js/api.js` |
| "Missing sheet: Pockets" | `setup()` was never run, or it ran against a different Sheet |
| "Invalid or missing token" | Token mismatch between the phones and Script Properties |
| "Another update is in progress" | The script lock is held. It releases on its own; retrying is correct |
| Installs on Android but not iOS | Expected — iOS has no install button; the app shows instructions instead |