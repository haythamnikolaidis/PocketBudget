// tests/sw.test.js
//
// Tests for the service worker (app/sw.js) and the offline page (app/offline.html).
//
// No browser required. We read the SW source, evaluate it inside a minimal fake
// ServiceWorkerGlobalScope (stub `self`, `caches`, `fetch`), and then drive the
// real install / activate / fetch handlers it registered.
//
// The single most important thing this file proves: the Apps Script API is NEVER
// served from a cache. A stale balance presented as a current one is worse than
// an error, because the whole product is "the numbers are true".

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const APP = fileURLToPath(new URL('../app/', import.meta.url));
const SW_PATH = APP + 'sw.js';
const OFFLINE_PATH = APP + 'offline.html';

const SW_SOURCE = readFileSync(SW_PATH, 'utf8');
const OFFLINE_HTML = readFileSync(OFFLINE_PATH, 'utf8');

const ORIGIN = 'https://pocketbudget.example';
const API_URL = 'https://script.google.com/macros/s/AKfycbXXXXXXXX/exec?action=balance';

// ---------------------------------------------------------------------------
// A deliberately minimal Cache / CacheStorage / global scope.
// ---------------------------------------------------------------------------

/** Parse the SW source for a top-level `const NAME = <literal>;` declaration. */
function readConst(source, name) {
  const re = new RegExp(`const\\s+${name}\\s*=\\s*('(?:[^'\\\\]|\\\\.)*'|\\[[\\s\\S]*?\\]);`);
  const m = source.match(re);
  assert.ok(m, `sw.js must declare a top-level "const ${name} = ..."`);
  // eslint-disable-next-line no-new-func
  return vm.runInNewContext(m[1]);
}

function makeCacheStorage() {
  // name -> Map<urlString, {response, count}>
  const stores = new Map();
  const stats = { opens: 0, matches: [], puts: [], deletes: [], addAlls: [], adds: [], has: 0 };

  function store(name) {
    if (!stores.has(name)) stores.set(name, new Map());
    return stores.get(name);
  }

  function cache(name) {
    return {
      async match(request) {
        const url = normalize(request);
        stats.matches.push({ name, url });
        const entry = stores.get(name)?.get(url);
        return entry ? entry.response : undefined;
      },
      async matchAll() {
        return Array.from(stores.get(name)?.values() ?? []).map((e) => e.response);
      },
      async put(request, response) {
        const url = normalize(request);
        stats.puts.push({ name, url });
        store(name).set(url, { response, count: 1 });
      },
      async addAll(urls) {
        stats.addAlls.push({ name, urls: [...urls] });
        // Real Cache.addAll() is atomic: one non-ok response rejects the lot.
        const responses = await Promise.all(
          urls.map(async (u) => fakeFetch(normalize(u))),
        );
        const bad = responses.find((r) => !r.ok);
        if (bad) throw new TypeError(`Request failed (status ${bad.status})`);
        for (let i = 0; i < urls.length; i += 1) store(name).set(normalize(urls[i]), { response: responses[i], count: 1 });
        return undefined;
      },
      async add(request) {
        const url = normalize(request);
        stats.adds.push({ name, url });
        const res = await fakeFetch(url);
        if (!res.ok) throw new TypeError(`Request failed (status ${res.status})`);
        store(name).set(url, { response: res, count: 1 });
        return undefined;
      },
      async delete(request) {
        const url = normalize(request);
        stats.deletes.push({ name, url });
        return Boolean(stores.get(name)?.delete(url));
      },
      async keys() {
        return Array.from(stores.get(name)?.keys() ?? []);
      },
    };
  }

  const api = {
    async open(name) { stats.opens += 1; store(name); return cache(name); },
    async keys() { return Array.from(stores.keys()); },
    async delete(name) {
      stats.deletes.push({ name, url: null });
      return stores.delete(name);
    },
    async has(name) { stats.has += 1; return stores.has(name); },
    async match(request) {
      for (const name of stores.keys()) {
        const hit = stores.get(name).get(normalize(request));
        if (hit) return hit.response;
      }
      return undefined;
    },
  };

  function normalize(request) {
    const raw = typeof request === 'string' ? request : (request?.url ?? String(request));
    try { return new URL(raw, `${ORIGIN}/`).toString(); } catch { return raw; }
  }

  // The fake network. Tests replace api.__fetchImpl to simulate offline/404.
  api.__fetchImpl = async (url) => ({
    ok: true, status: 200, type: 'basic', url,
    async text() { return `body of ${url}`; },
    clone() { return this; },
  });
  function fakeFetch(url) { return api.__fetchImpl(url); }

  api.stats = stats;
  api.seed = (name, url, response) => { store(name).set(normalize(url), { response, count: 1 }); };
  api.dump = (name) => Array.from(stores.get(name)?.keys() ?? []);
  return api;
}

