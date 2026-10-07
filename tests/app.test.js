// tests/app.test.js
// The bootstrap (app/js/app.js): view routing, toasts, the version/stale
// banners, the first-run setup screen, service-worker registration, and the
// install prompts.
//
// Node has no DOM, so everything browser-specific is driven through the fake
// window/document built below. No npm dependencies — the whole fake is a few
// hundred lines of plain objects.
//
// The load-bearing assertions here are not cosmetic:
//   * getState runs EXACTLY ONCE on load. Apps Script costs 1-3s per cold
//     start, so a second request on boot is a real product regression.
//   * An unconfigured app makes ZERO api calls and shows the setup screen.
//   * A failed getState shows the stale banner instead of an empty screen, and
//     cached data is labelled with the time it was fetched. Presenting a stale
//     balance as if it were current defeats the entire product.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CLIENT_VERSION,
  showToast,
  switchView,
  isServerStale,
  registerServiceWorker,
  captureInstallPrompt,
  shouldShowIosInstallHint,
  boot,
} from '../app/js/app.js';
import { makeConfig } from '../app/js/config.js';
import { makeApi } from '../app/js/api.js';

/* ------------------------------------------------------------- fake DOM -- */

const DATASET_KEYS = new Set(['action', 'txnId', 'pocketId', 'view', 'kind']);

function camel(name) {
  return name.replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
}

/**
 * Tag an event object with its type WITHOUT copying it.
 *
 * Identity matters: beforeinstallprompt is stashed and later asserted on by
 * reference, so a spread here would hand boot a look-alike that still happened
 * to work — and would hide any future code that keyed off the real event.
 */
function withType(ev, type) {
  if (!ev || typeof ev !== 'object') return { type };
  if (ev.type === undefined) ev.type = type;
  return ev;
}

/** `[data-txn-id]`, `[data-view="home"]`, `#id`, `.cls`, or a bare tag name. */
function matchesSimple(el, sel) {
  const s = String(sel).trim();
  if (!s) return false;
  if (s.startsWith('#')) return el.id === s.slice(1);
  if (s.startsWith('.')) return el.classList.contains(s.slice(1));
  if (s.startsWith('[')) {
    const m = s.match(/^\[([a-zA-Z-]+)(?:=["']?([^"'\]]*)["']?)?\]$/);
    if (!m) return false;
    const attr = m[1];
    if (!(attr in el.attributes)) return false;
    return m[2] === undefined || el.attributes[attr] === m[2];
  }
  return String(el.tagName).toUpperCase() === s.toUpperCase();
}

/** Subtree search used by an element's default querySelector. */
function defaultSearch(root, sel) {
  const s = String(sel).trim();
  if (matchesSimple(root, s)) return root;
  for (const child of root.children) {
    const hit = child && typeof child.querySelector === 'function' ? child.querySelector(s) : null;
    if (hit) return hit;
  }
  return null;
}

function makeEl(id = '', tag = 'div') {
  const el = {
    id,
    tagName: String(tag).toUpperCase(),
    attributes: {},
    children: [],
    parentNode: null,
    ownerDocument: null,
    textContent: '',
    innerHTML: '',
    value: '',
    hidden: false,
    disabled: false,
    focused: false,
    _listeners: new Map(),
  };

  // Like a real element, `dataset` is a getter-only accessor: reassigning it
  // throws a TypeError in strict mode. A plain writable property here hid a
  // production bug where Test connection did nothing at all.
  const dataset = {};
  Object.defineProperty(el, 'dataset', { get: () => dataset, enumerable: true });

  el.classList = {
    add(...names) { for (const n of names) el.classNames.add(n); },
    remove(...names) { for (const n of names) el.classNames.delete(n); },
    contains(name) { return el.classNames.has(name); },
    toggle(name, force) {
      const on = force === undefined ? !el.classNames.has(name) : !!force;
      if (on) el.classNames.add(name); else el.classNames.delete(name);
      return on;
    },
    values() { return [...el.classNames]; },
  };
  el.classNames = new Set();

  el.setAttribute = (k, v) => {
    const name = String(k);
    el.attributes[name] = String(v);
    if (name.startsWith('data-')) {
      const key = camel(name.slice(5));
      if (DATASET_KEYS.has(key)) el.dataset[key] = String(v);
    }
    if (name === 'hidden') el.hidden = true;
  };
  el.getAttribute = (k) => (String(k) in el.attributes ? el.attributes[String(k)] : null);
  el.removeAttribute = (k) => {
    delete el.attributes[String(k)];
    if (String(k).startsWith('data-')) delete el.dataset[camel(String(k).slice(5))];
  };

  el.addEventListener = (type, fn) => {
    if (!el._listeners.has(type)) el._listeners.set(type, []);
    el._listeners.get(type).push(fn);
  };
  el.removeEventListener = (type, fn) => {
    const list = el._listeners.get(type) || [];
    const i = list.indexOf(fn);
    if (i !== -1) list.splice(i, 1);
  };
  el.dispatch = (type, ev = {}) => {
    const event = withType(ev, type);
    const out = [];
    for (const fn of (el._listeners.get(type) || [])) out.push(fn(event));
    return out;
  };
  el.listenerCount = (type) => (el._listeners.get(type) || []).length;

  el.appendChild = (node) => {
    el.children.push(node);
    if (node && typeof node === 'object') node.parentNode = el;
    return node;
  };
  el.removeChild = (node) => {
    const i = el.children.indexOf(node);
    if (i !== -1) el.children.splice(i, 1);
    return node;
  };
  Object.defineProperty(el, 'firstChild', { get() { return el.children[0] || null; } });
  el.replaceChildren = (...nodes) => {
    const flat = nodes.flat();
    el.children = flat;
    // render.js / manage.js mount via <template>.content; record the markup so a
    // test can assert on what was painted.
    const frag = flat.find((n) => n && typeof n.__templateHtml === 'string');
    if (frag) el.innerHTML = frag.__templateHtml;
  };
  el.focus = () => { el.focused = true; };
  el.matches = (sel) => matchesSimple(el, sel);
  el.closest = (sel) => {
    let node = el;
    while (node) {
      if (matchesSimple(node, sel)) return node;
      node = node.parentNode;
    }
    return null;
  };
  // Default: search this subtree. Elements that live in a flat id registry
  // (the shell views) override this to resolve '#id' first.
  el.querySelector = (sel) => defaultSearch(el, sel);

  return el;
}

/** Every id app.js queries, mirroring index.html. */
const SHELL_IDS = [
  'toast', 'version-banner', 'stale-banner',
  'view-setup', 'setup-form', 'setup-endpoint', 'setup-token',
  'setup-save', 'setup-test', 'setup-status', 'setup-cancel', 'change-connection',
  'view-home', 'home-summary', 'pockets', 'activity',
  'view-add', 'add-form', 'add-amount', 'add-pocket', 'add-note',
  'add-user', 'add-submit', 'add-reason',
  'view-manage', 'manage-list', 'manage-form', 'manage-name',
  'manage-account', 'manage-limit', 'manage-submit', 'manage-reason',
];

/** Views that start with class="hidden" in index.html. */
const HIDDEN_AT_START = [
  'view-setup', 'view-home', 'view-add', 'view-manage',
  'add-reason', 'manage-reason', 'version-banner', 'stale-banner', 'toast',
];

const ENDPOINT = 'https://script.google.com/macros/s/AKfycbSEVEN/exec';
const TOKEN = 'household-token-123';

