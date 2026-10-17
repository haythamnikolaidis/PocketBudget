import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activePockets, moveProblem, movePreview, quickAmounts, mountMove, actingUser, moveFailureMessage,
} from '../app/js/move.js';
import { makeApi, ApiError } from '../app/js/api.js';
import { makeConfig } from '../app/js/config.js';

const state = {
  pockets: [
    { id: 'P1', name: 'Groceries', balance: 150 },
    { id: 'P2', name: 'Fun', balance: 0.1 },
    { id: 'P3', name: 'Old', balance: 50, status: 'Archived' },
  ],
};

test('activePockets drops archived pockets and keeps order', () => {
  assert.deepEqual(activePockets(state).map((p) => p.id), ['P1', 'P2']);
  assert.deepEqual(activePockets(null), []);
});

test('moveProblem: same or missing pocket', () => {
  assert.equal(moveProblem(state, 'P1', 'P1', '10'), 'Choose two different pockets.');
  assert.equal(moveProblem(state, 'P1', '', '10'), 'Choose two different pockets.');
  assert.equal(moveProblem(state, 'P1', 'P3', '10'), 'Choose two different pockets.');
});

test('moveProblem: amount must be greater than zero', () => {
  for (const text of ['', '0', 'abc', '-5']) {
    assert.equal(moveProblem(state, 'P1', 'P2', text), 'Enter an amount greater than zero.');
  }
});

test('moveProblem: not more than the source holds', () => {
  assert.equal(moveProblem(state, 'P1', 'P2', '150.01'), 'Only R150.00 left in Groceries.');
  assert.equal(moveProblem(state, 'P1', 'P2', '150'), null);
});

test('movePreview works in cents', () => {
  const s = { pockets: [{ id: 'A', name: 'A', balance: 0.1 }, { id: 'B', name: 'B', balance: 0.2 }] };
  const p = movePreview(s, 'A', 'B', '0.10');
  assert.deepEqual(p, {
    from: { name: 'A', before: 0.1, after: 0 },
    to: { name: 'B', before: 0.2, after: 0.3 },
  });
  assert.equal(movePreview(s, 'A', 'B', '0'), null);
  assert.equal(movePreview(s, 'A', 'A', '1'), null);
});

test('quickAmounts', () => {
  assert.deepEqual(quickAmounts(150), [100, { all: 150 }]);
  assert.deepEqual(quickAmounts(0), []);
  assert.deepEqual(quickAmounts(500), [100, 200, 300, { all: 500 }]);
});

/* ------------------------------------------------------------ the screen -- */

class El {
  constructor(tag, id = '') {
    this.tagName = tag.toUpperCase();
    this.id = id;
    this.children = [];
    this.listeners = {};
    this.disabled = false;
    this.value = '';
    this.className = '';
    this.classes = new Set(['hidden']);
    this.classList = {
      toggle: (c, on) => { if (on) this.classes.add(c); else this.classes.delete(c); },
    };
    this._text = '';
  }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
  set textContent(v) { this._text = String(v); this.children = []; }
  appendChild(c) { this.children.push(c); return c; }
  addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); }
  async fire(t) { await Promise.all((this.listeners[t] || []).map((fn) => fn({ type: t }))); }
}

const IDS = ['move-from', 'move-to', 'move-swap', 'move-amount', 'move-quick', 'move-note',
  'move-preview', 'move-reason', 'move-submit'];

function harness({ transferFunds, getUser = () => 'Sam', apiOverride = null, screenState = state } = {}) {
  const els = Object.fromEntries(IDS.map((id) => [id, new El(id.endsWith('from') || id.endsWith('to') ? 'select' : 'div', id)]));
  const doc = {
    getElementById: (id) => els[id] || null,
    createElement: (tag) => new El(tag),
  };
  const calls = [];
  const toasts = [];
  let done = 0;
  const api = apiOverride || {
    transferFunds: (p) => { calls.push(p); return transferFunds ? transferFunds(p) : Promise.resolve({ ok: true }); },
  };
  const screen = mountMove({
    root: null,
    api,
    getState: () => screenState,
    getUser,
    onDone: () => { done += 1; },
    toast: (message, kind) => toasts.push([message, kind]),
    doc,
  });
  return { els, screen, calls, toasts, done: () => done };
}

async function type(els, text) {
  els['move-amount'].value = text;
  await els['move-amount'].fire('input');
}

test('open fills both selects and selects the source pocket', () => {
  const h = harness();
  h.screen.open('P2');
  assert.equal(h.els['move-from'].value, 'P2');
  assert.equal(h.els['move-to'].value, 'P1');
  assert.equal(h.els['move-from'].children.length, 2);
  assert.equal(h.els['move-from'].children[0].textContent, 'Groceries \u2014 R150.00 left');
  assert.equal(h.els['move-submit'].disabled, true);
});

test('typing redraws the preview, chips and submit button', async () => {
  const h = harness();
  h.screen.open('P1');
  await type(h.els, '100');
  assert.equal(h.els['move-submit'].disabled, false);
  assert.equal(h.els['move-submit'].textContent, 'Move R100.00');
  assert.match(h.els['move-preview'].textContent, /R150\.00 \u2192 R50\.00/);
  assert.deepEqual(h.els['move-quick'].children.map((c) => c.textContent), ['R100', 'All R150.00']);

  await type(h.els, '999');
  assert.equal(h.els['move-submit'].disabled, true);
  assert.equal(h.els['move-reason'].textContent, 'Only R150.00 left in Groceries.');
  assert.equal(h.els['move-reason'].classes.has('hidden'), false);
});

