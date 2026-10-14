# T37 · Home-screen "Add expense" shortcut

**Milestone:** M3 · **Type:** frontend · **Depends on:** —

## Change
1. `app/manifest.webmanifest`: add
   `"shortcuts": [{ "name": "Add expense", "short_name": "Add", "url": "./index.html?view=add", "icons": [{ "src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png" }] }]`.
2. `app/js/app.js` `boot`: after the first successful state render, if
   `new URLSearchParams(location.search).get('view') === 'add'`, switch to the add view (use the
   injected window/location if boot takes them as dependencies:
   `grep -n "deps\.\|location" app/js/app.js | head`).

## Tests
`tests/manifest.test.js`: the shortcut exists and its URL is inside the scope.
`tests/boot.test.js` or `tests/app.test.js`: `?view=add` opens add.

## Verify
```bash
node --test tests/manifest.test.js
npm run check
```

## Done-check (used when resuming)
```bash
grep -q "shortcuts" app/manifest.webmanifest
```

## Commit
`v2(T37): add-expense home screen shortcut`