/**
 * A fake document + window with the id registry from index.html, the three tab
 * buttons inside a <nav>, and a template-capable createElement so render.js /
 * manage.js can mount in a headless host.
 */
function makeHarness({ ua, standalone, protocol = 'https:', hostname = 'pocketbudget.example', href } = {}) {
  const byId = new Map();
  for (const id of SHELL_IDS) {
    const el = makeEl(id, id.startsWith('view-') ? 'section' : 'div');
    if (HIDDEN_AT_START.includes(id)) el.classList.add('hidden');
    byId.set(id, el);
  }
  byId.get('add-form').tagName = 'FORM';
  byId.get('manage-form').tagName = 'FORM';
  byId.get('setup-form').tagName = 'FORM';
  byId.get('add-amount').value = '';
  byId.get('toast').setAttribute('role', 'alert');

  const nav = makeEl('', 'nav');
  const tabs = {};
  for (const name of ['home', 'add', 'manage']) {
    const tab = makeEl('', 'button');
    tab.setAttribute('data-view', name);
    nav.appendChild(tab);
    tabs[name] = tab;
  }

  const resolve = (sel) => {
    const s = String(sel).trim();
    if (s.startsWith('#')) return byId.get(s.slice(1)) || null;
    for (const el of byId.values()) if (matchesSimple(el, s)) return el;
    for (const tab of Object.values(tabs)) if (matchesSimple(tab, s)) return tab;
    if (matchesSimple(nav, s)) return nav;
    return null;
  };
  // The shell views resolve '#id' first (that is how addform.js / manage.js
  // scope their lookups), then fall back to a subtree search.
  for (const el of byId.values()) el.querySelector = (sel) => resolve(sel);

  const body = makeEl('body', 'body');
  const created = [];

  const doc = {
    visibilityState: 'visible',
    readyState: 'complete',
    _listeners: new Map(),
    getElementById: (id) => byId.get(String(id)) || null,
    querySelector: resolve,
    querySelectorAll: (sel) => {
      const pool = [...byId.values(), ...Object.values(tabs), nav];
      return pool.filter((el) => matchesSimple(el, sel));
    },
    createElement(tag) {
      const name = String(tag).toLowerCase();
      const el = makeEl('', name);
      el.ownerDocument = doc;
      // A created node contains no shell ids, so it gets the plain subtree
      // search. Routing it through the id registry instead would make
      // querySelector('button') return a tab bar button.
      el.querySelector = (sel) => defaultSearch(el, sel);
      created.push(el);
      if (name === 'template') {
        Object.defineProperty(el, 'content', {
          get() { return { __templateHtml: el.innerHTML }; },
        });
      }
      return el;
    },
    addEventListener(type, fn) {
      if (!doc._listeners.has(type)) doc._listeners.set(type, []);
      doc._listeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const list = doc._listeners.get(type) || [];
      const i = list.indexOf(fn);
      if (i !== -1) list.splice(i, 1);
    },
    /** Drive visibilitychange the way a browser does. */
    emit(type, ev = {}) {
      const out = [];
      for (const fn of doc._listeners.get(type) || []) out.push(fn(withType(ev, type)));
      return out;
    },
    listenerCount(type) { return (doc._listeners.get(type) || []).length; },
    body,
  };

  const win = {
    document: doc,
    location: {
      protocol,
      hostname,
      href: href || `${protocol}//${hostname}/PocketBudget/index.html`,
    },
    navigator: {},
    _listeners: new Map(),
    addEventListener(type, fn) {
      if (!win._listeners.has(type)) win._listeners.set(type, []);
      win._listeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const list = win._listeners.get(type) || [];
      const i = list.indexOf(fn);
      if (i !== -1) list.splice(i, 1);
    },
    emit(type, ev = {}) {
      const event = withType(ev, type);
      const out = [];
      for (const fn of win._listeners.get(type) || []) out.push(fn(event));
      return out;
    },
  };
  if (ua) win.navigator.userAgent = ua;
  if (standalone !== undefined) win.navigator.standalone = standalone;

  const timers = [];
  win.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  win.clearTimeout = () => {};

  return { win, doc, byId, nav, tabs, body, created };
}

/* --------------------------------------------------------------- fakes -- */

const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15'
  + ' (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36'
  + ' (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

const STATE = {
  version: '1.0.0',
  serverTime: '2026-10-01T09:40:00.000Z',
  month: '2026-10',
  pockets: [
    { id: 'P01', name: 'Groceries', account: 'Chase Checking', limit: 800, balance: 340.5, spent: 459.5, pctUsed: 57.44, isLocked: false },
    { id: 'P02', name: 'Fuel', account: '', limit: 120, balance: 0, spent: 120, pctUsed: 100, isLocked: true },
  ],
  transactions: [
    { id: 'T1001', timestamp: new Date().toISOString(), user: 'Alex', pocketId: 'P01', amount: 65.2, note: 'Whole Foods' },
  ],
  summary: { totalLimit: 920, totalBalance: 340.5, totalSpent: 579.5, users: ['Alex', 'Sam'] },
};

/** An api double that records every call, so "exactly once" is assertable. */
function fakeApi({ state = STATE, pingError = null, stateError = null } = {}) {
  const calls = { ping: 0, getState: 0, deleteTransaction: [], createPocket: [], updatePocket: [] };
  return {
    calls,
    ping: async () => {
      calls.ping += 1;
      if (pingError) throw pingError;
      return { ok: true, version: '1.0.0', serverTime: '2026-10-01T09:40:00.000Z' };
    },
    getState: async () => {
      calls.getState += 1;
      if (stateError) throw stateError;
      return state;
    },
    deleteTransaction: async (id) => { calls.deleteTransaction.push(id); return { ok: true }; },
    createPocket: async (p) => { calls.createPocket.push(p); return { ok: true }; },
    updatePocket: async (p) => { calls.updatePocket.push(p); return { ok: true }; },
    createTransaction: async () => ({ ok: true }),
  };
}

function memoryStore(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    _map: map,
  };
}

function configuredConfig() {
  const store = memoryStore({ 'pb.endpoint': ENDPOINT, 'pb.token': TOKEN });
  return makeConfig({ store });
}

function emptyConfig() {
  return makeConfig({ store: memoryStore() });
}

/**
 * boot() with everything the tests need, wired to the fake DOM.
 *
 * The fake document is installed as globalThis.document for the whole test
 * because render.js / manage.js read it at mount time — an async refresh that
 * lands after this call would otherwise find no document and silently paint
 * nothing. Each test tears the installation down with handle.teardown().
 */
function bootIn(harness, { config, api, now } = {}) {
  const had = Object.prototype.hasOwnProperty.call(globalThis, 'document');
  const prevDoc = globalThis.document;
  globalThis.document = harness.doc;

  let handle;
  try {
    handle = boot({
      win: harness.win,
      doc: harness.doc,
      config,
      api,
      apiFactory: (cfg) => api || fakeApi({}),
      now: now || (() => new Date('2026-10-01T09:41:00.000Z')),
    });
  } catch (err) {
    if (had) globalThis.document = prevDoc; else delete globalThis.document;
    throw err;
  }

  const rawTeardown = handle.teardown;
  handle.teardown = () => {
    rawTeardown();
    if (had) globalThis.document = prevDoc; else delete globalThis.document;
  };
  return handle;
}

/* --------------------------------------------------------------- toast -- */

