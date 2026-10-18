// app/js/addform.js
// The quick-add expense form — the screen the whole product is judged on.
//
// The single number that matters here is: how many seconds from opening the app
// to an expense being logged. Everything below is in service of that, and the
// two hard rules it must never violate are:
//
//   1. A double tap must never create two transactions. Submit is disabled while
//      a request is in flight AND the handler re-checks the in-flight flag, so
//      even a synthetic second event cannot get through. A duplicate spend costs
//      a household real money and is silently wrong — there is no undo prompt.
//   2. INSUFFICIENT_FUNDS is shown VERBATIM. The product brief specifies that
//      exact string, so err.message is passed to the toast untouched. Do not
//      "improve" the wording.
//
// The rule about depleted pockets is communicated BEFORE the round trip: a locked
// pocket's option is disabled in the select, and if one is somehow selected the
// submit button disables with the reason inline in #add-reason. Letting the user
// discover it through a server error is the failure mode we are avoiding.
//
// Locked means isLocked === true, which the backend defines as balance <= 0.
// Both are checked, because the flag is derived server-side and a stale payload
// must not let a depleted pocket look spendable.
//
// No build step, no dependencies, no innerHTML: pocket and user names come from
// a spreadsheet a human types into, so options are built as real elements and
// assigned textContent. Markup can never be parsed, so a pocket named
// `<img src=x onerror=...>` is inert text. See render.js for the same reasoning
// on the HTML-string path.

import { formatMoney, isValidAmount, parseAmountText } from './format.js';

/* --------------------------------------------------------------- messages -- */

/**
 * The inline #add-reason copy. These are the strings a user reads when they
 * cannot submit, so they name the pocket and say what to do — an error code or
 * "invalid state" is not communication.
 */
const NO_POCKET_REASON = 'Add a pocket before logging an expense.';
const NO_USER_REASON = 'Add your household on the Manage tab.';
const AMOUNT_REASON = 'Enter an amount greater than zero.';

function lockedReason(name) {
  return name + ' is depleted — there is no money left in this pocket. '
    + 'Raise its limit or choose another pocket.';
}

/**
 * Server answers that prove the expense was NOT recorded. After one of these the
 * next attempt is a new expense. Anything else (timeout, dropped connection,
 * unreadable reply, server fault) leaves it unknown, and the retry must reuse
 * the same requestId so the server can recognise it.
 */
const DEFINITIVE_REJECTIONS = new Set([
  'INSUFFICIENT_FUNDS', 'INVALID_AMOUNT', 'INVALID_USER', 'INVALID_REQUEST',
  'POCKET_NOT_FOUND', 'UNAUTHORIZED', 'BUSY',
]);

const UNCERTAIN_REASON = 'Could not confirm the expense was saved. '
  + 'Tap Save again — it will not be recorded twice.';

const ALL_LOCKED_REASON = 'Every pocket is depleted — there is no money left to spend. '
  + 'Raise a limit to log another expense.';
const UNEXPECTED_FAILURE = 'Something went wrong saving the expense. Check Activity before trying again.';

/* ------------------------------------------------------------ pure logic -- */

/**
 * A pocket is locked when the server said so OR its balance is spent down.
 * Both are checked so a stale flag cannot present a depleted pocket as spendable.
 */
export function isPocketLocked(p) {
  if (!p) return false;
  if (p.isLocked === true) return true;
  const bal = Number(p.balance);
  return Number.isFinite(bal) && bal <= 0;
}

/**
 * Which pocket the form should have selected. The previous selection survives
 * only while that pocket still exists AND can be spent from; otherwise the first
 * spendable pocket is chosen, or '' when none is. A depleted pocket is never the
 * answer, so it can never sit disabled-but-selected in the picker.
 *
 * @param {object[]} pockets    getState pockets
 * @param {string}   selectedId the id currently selected ('' if none)
 * @returns {string} the id to select, or ''
 */
export function resolveSelectedPocketId(pockets, selectedId) {
  const list = Array.isArray(pockets) ? pockets.filter((p) => p && p.id !== undefined && p.id !== null) : [];
  const want = String(selectedId ?? '');
  const kept = want ? list.find((p) => String(p.id) === want) : null;
  if (kept && !isPocketLocked(kept)) return String(kept.id);
  const open = list.find((p) => !isPocketLocked(p));
  return open ? String(open.id) : '';
}