/**
 * Evaluate app/sw.js inside a fake worker scope and return the registered
 * handlers plus the stubs, ready to be driven.
 */
function makeWorker({ cacheStorage = makeCacheStorage() } = {}) {
  const listeners = new Map();
  const calls = { skipWaiting: 0, claim: 0, fetched: [], console: [] };

  const self = {
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(handler);
    },
    skipWaiting() { calls.skipWaiting += 1; return Promise.resolve(); },
    clients: { claim() { calls.claim += 1; return Promise.resolve(); } },
    location: new URL(`${ORIGIN}/sw.js`),
    registration: { scope: `${ORIGIN}/` },
  };

  const sandboxConsole = { log: (...a) => calls.console.push(['log', ...a]),
    warn: (...a) => calls.console.push(['warn', ...a]),
    error: (...a) => calls.console.push(['error', ...a]) };

  // CacheStorage handles relative URLs itself; give it an absolute scope base.
  const context = vm.createContext({
    self, caches: cacheStorage, console: sandboxConsole,
    fetch: (input, init) => {
      const url = typeof input === 'string' ? input : (input?.url ?? String(input));
      calls.fetched.push({ url: new URL(url, `${ORIGIN}/`).toString(), init });
      return cacheStorage.__fetchImpl(new URL(url, `${ORIGIN}/`).toString());
    },
    Response: FakeResponseCtor(), Request: FakeRequestCtor(), URL, Promise, TypeError, Error,
  });
  // sw.js is a classic worker script: no import/export.
  vm.runInContext(SW_SOURCE, context, { filename: 'app/sw.js' });

  /**
   * Fire an event handler and await every waitUntil() promise.
   * Pass `{ awaitResponse: false }` to receive the raw respondWith() promise
   * instead of its resolved value — needed to assert that a network failure
   * REJECTS (surfacing an error to the page) rather than resolving to something.
   */
  async function fire(type, event = {}, opts = {}) {
    const { awaitResponse = true } = opts;
    const handlers = listeners.get(type) ?? [];
    const waits = [];
    const ev = { ...event, waitUntil: (p) => { waits.push(Promise.resolve(p)); } };
    let responded = null;
    ev.respondWith = (p) => { responded = Promise.resolve(p); };
    for (const h of handlers) h(ev);
    await Promise.all(waits);
    if (responded === null) return { responded: undefined, respondedCalled: false };
    if (!awaitResponse) return { responded, respondedCalled: true };
    return { responded: await responded, respondedCalled: true };
  }

  return { self, calls, cacheStorage, listeners, fire, sandboxConsole };
}

function FakeResponseCtor() {
  return class FakeResponse {
    constructor(body = '', init = {}) {
      this.body = body;
      this.status = init.status ?? 200;
      this.ok = (init.status ?? 200) >= 200 && (init.status ?? 200) < 300;
      this.type = init.type ?? 'basic';
      this.url = init.url ?? '';
      this.headers = init.headers ?? {};
    }
    async text() { return String(this.body); }
    clone() { return new FakeResponse(this.body, { status: this.status, type: this.type, url: this.url }); }
  };
}
function FakeRequestCtor() {
  return class FakeRequest {
    constructor(url, init = {}) {
      this.url = new URL(url, `${ORIGIN}/`).toString();
      this.method = (init.method ?? 'GET').toUpperCase();
      this.mode = init.mode ?? 'no-cors';
      this.headers = new Map(Object.entries(init.headers ?? {}));
      this.cache = init.cache ?? 'default';
    }
  };
}

const req = (url, init) => new (FakeRequestCtor())(url, init);

// ---------------------------------------------------------------------------
// 1. The precache list
// ---------------------------------------------------------------------------

test('precache list is a top-level constant and contains the whole app shell', () => {
  const list = readConst(SW_SOURCE, 'PRECACHE_URLS');
  assert.ok(Array.isArray(list), 'PRECACHE_URLS must be an array');
  const required = [
    './index.html', './offline.html', './styles.css', './tailwind.css', './manifest.webmanifest',
    './js/config.js', './js/format.js', './js/api.js', './js/render.js',
    './js/addform.js', './js/manage.js', './js/app.js',
    './icons/icon-192.png', './icons/icon-512.png',
    './icons/icon-maskable-512.png', './icons/apple-touch-icon.png',
  ];
  for (const entry of required) {
    assert.ok(list.includes(entry), `precache list must contain ${entry}`);
  }
  // The navigation entry point itself must be precached, otherwise the very
  // first offline load has no shell to fall back on.
  assert.ok(list.includes('./'), "precache list must contain './' for the start URL");
});