test('showToast sets the message and makes the element visible', () => {
  const el = makeEl('toast');
  el.classList.add('hidden');

  showToast(el, 'Expense saved.', 'success');

  assert.equal(el.textContent, 'Expense saved.');
  assert.equal(el.hidden, false, 'the hidden property must be cleared');
  assert.equal(el.classList.contains('hidden'), false, 'the hidden class must be removed');
});

test('showToast records the kind so an error is distinguishable from a success', () => {
  const err = makeEl('toast');
  const ok = makeEl('toast');

  showToast(err, 'Could not reach the server.', 'error');
  showToast(ok, 'Saved.', 'success');

  assert.equal(err.dataset.kind, 'error');
  assert.equal(ok.dataset.kind, 'success');
  assert.notEqual(err.dataset.kind, ok.dataset.kind);
  assert.ok(err.classList.contains('pb-toast--error'), 'error carries a marker class');
  assert.ok(!err.classList.contains('pb-toast--success'), 'kinds do not stack');
  assert.ok(ok.classList.contains('pb-toast--success'));
  assert.ok(!ok.classList.contains('pb-toast--error'));
});

test('showToast defaults to the info kind and tolerates a missing element', () => {
  const el = makeEl('toast');
  showToast(el, 'Hi');
  assert.equal(el.dataset.kind, 'info');

  assert.doesNotThrow(() => showToast(null, 'ignored', 'error'));
  assert.doesNotThrow(() => showToast(undefined, 'ignored', 'error'));
});

/* ------------------------------------------------------------- routing -- */

test('switchView hides every other view and marks the active tab aria-current', () => {
  const views = {
    setup: makeEl('view-setup'), home: makeEl('view-home'),
    add: makeEl('view-add'), manage: makeEl('view-manage'),
  };
  for (const el of Object.values(views)) el.classList.add('hidden');
  const tabs = { home: makeEl(), add: makeEl(), manage: makeEl() };

  switchView(views, tabs, 'add');

  assert.equal(views.add.hidden, false);
  assert.equal(views.add.classList.contains('hidden'), false);
  for (const key of ['setup', 'home', 'manage']) {
    assert.equal(views[key].hidden, true, `view-${key} must be hidden`);
    assert.equal(views[key].classList.contains('hidden'), true);
  }

  assert.equal(tabs.add.getAttribute('aria-current'), 'page');
  assert.equal(tabs.home.getAttribute('aria-current'), null, 'previous tab loses aria-current');
  assert.equal(tabs.manage.getAttribute('aria-current'), null);
});

test('switchView returns the active name and tolerates missing views/tabs', () => {
  assert.equal(switchView({ home: makeEl() }, {}, 'home'), 'home');
  assert.doesNotThrow(() => switchView(null, null, 'home'));
  assert.doesNotThrow(() => switchView({ home: makeEl('view-home') }, { home: null }, 'home'));
});

/* ------------------------------------------------------- version check -- */

test('isServerStale is false for matching versions and true for a mismatch', () => {
  assert.equal(isServerStale('1.0.0', '1.0.0'), false);
  assert.equal(isServerStale('1.1.0', '1.0.0'), true);
  assert.equal(isServerStale('1.0.0', '1.1.0'), true);
});

test('isServerStale tolerates missing or blank versions without shouting', () => {
  // No version in the payload means an older backend, not a stale client. The
  // banner is for a KNOWN mismatch, so silence beats a false alarm.
  assert.equal(isServerStale(undefined, '1.0.0'), false);
  assert.equal(isServerStale('', '1.0.0'), false);
  assert.equal(isServerStale('   ', '1.0.0'), false);
  assert.equal(isServerStale('1.0.0', undefined), false);
});

test('CLIENT_VERSION is 1.0.0, matching SERVER_VERSION', () => {
  assert.equal(CLIENT_VERSION, '1.0.0');
});

/* ------------------------------------------------------- install prompt -- */

function makeBeforeInstallPrompt() {
  const ev = {
    prevented: 0,
    prompted: 0,
    preventDefault() { ev.prevented += 1; },
    prompt() { ev.prompted += 1; return Promise.resolve({ outcome: 'accepted' }); },
    userChoice: Promise.resolve({ outcome: 'accepted' }),
  };
  return ev;
}

test('captureInstallPrompt stashes the event and calls preventDefault on it', () => {
  const state = {};
  const ev = makeBeforeInstallPrompt();

  captureInstallPrompt(state, ev);

  assert.equal(state.installPrompt, ev, 'the event is stashed on state');
  assert.equal(ev.prevented, 1, 'preventDefault MUST be called or Chrome never fires it again');
});

test('captureInstallPrompt works as a bare listener (single argument)', () => {
  // Used directly as the beforeinstallprompt listener, so the event arrives
  // first; it must still be preventDefault-ed and stashed on the shared holder.
  const ev = makeBeforeInstallPrompt();
  const returned = captureInstallPrompt(ev);

  assert.equal(ev.prevented, 1);
  assert.equal(returned, ev);
});

test('captureInstallPrompt replaces an earlier stashed event rather than keeping both', () => {
  const state = {};
  const first = makeBeforeInstallPrompt();
  const second = makeBeforeInstallPrompt();

  captureInstallPrompt(state, first);
  captureInstallPrompt(state, second);

  assert.equal(state.installPrompt, second);
  assert.equal(first.prevented, 1, 'the first event is still preventDefault-ed');
});

/* ---------------------------------------------------------------- iOS -- */

test('shouldShowIosInstallHint is true for iOS that is not standalone', () => {
  assert.equal(shouldShowIosInstallHint({ navigator: {} }, { userAgent: IOS_UA, standalone: false }), true);
});

test('shouldShowIosInstallHint is false once the app is already standalone', () => {
  assert.equal(shouldShowIosInstallHint({ navigator: {} }, { userAgent: IOS_UA, standalone: true }), false);
});