/**
 * The message for a failed save, and whether the server definitively refused it.
 * INSUFFICIENT_FUNDS keeps the server's text verbatim; unknown outcomes tell the
 * user a retry is safe; anything that is not an Error from the api client still
 * produces a readable message.
 *
 * @returns {{ message: string, definitive: boolean, stale: boolean }}
 */
export function describeSubmitFailure(err) {
  const code = err && typeof err === 'object' ? err.code : undefined;
  if (code === 'INSUFFICIENT_FUNDS') {
    return { message: String(err.message), definitive: true, stale: true };
  }
  if (code && DEFINITIVE_REJECTIONS.has(code)) {
    return { message: (err && err.message) || 'Could not save the expense.', definitive: true, stale: false };
  }
  if (code) return { message: UNCERTAIN_REASON, definitive: false, stale: false };
  return { message: UNEXPECTED_FAILURE, definitive: false, stale: false };
}

/** Storage key remembering which household member this phone belongs to. */
const USER_KEY = 'pb.user';

/** The browser's local storage when it works (private modes can throw), else null. */
function defaultUserStore() {
  try {
    const s = globalThis.localStorage;
    return s && typeof s.getItem === 'function' ? s : null;
  } catch (_) {
    return null;
  }
}

/** A fresh idempotency key: a UUID where available, else a random string of the same shape. */
function newRequestId() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const rand = () => Math.random().toString(16).slice(2, 10).padEnd(8, '0');
  return rand() + '-' + rand() + '-' + Date.now().toString(16);
}

/** Typed amount as a Number (R, spaces and decimal commas understood). Mirrors isValidAmount. */
function parseAmount(input) {
  return parseAmountText(input);
}

/* ------------------------------------------------------------- element io -- */

/**
 * Look an id up under `root`, falling back to a document-level lookup. In the
 * app the form lives inside #view-add, so root-scoped lookup is correct and
 * cannot collide with another view's ids; the fallback covers a host that hands
 * us a root which does not contain the markup (and unit tests).
 */
function pick(scope, doc, id) {
  if (scope && typeof scope.querySelector === 'function') {
    const found = scope.querySelector('#' + id);
    if (found) return found;
  }
  if (scope && typeof scope.getElementById === 'function') {
    const found = scope.getElementById(id);
    if (found) return found;
  }
  const d = doc || globalThis.document;
  if (d && typeof d.getElementById === 'function') return d.getElementById(id);
  return null;
}

/** Show a message in #add-reason. textContent only — never innerHTML. */
function showReason(el, message) {
  if (!el) return;
  el.textContent = message;
  const cl = el.classList;
  if (cl) cl.remove('hidden');
  // Some hosts (and the tailwind `hidden` class) rely on the class; the property
  // keeps the element out of the a11y tree regardless.
  el.hidden = false;
}

/** Clear #add-reason back to its hidden, empty state. */
function clearReason(el) {
  if (!el) return;
  el.textContent = '';
  const cl = el.classList;
  if (cl) cl.add('hidden');
  el.hidden = true;
}

/* ----------------------------------------------------------------- option -- */

function makeOption(doc, tag, value, label, disabled) {
  const opt = doc.createElement(tag);
  opt.value = value;
  opt.textContent = label; // textContent: never innerHTML — see the header note.
  opt.disabled = disabled === true;
  return opt;
}

/* ------------------------------------------------------------------ mount -- */

/**
 * Mount the quick-add form.
 *
 * @param {object}   o
 * @param {Element}  o.root       Scoped lookup root, normally #view-add.
 * @param {object}   o.api        The makeApi() client; only createTransaction is used.
 * @param {object}   o.state      getState payload: { pockets, transactions, summary }.
 * @param {string[]} [o.users]    Household members; falls back to state.summary.users.
 * @param {Function} [o.onAdded]  Called after a successful add so the feed refreshes.
 * @param {Function} [o.onError]  Called with any error that is not INSUFFICIENT_FUNDS.
 * @param {Function} [o.onStale]  Called after INSUFFICIENT_FUNDS: the balances on screen were out of date.
 * @param {Function} [o.toast]    toast(message, kind) for transient messages.
 * @returns {Function} teardown — detaches every listener this mount installed.
 *
 * The returned function is also the mount handle accepted by
 * updateAddFormState(), so a parent that refreshes state does not need a second
 * value threaded through its own module.
 */
