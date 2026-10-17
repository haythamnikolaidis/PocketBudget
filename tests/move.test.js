import test from 'node:test';
import assert from 'node:assert/strict';
import { activePockets, moveProblem, movePreview, quickAmounts, mountMove } from '../app/js/move.js';

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

function harness({ transferFunds } = {}) {
  const els = Object.fromEntries(IDS.map((id) => [id, new El(id.endsWith('from') || id.endsWith('to') ? 'select' : 'div', id)]));
  const doc = {
    getElementById: (id) => els[id] || null,
    createElement: (tag) => new El(tag),
  };
  const calls = [];
  const toasts = [];
  let done = 0;
  const api = {
    transferFunds: (p) => { calls.push(p); return transferFunds ? transferFunds(p) : Promise.resolve({ ok: true }); },
  };
  const screen = mountMove({
    root: null,
    api,
    getState: () => state,
    getUser: () => 'Sam',
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