test('precache list NEVER contains an API URL — a cached balance is a lie', () => {
  const list = readConst(SW_SOURCE, 'PRECACHE_URLS');
  assert.ok(list.length > 0);
  for (const entry of list) {
    assert.ok(!/script\.google/i.test(entry), `precache must not include ${entry}`);
    assert.ok(!/googleusercontent/i.test(entry), `precache must not include ${entry}`);
    assert.ok(!/^https?:/i.test(entry), `precache entries must be same-origin relative paths: ${entry}`);
    assert.ok(!/\?action=/.test(entry), `precache must not include API query strings: ${entry}`);
  }
});

// ---------------------------------------------------------------------------
// 2. install
// ---------------------------------------------------------------------------

test('install precaches the shell, survives a missing file, then skipWaiting()s', async () => {
  const w = makeWorker();
  const cacheStorage = w.cacheStorage;

  // Simulate index.html being 404 at install time (the exact scenario that
  // would kill offline support if addAll() were unguarded).
  cacheStorage.__fetchImpl = async (url) => {
    if (url.endsWith('/js/render.js')) {
      return { ok: false, status: 404, type: 'error', url, async text() { return 'Not Found'; }, clone() { return this; } };
    }
    return { ok: true, status: 200, type: 'basic', url, async text() { return 'ok'; }, clone() { return this; } };
  };

  const { respondedCalled } = await w.fire('install');
  assert.equal(respondedCalled, false, 'install must not call respondWith');

  const version = readConst(SW_SOURCE, 'CACHE_VERSION');
  // The install must NOT have rejected: waitUntil() resolved.
  assert.equal(w.calls.skipWaiting, 1, 'install must call skipWaiting() even when a file 404s');

  const cached = cacheStorage.dump(version);
  assert.ok(cached.includes(`${ORIGIN}/index.html`), 'index.html must be cached despite a sibling 404');
  assert.ok(cached.includes(`${ORIGIN}/styles.css`), 'styles.css must be cached');
  assert.ok(!cached.some((u) => u.endsWith('/js/render.js')), 'the 404 file must not be in the cache');
  assert.ok(cacheStorage.stats.addAlls.length >= 1, 'install should attempt addAll first');
});

test('install precaches every listed URL when they all exist', async () => {
  const w = makeWorker();
  await w.fire('install');
  const version = readConst(SW_SOURCE, 'CACHE_VERSION');
  const list = readConst(SW_SOURCE, 'PRECACHE_URLS');
  const cached = w.cacheStorage.dump(version);
  for (const entry of list) {
    assert.ok(cached.includes(new URL(entry, `${ORIGIN}/`).toString()), `${entry} must be precached`);
  }
});

// ---------------------------------------------------------------------------
// 3. activate
// ---------------------------------------------------------------------------

test('CACHE_VERSION is a generated content hash, and activate purges other caches', async () => {
  const version = readConst(SW_SOURCE, 'CACHE_VERSION');
  assert.equal(typeof version, 'string');

  // No longer a hand-maintained literal: it is derived from the precached files,
  // which is what makes forgetting impossible.
  assert.match(
    version,
    /^pocketbudget-[0-9a-f]{12}$/,
    'CACHE_VERSION must be a generated content hash, not a hand-written string',
  );
  assert.match(SW_SOURCE, /GENERATED — do not edit by hand/, 'sw.js must mark the value as generated');

  const w = makeWorker();
  await w.fire('install');
  // Simulate a previous release's cache sitting alongside the current one.
  w.cacheStorage.seed('pocketbudget-stale', `${ORIGIN}/index.html`, { ok: true, status: 200 });

  await w.fire('activate');

  assert.ok(w.cacheStorage.dump(version).length > 0, 'the current cache must survive activate');
  assert.equal(w.cacheStorage.dump('pocketbudget-stale').length, 0,
    'a previous release cache must be deleted');
});

// ---------------------------------------------------------------------------
// 4. fetch — the API must always go to the network
// ---------------------------------------------------------------------------

