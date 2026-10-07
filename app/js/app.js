// app/js/app.js
// The bootstrap. Wires config, api, render, addform, manage, the tab bar, the
// first-run setup screen, the service worker, and the install prompts together.
//
// ---------------------------------------------------------------------------
// THE TWO RULES THIS FILE EXISTS TO ENFORCE
//
// 1. ONE getState ON LOAD. Apps Script costs 1-3 seconds per cold start. A boot
//    sequence that pings and *then* fetches state doubles the time to first
//    paint for no benefit — the state payload carries everything the home screen
//    needs. So: configured -> getState() exactly once. Unconfigured -> zero
//    requests, because there is no endpoint to call yet.
//
// 2. NEVER SHOW A STALE BALANCE AS IF IT WERE CURRENT. A household decides
//    whether to spend from these numbers; a figure that looks live and is not is
//    worse than no figure at all, because the error is at least honest. So every
//    network failure shows the last known state *labelled* — "showing cached
//    data — last updated HH:MM" — and never silently. This is the same rule
//    app/sw.js enforces by never caching API responses.
// ---------------------------------------------------------------------------
//
// Every browser-specific object arrives through `deps` or a parameter. Nothing
// here touches `window` / `document` at import time, so the module imports
// cleanly under Node and is unit-testable without a browser.

import { config as defaultConfig, makeConfig } from './config.js';
import { makeApi } from './api.js';
import { formatMoney, monthProgress } from './format.js';
import { renderPockets, renderSummary, renderActivity } from './render.js';
import { mountAddForm, updateAddFormState } from './addform.js';
import { mountManage, updateManageState } from './manage.js';

/**
 * Version of this frontend.
 *
 * MUST be bumped in step with SERVER_VERSION in backend/00_Config.gs.js. The
 * backend stamps every response with its own version, and a mismatch is what
 * drives #version-banner: a cached frontend running against a newer backend can
 * render numbers it does not know how to interpret. Bumping one and not the
 * other is the bug that banner exists to catch, so bump both in one commit.
 */
export const CLIENT_VERSION = '1.0.0';

/** The three tabbed views, in tab-bar order. #view-setup is deliberately absent. */
const VIEWS = ['home', 'add', 'manage'];

/** How long a toast stays up before it hides itself again. */
const TOAST_MS = 3200;

/** Errors stay longer: they are longer, and they are the ones that must be read. */
const TOAST_ERROR_MS = 7000;

/* ---------------------------------------------------------------- toast -- */

/**
 * Show a transient message in a toast element.
 *
 * The `kind` is recorded on BOTH `dataset.kind` and a `pb-toast--<kind>` class so
 * the error state is distinguishable from a success by CSS and by a test — an
 * error that looks like a success is how a failed save becomes a mystery.
 *
 * @param {Element} el      the toast container, normally #toast
 * @param {string}  message what the user reads
 * @param {'error'|'success'|'info'} [kind='info']
 */
export function showToast(el, message, kind = 'info') {
  if (!el) return;
  const safeKind = kind === 'error' || kind === 'success' ? kind : 'info';

  // textContent, never innerHTML: a message can carry a server-supplied string
  // and this element already has role="alert" + aria-live.
  el.textContent = message == null ? '' : String(message);

  // Remove every kind marker before adding this one, so a failure after a
  // success cannot leave both classes on the element.
  if (el.classList && typeof el.classList.remove === 'function') {
    el.classList.remove('pb-toast--info', 'pb-toast--success', 'pb-toast--error');
    el.classList.remove('hidden');
    el.classList.add(`pb-toast--${safeKind}`);
  }
  // `dataset` is a read-only accessor on real elements: assigning to it throws a
  // TypeError in strict mode (every ES module). Only create one for a host that
  // has none, and never reassign it where it exists.
  if (!el.dataset) el.dataset = {};
  el.dataset.kind = safeKind;

  // The `hidden` property keeps the element out of the a11y tree even where the
  // tailwind `hidden` class is overridden.
  el.hidden = false;
}

/** Hide a toast again. */
function hideToast(el) {
  if (!el) return;
  el.textContent = '';
  if (el.classList && typeof el.classList.add === 'function') {
    el.classList.add('hidden');
    el.classList.remove('pb-toast--info', 'pb-toast--success', 'pb-toast--error');
  }
  el.hidden = true;
}

/* -------------------------------------------------------------- routing -- */

/**
 * Show one view and hide the rest, marking the active tab for assistive tech.
 *
 * Both mechanisms are set, deliberately. The `hidden` property is what the DOM
 * and the accessibility tree honour; the `hidden` CLASS is what index.html and
 * tailwind actually paint with. Setting only one leaves a screen that is
 * invisible to a screen reader but visible to an eye (or worse, the reverse).
 *
 * @param {Record<string, Element>} views name -> section element
 * @param {Record<string, Element>} tabs  name -> tab button
 * @param {string} name the view to show
 * @returns {string} the name shown, so a caller can assert on it
 */
