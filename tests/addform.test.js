// tests/addform.test.js
// Quick-add expense form tests.
//
// This screen is the whole product: a logged expense must take under 5 seconds.
// Two invariants therefore get hard assertions that must never be weakened:
//
//   1. The submit button is disabled while a request is in flight, so a double
//      tap cannot create two transactions. A duplicate spend costs a household
//      real money and is silently wrong.
//   2. INSUFFICIENT_FUNDS is surfaced VERBATIM. The product brief specifies that
//      exact string, so this test asserts equality, not a substring.
//
// Node has no DOM, so a minimal fake is built here — no npm dependencies.
// It implements only what the module touches: getElementById/querySelector,
// addEventListener/dispatch, value, disabled, textContent, classList, focus().

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { mountAddForm, updateAddFormState } from '../app/js/addform.js';
import { ApiError } from '../app/js/api.js';
import { formatMoney } from '../app/js/format.js';

/* --------------------------------------------------------------- fake DOM -- */

/**
 * A fake element. `value` mirrors the real DOM in one respect that matters:
 * setting `.value` on a <select> is normalised to the first enabled option when
 * the assigned value matches no option, which is how a browser behaves.
 */
class FakeElement {
  constructor(tag, id = '', doc = null) {
    this.tagName = String(tag).toUpperCase();
    this.id = id;
    this.ownerDocument = doc;
    this.children = [];
    this.parent = null;
    this.listeners = new Map();
    this.attributes = new Map();
    this._textContent = '';
    this._value = '';
    this.disabled = false;
    this.focused = 0;
    this.hidden = false;
    this._classes = new Set();

    this.classList = {
      contains: (c) => this._classes.has(c),
      add: (c) => this._classes.add(c),
      remove: (c) => this._classes.delete(c),
      toggle: (c, on) => { if (on) this._classes.add(c); else this._classes.delete(c); },
    };

    // Real selects reject an unknown value and fall back to a selectable option.
    Object.defineProperty(this, 'value', {
      get: () => this._value,
      set: (v) => { this._value = this.tagName === 'SELECT' ? this._normaliseSelect(v) : String(v); },
    });

    // Real <option> text and disabled state are what the user reads.
    Object.defineProperty(this, 'textContent', {
      get: () => this._textContent,
      set: (v) => { this._textContent = String(v); },
    });
  }

  get options() {
    return this.children.filter((c) => c.tagName === 'OPTION');
  }

  /** Resolve an assigned select value the way a browser does. */
  _normaliseSelect(v) {
    const want = String(v);
    const opts = this.options;
    if (opts.some((o) => o.value === want && !o.disabled)) return want;
    if (opts.some((o) => o.value === want)) return want;
    const firstEnabled = opts.find((o) => !o.disabled);
    return firstEnabled ? firstEnabled.value : '';
  }

  appendChild(child) {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    const i = this.children.indexOf(child);
    if (i >= 0) this.children.splice(i, 1);
    child.parent = null;
    return child;
  }

  get firstChild() {
    return this.children[0] || null;
  }

  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }

  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }

  removeEventListener(type, fn) {
    const list = this.listeners.get(type);
    if (!list) return;
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }

  focus() { this.focused += 1; }
  blur() { }

  /** Fire a listener synchronously and return whatever it returns (a promise). */
  dispatch(type, event = {}) {
    const list = this.listeners.get(type);
    if (!list) return undefined;
    const ev = { type, preventDefault() { this.defaultPrevented = true; }, ...event };
    let last;
    for (const fn of [...list]) last = fn.call(this, ev);
    return last;
  }
}

/** A fake document holding a root subtree; getElementById walks it. */
function makeDocument() {
  const byId = new Map();

  function register(el) {
    if (el.id) byId.set(el.id, el);
    for (const c of el.children) register(c);
    return el;
  }

  const doc = {
    byId,
    getElementById: (id) => byId.get(id) || null,
    createElement: (tag) => new FakeElement(tag, '', doc),
  };
  return doc;
}

/**
 * Build the add view exactly as index.html declares it: the seven ids, wired as
 * a form whose submit button is type=submit. add-reason starts hidden, matching
 * the `hidden` class in the real markup.
 */