test('a double submit calls transferFunds once', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const h = harness({ transferFunds: async () => { await gate; return { ok: true }; } });
  h.screen.open('P1');
  await type(h.els, '50');
  const first = h.els['move-submit'].fire('click');
  const second = h.els['move-submit'].fire('click');
  release();
  await Promise.all([first, second]);
  assert.equal(h.calls.length, 1);
  assert.equal(h.done(), 1);
  assert.deepEqual(h.toasts, [['Moved R50.00 to Fun.', 'success']]);
});

test('the payload is complete and a retry with the same values reuses the requestId', async () => {
  let attempt = 0;
  const h = harness({
    transferFunds: async () => {
      attempt += 1;
      if (attempt === 1) throw new Error('Network down');
      return { ok: true };
    },
  });
  h.screen.open('P1');
  await type(h.els, '25.50');
  h.els['move-note'].value = ' Braai ';
  await h.els['move-submit'].fire('click');
  assert.deepEqual(h.toasts[0], ['Network down', 'error']);
  assert.equal(h.done(), 0);
  assert.equal(h.els['move-submit'].disabled, false);

  await h.els['move-submit'].fire('click');
  assert.equal(h.calls.length, 2);
  const [a, b] = h.calls;
  assert.deepEqual(
    { ...a, requestId: undefined },
    { user: 'Sam', fromPocketId: 'P1', toPocketId: 'P2', amount: 25.5, note: 'Braai', requestId: undefined },
  );
  assert.ok(a.requestId && typeof a.requestId === 'string');
  assert.equal(b.requestId, a.requestId);
  assert.equal(h.done(), 1);

  await type(h.els, '10');
  await h.els['move-submit'].fire('click');
  assert.notEqual(h.calls[2].requestId, a.requestId);
});

test('swap exchanges the two pockets', async () => {
  const h = harness();
  h.screen.open('P1');
  await h.els['move-swap'].fire('click');
  assert.equal(h.els['move-from'].value, 'P2');
  assert.equal(h.els['move-to'].value, 'P1');
});

/* ------------------------------------------------------ the acting user -- */

test('actingUser keeps a remembered name the server lists', () => {
  assert.equal(actingUser('Sam', ['Alex', 'Sam']), 'Sam');
});

test('actingUser ignores a remembered name that is not a household member', () => {
  assert.equal(actingUser('Les', ['Alex', 'Sam']), 'Alex');
  assert.equal(actingUser('', ['Alex', 'Sam']), 'Alex');
  assert.equal(actingUser(null, ['Alex', 'Sam']), 'Alex');
});

test('actingUser with no household list passes the remembered name through', () => {
  assert.equal(actingUser('Sam', undefined), 'Sam');
  assert.equal(actingUser('Sam', []), 'Sam');
  assert.equal(actingUser(null, []), '');
});

test('moveFailureMessage explains an unknown user and passes other errors through', () => {
  assert.equal(
    moveFailureMessage(new ApiError('INVALID_USER', 'Unknown user: Les'), 'Les'),
    '"Les" is not a household member. Pick your name on the Add screen, then try again.',
  );
  assert.equal(moveFailureMessage(new ApiError('BUSY', 'Another update is in progress.'), 'Sam'), 'Another update is in progress.');
  assert.equal(moveFailureMessage(null, 'Sam'), 'Could not move the money.');
});

test('Move money puts the acting user on the wire, never a pocket or bank-account field', async () => {
  const pockets = {
    pockets: [
      { id: 'P1', name: 'Groceries', account: 'Les', balance: 150 },
      { id: 'P2', name: 'Fun', account: 'Ivan', balance: 10 },
    ],
  };
  const sent = [];
  const fetchImpl = async (url, opts) => {
    sent.push({ url, opts, body: JSON.parse(opts.body) });
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  const store = { getItem: (k) => ({ 'pb.endpoint': 'https://script.google.com/macros/s/ABC/exec', 'pb.token': 'tok' })[k] ?? null, setItem: () => {} };
  const api = makeApi(makeConfig({ store }), { fetchImpl });
  const h = harness({
    apiOverride: api,
    screenState: pockets,
    getUser: () => actingUser('Les', ['Alex', 'Sam']),
  });
  const { els, screen } = h;
  screen.open('P1');
  await type(els, '25.50');
  els['move-note'].value = 'Braai';
  await els['move-submit'].fire('click');
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(sent.length, 1);
  const body = sent[0].body;
  assert.equal(body.action, 'transferFunds');
  assert.equal(body.user, 'Alex');
  assert.notEqual(body.user, 'Les');
  assert.notEqual(body.user, 'Ivan');
  assert.deepEqual(
    { ...body, requestId: undefined },
    {
      action: 'transferFunds', token: 'tok', user: 'Alex', fromPocketId: 'P1', toPocketId: 'P2',
      amount: 25.5, note: 'Braai', requestId: undefined,
    },
  );
  assert.ok(typeof body.requestId === 'string' && body.requestId.length >= 8);
  assert.deepEqual(h.toasts, [['Moved R25.50 to Fun.', 'success']]);
});

test('an unknown-user rejection from the server shows a clear toast', async () => {
  const h = harness({
    getUser: () => 'Les',
    transferFunds: async () => { throw new ApiError('INVALID_USER', 'Unknown user: Les'); },
  });
  h.screen.open('P1');
  await type(h.els, '10');
  await h.els['move-submit'].fire('click');
  assert.deepEqual(h.toasts, [['"Les" is not a household member. Pick your name on the Add screen, then try again.', 'error']]);
  assert.equal(h.done(), 0);
});

test('with no acting user nothing is sent and the person is told', async () => {
  const h = harness({ getUser: () => '' });
  h.screen.open('P1');
  await type(h.els, '10');
  await h.els['move-submit'].fire('click');
  assert.equal(h.calls.length, 0);
  assert.equal(h.toasts[0][1], 'error');
});
