# T35 · Backdated expenses (backend)

**Milestone:** M3 · **Type:** backend · **Depends on:** T02

## Goal
`createTransaction` accepts an optional `date` (`YYYY-MM-DD`) within the current month, so
yesterday's coffee can be logged.

## Change
1. `backend/04_Rollover.gs.js`: export the pure `parseExpenseDate(text, now = new Date())` → a `Date`,
   or `null` when it's invalid. Rules: it must match `^\d{4}-\d{2}-\d{2}$` and be a real calendar
   day; `monthKey` of that day must equal `monthKey(now)`; it can't be after today (household time,
   `localParts`). It returns 12:00 household time on that day: `new Date(Date.UTC(y, m - 1, d, 12) - UTC_OFFSET_MINUTES * 60000)`.
2. `backend/05_Api.gs.js` `createTransaction`: if `params.date` is present and non-empty, parse it
   **before** taking the lock; invalid → `fail('INVALID_DATE', 'Pick a day in this month, up to today.')`.
   Use it in place of `now` for the row's timestamp **and** the response. With no date, nothing
   changes.

## Tests (new file `tests/expense-date.test.js`, with mocked Date)
Yesterday, the 1st and today are OK. Tomorrow, last month, `2026-02-30` and `14/11/2026` are
refused. The stored timestamp is 10:00Z.

## Verify
```bash
node --test tests/expense-date.test.js
npm run check
```

## Done-check (used when resuming)
```bash
grep -q "export function parseExpenseDate" backend/04_Rollover.gs.js
```

## Commit
`v2(T35): backdated expenses API`