function buildAddView(doc = makeDocument()) {
  const root = new FakeElement('section', 'view-add', doc);
  const form = new FakeElement('form', 'add-form', doc);
  const amount = new FakeElement('input', 'add-amount', doc);
  const pocket = new FakeElement('select', 'add-pocket', doc);
  const note = new FakeElement('input', 'add-note', doc);
  const user = new FakeElement('select', 'add-user', doc);
  const reason = new FakeElement('p', 'add-reason', doc);
  reason.classList.add('hidden');
  const submit = new FakeElement('button', 'add-submit', doc);
  submit.setAttribute('type', 'submit');

  root.appendChild(form);
  form.appendChild(amount);
  form.appendChild(pocket);
  form.appendChild(note);
  form.appendChild(user);
  form.appendChild(reason);
  form.appendChild(submit);
  registerTree(doc, root);

  return { doc, root, form, amount, pocket, note, user, reason, submit };
}

function registerTree(doc, el) {
  if (el.id) doc.byId.set(el.id, el);
  for (const c of el.children) registerTree(doc, c);
}

/** Fake root that supports the id lookup the module falls back to. */
function makeRoot(view) {
  const root = {
    view: view.root,
    querySelector: (sel) => (sel.startsWith('#') ? view.doc.getElementById(sel.slice(1)) : null),
    getElementById: (id) => view.doc.getElementById(id),
  };
  return root;
}

/* --------------------------------------------------------------- fixtures -- */

const POCKETS = [
  { id: 'P01', name: 'Groceries', account: 'Chase', limit: 800, balance: 340.5, spent: 459.5, pctUsed: 57.44, isLocked: false },
  { id: 'P02', name: 'Gas', account: 'Chase', limit: 200, balance: 60, spent: 140, pctUsed: 70, isLocked: false },
  { id: 'P03', name: 'Dining', account: 'Amex', limit: 300, balance: 0, spent: 300, pctUsed: 100, isLocked: true },
];

const state = { pockets: POCKETS, transactions: [], summary: { users: ['Alex', 'Sam'] } };
const USERS = ['Alex', 'Sam'];

/** A deferred promise so an in-flight request can be inspected mid-flight. */
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** Spies for the callbacks the contract accepts. */
function spies() {
  const toasts = [];
  const added = [];
  const errors = [];
  return {
    toasts,
    added,
    errors,
    toast: (msg, kind) => toasts.push({ msg, kind }),
    onAdded: (arg) => added.push(arg),
    onError: (err) => errors.push(err),
  };
}

/**
 * Mount with a recording api double. `calls` is the assertion surface for the
 * double-tap test: it must stay at exactly 1.
 */
function mount(over = {}) {
  const view = buildAddView();
  const calls = [];
  const gate = deferred();
  const api = {
    calls,
    createTransaction: (t) => {
      calls.push(t);
      return over.gated ? gate.promise : Promise.resolve({ ok: true, transaction: { id: 'T1' } });
    },
  };
  const s = spies();
  const teardown = mountAddForm({
    root: makeRoot(view),
    api,
    state,
    users: USERS,
    onAdded: s.onAdded,
    onError: s.onError,
    toast: s.toast,
    ...over.opts,
  });
  return { view, api, calls, gate, teardown, ...s, doc: view.doc };
}

/* ------------------------------------------------------------------ tests -- */

test('mount focuses the amount field', () => {
  const { view } = mount();
  assert.equal(view.amount.focused, 1, 'amount must be autofocused on mount');
});

test('pocket options render with the live remaining balance', () => {
  const { view } = mount();
  const opts = view.pocket.options;
  assert.equal(opts.length, 3);
  assert.equal(opts[0].value, 'P01');
  assert.equal(opts[0].textContent, 'Groceries — ' + formatMoney(340.5) + ' left');
  assert.equal(opts[1].textContent, 'Gas — ' + formatMoney(60) + ' left');
});

test('a locked pocket is disabled in the select', () => {
  const { view } = mount();
  const dining = view.pocket.options.find((o) => o.value === 'P03');
  assert.ok(dining, 'the locked pocket must still be listed');
  assert.equal(dining.disabled, true, 'a locked pocket option must be disabled');
  // The suffix is deliberate: the option is disabled, so the label is the only
  // place the rule can be stated while the user is still choosing.
  assert.equal(dining.textContent, 'Dining — ' + formatMoney(0) + ' left (depleted)');
});

test('a locked pocket shows a "locked" hint so the rule is visible while choosing', () => {
  const { view } = mount();
  const dining = view.pocket.options.find((o) => o.value === 'P03');
  assert.match(dining.textContent, /locked|depleted/i);
});

test('updating state refreshes the live balances in the options', () => {
  const m = mount();
  updateAddFormState(m.teardown, {
    ...state,
    pockets: [POCKETS[0], { ...POCKETS[1], balance: 12.25 }],
  });
  const gas = m.view.pocket.options.find((o) => o.value === 'P02');
  assert.equal(gas.textContent, 'Gas — R12.25 left');
});