test('cross-origin API request goes to the network and never touches the cache', async () => {
  const w = makeWorker();
  await w.fire('install');
  const version = readConst(SW_SOURCE, 'CACHE_VERSION');
  const before = w.cacheStorage.dump(version).length;

  let networkHit = 0;
  w.cacheStorage.__fetchImpl = async (url) => {
    networkHit += 1;
    return { ok: true, status: 200, type: 'cors', url, async json() { return { ok: true }; },
      async text() { return '{"ok":true}'; }, clone() { return this; } };
  };

  const { responded, respondedCalled } = await w.fire('fetch', { request: req(API_URL) });

  assert.equal(networkHit, 1, 'the API request must hit the network exactly once');
  assert.ok(respondedCalled, 'the worker should pass the API response through');
  assert.equal(responded.status, 200);

  const stats = w.cacheStorage.stats;
  assert.deepEqual(stats.puts, [], 'nothing may be written to the cache for an API request');
  assert.equal(
    stats.matches.filter((m) => m.url.includes('script.google')).length, 0,
    'the cache must never be consulted for an API request',
  );
  assert.equal(w.cacheStorage.dump(version).length, before, 'the cache must not gain an API entry');
});

test('API responses are never precached, so an offline reload cannot show a stale balance', async () => {
  const w = makeWorker();
  await w.fire('install');
  const version = readConst(SW_SOURCE, 'CACHE_VERSION');
  for (const url of w.cacheStorage.dump(version)) {
    assert.ok(!/script\.google|googleusercontent/i.test(url), `${url} must not be cached`);
  }
  // And the SW must still answer an API request even with the network down:
  // it has no cached copy to fall back on, which is the point. The pass-through
  // REJECTS, so api.js sees a network error instead of a plausible number.
  w.cacheStorage.__fetchImpl = async () => { throw new TypeError('Failed to fetch'); };
  const { responded, respondedCalled } = await w.fire(
    'fetch',
    { request: req(API_URL) },
    { awaitResponse: false },
  );
  assert.equal(respondedCalled, true, 'the worker still handles the request — but only via the network');
  await assert.rejects(
    responded,
    /Failed to fetch/,
    'offline API requests must surface a network failure, never a cached body',
  );
  assert.deepEqual(w.cacheStorage.stats.puts, [], 'still nothing cached');
});

// ---------------------------------------------------------------------------
// 5. fetch — navigation + shell assets
// ---------------------------------------------------------------------------

test('navigation falls back to ./offline.html when the network fails', async () => {
  const w = makeWorker();
  await w.fire('install');

  w.cacheStorage.__fetchImpl = async () => { throw new TypeError('Failed to fetch'); };

  const { responded, respondedCalled } = await w.fire('fetch', {
    request: req(`${ORIGIN}/index.html`, { mode: 'navigate' }),
  });

  assert.ok(respondedCalled, 'a navigation must always get a response');
  const body = await responded.text();
  assert.match(body, /offline/i, 'the offline page must be served when the network fails');
  assert.match(responded.headers?.['Content-Type'] ?? '', /text\/html/);
});

test('navigation uses the network when it is available', async () => {
  const w = makeWorker();
  await w.fire('install');

  let hits = 0;
  w.cacheStorage.__fetchImpl = async (url) => {
    hits += 1;
    return { ok: true, status: 200, type: 'basic', url, async text() { return '<html>LIVE</html>'; }, clone() { return this; } };
  };

  const { responded } = await w.fire('fetch', { request: req(`${ORIGIN}/`, { mode: 'navigate' }) });
  assert.equal(hits, 1, 'navigation is network-first');
  assert.match(await responded.text(), /LIVE/);
});

test('code assets are network-first, so a deploy is picked up on the next load', async () => {
  // Previously cache-first, which meant a user kept running the code from their
  // first visit until CACHE_VERSION changed. That is how a shipped fix failed to
  // reach a device: no network traffic, no console error, a dead button.
  const w = makeWorker();
  await w.fire('install');
  const version = readConst(SW_SOURCE, 'CACHE_VERSION');

  // Seed the cache with a stale copy, then let the network serve a fresh one.
  w.cacheStorage.seed(version, `${ORIGIN}/js/app.js`, staleResponse('STALE'));

  let networkHit = 0;
  w.cacheStorage.__fetchImpl = async (url) => {
    networkHit += 1;
    return freshResponse('FRESH', url);
  };

  const { responded } = await w.fire('fetch', { request: req(`${ORIGIN}/js/app.js`) });

  assert.equal(networkHit, 1, 'a code asset must go to the network first');
  assert.equal(await responded.text(), 'FRESH', 'the network response must win over the cached copy');
});

test('code assets still fall back to the cache when offline', async () => {
  const w = makeWorker();
  await w.fire('install');
  const version = readConst(SW_SOURCE, 'CACHE_VERSION');
  w.cacheStorage.seed(version, `${ORIGIN}/js/app.js`, staleResponse('CACHED'));

  w.cacheStorage.__fetchImpl = async () => { throw new Error('offline'); };

  const { responded } = await w.fire('fetch', { request: req(`${ORIGIN}/js/app.js`) });
  assert.equal(await responded.text(), 'CACHED', 'offline must still open the shell from cache');
});

