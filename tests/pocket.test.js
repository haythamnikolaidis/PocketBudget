// tests/pocket.test.js
// The pocket detail screen: pure HTML builder and its thin mount.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pocketDetailHtml, mountPocket } from '../app/js/pocket.js';

const NOW = new Date('2026-11-15T10:00:00');

const POCKETS = [
  { id: 'P01', name: 'Groceries', account: 'FNB Cheque', rule: 'Carry' },
  { id: 'P02', name: 'Dining Out', account: 'Visa', rule: 'Reset' },
  { id: 'P09', name: 'Holiday', account: '', rule: 'Reset', kind: 'Savings' },
];

function data(over = {}) {
  return {
    pocket: { id: 'P01', name: 'Groceries', account: 'FNB Cheque', limit: 4000, balance: 1980, carriedIn: 120, available: 4120, rule: 'Carry', sweepTo: '' },
    breakdown: { limit: 4000, carriedIn: 120, movedIn: 200, movedOut: 0, spent: 2340, count: 14, left: 1980 },
    transactions: [],
    adjustments: [],
    ...over,
  };
}

const html = (d, month = '2026-11', opts = {}) => pocketDetailHtml(d, month, { pockets: POCKETS, now: NOW, ...opts });

test('header line names the funding account and the month', () => {
  assert.match(html(data()), /Funded from FNB Cheque · November/);
});

test('header line drops the account when there is none', () => {
  const d = data();
  d.pocket.account = '';
  const out = html(d);
  assert.match(out, /<p class="pb-pd__sub">November<\/p>/);
  assert.doesNotMatch(out, /Funded from/);
});

