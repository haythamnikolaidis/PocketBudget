# Task 00: Get set up and learn the code

**Milestone:** M1 · **Size:** S · **Depends on:** nothing

## Why
Every later task assumes you can run the tests, run the app against a test Sheet, and know where
things live. Spending a day here saves a week later.

## Steps
1. Install Node 20 or newer. Clone the repo. Run `npm test`: about 470 tests should pass. There
   are no dependencies to install.
2. Read [`../README.md`](../README.md) sections 1–4, then the root [`README.md`](../../../README.md).
3. Make a **test copy** of the Sheet and deploy its Apps Script, following
   [`../../DEPLOYMENT.md`](../../DEPLOYMENT.md) sections 1–5. Ask the product owner for edit access
   to the real Sheet so you can copy it, or start from a blank Sheet.
4. Run `npm run dev`, open http://localhost:8080, and paste in your test URL and token.
5. Use the app: create two pockets, log five expenses, try to overspend, delete an expense. Watch
   the rows appear in the Sheet as you go.
6. Read the code in the order given in the plan, §2. While reading `createTransaction`, find the
   line that enforces each rule in the plan's §3.
7. Run the smoke test ([`../../SMOKE_TEST.md`](../../SMOKE_TEST.md)) against your test deployment
   once, so you know it before you add to it.

## Done when
- [ ] `npm run check` passes on your machine.
- [ ] The app on localhost works against your own test Sheet.
- [ ] You can explain, in two sentences, why the balance is re-read inside the lock in
      `createTransaction`.

No PR for this task. If anything in these steps was wrong or unclear, fix the doc in your first PR.