export function switchView(views, tabs, name) {
  const viewMap = views || {};
  const tabMap = tabs || {};

  for (const key of Object.keys(viewMap)) {
    const el = viewMap[key];
    if (!el) continue;
    const active = key === name;
    el.hidden = !active;
    if (el.classList && typeof el.classList.toggle === 'function') {
      el.classList.toggle('hidden', !active);
    }
  }

  for (const key of Object.keys(tabMap)) {
    const tab = tabMap[key];
    if (!tab || typeof tab.setAttribute !== 'function') continue;
    if (key === name) tab.setAttribute('aria-current', 'page');
    else if (typeof tab.removeAttribute === 'function') tab.removeAttribute('aria-current');
  }

  return name;
}

/* ------------------------------------------------------- version banner -- */

/**
 * True when the backend reports a version this frontend does not know about.
 *
 * Deliberately false when either side is missing: a payload with no version is
 * an older backend, not a stale client, and a banner that fires on data we do
 * not have teaches the user to ignore the banner — which is exactly how it stops
 * working when it is needed.
 */
export function isServerStale(serverVersion, clientVersion) {
  const server = String(serverVersion ?? '').trim();
  const client = String(clientVersion ?? '').trim();
  if (!server || !client) return false;
  return server !== client;
}

/* -------------------------------------------------------- service worker -- */

/** Hosts on which a plain-http service worker is still allowed. */
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1', '[::1]'];

/**
 * Register the service worker, once it is safe to do so.
 *
 * Two guards, both load-bearing:
 *   * `'serviceWorker' in navigator` — absent in older Safari, and a TypeError
 *     thrown during boot would take the whole app down over a nicety.
 *   * https-or-localhost — registering over plain http on a LAN IP does not
 *     throw, it silently never installs, which is far more expensive to debug.
 *
 * Waiting-worker handling asks the worker to skip waiting but NEVER reloads the
 * page. A forced reload here would discard a half-typed expense, and this app's
 * whole promise is that logging one takes under five seconds. The new worker
 * takes over on the next navigation instead.
 *
 * @param {Window} win
 * @returns {Promise<ServiceWorkerRegistration>|null} the registration promise,
 *   or null when registration was skipped.
 */
export function registerServiceWorker(win) {
  if (!win) return null;
  const nav = win.navigator;
  if (!nav || !('serviceWorker' in nav) || !nav.serviceWorker) return null;

  const location = win.location || {};
  const protocol = String(location.protocol || '');
  const hostname = String(location.hostname || '');
  const secureContext = protocol === 'https:' || LOCAL_HOSTS.includes(hostname);
  if (!secureContext) return null;

  const href = location.href || `${protocol}//${hostname}/`;
  let swUrl = './sw.js';
  try { swUrl = new URL('./sw.js', href).toString(); } catch (_) { /* keep the relative form */ }

  // The returned promise must never reject: a failed registration (private
  // mode, storage pressure, a mid-deploy 404) is not a reason to break the app,
  // and an unhandled rejection here would surface as a console error nobody can
  // act on.
  let registration;
  try {
    registration = nav.serviceWorker.register(swUrl, { scope: './' });
  } catch (_) {
    return null;
  }
  if (!registration || typeof registration.then !== 'function') return null;

  return registration.then(
    (reg) => {
      try { askWaitingWorker(reg); } catch (_) { /* never fatal */ }
      return reg;
    },
    () => null,
  );
}

/**
 * Nudge a worker that is stuck waiting so the next navigation gets it.
 *
 * Only a message — no location.reload(). See the note on
 * registerServiceWorker: a reload here loses an in-progress entry.
 */
function askWaitingWorker(registration) {
  if (!registration) return;
  const waiting = registration.waiting;
  if (waiting && typeof waiting.postMessage === 'function') {
    waiting.postMessage({ type: 'SKIP_WAITING' });
    return;
  }
  const installing = registration.installing;
  if (installing && typeof installing.addEventListener === 'function') {
    installing.addEventListener('statechange', () => {
      // Only nudge when a controller exists: with no controller this is the very
      // first install, and skipWaiting gains nothing.
      if (installing.state === 'installed' && registration.active
          && typeof installing.postMessage === 'function') {
        installing.postMessage({ type: 'SKIP_WAITING' });
      }
    });
  }
}

/* -------------------------------------------------------- install prompt -- */

/** Shared holder for the deferred event, so a bare listener can still stash. */
const SHARED_INSTALL_STATE = { installPrompt: null };

/**
 * Capture `beforeinstallprompt` for a later, user-initiated `prompt()`.
 *
 * preventDefault() is mandatory and is the single most-missed line in this whole
 * PWA: without it Chrome does not fire the event again, so the app gets exactly
 * one chance to offer installation and silently loses it.
 *
 * Accepts either shape, because it is used two ways:
 *   captureInstallPrompt(state, ev) — explicit, from a named handler.
 *   captureInstallPrompt(ev)         — wired straight to addEventListener, in
 *                                      which case the event arrives first.
 *
 * @param {object|Event} state  the state holder (or the event, see above)
 * @param {Event} [event]
 * @returns {Event|null} the stashed event
 */