test('breakdown shows every non-zero line with its sign and the previous month', () => {
  const out = html(data());
  assert.match(out, />Monthly limit<\/span><span class="pb-pd__val">R4,000\.00</);
  assert.match(out, />Carried in from October<\/span><span class="pb-pd__val pb-pd__val--in">\+ R120\.00</);
  assert.match(out, />Moved in<\/span><span class="pb-pd__val pb-pd__val--in">\+ R200\.00</);
  assert.match(out, />Spent \(14 expenses\)<\/span><span class="pb-pd__val">− R2,340\.00</);
  assert.match(out, /pb-pd__big">R1,980\.00</);
});

test('zero lines are hidden', () => {
  const d = data({ breakdown: { limit: 0, carriedIn: 0, movedIn: 0, movedOut: 0, spent: 0, count: 0, left: 50 } });
  const out = html(d);
  for (const label of ['Monthly limit', 'Carried in', 'Moved in', 'Moved out', 'Spent']) {
    assert.doesNotMatch(out, new RegExp(label), `${label} should be hidden`);
  }
  assert.match(out, /pb-pd__total">Left</);
});

test('moved out shows with a minus, and one expense is singular', () => {
  const d = data({ breakdown: { limit: 100, carriedIn: 0, movedIn: 0, movedOut: 30, spent: 10, count: 1, left: 60 } });
  const out = html(d);
  assert.match(out, />Moved out<\/span><span class="pb-pd__val">− R30\.00</);
  assert.match(out, /Spent \(1 expense\)/);
});

test('the leftover rule is named under "At month end"', () => {
  assert.match(html(data()), /At month end<\/h2>.*Carries over/);
  const sweep = data();
  sweep.pocket.rule = 'Sweep';
  sweep.pocket.sweepTo = 'P09';
  assert.match(html(sweep), /Goes to Holiday/);
  const reset = data();
  reset.pocket.rule = 'Reset';
  assert.match(html(reset), /Resets/);
});

test('transactions and adjustments merge newest first, with Moved and Carried tags', () => {
  const d = data({
    transactions: [
      { id: 'T3', timestamp: '2026-11-14T09:00:00', user: 'Sam', note: 'Checkers', amount: 900 },
      { id: 'T1', timestamp: '2026-11-05T09:00:00', user: 'Alex', note: 'Spar', amount: 141 },
    ],
    adjustments: [
      { id: 'A1', timestamp: '2026-11-13T09:00:00', user: 'Alex', month: '2026-11', type: 'transfer', fromPocketId: 'P02', toPocketId: 'P01', amount: 200, note: 'Big braai' },
      { id: 'A0', timestamp: '2026-11-01T00:05:00', user: '', month: '2026-11', type: 'carry', fromPocketId: '', toPocketId: 'P01', amount: 120, note: '' },
    ],
  });
  const out = html(d);
  const order = ['Checkers', 'From Dining Out', 'Spar', 'Left over from October'].map((w) => out.indexOf(w));
  assert.ok(order.every((i) => i >= 0), 'every row is present: ' + order);
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'rows are newest first');
  assert.match(out, /pb-pd__adj">Moved</);
  assert.match(out, /pb-pd__adj">Carried</);
  assert.match(out, /pb-pd__who">Sam</);
  assert.match(out, /pb-pd__amt pb-pd__amt--in">\+R200\.00</);
  assert.match(out, /“Big braai” · Nov 13 · Alex/);
});

test('a move out of the pocket is signed negative and names the destination', () => {
  const d = data({
    adjustments: [
      { id: 'A2', timestamp: '2026-11-13T09:00:00', user: 'Sam', month: '2026-11', type: 'transfer', fromPocketId: 'P01', toPocketId: 'P02', amount: 75.5, note: '' },
    ],
  });
  const out = html(d);
  assert.match(out, /To Dining Out/);
  assert.match(out, /pb-pd__amt">−R75\.50</);
});

test('only the newest 20 rows are listed, with a count of the rest', () => {
  const transactions = Array.from({ length: 25 }, (_, i) => ({
    id: 'T' + i, timestamp: `2026-11-${String(i + 1).padStart(2, '0')}T08:00:00`, user: 'Sam', note: 'Item ' + i, amount: 1,
  }));
  const out = html(data({ transactions }));
  assert.equal((out.match(/class="pb-pd__row"/g) || []).length, 20);
  assert.match(out, /Item 24/);
  assert.doesNotMatch(out, />Item 4</);
  assert.match(out, /Showing 20 of 25/);
});

test('an empty month says so', () => {
  assert.match(html(data()), /Nothing yet this month\./);
});

test('every user-typed value is escaped', () => {
  const evil = '<img src=x onerror=alert(1)>';
  const d = data({
    pocket: { id: 'P01', name: evil, account: evil, limit: 10, balance: 5, rule: 'Sweep', sweepTo: 'P77' },
    transactions: [{ id: 'T1', timestamp: '2026-11-14T09:00:00', user: evil, note: evil, amount: 1 }],
    adjustments: [{ id: 'A1', timestamp: '2026-11-13T09:00:00', user: evil, month: '2026-11', type: 'transfer', fromPocketId: 'P66', toPocketId: 'P01', amount: 2, note: evil }],
  });
  const out = pocketDetailHtml(d, '2026-11', {
    pockets: [{ id: 'P66', name: evil }, { id: 'P77', name: evil }],
    now: NOW,
  });
  assert.doesNotMatch(out, /<img/);
  assert.ok(out.includes('&lt;img src=x onerror=alert(1)&gt;'));
});

test('missing data renders without throwing', () => {
  assert.doesNotThrow(() => pocketDetailHtml(null, ''));
  assert.doesNotThrow(() => pocketDetailHtml({}, 'nonsense'));
});

/* ---------------------------------------------------------------- mount -- */

function fakeEl(id) {
  const listeners = {};
  return {
    id,
    textContent: '',
    html: '',
    children: [],
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    fire(type, ev = {}) { for (const fn of listeners[type] || []) fn(ev); },
    replaceChildren(node) { this.html = node.__html; },
  };
}

function mountHarness(api, state = { month: '2026-11', pockets: POCKETS }) {
  const els = {};
  for (const id of ['pocket-body', 'pocket-heading', 'pocket-add', 'pocket-move', 'pocket-settings']) els[id] = fakeEl(id);
  const root = { querySelector: (sel) => els[sel.slice(1)] || null };
  const calls = { add: [], move: [], settings: [] };
  globalThis.document = {
    createElement: () => ({
      set innerHTML(value) { this.content = { __html: value }; },
    }),
  };
  const screen = mountPocket({
    root,
    api,
    getState: () => state,
    onAdd: (id) => calls.add.push(id),
    onMove: (id) => calls.move.push(id),
    onSettings: (id) => calls.settings.push(id),
  });
  return { els, calls, screen };
}

test('open() loads the pocket for the state month and paints it', async (t) => {
  t.after(() => { delete globalThis.document; });
  const asked = [];
  const api = { getPocket: async (id, month) => { asked.push([id, month]); return data(); } };
  const { els, screen } = mountHarness(api);
  await screen.open('P01');
  assert.deepEqual(asked, [['P01', '2026-11']]);
  assert.equal(els['pocket-heading'].textContent, 'Groceries');
  assert.match(els['pocket-body'].html, /Funded from FNB Cheque/);
});

test('the buttons report the open pocket; before open() they do nothing', async (t) => {
  t.after(() => { delete globalThis.document; });
  const { els, calls, screen } = mountHarness({ getPocket: async () => data() });
  els['pocket-add'].fire('click');
  assert.deepEqual(calls.add, []);
  await screen.open('P01');
  els['pocket-add'].fire('click');
  els['pocket-move'].fire('click');
  els['pocket-settings'].fire('click');
  els['pocket-body'].fire('click', { target: { closest: (sel) => (sel === '[data-action="pocket-settings"]' ? {} : null) } });
  assert.deepEqual(calls.add, ['P01']);
  assert.deepEqual(calls.move, ['P01']);
  assert.deepEqual(calls.settings, ['P01', 'P01']);
});

test('a failed load shows the reason, escaped', async (t) => {
  t.after(() => { delete globalThis.document; });
  const { els, screen } = mountHarness({ getPocket: async () => { throw new Error('<b>Offline</b>'); } });
  await screen.open('P01');
  assert.match(els['pocket-body'].html, /Could not load this pocket\. &lt;b&gt;Offline&lt;\/b&gt;/);
});

test('a slow answer for a pocket you already left never paints over the new one', async (t) => {
  t.after(() => { delete globalThis.document; });
  const slow = [];
  const api = {
    getPocket: (id) => new Promise((resolve) => {
      slow.push(() => resolve(data({ pocket: { ...data().pocket, id, name: id === 'P01' ? 'First' : 'Second' } })));
    }),
  };
  const { els, screen } = mountHarness(api);
  const first = screen.open('P01');
  const second = screen.open('P02');
  await new Promise((resolve) => setImmediate(resolve));
  slow[1]();
  await second;
  slow[0]();
  await first;
  assert.equal(els['pocket-heading'].textContent, 'Second');
});
