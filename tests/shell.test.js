// tests/shell.test.js
// Structural contract tests for the static shell.
//
// These guard the wiring between index.html and the JS modules. A renamed id
// silently breaks a screen at runtime with no test failure otherwise — the
// DOM is the only place these names are declared.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../app/styles.css', import.meta.url), 'utf8');

/** Every id app.js / render.js / addform.js / manage.js will query. */
const REQUIRED_IDS = [
  'toast', 'version-banner', 'stale-banner',
  'view-setup', 'setup-form', 'setup-endpoint', 'setup-token',
  'setup-save', 'setup-test', 'setup-status', 'setup-cancel', 'change-connection',
  'view-home', 'home-summary', 'pockets', 'activity',
  'view-add', 'add-form', 'add-amount', 'add-pocket', 'add-note',
  'add-user', 'add-submit', 'add-reason',
  'view-manage', 'manage-list', 'manage-form', 'manage-name',
  'manage-account', 'manage-limit', 'manage-submit', 'manage-reason',
];

test('index.html declares every id the modules query', () => {
  const missing = REQUIRED_IDS.filter((id) => !html.includes(`id="${id}"`));
  assert.deepEqual(missing, [], 'missing ids: ' + missing.join(', '));
});

test('three tab views exist and match the tab bar; setup is a fourth, untabbed view', () => {
  // view-setup is deliberately NOT in the tab bar — it is shown before the
  // household is configured and hides itself afterwards.
  const views = [...html.matchAll(/id="view-([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(views.sort(), ['add', 'home', 'manage', 'setup']);

  const tabs = [...html.matchAll(/data-view="([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(tabs.sort(), ['add', 'home', 'manage']);

  // Every tab must target a view that actually exists.
  const tabbed = tabs.filter((t) => !views.includes(t));
  assert.deepEqual(tabbed, [], 'tabs pointing at missing views: ' + tabbed.join(', '));
});

test('every view starts hidden so only one is visible at a time', () => {
  for (const v of ['home', 'add', 'manage', 'setup']) {
    const tag = html.match(new RegExp(`<section id="view-${v}"[^>]*>`))[0];
    assert.match(tag, /class="[^"]*\bhidden\b/, `view-${v} must start hidden`);
  }
});

test('the viewport enables safe-area insets for the notch', () => {
  assert.match(html, /name="viewport"[^>]*viewport-fit=cover/);
});

test('the amount field uses inputmode decimal, not type=number', () => {
  // iOS renders type="number" without a decimal keypad on several versions,
  // which would break the sub-5-second entry goal on exactly the phones
  // that need it.
  const tag = html.match(/<input[^>]*id="add-amount"[^>]*>/)[0];
  assert.match(tag, /inputmode="decimal"/);
  assert.doesNotMatch(tag, /type="number"/);
});

test('the setup token field is masked', () => {
  assert.match(html, /id="setup-token"[^>]*type="password"/);
});

test('the toast is announced to screen readers', () => {
  const tag = html.match(/<div[^>]*id="toast"[^>]*>/)[0];
  assert.match(tag, /role="alert"/);
  assert.match(tag, /aria-live="polite"/);
});

test('the manifest and icons are linked for installability', () => {
  assert.match(html, /rel="manifest"[^>]*href="manifest\.webmanifest"/);
  assert.match(html, /rel="apple-touch-icon"[^>]*href="icons\/apple-touch-icon\.png"/);
  assert.match(html, /name="theme-color"[^>]*content="#0f172a"/);
});

test('app.js is loaded as a module so imports resolve', () => {
  assert.match(html, /<script type="module" src="js\/app\.js">/);
});

test('the bottom nav respects the iOS home indicator', () => {
  assert.match(html, /padding-bottom:\s*env\(safe-area-inset-bottom\)/);
});

test('styles.css sets the theme background to avoid a white flash', () => {
  assert.match(css, /background:\s*var\(--ink\)/);
  assert.match(css, /color-scheme:\s*dark/);
});

test('inputs are 16px so Safari does not zoom on focus', () => {
  assert.match(css, /input[\s\S]*font-size:\s*16px/);
});
test('the toast is a light card with dark text, not bare text on the dark page', () => {
  assert.match(html.match(/<div[^>]*id="toast"[^>]*>/)[0], /\bpb-toast\b/);
  const rule = css.match(/\.pb-toast\s*\{([^}]*)\}/);
  assert.ok(rule, '.pb-toast must be styled in styles.css');
  const bg = rule[1].match(/background:\s*(#[0-9a-f]{6})/i);
  const fg = rule[1].match(/(?:^|[;\s])color:\s*(#[0-9a-f]{6})/i);
  assert.ok(bg && fg, 'both a background and a text colour are set');
  const lum = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [light, dark] = [lum(bg[1]), lum(fg[1])];
  assert.ok(light > 0.8, `background ${bg[1]} must be light`);
  assert.ok(dark < 0.05, `text ${fg[1]} must be dark`);
  assert.ok((light + 0.05) / (dark + 0.05) >= 7, 'contrast must be at least 7:1');
});

/* -------------------------------------------- compiled Tailwind (no CDN) -- */

test('the page uses the committed tailwind.css, not the runtime CDN', () => {
  assert.doesNotMatch(html, /cdn\.tailwindcss\.com/);
  assert.doesNotMatch(html, /tailwind\.config\s*=/);
  assert.match(html, /<link rel="stylesheet" href="tailwind\.css">/);
  assert.ok(html.indexOf('tailwind.css') < html.indexOf('styles.css'), 'our overrides load after Tailwind');
});

test('every Tailwind class used in index.html exists in the compiled stylesheet', () => {
  const compiled = readFileSync(new URL('../app/tailwind.css', import.meta.url), 'utf8');
  const OURS = /^(pb-|tab$|dark$|scroll-thin$)/;
  const missing = new Set();
  for (const m of html.matchAll(/class="([^"]*)"/g)) {
    for (const cls of m[1].split(/\s+/).filter(Boolean)) {
      if (OURS.test(cls)) continue;
      const selector = '.' + cls.replace(/([:/.\[\]%#,()])/g, '\\$1');
      if (!compiled.includes(selector)) missing.add(cls);
    }
  }
  assert.deepEqual([...missing], [], 'run `npm run build:css`; missing: ' + [...missing].join(' '));
});