export function mountAddForm({ root, api, state, users, onAdded, onError, onStale, toast, doc, userStore } = {}) {
  const document_ = doc || globalThis.document;

  const form = pick(root, document_, 'add-form');
  const amountEl = pick(root, document_, 'add-amount');
  const pocketEl = pick(root, document_, 'add-pocket');
  const noteEl = pick(root, document_, 'add-note');
  const userEl = pick(root, document_, 'add-user');
  const submitEl = pick(root, document_, 'add-submit');
  const reasonEl = pick(root, document_, 'add-reason');

  /**
   * The document we build option elements in. An explicitly passed `doc` wins;
   * otherwise the owner document of an element we actually found is the
   * authority — in a browser that is always the right document, and it keeps
   * this working in a host (or a test) that has no `globalThis.document`.
   */
  const ownerDoc = doc
    || (amountEl && amountEl.ownerDocument)
    || (pocketEl && pocketEl.ownerDocument)
    || globalThis.document
    || null;

  // Which household member is holding this phone. The select defaulted to the first
  // name, so Sam had to re-pick "Sam" on every launch or the expense (and the
  // report's spouse split) was quietly credited to Alex.
  const store = userStore === undefined ? defaultUserStore() : userStore;
  const savedUser = () => {
    try { return store ? String(store.getItem(USER_KEY) || '') : ''; } catch (_) { return ''; }
  };
  const rememberUser = (name) => {
    try { if (store && name) store.setItem(USER_KEY, name); } catch (_) { /* a private window: fine */ }
  };

  const listeners = [];
  function on(target, type, fn) {
    if (!target || typeof target.addEventListener !== 'function') return;
    target.addEventListener(type, fn);
    listeners.push([target, type, fn]);
  }

  // Non-null in every real path; the guards below keep a headless host (or a
  // partially-mounted DOM) from throwing instead of degrading.
  const hasDom = !!ownerDoc && typeof ownerDoc.createElement === 'function';

  /* ------------------------------------------------------ derived state -- */

  let current = state || {};
  let inFlight = false;
  let disposed = false;
  /** The in-doubt attempt, if any: `{ id, fingerprint }`. See DEFINITIVE_REJECTIONS. */
  let pendingAttempt = null;

  const pockets = () => (Array.isArray(current.pockets) ? current.pockets : []);
  const pocketById = (id) => pockets().find((p) => p && p.id === id) || null;

  const isLocked = isPocketLocked;

  function listUsers() {
    if (Array.isArray(users) && users.length) return users;
    const fromSummary = current && current.summary && current.summary.users;
    return Array.isArray(fromSummary) ? fromSummary : [];
  }

  /* --------------------------------------------------------- rendering -- */

  /** 'Groceries — R340.50 left', with a depleted suffix on a locked pocket. */
  function pocketLabel(p) {
    const base = String(p.name ?? '').trim() || String(p.id ?? '');
    const left = formatMoney(p.balance);
    return base + ' — ' + left + ' left' + (isLocked(p) ? ' (depleted)' : '');
  }

  /**
   * Rebuild the pocket and user options, preserving the current selection when
   * it survives the refresh. Called on mount and on every state change, so the
   * remaining balance shown is always live — that is the whole point of putting
   * it in the option label instead of behind a second tap.
   */
  function renderOptions() {
    if (!hasDom || !pocketEl) return;

    const prevPocket = pocketEl.value;
    const prevUser = userEl ? userEl.value : '';

    while (pocketEl.firstChild) pocketEl.removeChild(pocketEl.firstChild);
    for (const p of pockets()) {
      if (!p || p.id === undefined || p.id === null) continue;
      pocketEl.appendChild(makeOption(ownerDoc, 'option', String(p.id), pocketLabel(p), isLocked(p)));
    }

    // Keep the user's choice across a refresh only while that pocket can still be
    // spent from; a depleted pocket must never stay selected.
    pocketEl.value = resolveSelectedPocketId(pockets(), prevPocket);

    if (userEl) {
      while (userEl.firstChild) userEl.removeChild(userEl.firstChild);
      for (const u of listUsers()) {
        const name = String(u ?? '').trim();
        if (name === '') continue;
        userEl.appendChild(makeOption(ownerDoc, 'option', name, name, false));
      }
      const listed = (name) => Boolean(name) && listUsers().some((u) => String(u) === name);
      const keptUser = listed(prevUser) ? prevUser : (listed(savedUser()) ? savedUser() : '');
      if (keptUser) userEl.value = keptUser;
    }
  }

  /**
   * Recompute whether submit is allowed and why, and reflect it in the DOM.
   * One function owns both, so the button and the message can never disagree.
   */
  function syncSubmitState() {
    const selected = pocketEl ? pocketById(pocketEl.value) : null;

    if (pockets().length === 0) {
      if (submitEl) submitEl.disabled = true;
      showReason(reasonEl, NO_POCKET_REASON);
      return { ok: false };
    }
    if (!selected) {
      if (submitEl) submitEl.disabled = true;
      showReason(reasonEl, pockets().every(isLocked) ? ALL_LOCKED_REASON : NO_POCKET_REASON);
      return { ok: false };
    }
    if (isLocked(selected)) {
      // The rule, stated before the user can trip it on the server.
      if (submitEl) submitEl.disabled = true;
      showReason(reasonEl, lockedReason(String(selected.name ?? selected.id ?? 'This pocket')));
      return { ok: false };
    }
    if (listUsers().length === 0) {
      if (submitEl) submitEl.disabled = true;
      showReason(reasonEl, NO_USER_REASON);
      return { ok: false };
    }

    // Nothing structural is wrong. An in-flight request keeps submit disabled so
    // a double tap cannot land twice.
    if (submitEl) submitEl.disabled = inFlight;
    clearReason(reasonEl);
    return { ok: true };
  }

  /**
   * Move the selection off a depleted or missing pocket, then recompute the
   * submit gate. Used whenever the form is shown or its state refreshes.
   */
  function syncSelection() {
    if (hasDom && pocketEl) {
      const want = resolveSelectedPocketId(pockets(), pocketEl.value);
      if (want !== pocketEl.value) pocketEl.value = want;
    }
    return syncSubmitState();
  }

  /* ------------------------------------------------------------- submit -- */

  /** Show a transient message; a throwing toast must never break the submit path. */
  function notify(message, kind) {
    try {
      if (typeof toast === 'function') toast(message, kind);
    } catch (_) { /* nothing more can be done for the user here */ }
  }

  async function submit() {
    if (disposed) return;

    // Belt and braces with the disabled attribute: a synthetic or queued second
    // event must not open a second request.
    if (inFlight) return;

    inFlight = true;
    // True when the form already shows why it refused; finally must not repaint over it.
    let refused = false;
    try {
      // Gate on the server's own amount rules before spending a round trip.
      if (!isValidAmount(amountEl ? amountEl.value : '')) {
        if (submitEl) submitEl.disabled = true;
        showReason(reasonEl, AMOUNT_REASON);
        if (amountEl && typeof amountEl.focus === 'function') amountEl.focus();
        refused = true;
        return;
      }

      // A depleted or missing selection is refused with a message and a toast,
      // never silently: the tap must visibly do something.
      const verdict = syncSubmitState();
      if (!verdict.ok) {
        notify(reasonEl && reasonEl.textContent ? reasonEl.textContent : NO_POCKET_REASON, 'error');
        refused = true;
        return;
      }

      const amount = parseAmount(amountEl.value);
      const payload = {
        pocketId: String(pocketEl.value),
        amount,
        note: noteEl ? String(noteEl.value ?? '').trim() : '',
        user: userEl ? String(userEl.value ?? '') : '',
      };

      // Retrying the SAME expense reuses its requestId (so a lost response cannot
      // become a second deduction); changing any field is a different expense.
      const fingerprint = JSON.stringify([payload.pocketId, payload.amount, payload.note, payload.user]);
      if (!pendingAttempt || pendingAttempt.fingerprint !== fingerprint) {
        pendingAttempt = { id: newRequestId(), fingerprint };
      }
      payload.requestId = pendingAttempt.id;

      if (submitEl) submitEl.disabled = true; // for the duration of the request
      const result = await api.createTransaction(payload);
      pendingAttempt = null;

      // Stay put. No navigation, no full reset: the pocket and the note context
      // survive so the next entry is one number and one tap. This is the
      // behaviour that keeps the round trip under five seconds.
      if (amountEl) amountEl.value = '';
      if (noteEl) noteEl.value = '';
      if (amountEl && typeof amountEl.focus === 'function') amountEl.focus();

      notify('Expense saved.', 'success');
      if (typeof onAdded === 'function') onAdded(result);
    } catch (err) {
      const failure = describeSubmitFailure(err);
      if (failure.definitive) pendingAttempt = null;
      if (failure.stale) {
        // VERBATIM. The brief specifies this exact string, so err.message goes to
        // the toast untouched. The refusal also means what the screen showed was
        // out of date (the other phone spent first): reload so the pocket list
        // shows the real balance.
        notify(failure.message, 'error');
        try { if (typeof onStale === 'function') onStale(err); } catch (_) { /* refresh is best effort */ }
      } else {
        try { if (typeof onError === 'function') onError(err); } catch (_) { /* the toast below still shows */ }
        notify(failure.message, 'error');
      }
      // The amount stays put so the user can fix it and retry without retyping.
    } finally {
      // Whatever happened above, the form must be usable again.
      inFlight = false;
      if (!refused) {
        try { syncSubmitState(); } catch (_) { if (submitEl) submitEl.disabled = false; }
      }
    }
  }

  /* ----------------------------------------------------------- listeners -- */

  on(form, 'submit', (ev) => {
    if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
    return submit();
  });
  on(submitEl, 'click', () => submit());
  on(pocketEl, 'change', () => syncSubmitState());
  on(userEl, 'change', () => rememberUser(userEl.value));
  on(amountEl, 'input', () => syncSubmitState());
  on(amountEl, 'keydown', (ev) => {
    // Enter submits, so the 5-second path is type-number-Enter with no aiming.
    if (ev && ev.key === 'Enter') {
      if (typeof ev.preventDefault === 'function') ev.preventDefault();
      return submit();
    }
    return undefined;
  });

  /* --------------------------------------------------------------- mount -- */

  // type="text" + inputmode="decimal" is required, not cosmetic: iOS renders
  // type="number" without a decimal keypad on several versions, which breaks the
  // 5-second goal on exactly the phones that need it. The markup already says so;
  // reasserted here so a host that builds the form from scratch still gets it.
  if (amountEl && typeof amountEl.setAttribute === 'function') {
    amountEl.setAttribute('inputmode', 'decimal');
    amountEl.setAttribute('type', 'text');
  }

  renderOptions();
  syncSubmitState();

  // Autofocus last: the options are populated and the button state is settled,
  // so the very first keystroke goes to a live form.
  if (amountEl && typeof amountEl.focus === 'function') amountEl.focus();

  function teardown() {
    if (disposed) return;
    disposed = true;
    for (const [target, type, fn] of listeners) {
      if (typeof target.removeEventListener === 'function') target.removeEventListener(type, fn);
    }
    listeners.length = 0;
  }

  // The mount handle updateAddFormState() consumes.
  teardown.update = (next) => updateAddFormState(teardown, next);
  teardown.getState = () => current;
  teardown.elements = { form, amountEl, pocketEl, noteEl, userEl, submitEl, reasonEl };
  teardown.isSubmitting = () => inFlight;

  /**
   * Pre-select a pocket (the home screen's "Add expense" button) and put the
   * cursor in the amount field. A depleted or unknown pocket is ignored, so the
   * form never starts on something that cannot be spent from.
   */
  teardown.selectPocket = (id) => {
    const p = pocketById(String(id));
    if (!p || isLocked(p) || !pocketEl) return false;
    pocketEl.value = String(p.id);
    syncSubmitState();
    if (amountEl && typeof amountEl.focus === 'function') amountEl.focus();
    return true;
  };

  /**
   * Replace the payload and re-render. Lives on the closure because `current`
   * is module-local state: this is the only way to reach it from outside, and
   * it guarantees the options and the submit gate are re-run together so they
   * can never disagree after a refresh.
   */
  teardown._applyState = (next) => {
    current = next || {};
    renderOptions();
    syncSelection();
  };

  /**
   * Called whenever the Add screen is shown: re-checks the remembered pocket
   * against the current balances and moves off one that can no longer be spent.
   */
  teardown.ensureSelection = () => syncSelection();

  return teardown;
}

/**
 * Push a refreshed getState payload into a mounted form.
 *
 * `state` arrives as a plain value, so mountAddForm cannot observe the parent
 * refreshing it; this is how the parent tells the form. Re-renders the options
 * (live balances) and re-runs the submit gate, preserving the current selection.
 *
 * @param {Function|object} mounted The teardown returned by mountAddForm().
 * @param {object} state           A fresh getState payload.
 */
export function updateAddFormState(mounted, state) {
  // Accept either the teardown function itself or an object wrapping it, so a
  // caller that stashed the handle in a wider object still works.
  const handle = typeof mounted === 'function' ? mounted : (mounted && mounted.teardown);
  if (typeof handle !== 'function' || typeof handle._applyState !== 'function') return;
  handle._applyState(state);
}