test('shouldShowIosInstallHint is false on Android and desktop', () => {
  assert.equal(shouldShowIosInstallHint({ navigator: {} }, { userAgent: ANDROID_UA, standalone: false }), false);
  assert.equal(
    shouldShowIosInstallHint({ navigator: {} },
      { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15', standalone: false }),
    false,
  );
});

test('shouldShowIosInstallHint falls back to win.navigator and matchMedia', () => {
  // No navigator.standalone at all (desktop-mode iPad / a host without it), so
  // matchMedia decides: matches === true means the app is ALREADY installed.
  const notInstalled = {
    navigator: { userAgent: IOS_UA },
    matchMedia: () => ({ matches: false }),
  };
  assert.equal(shouldShowIosInstallHint(notInstalled, {}), true);

  const installed = {
    navigator: { userAgent: IOS_UA },
    matchMedia: () => ({ matches: true }),
  };
  assert.equal(shouldShowIosInstallHint(installed, {}), false);
});

test('shouldShowIosInstallHint is false when there is nothing to detect', () => {
  assert.equal(shouldShowIosInstallHint(null, null), false);
  assert.equal(shouldShowIosInstallHint({}, {}), false);
});

/* --------------------------------------------------- service worker -- */

function makeWindow({ protocol, hostname, href, withSW = true } = {}) {
  const registrations = [];
  const win = {
    location: {
      protocol,
      hostname,
      href: href || `${protocol}//${hostname}/index.html`,
    },
    navigator: {},
  };
  if (withSW) {
    win.navigator.serviceWorker = {
      register(url, opts) {
        registrations.push({ url, opts });
        return Promise.resolve({ scope: opts && opts.scope });
      },
    };
  }
  win.registrations = registrations;
  return win;
}

test('registerServiceWorker does nothing over plain http on a LAN address', async () => {
  const win = makeWindow({ protocol: 'http:', hostname: '192.168.1.24' });

  const result = registerServiceWorker(win);

  assert.equal(result, null, 'no registration object');
  assert.equal(win.registrations.length, 0, 'register() must not even be attempted');
});

test('registerServiceWorker returns null when the browser has no service workers', () => {
  const win = makeWindow({ protocol: 'https:', withSW: false });
  assert.equal(registerServiceWorker(win), null);
  assert.equal(registerServiceWorker(null), null);
  assert.equal(registerServiceWorker({}), null);
});

test('registerServiceWorker registers sw.js over https', async () => {
  const win = makeWindow({ protocol: 'https:', hostname: 'pocketbudget.example' });

  const result = registerServiceWorker(win);

  assert.ok(result, 'a registration (promise) is returned');
  await result;
  assert.equal(win.registrations.length, 1);
  assert.match(win.registrations[0].url, /sw\.js$/);
});

test('registerServiceWorker registers over http on localhost', async () => {
  for (const hostname of ['localhost', '127.0.0.1', '[::1]']) {
    const win = makeWindow({ protocol: 'http:', hostname });
    const result = registerServiceWorker(win);
    assert.ok(result, `expected a registration for ${hostname}`);
    await result;
    assert.equal(win.registrations.length, 1);
  }
});

test('registerServiceWorker asks a waiting worker to skip waiting but never reloads', async () => {
  const win = makeWindow({ protocol: 'https:', hostname: 'pocketbudget.example' });
  const posted = [];
  const registration = {
    waiting: { postMessage: (msg) => posted.push(msg) },
    installing: null,
    addEventListener() {},
  };
  win.navigator.serviceWorker.register = () => Promise.resolve(registration);
  win.location.reload = () => { throw new Error('boot must never force a reload'); };

  await registerServiceWorker(win);

  assert.equal(posted.length, 1);
  assert.deepEqual(posted[0], { type: 'SKIP_WAITING' });
});

test('an installing worker is nudged once it has installed (statechange is a real DOM event)', async () => {
  const win = makeWindow({ protocol: 'https:', hostname: 'pocketbudget.example' });
  const posted = [];
  const listeners = [];
  const installing = {
    state: 'installing',
    postMessage: (msg) => posted.push(msg),
    // The real API is addEventListener. The code used a method that does not exist
    // (addStateListener), so this branch could never run in a browser.
    addEventListener: (type, fn) => listeners.push([type, fn]),
  };
  const registration = { waiting: null, installing, active: { state: 'activated' } };
  win.navigator.serviceWorker.register = () => Promise.resolve(registration);

  await registerServiceWorker(win);
  assert.equal(listeners.length, 1);
  assert.equal(listeners[0][0], 'statechange');
  assert.equal(posted.length, 0, 'not before it has installed');

  installing.state = 'installed';
  listeners[0][1]();
  assert.deepEqual(posted, [{ type: 'SKIP_WAITING' }]);
});

test('registerServiceWorker does not blow up when the promise rejects', async () => {
  const win = makeWindow({ protocol: 'https:', hostname: 'pocketbudget.example' });
  win.navigator.serviceWorker.register = () => Promise.reject(new Error('SecurityError'));
  const result = registerServiceWorker(win);
  assert.ok(result, 'the caller still gets a handle; the failure is swallowed internally');
  await assert.doesNotReject(() => result);
});

/* ---------------------------------------------------------------- boot -- */

test('saving the setup form persists the config and enters the app once', async () => {
  const h = makeHarness();
  const api = fakeApi();
  const config = emptyConfig();
  h.byId.get('setup-endpoint').value = ENDPOINT;
  h.byId.get('setup-token').value = TOKEN;

  const handle = await bootIn(h, { config, api });
  await handle.ready;
  assert.equal(config.isConfigured(), false);

  h.byId.get('setup-form').dispatch('submit');
  await handle.pending();

  assert.equal(config.isConfigured(), true, 'the config is saved');
  assert.equal(config.getEndpoint(), ENDPOINT);
  assert.equal(config.getToken(), TOKEN);
  assert.equal(api.calls.getState, 1, 'ONE request after saving — not one per handler');
  assert.equal(h.byId.get('view-setup').hidden, true);
  assert.equal(h.byId.get('view-home').hidden, false);
  assert.equal(h.nav.hidden, false, 'the tab bar appears once the app is configured');
  assert.equal(h.tabs.home.getAttribute('aria-current'), 'page');

  handle.teardown();
});

test('a setup save that the server rejects says so and does not enter the app', async () => {
  const h = makeHarness();
  const api = fakeApi({ stateError: Object.assign(new Error('Invalid or missing token.'), { name: 'ApiError', code: 'UNAUTHORIZED' }) });
  const config = emptyConfig();
  h.byId.get('setup-endpoint').value = ENDPOINT;
  h.byId.get('setup-token').value = 'wrong-token';

  const handle = await bootIn(h, { config, api });
  await handle.ready;
  h.byId.get('setup-form').dispatch('submit');
  await handle.pending();

  assert.equal(h.byId.get('setup-status').dataset.kind, 'error');
  assert.match(h.byId.get('setup-status').textContent, /Invalid or missing token\./);
  assert.equal(h.byId.get('view-setup').hidden, false, 'the user stays on setup');
  assert.equal(h.nav.hidden, true);
  assert.equal(h.byId.get('stale-banner').hidden, false, 'the failure is visible, not swallowed');

  handle.teardown();
});

test('boot shows the setup view and makes NO api call when unconfigured', async () => {
  const h = makeHarness();
  const api = fakeApi();

  const handle = await bootIn(h, { config: emptyConfig(), api });
  await handle.ready;

  assert.equal(api.calls.getState, 0, 'no state fetch before a config exists');
  assert.equal(api.calls.ping, 0, 'not even a ping');
  assert.equal(h.byId.get('view-setup').hidden, false, 'setup must be visible');
  assert.equal(h.byId.get('view-home').hidden, true);
  assert.equal(h.nav.hidden, true, 'the tab bar is meaningless until configured');
  assert.equal(h.nav.classList.contains('hidden'), true);

  handle.teardown();
});

test('boot wires the Test connection button to api.ping and reports success', async () => {
  const h = makeHarness();
  const api = fakeApi();
  const config = emptyConfig();
  h.byId.get('setup-endpoint').value = ENDPOINT;
  h.byId.get('setup-token').value = TOKEN;

  const handle = await bootIn(h, { config, api });
  await handle.ready;
  h.byId.get('setup-test').dispatch('click');
  await handle.pending();

  assert.equal(api.calls.ping, 1, 'exactly one ping — the button is not a submit');
  assert.match(h.byId.get('setup-status').textContent, /Connected/i);
  assert.equal(h.byId.get('setup-status').dataset.kind, 'success');
  // Testing must not persist the config; Save is what commits it.
  assert.equal(config.isConfigured(), false);

  handle.teardown();
});

test('boot reports the precise failure from Test connection and does not save', async () => {
  const h = makeHarness();
  const api = fakeApi({ pingError: Object.assign(new Error('Invalid or missing token.'), { code: 'UNAUTHORIZED', name: 'ApiError' }) });
  const config = emptyConfig();
  h.byId.get('setup-endpoint').value = ENDPOINT;
  h.byId.get('setup-token').value = 'wrong-token';

  const handle = await bootIn(h, { config, api });
  await handle.ready;
  h.byId.get('setup-test').dispatch('click');
  await handle.pending();

  assert.equal(api.calls.ping, 1);
  assert.match(h.byId.get('setup-status').textContent, /Invalid or missing token\./);
  assert.equal(h.byId.get('setup-status').dataset.kind, 'error');
  assert.equal(config.isConfigured(), false);

  handle.teardown();
});

test('boot catches a malformed endpoint before spending a request on it', async () => {
  const h = makeHarness();
  const api = fakeApi();
  const config = emptyConfig();
  h.byId.get('setup-endpoint').value = 'not-a-url';
  h.byId.get('setup-token').value = TOKEN;

  const handle = await bootIn(h, { config, api });
  await handle.ready;
  h.byId.get('setup-test').dispatch('click');
  await handle.pending();

  assert.equal(api.calls.ping, 0, 'a bad paste is caught locally, not by the server');
  assert.match(h.byId.get('setup-status').textContent, /https/i);
  assert.equal(h.byId.get('setup-status').dataset.kind, 'error');

  handle.teardown();
});

test('boot calls getState exactly once when already configured', async () => {
  const h = makeHarness();
  const api = fakeApi();

  const handle = await bootIn(h, { config: configuredConfig(), api });
  await handle.ready;

  assert.equal(api.calls.getState, 1, 'ONE request on load — Apps Script costs 1-3s per cold start');
  assert.equal(api.calls.ping, 0, 'ping is for the setup screen only');
  assert.equal(h.byId.get('view-home').hidden, false);
  assert.equal(h.nav.hidden, false);
  assert.match(h.byId.get('pockets').innerHTML, /Groceries/);
  assert.match(h.byId.get('activity').innerHTML, /Whole Foods/);
  assert.equal(handle.getState().pockets.length, 2);

  handle.teardown();
});

test('a getState failure shows the stale banner rather than an empty screen', async () => {
  const h = makeHarness();
  const api = fakeApi({ stateError: Object.assign(new Error('Could not reach the server.'), { code: 'NETWORK', name: 'ApiError' }) });

  const handle = await bootIn(h, { config: configuredConfig(), api });
  await handle.ready;

  const banner = h.byId.get('stale-banner');
  assert.equal(banner.hidden, false, 'the stale banner is the content — never a blank screen');
  assert.notEqual(banner.textContent, '');
  assert.match(banner.textContent, /retry/i, 'a retry affordance, not a dead end');
  assert.equal(banner.classList.contains('hidden'), false);
  assert.equal(h.byId.get('view-home').hidden, false);

  handle.teardown();
});

test('after a successful load, a failed refresh keeps the data and labels it as cached', async () => {
  const h = makeHarness();
  const api = fakeApi();
  let fail = false;
  const realGetState = api.getState;
  api.getState = async () => {
    if (fail) {
      throw Object.assign(new Error('Could not reach the server.'), { code: 'NETWORK', name: 'ApiError' });
    }
    return realGetState();
  };

  const handle = await bootIn(h, { config: configuredConfig(), api, now: () => new Date('2026-10-01T09:41:00.000Z') });
  await handle.ready;
  assert.equal(h.byId.get('stale-banner').hidden, true, 'no banner while the data is live');

  fail = true;
  await handle.refresh();

  const banner = h.byId.get('stale-banner');
  assert.equal(banner.hidden, false);
  assert.match(banner.textContent, /cached data/i);
  assert.match(banner.textContent, /last updated \d{1,2}:\d{2}/);
  // The last known balances are still on screen — labelled, not hidden.
  assert.match(h.byId.get('pockets').innerHTML, /Groceries/);

  fail = false;
  await handle.refresh();
  assert.equal(h.byId.get('stale-banner').hidden, true, 'a good fetch clears the banner');

  handle.teardown();
});

test('a version mismatch shows #version-banner telling the user to reopen', async () => {
  const h = makeHarness();
  const api = fakeApi({ state: { ...STATE, version: '1.1.0' } });

  const handle = await bootIn(h, { config: configuredConfig(), api });
  await handle.ready;

  const banner = h.byId.get('version-banner');
  assert.equal(banner.hidden, false);
  assert.match(banner.textContent, /close and reopen/i);

  handle.teardown();
});

test('a matching version leaves #version-banner hidden', async () => {
  const h = makeHarness();
  const handle = await bootIn(h, { config: configuredConfig(), api: fakeApi() });
  await handle.ready;
  assert.equal(h.byId.get('version-banner').hidden, true);
  handle.teardown();
});

test('refetching after a mutation keeps the feed in step', async () => {
  const h = makeHarness();
  const api = fakeApi();
  const handle = await bootIn(h, { config: configuredConfig(), api });
  await handle.ready;

  await handle.refresh();
  await handle.refresh();

  assert.equal(api.calls.getState, 3, 'boot + 2 explicit refreshes');
  handle.teardown();
});

test('returning to the foreground refetches — that is how a spouse sees new expenses', async () => {
  const h = makeHarness();
  const api = fakeApi();
  const handle = await bootIn(h, { config: configuredConfig(), api });
  await handle.ready;
  assert.equal(api.calls.getState, 1);

  h.doc.visibilityState = 'visible';
  h.doc.emit('visibilitychange', { visibilityState: 'visible' });
  await handle.pending();

  assert.equal(api.calls.getState, 2, 'no polling, but a foreground refresh');

  h.doc.visibilityState = 'hidden';
  h.doc.emit('visibilitychange', { visibilityState: 'hidden' });
  await handle.pending();
  assert.equal(api.calls.getState, 2, 'a backgrounded app does not fetch');

  handle.teardown();
});

test('the tab bar switches views by clicking a tab', async () => {
  const h = makeHarness();
  const handle = await bootIn(h, { config: configuredConfig(), api: fakeApi() });
  await handle.ready;

  h.tabs.manage.dispatch('click');
  assert.equal(h.byId.get('view-manage').hidden, false);
  assert.equal(h.byId.get('view-home').hidden, true);
  assert.equal(h.tabs.manage.getAttribute('aria-current'), 'page');
  assert.equal(h.tabs.home.getAttribute('aria-current'), null);

  h.tabs.add.dispatch('click');
  assert.equal(h.byId.get('view-add').hidden, false);
  assert.equal(h.byId.get('view-manage').hidden, true);

  handle.teardown();
});

test('clicking a data-txn-id element deletes the transaction then refreshes', async () => {
  const h = makeHarness();
  const api = fakeApi();
  const handle = await bootIn(h, { config: configuredConfig(), api });
  await handle.ready;
  assert.equal(api.calls.getState, 1);

  const del = makeEl('', 'button');
  del.setAttribute('data-action', 'delete-txn');
  del.setAttribute('data-txn-id', 'T1001');
  h.byId.get('activity').appendChild(del);

  h.byId.get('activity').dispatch('click', { target: del });
  await handle.pending();

  assert.deepEqual(api.calls.deleteTransaction, ['T1001']);
  assert.equal(api.calls.getState, 2, 'the feed is refetched after the delete');

  handle.teardown();
});

test('tapping the body of a feed row does NOT delete it', async () => {
  const h = makeHarness();
  const api = fakeApi();
  const handle = await bootIn(h, { config: configuredConfig(), api });
  await handle.ready;

  // What a row looks like now: an <li> and some text, no delete action.
  const row = makeEl('', 'li');
  const text = makeEl('', 'p');
  row.appendChild(text);
  text.parentNode = row;
  h.byId.get('activity').appendChild(row);
  row.parentNode = h.byId.get('activity');

  h.byId.get('activity').dispatch('click', { target: text });
  await handle.pending();

  assert.deepEqual(api.calls.deleteTransaction, []);
  assert.equal(api.calls.getState, 1);

  handle.teardown();
});

test('delete asks first, names the expense, and does nothing if declined', async () => {
  const h = makeHarness();
  const api = fakeApi();
  const asked = [];
  let answer = false;
  h.win.confirm = (msg) => { asked.push(msg); return answer; };
  const handle = await bootIn(h, { config: configuredConfig(), api });
  await handle.ready;

  const del = makeEl('', 'button');
  del.setAttribute('data-action', 'delete-txn');
  del.setAttribute('data-txn-id', 'T1001');
  h.byId.get('activity').appendChild(del);

  h.byId.get('activity').dispatch('click', { target: del });
  await handle.pending();
  assert.equal(asked.length, 1);
  assert.match(asked[0], /R65\.20/);
  assert.match(asked[0], /Whole Foods/);
  assert.deepEqual(api.calls.deleteTransaction, [], 'declined: nothing is deleted');

  answer = true;
  h.byId.get('activity').dispatch('click', { target: del });
  await handle.pending();
  assert.deepEqual(api.calls.deleteTransaction, ['T1001']);

  handle.teardown();
});

test('a failed delete surfaces the error and does not fake a refresh', async () => {
  const h = makeHarness();
  const api = fakeApi();
  api.deleteTransaction = async () => { throw Object.assign(new Error('Not found.'), { name: 'ApiError', code: 'NOT_FOUND' }); };
  const handle = await bootIn(h, { config: configuredConfig(), api });
  await handle.ready;

  const del = makeEl('', 'button');
  del.setAttribute('data-action', 'delete-txn');
  del.setAttribute('data-txn-id', 'T404');
  h.byId.get('activity').appendChild(del);
  h.byId.get('activity').dispatch('click', { target: del });
  await handle.pending();

  assert.match(h.byId.get('toast').textContent, /Not found\./);
  assert.equal(api.calls.getState, 1, 'nothing changed, so nothing was refetched');

  handle.teardown();
});

test('a beforeinstallprompt event reveals an install button that calls prompt()', async () => {
  const h = makeHarness({ ua: ANDROID_UA, standalone: undefined });
  const handle = await bootIn(h, { config: configuredConfig(), api: fakeApi() });
  await handle.ready;
  assert.equal(h.body.children.length, 0, 'no install UI until the browser offers one');

  const ev = makeBeforeInstallPrompt();
  h.win.emit('beforeinstallprompt', ev);
  await handle.pending();

  assert.equal(handle.installPrompt, ev, 'the event is stashed for a later tap');
  assert.equal(ev.prevented, 1, 'without preventDefault Chrome never fires this again');

  const button = h.body.querySelector('button');
  assert.ok(button, 'an install button is exposed');
  assert.equal(button.id, 'install-button', 'the install button, not some other button');
  assert.match(button.textContent, /home screen/i);
  assert.equal(button.hidden, false);
  button.dispatch('click');
  await handle.pending();
  assert.equal(ev.prompted, 1, 'tapping the button prompts');
  assert.equal(h.body.children.length, 0, 'the offer is withdrawn once answered');

  handle.teardown();
});

test('iOS users get plain Share / Add to Home Screen instructions', async () => {
  const h = makeHarness({ ua: IOS_UA, standalone: false });
  const handle = await bootIn(h, { config: configuredConfig(), api: fakeApi() });
  await handle.ready;

  // textOf walks the subtree the way a real textContent does on a wrapper.
  const textOf = (el) => [el.textContent || '', ...el.children.map(textOf)].join(' ');
  const text = h.body.children.map(textOf).join(' ');
  assert.match(text, /Share/i);
  assert.match(text, /Add to Home Screen/i);

  handle.teardown();
});

test('an already-installed iOS app is not nagged', async () => {
  const h = makeHarness({ ua: IOS_UA, standalone: true });
  const handle = await bootIn(h, { config: configuredConfig(), api: fakeApi() });
  await handle.ready;

  assert.equal(h.body.children.length, 0, 'standalone means installed: no install UI');
  handle.teardown();
});

test('boot defers service-worker registration until window load', async () => {
  const h = makeHarness();
  const registered = [];
  h.win.navigator.serviceWorker = {
    register: (url) => { registered.push(url); return Promise.resolve({}); },
  };
  h.doc.readyState = 'loading';

  const handle = await bootIn(h, { config: configuredConfig(), api: makeApi() });
  await handle.ready;
  assert.equal(registered.length, 0, 'not before load — registration competes with first paint');

  h.win.emit('load');
  await handle.pending();
  assert.equal(registered.length, 1);

  handle.teardown();
});

test('teardown detaches the listeners boot installed', async () => {
  const h = makeHarness();
  const api = fakeApi();
  const handle = await bootIn(h, { config: configuredConfig(), api });
  await handle.ready;

  const before = h.doc.listenerCount('visibilitychange');
  assert.ok(before > 0);
  handle.teardown();
  assert.equal(h.doc.listenerCount('visibilitychange'), 0);

  h.doc.emit('visibilitychange', { visibilityState: 'visible' });
  await handle.pending();
  assert.equal(api.calls.getState, 1, 'a torn-down app does not fetch');
});

/* ---------------------------------------------------------- integration -- */

test('a refresh preserves a half-typed expense and a half-typed pocket name', async () => {
  // The whole product promise is "log an expense in under five seconds". A
  // background refresh must never cost the user what they already typed.
  const h = makeHarness();
  const api = fakeApi();
  const handle = await bootIn(h, { config: configuredConfig(), api });
  await handle.ready;

  h.byId.get('add-amount').value = '42.50';
  h.byId.get('add-note').value = 'Half typed';
  h.byId.get('manage-name').value = 'Half typed pocket';

  await handle.refresh();

  assert.equal(h.byId.get('add-amount').value, '42.50', 'the expense amount survives a refresh');
  assert.equal(h.byId.get('add-note').value, 'Half typed');
  assert.equal(h.byId.get('manage-name').value, 'Half typed pocket', 'the manage form survives too');

  handle.teardown();
});

test('concurrent refreshes share one request', async () => {
  // A mutation finishing as the app is foregrounded must not spend two cold
  // starts to learn the same thing.
  const h = makeHarness();
  const api = fakeApi();
  const handle = await bootIn(h, { config: configuredConfig(), api });
  await handle.ready;

  await Promise.all([handle.refresh(), handle.refresh(), handle.refresh()]);

  assert.equal(api.calls.getState, 2, 'boot + ONE shared refresh');
  handle.teardown();
});

test('a later refresh still runs after an earlier one failed', async () => {
  const h = makeHarness();
  const api = fakeApi();
  let fail = true;
  const real = api.getState;
  api.getState = async () => {
    // `real` is the double's own getState and keeps its own counter, so the
    // failure path increments by hand and the success path delegates.
    if (fail) {
      api.calls.getState += 1;
      throw Object.assign(new Error('Could not reach the server.'), { name: 'ApiError', code: 'NETWORK' });
    }
    return real();
  };

  const handle = await bootIn(h, { config: configuredConfig(), api });
  await handle.ready;
  assert.equal(api.calls.getState, 1);

  fail = false;
  await handle.refresh();
  await handle.refresh();

  assert.equal(api.calls.getState, 3,
    'a failure must not leave refresh() permanently short-circuiting to stale data');
  assert.equal(h.byId.get('stale-banner').hidden, true);

  handle.teardown();
});

test('the real makeApi + makeConfig drive boot end to end over a fake fetch', async () => {
  // No api double here: this exercises config.js, api.js, render.js, addform.js
  // and manage.js through the one code path a browser takes. The endpoint must
  // survive resolveEndpoint's validation for the client to even be built.
  const h = makeHarness();
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url: String(url), init });
    const action = init && init.body ? JSON.parse(init.body).action : '';
    // api.js unwraps an { ok } envelope, so the fake MUST send one.
    const payload = action === 'getState' ? { ok: true, ...STATE } : { ok: true, version: '1.0.0' };
    return { ok: true, status: 200, json: async () => payload };
  };

  const config = configuredConfig();
  const handle = bootIn(h, {
    config,
    api: makeApi(config, { fetchImpl }),
    apiFactory: (cfg) => makeApi(cfg, { fetchImpl }),
  });
  await handle.ready;

  assert.equal(requests.length, 1, 'exactly one network request on load');
  assert.equal(requests[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(requests[0].init.body), { action: 'getState', token: 'household-token-123' });
  assert.ok(!requests[0].url.includes('household-token-123'), 'the token is never in the URL');
  assert.equal(h.byId.get('pockets').innerHTML.includes('Groceries'), true);
  assert.equal(h.byId.get('activity').innerHTML.includes('Whole Foods'), true);
  assert.equal(h.byId.get('stale-banner').hidden, true);
  // The add form was mounted against real state, so the pocket select is live.
  const pocketSelect = h.byId.get('add-pocket');
  assert.equal(pocketSelect.children.length, 2, 'one option per pocket');
  assert.equal(pocketSelect.children[0].textContent.includes('Groceries'), true);

  handle.teardown();
});

