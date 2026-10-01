// tests/integration.test.js
// End-to-end wiring checks across module boundaries.
//
// The per-module suites prove each piece works in isolation. These prove they
// agree with each other — which is where a mismatched export name or a renamed
// DOM id actually breaks, and where no single-module test would notice.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..', 'app');
const JS = join(APP, 'js');
const html = readFileSync(join(APP, 'index.html'), 'utf8');
const sw = readFileSync(join(APP, 'sw.js'), 'utf8');

/** Every export name each module is contracted to provide. */
const EXPECTED_EXPORTS = {
  'config.js': ['resolveEndpoint', 'makeConfig'],
  'format.js': ['formatMoney', 'formatPct', 'isValidAmount', 'relativeDay'],
  'api.js': ['makeApi', 'ApiError'],
  'render.js': ['esc', 'pocketCardHtml', 'activityRowHtml', 'renderPockets', 'renderActivity'],
  'addform.js': ['mountAddForm'],
  'manage.js': ['mountManage'],
  'app.js': ['boot', 'showToast', 'switchView', 'isServerStale', 'registerServiceWorker',
             'captureInstallPrompt', 'shouldShowIosInstallHint'],
};

test('every frontend module exists', () => {
  for (const f of Object.keys(EXPECTED_EXPORTS)) {
    assert.ok(existsSync(join(JS, f)), 'missing app/js/' + f);
  }
});

test('every module declares the exports the others import', async () => {
  for (const [file, names] of Object.entries(EXPECTED_EXPORTS)) {
    const mod = await import('../app/js/' + file);
    for (const name of names) {
      assert.ok(name in mod, `app/js/${file} must export ${name}() — something imports it by that name`);
    }
  }
});

test('every static import resolves to a module that exists', () => {
  const files = readdirSync(JS).filter((f) => f.endsWith('.js'));
  for (const f of files) {
    const src = readFileSync(join(JS, f), 'utf8');
    const specs = [...src.matchAll(/from\s+'(\.\/[^']+)'/g)].map((m) => m[1]);
    for (const spec of specs) {
      assert.ok(existsSync(join(JS, spec)), `${f} imports '${spec}' which does not exist`);
    }
  }
});

test('the service worker precaches every module the shell actually ships', () => {
  // A module missing from the precache list means the app breaks offline.
  for (const f of readdirSync(JS).filter((f) => f.endsWith('.js'))) {
    assert.ok(sw.includes('./js/' + f), `sw.js must precache ./js/${f}`);
  }
});

test('the service worker precaches no API URL', () => {
  // Strip comments first: sw.js deliberately *mentions* script.google in prose to
  // explain why the API is excluded, and that prose must not count as a precache entry.
  const code = sw.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const listMatch = code.match(/const\s+PRECACHE[^=]*=\s*\[([\s\S]*?)\]/);
  assert.ok(listMatch, 'sw.js must declare a PRECACHE array');
  assert.doesNotMatch(listMatch[1], /script\.google/,
    'the API must never appear in the precache list');
});

test('index.html loads app.js as a module and every module it needs exists', () => {
  assert.match(html, /<script type="module" src="js\/app\.js">/);
  assert.ok(existsSync(join(JS, 'app.js')));
});

test('CLIENT_VERSION in app.js matches SERVER_VERSION in the backend', async () => {
  // A mismatch shows the version banner to every user on every load.
  const { SERVER_VERSION } = await import('../backend/00_Config.gs.js');
  const appSrc = readFileSync(join(JS, 'app.js'), 'utf8');
  const m = appSrc.match(/CLIENT_VERSION\s*=\s*['"]([^'"]+)['"]/);
  assert.ok(m, 'app.js must declare CLIENT_VERSION');
  assert.equal(m[1], SERVER_VERSION, 'CLIENT_VERSION must track SERVER_VERSION');
});

test('the transport header in api.js is still text/plain', async () => {
  const src = readFileSync(join(JS, 'api.js'), 'utf8');
  const m = src.match(/SAFE_HEADERS\s*=\s*\{([^}]+)\}/);
  assert.ok(m, 'api.js must define SAFE_HEADERS');
  assert.match(m[1], /text\/plain/,
    'REGRESSION: application/json triggers a CORS preflight Apps Script 405s');
  assert.doesNotMatch(m[1], /application\/json/);
});

test('DOM ids referenced by the modules all exist in the shell', () => {
  // Pull literal getElementById/#-selector ids out of the modules.
  const ids = new Set();
  for (const f of readdirSync(JS).filter((f) => f.endsWith('.js'))) {
    const src = readFileSync(join(JS, f), 'utf8');
    for (const m of src.matchAll(/getElementById\(\s*['"]([\w-]+)['"]/g)) ids.add(m[1]);
    for (const m of src.matchAll(/byId\(\s*['"]([\w-]+)['"]/g)) ids.add(m[1]);
  }
  const missing = [...ids].filter((id) => !html.includes(`id="${id}"`));
  assert.deepEqual(missing, [], 'modules query ids absent from index.html: ' + missing.join(', '));
});

test('every module passes the syntax check', () => {
  // Guards against a truncated or malformed file that Node would refuse.
  for (const f of readdirSync(JS).filter((f) => f.endsWith('.js'))) {
    const src = readFileSync(join(JS, f), 'utf8');
    assert.ok(src.length > 200, `app/js/${f} looks truncated (${src.length} bytes)`);
    assert.match(src, /export (function|const|class)/, `app/js/${f} exports nothing`);
  }
});

test('no module touches window or document at import time', () => {
  // A browser global accessed at module top level would throw on import under
  // Node and would break every test that imports the module. Only consider
  // statements at brace depth 0 — a line inside a function body is fine.
  const BROWSER = /\b(window|document|navigator|localStorage)\b/;
  for (const f of readdirSync(JS).filter((f) => f.endsWith('.js'))) {
    const lines = readFileSync(join(JS, f), 'utf8').split('\n');
    let depth = 0;
    const offenders = [];
    for (const raw of lines) {
      const line = raw
        .replace(/\/\/.*$/, '')          // line comments
        .replace(/^\s*\*.*$/, '')        // JSDoc block-comment continuation
        .trim();
      const opens = (raw.match(/\{/g) || []).length;
      const closes = (raw.match(/\}/g) || []).length;
      if (depth === 0 && BROWSER.test(line) && !/^(import|export)/.test(line)) {
        offenders.push(raw.trim());
      }
      depth += opens - closes;
      if (depth < 0) depth = 0;
    }
    assert.deepEqual(offenders, [], `app/js/${f} touches the browser at module top level`);
  }
});