export function captureInstallPrompt(state, event) {
  const ev = event || (state && typeof state.preventDefault === 'function' ? state : null);
  const holder = state && typeof state.preventDefault !== 'function' ? state : SHARED_INSTALL_STATE;

  if (!ev) return null;
  if (typeof ev.preventDefault === 'function') ev.preventDefault();

  if (holder && typeof holder === 'object') holder.installPrompt = ev;
  return ev;
}

/**
 * True when the platform is iOS and the app is NOT running standalone.
 *
 * iOS Safari never fires beforeinstallprompt, so this detection is the ONLY
 * install path those users get. Without it they simply never see an install
 * button — which reads as "this app cannot be installed", not "this app has no
 * install prompt". Standalone is checked first so an already-installed copy is
 * not nagged, and matchMedia is the fallback for iPadOS in desktop mode, which
 * reports no `navigator.standalone` at all.
 *
 * @param {Window} win
 * @param {Navigator} [nav]
 * @returns {boolean}
 */
export function shouldShowIosInstallHint(win, nav) {
  // Field-by-field fallback rather than `nav || win.navigator`: the two are
  // often partially populated (a UA on the window, a matchMedia on the same
  // object), and picking one object wholesale would silently drop the other.
  const explicit = nav || null;
  const fallback = (win && win.navigator) || null;
  const ua = String((explicit && explicit.userAgent)
    || (fallback && fallback.userAgent)
    || '');
  if (!ua) return false;

  const touchPoints = (explicit && explicit.maxTouchPoints) || (fallback && fallback.maxTouchPoints);
  const isIos = /iPad|iPhone|iPod/.test(ua)
    // iPadOS 13+ in desktop mode reports as a Mac; touch points give it away.
    || (/Macintosh/.test(ua) && Number(touchPoints) > 1);
  if (!isIos) return false;

  const standalone = (explicit && explicit.standalone);
  if (typeof standalone === 'boolean') return standalone !== true;
  if (win && typeof win.matchMedia === 'function') {
    try {
      const mq = win.matchMedia('(display-mode: standalone)');
      return !(mq && mq.matches === true);
    } catch (_) { /* fall through to "show the hint" */ }
  }
  return true;
}

/* ------------------------------------------------------------------ boot -- */

/** Readable text for anything thrown by the api client. */
function describeError(err) {
  if (err && typeof err.message === 'string' && err.message.trim() !== '') {
    return err.message.trim();
  }
  return 'Something went wrong. Please try again.';
}