test('a pocket that becomes locked on refresh is disabled', () => {
  const m = mount();
  updateAddFormState(m.teardown, {
    ...state,
    pockets: [POCKETS[0], { ...POCKETS[1], balance: 0, isLocked: true }],
  });
  const gas = m.view.pocket.options.find((o) => o.value === 'P02');
  assert.equal(gas.disabled, true);
});

test('selecting a locked pocket disables submit and shows an inline reason', () => {
  const { view } = mount();
  view.pocket.value = 'P03';
  view.pocket.dispatch('change');

  assert.equal(view.submit.disabled, true, 'submit must be disabled for a locked pocket');
  assert.equal(view.reason.classList.contains('hidden'), false, 'the reason must be visible');
  assert.match(view.reason.textContent, /Dining/);
  assert.match(view.reason.textContent, /depleted|locked|left|no money/i);
});

test('selecting an available pocket clears the inline reason', () => {
  const { view } = mount();
  view.pocket.value = 'P03';
  view.pocket.dispatch('change');
  view.pocket.value = 'P01';
  view.pocket.dispatch('change');

  assert.equal(view.reason.classList.contains('hidden'), true);
  assert.equal(view.reason.textContent, '');
  assert.equal(view.submit.disabled, false);
});

test('the user select is populated from the users list', () => {
  const { view } = mount();
  const opts = view.user.options;
  assert.equal(opts.length, 2);
  assert.equal(opts[0].value, 'Alex');
  assert.equal(opts[1].value, 'Sam');
});

test('submit is disabled during an in-flight request: a double tap calls the api once', async () => {
  const m = mount({ gated: true });
  m.view.amount.value = '12.50';
  m.view.pocket.value = 'P01';

  const first = m.view.submit.dispatch('click');
  const second = m.view.submit.dispatch('click');

  assert.equal(m.view.submit.disabled, true, 'submit must be disabled while in flight');
  assert.equal(m.calls.length, 1, 'the double tap must not create two transactions');

  m.gate.resolve({ ok: true });
  await Promise.all([first, second]);
  assert.equal(m.view.submit.disabled, false, 'submit re-enables after the request settles');
});

test('submit is also guarded when the form submit event fires twice', async () => {
  const m = mount({ gated: true });
  m.view.amount.value = '10';
  m.view.pocket.value = 'P01';

  const a = m.view.form.dispatch('submit');
  const b = m.view.form.dispatch('submit');
  assert.equal(m.calls.length, 1);
  m.gate.resolve({ ok: true });
  await Promise.all([a, b]);
});

test('a successful add clears the amount, keeps the pocket, refocuses, and calls onAdded', async () => {
  const m = mount();
  m.view.amount.value = '25';
  m.view.note.value = 'Whole Foods';
  // Deliberately NOT the first option: if the form reset the select, the value
  // would silently fall back to P01 and "keeps the pocket selected" would still
  // look true. Choosing P02 makes a reset observable.
  m.view.pocket.value = 'P02';
  m.view.pocket.dispatch('change');
  m.view.user.value = 'Alex';
  const focusBefore = m.view.amount.focused;

  await m.view.submit.dispatch('click');

  assert.equal(m.calls.length, 1);
  assert.equal(m.calls[0].amount, 25);
  assert.equal(m.calls[0].pocketId, 'P02');
  assert.equal(m.calls[0].note, 'Whole Foods');
  assert.equal(m.calls[0].user, 'Alex');

  assert.equal(m.view.amount.value, '', 'the amount is cleared for the next entry');
  assert.equal(m.view.pocket.value, 'P02', 'the pocket stays selected — no form reset');
  assert.ok(m.view.amount.focused > focusBefore, 'the amount is refocused');
  assert.equal(m.added.length, 1, 'onAdded is called once');
  assert.equal(m.errors.length, 0);
  assert.equal(m.toasts.length, 1, 'a success toast is shown');
  assert.match(m.toasts[0].msg, /saved|added|logged/i);
});

test('the note is cleared after a successful add', async () => {
  const m = mount();
  m.view.amount.value = '25';
  m.view.note.value = 'Whole Foods';
  await m.view.submit.dispatch('click');
  assert.equal(m.view.note.value, '');
});

