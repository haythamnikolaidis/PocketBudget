# T32 · Add form remembers each person's last pocket

**Milestone:** M3 · **Type:** frontend · **Depends on:** —

## Read
`app/js/addform.js`: `USER_KEY`, `savedUser`, `rememberUser`, `renderOptions`, and the success branch of `submit`.

## Change
1. After a successful save, store the pocket id under `'pb.lastPocket.' + user` (the same
   try/catch store pattern as `rememberUser`).
2. In `renderOptions`, choose the pocket in this order: the kept current selection → this user's
   saved last pocket (if it exists and isn't locked) → `firstOpenPocket()`.
3. Export a pure helper, `pickInitialPocket(pockets, { current, remembered, isLocked })`, and use it.

## Tests (`tests/addform.test.js`)
`pickInitialPocket` order; a locked remembered pocket is skipped; a save stores the pocket per user
(fake store).

## Verify
```bash
node --test tests/addform.test.js
npm run check
```

## Done-check (used when resuming)
```bash
grep -q "pb.lastPocket" app/js/addform.js
```

## Commit
`v2(T32): remember last pocket per user`