test('a poisoned fetch leaves the stale banner up and never claims fresh data', async () => {
  const h = makeHarness();
  const config = configuredConfig();
  let healthy = true;
  const fetchImpl = async (url, init) => {
    if (!healthy) throw new TypeError('Failed to fetch');
    const action = JSON.parse(init.body).action;
    const payload = action === 'getState' ? { ok: true, ...STATE } : { ok: true };
    return { ok: true, status: 200, json: async () => payload };
  };

  const handle = bootIn(h, { config, api: makeApi(config, { fetchImpl }), apiFactory: (c) => makeApi(c, { fetchImpl }) });
  await handle.ready;
  assert.equal(h.byId.get('stale-banner').hidden, true);

  healthy = false;
  await handle.refresh();

  const banner = h.byId.get('stale-banner');
  assert.equal(banner.hidden, false);
  assert.match(banner.textContent, /cached data/i);
  assert.match(banner.textContent, /last updated \d{1,2}:\d{2}/);
  assert.match(banner.textContent, /Could not reach the server/i);
  assert.equal(h.byId.get('pockets').innerHTML.includes('Groceries'), true,
    'last known balances stay on screen, labelled');

  handle.teardown();
});

/* ------------------------------------------- recovering from a bad token -- */

const unauthorized = () => Object.assign(new Error('Invalid or missing token.'), { name: 'ApiError', code: 'UNAUTHORIZED' });

