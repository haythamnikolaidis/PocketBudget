// app/sw.js — PocketBudget service worker.
//
// Classic worker script (no ES module syntax): a service worker registered with
// `navigator.serviceWorker.register('./sw.js')` is evaluated as a classic script.
//
// The job of this file is narrow and deliberate:
//   1. Precache the static app shell so the app opens with no connection.
//   2. NEVER serve data from a cache. Balances always come from the network.
//
// A cached balance is a lie. This app's entire value is that the numbers are
// true — a household decides whether to spend from these figures. Serving a
// stale figure that looks exactly like a current one defeats the product and
// is worse than showing an error, because the error is honest. So the Apps
// Script API (script.google.com / script.googleusercontent.com) is explicitly
// excluded from every cache in this file, and is not a cache fallback for any
// request. Offline, the API fails loudly; it never lies quietly.

/**
 * Cache namespace for this release.
 *
 * BUMP THIS ON EVERY DEPLOY. The activate handler deletes every cache whose name
 * is not exactly CACHE_VERSION, so this string is the only thing that separates
 * "the assets I shipped" from "the assets the user already has". Fail to bump it
 * and the app runs against a stale mix of old and new files — the classic
 * service-worker staleness bug, and a genuinely miserable one to debug because
 * the code on disk and the code in the cache differ with nothing to show it.
 */
const CACHE_VERSION = 'pocketbudget-v1';

// The static app shell. Relative to the SW scope (the site root).
// './' is the manifest start_url; without it the very first offline launch has
// nothing to navigate to.
// NOTE: shell assets only. If you add a URL here, it must be a file in this
// repository. API endpoints do not belong in this list, ever.
const PRECACHE_URLS = [
  './',
  './index.html',
  './offline.html',
  './styles.css',
  './js/config.js',
  './js/format.js',
  './js/api.js',
  './js/render.js',
  './js/addform.js',
  './js/manage.js',
  './js/app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

// Served when a navigation cannot reach the network.
const OFFLINE_URL = './offline.html';

/** Absolute form of a scope-relative shell URL, for comparisons. */
function abs(relativeUrl) {
  return new URL(relativeUrl, self.location.href).toString();
}

/** True when `url` (absolute) is one of the precached shell assets. */
function isShellAsset(url) {
  return PRECACHE_URLS.some((entry) => abs(entry) === url);
}

/** True when a request is a top-level page navigation. */
function isNavigation(request) {
  return request.mode === 'navigate'
    || (request.destination === 'document' && (request.method === 'GET' || !request.method));
}

// ---------------------------------------------------------------------------
// install — precache the shell
// ---------------------------------------------------------------------------

/**
 * Cache every shell file.
 *
 * cache.addAll() is all-or-nothing: if one URL 404s the whole promise rejects,
 * the install fails, and the app loses offline support entirely because of a
 * single typo'd path. So we try the fast path first and, on rejection, log it
 * and cache each URL on its own — one missing file degrades offline support
 * instead of destroying it. The install always resolves, so the SW installs.
 */
async function precacheShell() {
  const cache = await caches.open(CACHE_VERSION);
  try {
    await cache.addAll(PRECACHE_URLS);
    return;
  } catch (err) {
    console.warn('[sw] precache addAll failed; retrying file-by-file.', err);
  }
  await Promise.all(PRECACHE_URLS.map(async (url) => {
    try {
      await cache.add(url);
    } catch (err) {
      console.warn(`[sw] precache skipped ${url}:`, err);
    }
  }));
}

self.addEventListener('install', (event) => {
  event.waitUntil(precacheShell().then(() => self.skipWaiting()));
});

// ---------------------------------------------------------------------------
// activate — drop caches from previous releases
// ---------------------------------------------------------------------------

// Anything not named CACHE_VERSION is either an older release's shell or some
// unrelated cache; both are dead weight now that skipWaiting() has put this
// worker in control of every page.
async function purgeOldCaches() {
  const names = await caches.keys();
  await Promise.all(names
    .filter((name) => name !== CACHE_VERSION)
    .map((name) => caches.delete(name)));
}

self.addEventListener('activate', (event) => {
  event.waitUntil(purgeOldCaches().then(() => self.clients.claim()));
});

// ---------------------------------------------------------------------------
// fetch — read-only interception
// ---------------------------------------------------------------------------

/** An offline page response, served when even offline.html is not cached. */
function offlineFallbackResponse() {
  return new Response(
    '<!doctype html><meta charset="utf-8"><meta name="theme-color" content="#0f172a">'
    + '<title>Offline</title><p>You are offline. PocketBudget needs a connection to check balances.</p>',
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
}

/** network-first: fresh HTML when possible, offline.html when not. */
async function handleNavigation(request) {
  const cache = await caches.open(CACHE_VERSION);
  try {
    return await fetch(request);
  } catch (_) {
    // Deliberately not the cached index.html: a stale shell would render with an
    // empty or wrong balance. offline.html is the honest answer.
    const cached = await cache.match(OFFLINE_URL);
    if (!cached) return offlineFallbackResponse();
    const body = await cached.clone().text();
    return new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
}

/** cache-first for the immutable-by-version shell; network for anything else. */
async function handleAsset(request, url) {
  const cache = await caches.open(CACHE_VERSION);
  if (isShellAsset(url)) {
    const hit = await cache.match(request);
    if (hit) return hit;
  }
  const response = await fetch(request);
  // Only shell assets are ever written, and only the ones on the list above —
  // so an API response cannot reach the cache even if it were same-origin.
  if (isShellAsset(url) && response && response.ok && response.type !== 'opaque') {
    try {
      await cache.put(request, response.clone());
    } catch (err) {
      console.warn(`[sw] could not cache ${url}:`, err);
    }
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Writes (POST/PUT/DELETE) are not ours to touch. Only GET is intercepted.
  if (!request || request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url).toString();
  } catch (_) {
    return;
  }

  // Cross-origin — this is the Apps Script API. Pass it straight to the network
  // and never consult a cache. No stale balances, ever.
  if (new URL(url).origin !== self.location.origin) {
    event.respondWith(fetch(request));
    return;
  }

  if (isNavigation(request)) {
    event.respondWith(handleNavigation(request));
    return;
  }

  event.respondWith(handleAsset(request, url));
});