test('INSUFFICIENT_FUNDS surfaces err.message verbatim in the toast', async () => {
  const m = mount();
  const verbatim = 'Insufficient funds in Groceries. Remaining: R340.50';
  m.api.createTransaction = () => Promise.reject(new ApiError('INSUFFICIENT_FUNDS', verbatim, { pocketId: 'P01' }));

  m.view.amount.value = '400';
  m.view.pocket.value = 'P01';
  await m.view.submit.dispatch('click');

  assert.equal(m.toasts.length, 1);
  assert.equal(m.toasts[0].msg, verbatim, 'the brief specifies this exact string — do not reword');
  assert.equal(m.added.length, 0, 'nothing is added on failure');
});

test('an INSUFFICIENT_FUNDS message containing markup is shown as text, not reworded', async () => {
  const m = mount();
  const verbatim = 'Insufficient funds in <script>alert(1)</script>. Remaining: R0.00';
  m.api.createTransaction = () => Promise.reject(new ApiError('INSUFFICIENT_FUNDS', verbatim));

  m.view.amount.value = '5';
  await m.view.submit.dispatch('click');
  // textContent assignment can never parse markup; the value must be identical.
  assert.equal(m.toasts[0].msg, verbatim);
});

test('a non-ApiError failure calls onError with a readable message', async () => {
  const m = mount();
  m.api.createTransaction = () => Promise.reject(new ApiError('BUSY', 'Another update is in progress. Please try again.'));

  m.view.amount.value = '5';
  await m.view.submit.dispatch('click');

  assert.equal(m.errors.length, 1);
  assert.equal(m.errors[0].code, 'BUSY');
  assert.ok(m.toasts.length >= 1);
  assert.match(m.toasts[0].msg, /another update is in progress/i);
  assert.equal(m.added.length, 0);
});

test('the amount is preserved when the request fails, so the user can retry', async () => {
  const m = mount();
  m.api.createTransaction = () => Promise.reject(new ApiError('NETWORK', 'Could not reach the server.'));
  m.view.amount.value = '7.25';
  await m.view.submit.dispatch('click');
  assert.equal(m.view.amount.value, '7.25');
});

test('an invalid amount never reaches the api', async () => {
  const m = mount();
  for (const bad of ['', 'abc', '-5', '12.345']) {
    m.view.amount.value = bad;
    await m.view.submit.dispatch('click');
  }
  assert.equal(m.calls.length, 0, 'no request may be made for an invalid amount');
});

test('an invalid amount is explained inline rather than silently ignored', async () => {
  const m = mount();
  m.view.amount.value = 'abc';
  await m.view.submit.dispatch('click');
  assert.equal(m.view.reason.classList.contains('hidden'), false);
  assert.match(m.view.reason.textContent, /amount/i);
});

test('submit is disabled when there is no pocket to spend from', () => {
  const view = buildAddView();
  const s = spies();
  mountAddForm({
    root: makeRoot(view),
    api: { createTransaction: () => Promise.resolve({ ok: true }) },
    state: { pockets: [], transactions: [] },
    users: [],
    onAdded: s.onAdded,
    onError: s.onError,
    toast: s.toast,
  });
  assert.equal(view.submit.disabled, true);
  assert.equal(view.reason.classList.contains('hidden'), false);
  assert.match(view.reason.textContent, /pocket/i);
});

test('the api is not called when submit is disabled', async () => {
  const m = mount();
  m.view.pocket.value = 'P03';
  m.view.pocket.dispatch('change');
  m.view.amount.value = '5';
  await m.view.submit.dispatch('click');
  assert.equal(m.calls.length, 0);
});

test('the pocket select falls back to the first available pocket', () => {
  const { view } = mount();
  assert.equal(view.pocket.value, 'P01', 'the first unlocked pocket is pre-selected');
});

test('the pre-selected pocket is skipped when it is locked', () => {
  const m = mount();
  updateAddFormState(m.teardown, {
    ...state,
    pockets: [POCKETS[2], POCKETS[0], POCKETS[1]],
  });
  assert.equal(m.view.pocket.value, 'P01', 'a locked pocket must never be the default selection');
});

test('the selected pocket survives a state refresh', () => {
  const m = mount();
  m.view.pocket.value = 'P02';
  m.view.pocket.dispatch('change');
  updateAddFormState(m.teardown, state);
  assert.equal(m.view.pocket.value, 'P02', 'a refresh must not reset the user\'s choice');
});

test('teardown detaches the listeners and re-enables nothing further', async () => {
  const m = mount({ gated: true });
  m.teardown();
  m.view.amount.value = '5';
  await m.view.form.dispatch('submit');
  assert.equal(m.calls.length, 0, 'after teardown the form must be inert');
});