test('a rejected first save is NOT kept: the next launch still shows setup', async () => {
  const h = makeHarness();
  const config = emptyConfig();
  h.byId.get('setup-endpoint').value = ENDPOINT;
  h.byId.get('setup-token').value = 'wrong-token';

  const handle = await bootIn(h, { config, api: fakeApi({ stateError: unauthorized() }) });
  await handle.ready;
  h.byId.get('setup-form').dispatch('submit');
  await handle.pending();

  assert.equal(config.isConfigured(), false, 'the bad token must not stay saved');
  assert.equal(config.getToken(), '');
  assert.equal(h.byId.get('view-setup').hidden, false);
  assert.equal(h.byId.get('setup-cancel').hidden, true, 'nothing to cancel back to');

  handle.teardown();
});

test('a rejected replacement keeps the previous working connection', async () => {
  const h = makeHarness();
  const config = configuredConfig();
  let reject = false;
  const api = fakeApi();
  const good = api.getState;
  api.getState = async () => { if (reject) throw unauthorized(); return good(); };

  const handle = await bootIn(h, { config, api });
  await handle.ready;
  h.byId.get('change-connection').dispatch('click');
  h.byId.get('setup-endpoint').value = ENDPOINT;
  h.byId.get('setup-token').value = 'typo';
  reject = true;
  h.byId.get('setup-form').dispatch('submit');
  await handle.pending();

  assert.equal(config.getToken(), TOKEN, 'the old token is restored');
  assert.equal(config.getEndpoint(), ENDPOINT);
  assert.equal(h.byId.get('view-setup').hidden, false, 'the user stays on setup to try again');

  handle.teardown();
});