test('icons stay cache-first: they cannot change within a release', async () => {
  const w = makeWorker();
  await w.fire('install');
  const version = readConst(SW_SOURCE, 'CACHE_VERSION');
  w.cacheStorage.seed(version, `${ORIGIN}/icons/icon-192.png`, staleResponse('PNG'));

  let networkHit = 0;
  w.cacheStorage.__fetchImpl = async (url) => { networkHit += 1; return freshResponse('NEW', url); };

  await w.fire('fetch', { request: req(`${ORIGIN}/icons/icon-192.png`) });
  assert.equal(networkHit, 0, 'a cached icon should be served without a network round trip');
});

test('an uncached same-origin asset falls through to the network', async () => {
  const w = makeWorker();
  let hits = 0;
  w.cacheStorage.__fetchImpl = async (url) => {
    hits += 1;
    return { ok: true, status: 200, type: 'basic', url, async text() { return 'fresh'; }, clone() { return this; } };
  };
  const { responded } = await w.fire('fetch', { request: req(`${ORIGIN}/js/not-precached.js`) });
  assert.equal(hits, 1);
  assert.equal(await responded.text(), 'fresh');
});

test('non-GET requests are ignored entirely', async () => {
  const w = makeWorker();
  await w.fire('install');
  w.cacheStorage.stats.matches.length = 0;
  const before = w.cacheStorage.dump(readConst(SW_SOURCE, 'CACHE_VERSION')).length;

  const { responded, respondedCalled } = await w.fire('fetch', {
    request: req(`${ORIGIN}/js/api.js`, { method: 'POST' }),
  });
  assert.equal(respondedCalled, false, 'POST must be passed straight through to the browser');
  assert.equal(responded, undefined);
  assert.deepEqual(w.cacheStorage.stats.matches, [], 'a POST must not consult the cache');
  assert.equal(w.cacheStorage.dump(readConst(SW_SOURCE, 'CACHE_VERSION')).length, before);
});

test('a failing API POST is never intercepted even when it is same-origin-ish', async () => {
  const w = makeWorker();
  await w.fire('install');
  const { respondedCalled } = await w.fire('fetch', {
    request: req(API_URL, { method: 'POST' }),
  });
  assert.equal(respondedCalled, false, 'non-GET cross-origin requests must be ignored');
});

// ---------------------------------------------------------------------------
// 6. offline.html
// ---------------------------------------------------------------------------

test('offline.html sets its own theme-color so iOS does not white-flash', () => {
  const theme = OFFLINE_HTML.match(/<meta\s+name=["']theme-color["']\s+content=["'](#[0-9a-f]{3,8})["']/i);
  assert.ok(theme, 'offline.html must declare <meta name="theme-color">');
  assert.equal(theme[1].toLowerCase(), '#0f172a');
});

test('offline.html uses the app background and says why the app is unavailable', () => {
  assert.match(OFFLINE_HTML, /background[^;{]*:\s*#0f172a/i, 'body background must be #0f172a');
  assert.match(OFFLINE_HTML, /You(?:&rsquo;|&#8217;|’|')?re offline/i, 'must say the user is offline');
  assert.match(OFFLINE_HTML, /connection/i, 'must explain that a connection is needed');
  assert.match(OFFLINE_HTML, /balance/i, 'must mention checking balances');
});

test('offline.html is standalone: no external CSS or JS dependencies', () => {
  assert.ok(!/<link[^>]+stylesheet/i.test(OFFLINE_HTML), 'offline.html must inline its styles — the network is gone');
  assert.ok(!/<script/i.test(OFFLINE_HTML), 'offline.html must not need JavaScript');
  assert.match(OFFLINE_HTML, /<meta\s+name=["']viewport["']/i, 'must be mobile-first');
});

test('offline.html is referenced by the precache list under exactly ./offline.html', () => {
  const list = readConst(SW_SOURCE, 'PRECACHE_URLS');
  assert.ok(list.includes('./offline.html'));
  const swOfflineUrls = SW_SOURCE.match(/offline\.html/g) ?? [];
  assert.ok(swOfflineUrls.length >= 1);
});


/** A cached-style response the fake cache can store and return. */
function staleResponse(body) {
  return { ok: true, status: 200, type: 'basic', body,
    async text() { return body; }, clone() { return this; } };
}

/** A network-style response. */
function freshResponse(body, url = '') {
  return { ok: true, status: 200, type: 'basic', url, body,
    async text() { return body; }, clone() { return this; } };
}