/** 'HH:MM' in the viewer's own timezone, for the cached-data banner. */
function hhmm(date) {
  const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

/**
 * Wire up the whole application.
 *
 * All dependencies are injectable so this runs headless: `win`/`doc` supply the
 * DOM, `config` the stored settings, `api` the client, `now` the clock.
 *
 * @param {object} [deps]
 * @param {Window} [deps.win]
 * @param {Document} [deps.doc]
 * @param {object} [deps.config]   a makeConfig() holder
 * @param {object} [deps.api]      a makeApi() client
 * @param {Function} [deps.apiFactory] (config) => api, for the setup screen's
 *   throwaway client used by Test connection
 * @param {Function} [deps.now]    () => Date
 * @returns {{ready: Promise, refresh: Function, teardown: Function,
 *            getState: Function, pending: Function}}
 */
export function boot(deps = {}) {
  const win = deps.win || null;
  const doc = deps.doc || (win && win.document) || null;
  const config = deps.config || defaultConfig;
  const apiFactory = deps.apiFactory || ((cfg) => makeApi(cfg));
  const now = deps.now || (() => new Date());
  const api = deps.api || apiFactory(config);

  // ---- element lookups ---------------------------------------------------
  const byId = (id) => {
    if (!doc) return null;
    if (typeof doc.getElementById === 'function') {
      const found = doc.getElementById(id);
      if (found) return found;
    }
    if (typeof doc.querySelector === 'function') return doc.querySelector('#' + id);
    return null;
  };

  const els = {
    toast: byId('toast'),
    versionBanner: byId('version-banner'),
    staleBanner: byId('stale-banner'),
    homeSummary: byId('home-summary'),
    pockets: byId('pockets'),
    activity: byId('activity'),
    setupForm: byId('setup-form'),
    setupEndpoint: byId('setup-endpoint'),
    setupToken: byId('setup-token'),
    setupSave: byId('setup-save'),
    setupTest: byId('setup-test'),
    setupStatus: byId('setup-status'),
    setupCancel: byId('setup-cancel'),
    changeConnection: byId('change-connection'),
    viewSetup: byId('view-setup'),
    viewHome: byId('view-home'),
    viewAdd: byId('view-add'),
    viewManage: byId('view-manage'),
  };

  const views = {
    setup: els.viewSetup,
    home: els.viewHome,
    add: els.viewAdd,
    manage: els.viewManage,
  };

  /** tab buttons, keyed by view name — index.html marks them data-view. */
  const tabs = {};
  for (const name of VIEWS) {
    let tab = null;
    if (doc && typeof doc.querySelector === 'function') {
      tab = doc.querySelector(`[data-view="${name}"]`);
    }
    if (!tab && doc && typeof doc.querySelectorAll === 'function') {
      const all = doc.querySelectorAll('[data-view]');
      for (const candidate of all) {
        if (candidate && String((candidate.dataset || {}).view) === name) { tab = candidate; break; }
      }
    }
    tabs[name] = tab;
  }

  /** The tab bar itself: the closest <nav> ancestor of any tab. */
  const tabBar = (() => {
    if (!doc || typeof doc.querySelector !== 'function') return null;
    if (typeof doc.querySelector('nav') === 'object' && doc.querySelector('nav')) return doc.querySelector('nav');
    for (const name of VIEWS) {
      const tab = tabs[name];
      if (tab && typeof tab.closest === 'function') {
        const nav = tab.closest('nav');
        if (nav) return nav;
      }
    }
    return null;
  })();

  // ---- state -------------------------------------------------------------
  let lastState = null;
  let lastUpdatedAt = null;
  let lastRefreshError = null;
  let rerunRequested = false;
  let refreshPromise = null;
  let teardownAddForm = null;
  let teardownManage = null;
  let installState = { installPrompt: null };
  let installNode = null;
  let torn = false;
  const listeners = [];
  const timers = new Set();

  /** Track a promise so pending() can await everything in flight. */
  function track(promise) {
    if (promise && typeof promise.then === 'function') {
      pendingTasks.add(promise);
      const done = () => pendingTasks.delete(promise);
      promise.then(done, done);
    }
    return promise;
  }
  const pendingTasks = new Set();

  /** Resolves once nothing is in flight. Used by the tests and by refresh(). */
  function pending() {
    if (pendingTasks.size === 0) return Promise.resolve();
    return Promise.all([...pendingTasks].map((p) => Promise.resolve(p).catch(() => {})))
      .then(() => (pendingTasks.size === 0 ? undefined : pending()));
  }

  const toast = (message, kind = 'info') => {
    showToast(els.toast, message, kind);
    // Do not rely on a browser timer existing: in a headless host there is no
    // timer, and the toast simply stays up, which is harmless.
    const setTimer = win && typeof win.setTimeout === 'function' ? win.setTimeout : null;
    if (!setTimer) return;
    for (const t of timers) {
      const clearTimer = win && typeof win.clearTimeout === 'function' ? win.clearTimeout : null;
      if (clearTimer) clearTimer(t);
    }
    timers.clear();
    timers.add(setTimer(() => { hideToast(els.toast); timers.clear(); }, kind === 'error' ? TOAST_ERROR_MS : TOAST_MS));
  };

  function on(target, type, fn, options) {
    if (!target || typeof target.addEventListener !== 'function') return;
    target.addEventListener(type, fn, options);
    listeners.push([target, type, fn, options]);
  }

  function setHidden(el, hidden) {
    if (!el) return;
    el.hidden = hidden;
    if (el.classList && typeof el.classList.toggle === 'function') el.classList.toggle('hidden', hidden);
  }

  /** Show or clear the "a new version is deployed" banner. */
  function showVersionBanner(serverVersion) {
    if (!els.versionBanner) return;
    if (!isServerStale(serverVersion, CLIENT_VERSION)) {
      setHidden(els.versionBanner, true);
      return;
    }
    els.versionBanner.textContent =
      'A new version of PocketBudget is deployed (server ' + String(serverVersion)
      + ', this app ' + CLIENT_VERSION + '). Close and reopen PocketBudget to update.';
    setHidden(els.versionBanner, false);
  }

  /**
   * Show the stale banner, or clear it.
   *
   * The message ALWAYS says when the data was fetched. This is the whole point:
   * see rule 2 in the header. A cached figure with no timestamp reads as live.
   */
  function showStaleBanner(message) {
    if (!els.staleBanner) return;
    if (!message) {
      els.staleBanner.textContent = '';
      setHidden(els.staleBanner, true);
      return;
    }
    els.staleBanner.textContent = message;
    setHidden(els.staleBanner, false);
  }

  function staleMessage(err) {
    const why = describeError(err);
    if (lastState) {
      return 'Showing cached data — last updated ' + hhmm(lastUpdatedAt)
        + '. These balances may be out of date. ' + why + ' Tap to retry.';
    }
    // Nothing cached yet: an honest empty state beats an empty screen.
    return 'Could not load your budgets. ' + why + ' Tap to retry.';
  }

  /**
   * Which slice of the pocket list is showing: 'all', 'attention' or
   * 'account:<name>'. Survives refreshes, so the list does not snap back to "All"
   * every time you return to the app.
   */
  let pocketFilter = 'all';

  /** Paint the summary header and the pocket list from a getState payload. */
  function paintPockets(payload) {
    const pockets = Array.isArray(payload.pockets) ? payload.pockets : [];
    // Pace only means something for the month the payload describes; a stale
    // cached payload from last month gets plain thresholds and no tick.
    const pace = monthProgress(new Date(), payload.month);
    pocketFilter = renderPockets(els.pockets, pockets, { pace, filter: pocketFilter });
    renderSummary(els.homeSummary, payload.summary, pockets, pace);
  }

  /** Paint the summary, pocket list and activity feed from a getState payload. */
  function renderState(state) {
    const payload = state || {};
    const pockets = Array.isArray(payload.pockets) ? payload.pockets : [];
    const transactions = Array.isArray(payload.transactions) ? payload.transactions : [];

    paintPockets(payload);
    renderActivity(els.activity, transactions, pocketNames(pockets));
  }

  function pocketNames(pockets) {
    const map = {};
    for (const p of pockets) {
      if (p && p.id != null) map[p.id] = p.name;
    }
    return map;
  }

  /**
   * Mount (or re-mount) the add form and the manage screen against new state.
   *
   * Both screens are mounted ONCE and then handed each new payload through an
   * update handle (updateAddFormState / updateManageState), so a refresh never
   * blows away a half-typed expense or the pocket being edited.
   */
  function mountChildScreens(state) {
    if (torn) return;
    try {
      if (!teardownAddForm) {
        teardownAddForm = mountAddForm({
          root: views.add,
          api,
          state,
          doc,
          toast: (message, kind) => toast(message, kind),
          onAdded: () => { track(refresh({ fresh: true })); },
          onStale: () => { track(refresh()); },
          onError: (err) => { toast(describeError(err), 'error'); },
        });
      } else {
        updateAddFormState(teardownAddForm, state);
      }
    } catch (err) {
      // A broken child screen must not take the home feed down with it.
      console.warn('[app] add form failed to mount:', err);
    }

    try {
      if (!teardownManage) {
        teardownManage = mountManage({
          root: views.manage,
          api,
          state,
          onChanged: () => { track(refresh({ fresh: true })); },
          toast: (message) => { toast(message, 'success'); },
        });
      } else {
        updateManageState(teardownManage, state);
      }
    } catch (err) {
      console.warn('[app] manage screen failed to mount:', err);
    }
  }

  /** One fetch + paint. Never rejects; returns the state now on screen. */
  function fetchAndPaint() {
    // The api client is called inside Promise.resolve() so that even a client
    // which throws SYNCHRONOUSLY lands on the microtask queue. Without this the
    // catch/finally in refresh() would run before `refreshPromise =` was ever
    // assigned, leaving the field permanently holding a resolved promise and
    // every later refresh silently short-circuiting to stale data.
    return Promise.resolve()
      .then(() => api.getState())
      .then((state) => {
        if (torn) return lastState;
        lastState = state || {};
        lastRefreshError = null;
        lastUpdatedAt = now();
        renderState(lastState);
        mountChildScreens(lastState);
        showVersionBanner(lastState.version);
        showStaleBanner(null);
        return lastState;
      }, (err) => {
        if (torn) return lastState;
        lastRefreshError = err;
        // Keep the last known balances on screen, LABELLED with when they were
        // fetched. NEVER present them as current — see rule 2 in the header.
        if (lastState) renderState(lastState);
        showStaleBanner(staleMessage(err));
        // A rejected token cannot be fixed by retrying: the stale banner would
        // say "Tap to retry" forever. Take the user to the one screen that can
        // fix it. (Skipped while setup is already showing — saveSetup reports
        // the failure there itself.)
        if (err && err.code === 'UNAUTHORIZED' && !isSetupVisible()) {
          showSetup('The household token was rejected. Enter the current token to reconnect.');
        }
        return lastState;
      });
  }

  /**
   * Fetch state once and paint it.
   *
   * Concurrent callers share the in-flight promise. Two triggers firing at once
   * (a mutation finishing as the app is foregrounded) would otherwise spend two
   * cold starts to learn the same thing.
   *
   * EXCEPT after a write: pass `{ fresh: true }`. A fetch that was already in
   * flight when the write landed may have read the sheet BEFORE it, so joining it
   * would paint pre-write balances as if they were current. A fresh request waits
   * for that fetch, then fetches once more, and every waiting caller gets the
   * newer result.
   */
  function refresh(opts = {}) {
    if (torn) return Promise.resolve(lastState);
    if (refreshPromise) {
      if (opts.fresh) rerunRequested = true;
      return refreshPromise;
    }

    const run = fetchAndPaint().then((state) => {
      if (!rerunRequested || torn) return state;
      rerunRequested = false;
      return fetchAndPaint();
    });

    refreshPromise = run;
    // Clear only OUR own promise: a refresh started while this one settles must
    // not have its slot taken away by the older run's cleanup.
    const clear = () => { if (refreshPromise === run) refreshPromise = null; };
    run.then(clear, clear);

    return track(run);
  }

  /* ---------------------------------------------------- setup screen -- */

  /** Read the two setup fields, falling back to the saved values. */
  function readSetupFields() {
    return {
      endpoint: String((els.setupEndpoint && els.setupEndpoint.value) || ''),
      token: String((els.setupToken && els.setupToken.value) || ''),
    };
  }

  function setSetupStatus(message, kind = 'info') {
    if (!els.setupStatus) return;
    els.setupStatus.textContent = message;
    if (!els.setupStatus.dataset) els.setupStatus.dataset = {};
    els.setupStatus.dataset.kind = kind;
  }

  /**
   * "Test connection": validate the pasted values and ping with a THROWAWAY
   * client, without saving anything.
   *
   * This is where a bad paste gets caught. Finding out three screens later that
   * the URL was missing `/exec` — or that the token was the wrong household's —
   * is the difference between a two-minute fix and a support conversation.
   */
  async function testConnection() {
    const { endpoint, token } = readSetupFields();
    if (els.setupTest) els.setupTest.disabled = true;
    setSetupStatus('Testing…', 'info');

    // A scratch store so testing never persists: Save is what commits.
    const scratch = {};
    let probe;
    try {
      const candidate = makeConfig({ store: { getItem: () => null, setItem: () => {} } });
      candidate.configure(endpoint, token);
      probe = apiFactory(candidate);
    } catch (err) {
      if (els.setupTest) els.setupTest.disabled = false;
      setSetupStatus(describeError(err), 'error');
      return false;
    }

    try {
      const res = await probe.ping();
      if (els.setupTest) els.setupTest.disabled = false;
      const version = res && res.version ? ` (server ${res.version})` : '';
      setSetupStatus('Connected' + version + '. Now tap Save.', 'success');
      return true;
    } catch (err) {
      if (els.setupTest) els.setupTest.disabled = false;
      setSetupStatus(describeError(err), 'error');
      return false;
    }
  }

  /** Put back the connection that was saved before an attempt to replace it. */
  function restoreConfig(prev) {
    try {
      if (prev.endpoint && prev.token) config.configure(prev.endpoint, prev.token);
      else config.clear();
    } catch (_) {
      config.clear();
    }
  }

  /**
   * Save the setup fields and, if they work, go straight to the home feed.
   *
   * The new values are only KEPT once the server accepts them. They have to be
   * stored first (the api client reads the config), so a failed attempt puts
   * the previous connection back. Without that, one mistyped token was saved,
   * the next launch skipped this screen, and there was no way back to it.
   */
  async function saveSetup() {
    const { endpoint, token } = readSetupFields();
    const prev = { endpoint: config.getEndpoint(), token: config.getToken() };
    if (els.setupSave) els.setupSave.disabled = true;
    try {
      config.configure(endpoint, token);
    } catch (err) {
      if (els.setupSave) els.setupSave.disabled = false;
      setSetupStatus(describeError(err), 'error');
      return false;
    }

    try {
      await refresh();
      const failed = els.staleBanner && els.staleBanner.hidden === false;
      if (failed) {
        // Surface the PRECISE reason, not the home screen's "cached data" banner:
        // a wrong token reads as "Invalid or missing token" here rather than as a
        // mystery three screens later.
        setSetupStatus(lastRefreshError
          ? describeError(lastRefreshError)
          : 'The server could not be reached. Check the values.', 'error');
        restoreConfig(prev);
        syncSetupCancel();
        return false;
      }
      setSetupStatus('Saved.', 'success');
      enterApp();
      return true;
    } finally {
      if (els.setupSave) els.setupSave.disabled = false;
    }
  }

  function isSetupVisible() {
    return Boolean(els.viewSetup) && els.viewSetup.hidden === false;
  }

  /** "Cancel" only makes sense when there is a working connection to go back to. */
  function syncSetupCancel() {
    setHidden(els.setupCancel, !config.isConfigured());
  }

  /**
   * Open the setup screen on demand: from the Manage tab's "Change connection",
   * or automatically when the server rejects the token. The endpoint is
   * prefilled; the token is NOT, so it has to be typed again.
   */
  function showSetup(message) {
    if (els.setupEndpoint) els.setupEndpoint.value = config.getEndpoint();
    if (els.setupToken) els.setupToken.value = '';
    setSetupStatus(message || '', message ? 'error' : 'info');
    syncSetupCancel();
    setHidden(tabBar, true);
    switchView(views, tabs, 'setup');
  }

  /** Leave the setup screen: tab bar on, home feed visible. */
  function enterApp() {
    setHidden(tabBar, false);
    switchView(views, tabs, 'home');
  }

  /**
   * Ask before deleting, naming the expense so the right one is being removed.
   * A host with no confirm() (a headless test) proceeds, as manage.js does.
   */
  function confirmDelete(txnId) {
    if (!win || typeof win.confirm !== 'function') return true;
    const txns = lastState && Array.isArray(lastState.transactions) ? lastState.transactions : [];
    const t = txns.find((x) => x && String(x.id) === txnId);
    const what = t
      ? `${formatMoney(t.amount)}${t.note ? ' (' + t.note + ')' : ''}`
      : 'this expense';
    return win.confirm(`Delete ${what}? The amount goes back into its pocket.`) === true;
  }

  /* ------------------------------------------------------- install UI -- */

  function removeInstallNode() {
    if (installNode && installNode.parentNode && typeof installNode.parentNode.removeChild === 'function') {
      installNode.parentNode.removeChild(installNode);
    }
    installNode = null;
  }

  /**
   * Build the install affordance and mount it on the body.
   *
   * `instructions === true` produces the iOS variant: a <p> of plain text,
   * because iOS Safari never fires beforeinstallprompt and this sentence is the
   * ONLY install path those users get. Everything is textContent, never
   * innerHTML, so nothing here can inject markup.
   */
  function showInstallNode(instructions) {
    if (!doc || typeof doc.createElement !== 'function') return null;
    if (installNode) return installNode;

    const wrap = doc.createElement('div');
    wrap.id = 'install-bar';
    wrap.hidden = false;
    if (wrap.classList && typeof wrap.classList.add === 'function') {
      wrap.classList.add('pb-install', 'mx-auto', 'max-w-lg', 'px-4', 'pt-3', 'text-center');
    }

    if (instructions) {
      const note = doc.createElement('p');
      note.className = 'pb-install__note text-xs text-slate-400';
      note.textContent = 'To install PocketBudget on your home screen, '
        + 'tap Share, then Add to Home Screen.';
      wrap.appendChild(note);
    } else {
      const button = doc.createElement('button');
      button.type = 'button';
      button.id = 'install-button';
      button.textContent = 'Add to home screen';
      button.hidden = false;
      on(button, 'click', () => {
        const event = installState.installPrompt;
        if (!event || typeof event.prompt !== 'function') return;
        // prompt() MUST come from a user gesture; the stashed event is the only
        // way to reach Chrome's install dialog after the fact.
        const outcome = event.prompt();
        track(Promise.resolve(outcome).then(() => {
          installState.installPrompt = null;
          removeInstallNode();
        }, () => { removeInstallNode(); }));
      });
      wrap.appendChild(button);
    }

    if (doc.body && typeof doc.body.appendChild === 'function') doc.body.appendChild(wrap);
    installNode = wrap;
    return wrap;
  }

  /** Chrome/Edge/Android: stash the event and offer a button. */
  function onBeforeInstallPrompt(ev) {
    captureInstallPrompt(installState, ev);
    showInstallNode(false);
  }

  /* ----------------------------------------------------------- wiring -- */

  // Tab bar.
  for (const name of VIEWS) {
    on(tabs[name], 'click', () => { switchView(views, tabs, name); });
  }

  // Setup screen.
  //
  // Only the FORM is bound, not the Save button as well: #setup-save is
  // type="submit" inside #setup-form, so a click on it fires click AND submit.
  // Binding both would save twice and spend two Apps Script cold starts on one
  // deliberate action.
  on(els.setupTest, 'click', () => { track(testConnection()); });
on(els.changeConnection, 'click', () => { showSetup(''); });
on(els.setupCancel, 'click', () => {
  if (!config.isConfigured()) return;
  setSetupStatus('', 'info');
  enterApp();
  track(refresh());   // the failed attempt may have left its error banner up
});
  on(els.setupForm, 'submit', (ev) => {
    if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
    track(saveSetup());
  });

  // Delete affordance: the feed re-renders on every state change, so this is
  // delegated from the container rather than bound per row.
  //
  // It keys on the DELETE BUTTON (data-action="delete-txn"), never on the row:
  // the row also carried the transaction id, and matching on that made a tap
  // anywhere on a row — to read it, or while scrolling — delete the expense and
  // refund the pocket. Deleting also asks first: it is not undoable.
  on(els.activity, 'click', (ev) => {
    const target = ev && ev.target && typeof ev.target.closest === 'function'
      ? ev.target.closest('[data-action="delete-txn"]')
      : null;
    if (!target) return;
    const dataset = target.dataset || {};
    const txnId = dataset.txnId || (target.getAttribute && target.getAttribute('data-txn-id'));
    if (!txnId) return;
    if (!confirmDelete(String(txnId))) return;
    track(Promise.resolve()
      .then(() => api.deleteTransaction(String(txnId)))
      .then((res) => {
        // An expense from an earlier month is removed from the history, but its
        // money is not given back to this month's balance.
        toast(res && res.refunded === false
          ? 'Deleted. It was from an earlier month, so the balance is unchanged.'
          : 'Deleted.', 'success');
        return refresh({ fresh: true });
      })
      .catch((err) => {
        // Nothing changed, so nothing is refetched: the feed still shows the
        // truth. Reporting the failure is the honest move.
        toast(describeError(err), 'error');
      }));
  });

  // Tapping a pocket row: jump to the add form with that pocket chosen.
  // (The card button used to render with nothing listening to it.)
  on(els.pockets, 'click', (ev) => {
    const target = ev && ev.target && typeof ev.target.closest === 'function' ? ev.target : null;

    // Filter chips: narrow the list in place; nothing is fetched.
    const chip = target ? target.closest('[data-action="filter-pockets"]') : null;
    if (chip) {
      const value = (chip.dataset && chip.dataset.filter)
        || (chip.getAttribute && chip.getAttribute('data-filter')) || 'all';
      pocketFilter = String(value);
      if (lastState) paintPockets(lastState);
      return;
    }

    const btn = target ? target.closest('[data-action="select-pocket"]') : null;
    if (!btn || btn.disabled) return;
    const dataset = btn.dataset || {};
    const id = dataset.pocketId || (btn.getAttribute && btn.getAttribute('data-pocket-id'));
    if (!id) return;
    switchView(views, tabs, 'add');
    if (typeof teardownAddForm === 'function' && typeof teardownAddForm.selectPocket === 'function') {
      teardownAddForm.selectPocket(String(id));
    }
  });

  // The stale banner doubles as the retry affordance: it is the only element on
  // screen when a fetch fails, so it has to be the thing you tap.
  on(els.staleBanner, 'click', () => { if (config.isConfigured()) track(refresh()); });

  // Foreground refresh. No polling, no websockets: this is how the second
  // spouse's expense appears when the first brings the app back to the front.
  on(doc, 'visibilitychange', (ev) => {
    if (torn || !config.isConfigured()) return;
    const visible = ev && typeof ev.visibilityState === 'string'
      ? ev.visibilityState === 'visible'
      : doc.visibilityState !== 'hidden';
    if (visible) track(refresh());
  });

  // Install prompts.
  on(win, 'beforeinstallprompt', onBeforeInstallPrompt);
  on(win, 'appinstalled', () => { removeInstallNode(); installState.installPrompt = null; });
  if (shouldShowIosInstallHint(win, win && win.navigator)) showInstallNode(true);

  // Service worker: after `load`, so registration never competes with first
  // paint for the connection.
  on(win, 'load', () => { registerServiceWorker(win); });

  /* ----------------------------------------------------------- start -- */

  let ready;
  if (config.isConfigured()) {
    setHidden(tabBar, false);
    switchView(views, tabs, 'home');
    ready = Promise.resolve(refresh()).catch(() => lastState);
  } else {
    // Not configured: no request is possible AND none is needed. Show setup,
    // hide the tab bar — offering tabs that lead to an empty feed is worse than
    // not offering them.
    switchView(views, tabs, 'setup');
    setHidden(tabBar, true);
    ready = Promise.resolve(null);
  }

  function teardown() {
    if (torn) return;
    torn = true;
    for (const [target, type, fn, options] of listeners) {
      if (target && typeof target.removeEventListener === 'function') {
        target.removeEventListener(type, fn, options);
      }
    }
    listeners.length = 0;
    for (const t of timers) {
      if (win && typeof win.clearTimeout === 'function') win.clearTimeout(t);
    }
    timers.clear();
    if (teardownAddForm && typeof teardownAddForm === 'function') teardownAddForm();
    if (teardownManage && typeof teardownManage === 'function') teardownManage();
    teardownAddForm = null;
    teardownManage = null;
    removeInstallNode();
  }

  return {
    ready,
    refresh: (opts) => track(refresh(opts)),
    pending,
    teardown,
    getState: () => lastState,
    getViews: () => views,
    getTabs: () => tabs,
    getConfig: () => config,
    /** The stashed beforeinstallprompt event, if the browser offered one. */
    getInstallPrompt: () => installState.installPrompt,
    /** Exposed on the handle itself so a test can read it as a property. */
    get installPrompt() { return installState.installPrompt; },
    clientVersion: CLIENT_VERSION,
  };
}

/* --------------------------------------------------------------- auto-boot -- */

/**
 * Start the app in a real browser.
 *
 * Without this, nothing ever ran: every view in index.html ships `hidden`, so a
 * missing boot call renders a completely blank page. `boot()` takes every
 * dependency by injection so it stays unit-testable under Node — this is the one
 * place that binds it to the real window and document.
 *
 * Guarded so importing the module in a test (where there is no document) is a
 * no-op rather than a crash.
 */
function autoBoot() {
  if (typeof document === 'undefined' || typeof window === 'undefined') return null;

  const start = () => {
    try {
      return boot({ win: window, doc: document });
    } catch (err) {
      // A failure here would leave every view hidden, i.e. a blank page. Surface
      // it rather than letting the user stare at nothing.
      console.error('[PocketBudget] failed to start:', err);
      const banner = document.getElementById('version-banner');
      if (banner) {
        banner.classList.remove('hidden');
        banner.textContent = 'PocketBudget failed to start. Close and reopen, or check the console.';
      }
      return null;
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
    return null;
  }
  return start();
}

autoBoot();