test('an UNAUTHORIZED refresh sends the user to setup, endpoint prefilled, token blank', async () => {
  const h = makeHarness();
  const config = configuredConfig();
  const handle = await bootIn(h, { config, api: fakeApi({ stateError: unauthorized() }) });
  await handle.ready;

  assert.equal(h.byId.get('view-setup').hidden, false);
  assert.equal(h.byId.get('view-home').hidden, true);
  assert.equal(h.nav.hidden, true);
  assert.equal(h.byId.get('setup-endpoint').value, ENDPOINT);
  assert.equal(h.byId.get('setup-token').value, '');
  assert.match(h.byId.get('setup-status').textContent, /token was rejected/i);
  assert.equal(h.byId.get('setup-cancel').hidden, false, 'a connection exists to go back to');

  handle.teardown();
});

test('a network failure does NOT send the user to setup', async () => {
  const h = makeHarness();
  const err = Object.assign(new Error('Could not reach the server.'), { name: 'ApiError', code: 'NETWORK' });
  const handle = await bootIn(h, { config: configuredConfig(), api: fakeApi({ stateError: err }) });
  await handle.ready;

  assert.equal(h.byId.get('view-setup').hidden, true);
  assert.equal(h.byId.get('view-home').hidden, false);

  handle.teardown();
});

test('Change connection opens setup; Cancel returns to the feed and refetches', async () => {
  const h = makeHarness();
  const api = fakeApi();
  const handle = await bootIn(h, { config: configuredConfig(), api });
  await handle.ready;
  assert.equal(api.calls.getState, 1);

  h.byId.get('change-connection').dispatch('click');
  assert.equal(h.byId.get('view-setup').hidden, false);
  assert.equal(h.nav.hidden, true);
  assert.equal(h.byId.get('setup-endpoint').value, ENDPOINT);

  h.byId.get('setup-cancel').dispatch('click');
  await handle.pending();
  assert.equal(h.byId.get('view-setup').hidden, true);
  assert.equal(h.byId.get('view-home').hidden, false);
  assert.equal(h.nav.hidden, false);
  assert.equal(api.calls.getState, 2);

  handle.teardown();
});

test('the home summary leads with money left, in whole rand', async () => {
  const h = makeHarness();
  // A month that is never the current one: no pace, so the result cannot depend on today's date.
  const handle = await bootIn(h, { config: configuredConfig(), api: fakeApi({ state: { ...STATE, month: '2000-01' } }) });
  await handle.ready;
  const html = h.byId.get('home-summary').innerHTML;
  assert.match(html, /Left this month/);
  assert.match(html, /pb-sum__left[^>]*>R340</, 'balance, rounded down');
  assert.match(html, /of R920/);
  assert.match(html, /1 pocket needs a look/, 'the locked pocket needs a look');
  handle.teardown();
});