test('mountAddForm works when the ids are only reachable via a document fallback', () => {
  const view = buildAddView();
  const s = spies();
  // No root passed: the module must fall back to document.getElementById.
  const teardown = mountAddForm({
    root: { querySelector: () => null, getElementById: () => null },
    doc: view.doc,
    api: { createTransaction: () => Promise.resolve({ ok: true }) },
    state,
    users: USERS,
    onAdded: s.onAdded,
    onError: s.onError,
    toast: s.toast,
  });
  assert.equal(view.amount.focused, 1);
  assert.equal(view.pocket.options.length, 3);
  teardown();
});

test('a second submit after a success works, so two expenses can be logged in a row', async () => {
  const m = mount();
  m.view.amount.value = '5';
  m.view.pocket.value = 'P01';
  await m.view.submit.dispatch('click');
  m.view.amount.value = '6';
  await m.view.submit.dispatch('click');
  assert.equal(m.calls.length, 2);
  assert.equal(m.added.length, 2);
});
/* ----------------------------------------------------- retry idempotency -- */

/** Fill the form and press Save. */
async function save(m, amount = '12.50', pocket = 'P01') {
  m.view.amount.value = amount;
  m.view.pocket.value = pocket;
  await m.view.submit.dispatch('click');
}

test('every submission carries a requestId', async () => {
  const m = mount();
  await save(m);
  assert.match(m.calls[0].requestId, /^[A-Za-z0-9-]{8,64}$/);
});

test('retrying the SAME expense after a lost response reuses the requestId', async () => {
  const m = mount();
  m.api.createTransaction = (t) => { m.calls.push(t); return Promise.reject(new ApiError('NETWORK', 'Could not reach the server.')); };
  await save(m, '7.25');
  await m.view.submit.dispatch('click');
  assert.equal(m.calls.length, 2);
  assert.equal(m.calls[1].requestId, m.calls[0].requestId,
    'same id, so the server can recognise it as the same expense');
});

test('a TIMEOUT also keeps the requestId, and tells the user a retry is safe', async () => {
  const m = mount();
  m.api.createTransaction = (t) => { m.calls.push(t); return Promise.reject(new ApiError('TIMEOUT', 'The server took too long to respond.')); };
  await save(m);
  await m.view.submit.dispatch('click');
  assert.equal(m.calls[1].requestId, m.calls[0].requestId);
  const last = m.toasts[m.toasts.length - 1];
  assert.match(last.msg, /will not be recorded twice/i);
  assert.equal(last.kind, 'error');
});

test('changing the amount between attempts is a different expense and gets a new requestId', async () => {
  const m = mount();
  m.api.createTransaction = (t) => { m.calls.push(t); return Promise.reject(new ApiError('NETWORK', 'x')); };
  await save(m, '10');
  m.view.amount.value = '11';
  await m.view.submit.dispatch('click');
  assert.notEqual(m.calls[1].requestId, m.calls[0].requestId);
});

test('after a success the next expense gets a fresh requestId', async () => {
  const m = mount();
  await save(m, '5');
  await save(m, '5');   // identical fields, but the first one is done
  assert.equal(m.calls.length, 2);
  assert.notEqual(m.calls[1].requestId, m.calls[0].requestId);
});

test('after the server REJECTS an expense the next attempt is a new one', async () => {
  const m = mount();
  let reject = true;
  m.api.createTransaction = (t) => {
    m.calls.push(t);
    return reject ? Promise.reject(new ApiError('INSUFFICIENT_FUNDS', 'Insufficient funds in Groceries. Remaining: R1.00')) : Promise.resolve({ ok: true });
  };
  await save(m, '10');
  reject = false;
  await m.view.submit.dispatch('click');
  assert.notEqual(m.calls[1].requestId, m.calls[0].requestId, 'a refusal proves nothing was recorded');
});

test('a server rejection keeps its own wording rather than the "not confirmed" message', async () => {
  const m = mount();
  m.api.createTransaction = () => Promise.reject(new ApiError('INVALID_AMOUNT', 'Amount must be greater than zero.'));
  await save(m, '5');
  const last = m.toasts[m.toasts.length - 1];
  assert.equal(last.msg, 'Amount must be greater than zero.');
});

test('a decimal comma is sent as a decimal: "12,50" is R12.50, not R1,250', async () => {
  const m = mount();
  await save(m, '12,50');
  assert.equal(m.calls[0].amount, 12.5);
  m.view.amount.value = 'R7,5';
  await m.view.submit.dispatch('click');
  assert.equal(m.calls[1].amount, 7.5);
});