/** Six pockets (so filter chips show), whose status does not depend on today's date. */
function sixPocketState() {
  const mk = (id, name, account, pctUsed, isLocked = false) => ({
    id, name, account, limit: 100, balance: isLocked ? 0 : 100 - pctUsed, spent: pctUsed, pctUsed, isLocked,
  });
  return {
    ...STATE,
    pockets: [
      mk('P1', 'Groceries', 'Les', 10), mk('P2', 'Fuel', 'Ivan', 10), mk('P3', 'Gifts', 'Ivan', 90),
      mk('P4', 'Cars', 'Ivan', 10), mk('P5', 'Gas', 'Ivan', 100, true), mk('P6', 'Pets', 'Les', 10),
    ],
    summary: { ...STATE.summary, totalLimit: 600, totalBalance: 400 },
  };
}

function chipButton(h, filter) {
  const btn = makeEl('', 'button');
  btn.setAttribute('data-action', 'filter-pockets');
  btn.setAttribute('data-filter', filter);
  h.byId.get('pockets').appendChild(btn);
  return btn;
}

const rowCount = (html) => (html.match(/data-action="select-pocket"/g) || []).length;

test('a filter chip narrows the pocket list without refetching, and the choice survives a refresh', async () => {
  const h = makeHarness();
  const api = fakeApi({ state: sixPocketState() });
  const handle = await bootIn(h, { config: configuredConfig(), api });
  await handle.ready;
  const pockets = h.byId.get('pockets');
  assert.equal(rowCount(pockets.innerHTML), 6);
  const fetched = api.calls.getState;

  pockets.dispatch('click', { target: chipButton(h, 'attention') });
  assert.equal(rowCount(pockets.innerHTML), 2, 'only Gifts and Gas need attention');
  assert.equal(api.calls.getState, fetched, 'filtering must not hit the network');

  await handle.refresh({ fresh: true });
  assert.equal(rowCount(pockets.innerHTML), 2, 'the filter outlives a refresh');
  assert.match(pockets.innerHTML, /data-filter="attention"[^>]*aria-pressed="true"/);

  pockets.dispatch('click', { target: chipButton(h, 'account:Les') });
  assert.equal(rowCount(pockets.innerHTML), 2);
  assert.match(pockets.innerHTML, /Groceries/);
  assert.doesNotMatch(pockets.innerHTML, /Gifts/);

  pockets.dispatch('click', { target: chipButton(h, 'all') });
  assert.equal(rowCount(pockets.innerHTML), 6);
  handle.teardown();
});

test('deleting an expense from an earlier month says the balance did not change', async () => {
  const h = makeHarness();
  const api = fakeApi();
  api.deleteTransaction = async (id) => { api.calls.deleteTransaction.push(id); return { ok: true, refunded: false }; };
  const handle = await bootIn(h, { config: configuredConfig(), api });
  await handle.ready;

  const del = makeEl('', 'button');
  del.setAttribute('data-action', 'delete-txn');
  del.setAttribute('data-txn-id', 'T1001');
  h.byId.get('activity').appendChild(del);
  h.byId.get('activity').dispatch('click', { target: del });
  await handle.pending();

  assert.match(h.byId.get('toast').textContent, /earlier month, so the balance is unchanged/);
  handle.teardown();
});

/* ---------------------------------------------- refresh after a write -- */

test('a refresh asked for after a write is not satisfied by a fetch already in flight', async () => {
  const h = makeHarness();
  const old = { ...STATE, pockets: [{ ...STATE.pockets[0], balance: 340.5 }, STATE.pockets[1]] };
  const fresh = { ...STATE, pockets: [{ ...STATE.pockets[0], balance: 300 }, STATE.pockets[1]] };
  let calls = 0;
  const gates = [];
  const api = fakeApi();
  api.getState = () => {
    calls += 1;
    const result = calls === 1 ? old : fresh;
    return new Promise((resolve) => gates.push(() => resolve(result)));
  };
  const handle = await bootIn(h, { config: configuredConfig(), api });
  // Boot's own fetch is in flight, and it will return the PRE-write sheet.
  const afterWrite = handle.refresh({ fresh: true });
  assert.equal(calls, 1, 'no second request until the first has settled');

  gates[0]();
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(calls, 2, 'a second fetch was made to pick up the write');
  gates[1]();
  const state = await afterWrite;
  assert.equal(state.pockets[0].balance, 300, 'the caller gets the post-write state');
  assert.match(h.byId.get('pockets').innerHTML, /R300\.00/);
  handle.teardown();
});

test('plain refreshes still coalesce into one request', async () => {
  const h = makeHarness();
  const api = fakeApi();
  let calls = 0;
  const gates = [];
  api.getState = () => { calls += 1; return new Promise((resolve) => gates.push(() => resolve(STATE))); };
  const handle = await bootIn(h, { config: configuredConfig(), api });
  const a = handle.refresh();
  const b = handle.refresh();
  gates[0]();
  await Promise.all([a, b]);
  assert.equal(calls, 1);
  handle.teardown();
});

/* ------------------------------------- tapping a pocket row opens Add expense -- */

function cardButton(h, pocketId, { disabled = false } = {}) {
  const btn = makeEl('', 'button');
  btn.setAttribute('data-action', 'select-pocket');
  btn.setAttribute('data-pocket-id', pocketId);
  btn.disabled = disabled;
  h.byId.get('pockets').appendChild(btn);
  return btn;
}

test('tapping a pocket row opens the add form with that pocket selected', async () => {
  const h = makeHarness();
  const handle = await bootIn(h, { config: configuredConfig(), api: fakeApi() });
  await handle.ready;

  h.byId.get('pockets').dispatch('click', { target: cardButton(h, 'P01') });

  assert.equal(h.byId.get('view-add').hidden, false, 'switched to the add view');
  assert.equal(h.byId.get('view-home').hidden, true);
  assert.equal(h.byId.get('add-pocket').value, 'P01');
  assert.equal(h.byId.get('add-amount').focused, true, 'cursor is in the amount field');
  handle.teardown();
});

test('a depleted pocket\'s row does nothing', async () => {
  const h = makeHarness();
  const handle = await bootIn(h, { config: configuredConfig(), api: fakeApi() });
  await handle.ready;
  h.byId.get('pockets').dispatch('click', { target: cardButton(h, 'P02', { disabled: true }) });
  assert.equal(h.byId.get('view-home').hidden, false, 'stays on home');
  handle.teardown();
});

test('an insufficient-funds refusal makes the app refetch balances', async () => {
  const h = makeHarness();
  const api = fakeApi();
  api.createTransaction = async () => { throw Object.assign(new Error('Insufficient funds in Groceries. Remaining: R1.00'), { name: 'ApiError', code: 'INSUFFICIENT_FUNDS' }); };
  const handle = await bootIn(h, { config: configuredConfig(), api });
  await handle.ready;
  assert.equal(api.calls.getState, 1);

  h.byId.get('add-amount').value = '500';
  h.byId.get('add-pocket').value = 'P01';
  await h.byId.get('add-form').dispatch('submit');
  await handle.pending();

  assert.equal(api.calls.getState, 2, 'balances reloaded after the refusal');
  handle.teardown();
});
