// tests/household.test.js
// The Household section of the Manage tab: the pure name rules (they mirror the
// backend's checkUsers) and the section wired into mountManage.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  householdNames, addName, removeName, sameNames, householdHtml,
  MAX_HOUSEHOLD_NAMES, MAX_HOUSEHOLD_NAME_LENGTH,
} from '../app/js/household.js';
import { mountManage, updateManageState } from '../app/js/manage.js';
import { ApiError } from '../app/js/api.js';

/* ----------------------------------------------------------- pure rules -- */

test('householdNames keeps trimmed, non-empty strings and nothing else', () => {
  assert.deepEqual(householdNames([' Alex ', '', null, 'Sam']), ['Alex', 'Sam']);
  assert.deepEqual(householdNames(undefined), []);
  assert.deepEqual(householdNames('Alex'), []);
});

test('addName trims and appends', () => {
  assert.deepEqual(addName(['Alex'], '  Sam '), { list: ['Alex', 'Sam'] });
  assert.deepEqual(addName([], 'Alex'), { list: ['Alex'] });
});

test('addName does not change the list it was given', () => {
  const list = ['Alex'];
  addName(list, 'Sam');
  assert.deepEqual(list, ['Alex']);
});

test('addName refuses a blank name', () => {
  for (const raw of ['', '   ', null, undefined]) {
    const r = addName(['Alex'], raw);
    assert.deepEqual(r.list, ['Alex']);
    assert.ok(r.error);
  }
});

test('addName refuses a duplicate, ignoring case and surrounding spaces', () => {
  const r = addName(['Alex'], ' aLEX ');
  assert.deepEqual(r.list, ['Alex']);
  assert.match(r.error, /already/);
});

test('addName refuses a comma', () => {
  const r = addName([], 'Alex, Sam');
  assert.deepEqual(r.list, []);
  assert.match(r.error, /comma/);
});

test('addName allows 30 characters and refuses 31', () => {
  assert.equal(addName([], 'a'.repeat(MAX_HOUSEHOLD_NAME_LENGTH)).error, undefined);
  const r = addName([], 'a'.repeat(MAX_HOUSEHOLD_NAME_LENGTH + 1));
  assert.deepEqual(r.list, []);
  assert.match(r.error, /30/);
});

test('addName allows ten names and refuses an eleventh', () => {
  let list = [];
  for (let i = 0; i < MAX_HOUSEHOLD_NAMES; i += 1) {
    const r = addName(list, `Person${i}`);
    assert.equal(r.error, undefined);
    list = r.list;
  }
  const r = addName(list, 'Extra');
  assert.equal(r.list.length, MAX_HOUSEHOLD_NAMES);
  assert.match(r.error, /10/);
});

test('removeName drops one name and ignores an unknown one', () => {
  assert.deepEqual(removeName(['Alex', 'Sam'], 'Alex'), ['Sam']);
  assert.deepEqual(removeName(['Alex'], 'Nobody'), ['Alex']);
});

test('sameNames compares order and content', () => {
  assert.equal(sameNames(['Alex', 'Sam'], ['Alex', 'Sam']), true);
  assert.equal(sameNames(['Alex', 'Sam'], ['Sam', 'Alex']), false);
  assert.equal(sameNames([], undefined), true);
});

test('householdHtml escapes names and carries a Remove button per name', () => {
  const html = householdHtml(['<img src=x onerror=1>', 'Sam']);
  assert.ok(!html.includes('<img'));
  assert.match(html, /&lt;img/);
  assert.equal((html.match(/data-action="remove-user"/g) || []).length, 2);
  assert.match(html, /data-name="Sam"/);
});

test('householdHtml shows a prompt, not an empty list, when there are no names', () => {
  const html = householdHtml([]);
  assert.match(html, /No one yet/);
  assert.ok(!html.includes('<ul'));
});

/* ------------------------------------------------------------ the section -- */

function makeEl(id = '') {
  const el = {
    id, value: '', textContent: '', disabled: false, dataset: {}, classes: new Set(),
    handlers: new Map(), html: '',
    classList: {
      add(...n) { n.forEach((x) => el.classes.add(x)); },
      remove(...n) { n.forEach((x) => el.classes.delete(x)); },
      contains(n) { return el.classes.has(n); },
    },
    addEventListener(type, fn) {
      if (!el.handlers.has(type)) el.handlers.set(type, []);
      el.handlers.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const list = el.handlers.get(type) || [];
      const i = list.indexOf(fn);
      if (i !== -1) list.splice(i, 1);
    },
    replaceChildren(frag) { el.html = frag && typeof frag.__templateHtml === 'string' ? frag.__templateHtml : ''; },
    appendChild(node) { el.html = node && typeof node.__templateHtml === 'string' ? node.__templateHtml : ''; },
    get firstChild() { return el.html === '' ? null : { __child: true }; },
    removeChild() {},
    focus() {},
    closest() { return null; },
  };
  return el;
}

function fakeShell() {
  const ids = ['household-list', 'household-form', 'household-name', 'household-reason', 'household-save'];
  const nodes = {};
  for (const id of ids) nodes[id] = makeEl(id);
  nodes['household-reason'].classes.add('hidden');
  const root = makeEl('root');
  root.querySelector = (sel) => nodes[String(sel).replace(/^#/, '')] || null;
  return { root, nodes };
}

async function withFakeDom(fn) {
  const had = Object.prototype.hasOwnProperty.call(globalThis, 'document');
  const prev = globalThis.document;
  globalThis.document = {
    createElement(tag) {
      const tpl = { tagName: String(tag).toUpperCase(), innerHTML: '' };
      Object.defineProperty(tpl, 'content', { get() { return { __templateHtml: tpl.innerHTML }; } });
      return tpl;
    },
  };
  try {
    return await fn();
  } finally {
    if (had) globalThis.document = prev;
    else delete globalThis.document;
  }
}

const stateWith = (users) => ({ month: '2026-10', pockets: [], transactions: [], summary: { users } });

function mount({ users = [], api } = {}) {
  const shell = fakeShell();
  const calls = [];
  const toasts = [];
  let changed = 0;
  const fakeApi = api || { async updateUsers(list) { calls.push(list); return { users: list }; } };
  const teardown = mountManage({
    root: shell.root,
    api: fakeApi,
    state: stateWith(users),
    onChanged: () => { changed += 1; },
    toast: (m) => toasts.push(m),
  });
  const n = shell.nodes;
  const fire = (el, type, ev) => Promise.all((el.handlers.get(type) || []).map((fn) => fn(ev)));
  return {
    n, teardown, calls, toasts, changed: () => changed,
    add(name) {
      n['household-name'].value = name;
      return fire(n['household-form'], 'submit', { type: 'submit', preventDefault() {} });
    },
    remove(name) {
      const target = { dataset: { action: 'remove-user', name }, closest: () => target };
      return fire(n['household-list'], 'click', { type: 'click', target });
    },
    save: () => fire(n['household-save'], 'click', { type: 'click' }),
  };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test('the section lists the household from state', async () => {
  await withFakeDom(async () => {
    const m = mount({ users: ['Alex', 'Sam'] });
    assert.match(m.n['household-list'].html, /Alex/);
    assert.match(m.n['household-list'].html, /Sam/);
    assert.equal(m.n['household-save'].disabled, true, 'nothing to save yet');
  });
});

test('an empty household shows the prompt', async () => {
  await withFakeDom(async () => {
    const m = mount({ users: [] });
    assert.match(m.n['household-list'].html, /No one yet/);
  });
});

test('adding a name lists it, clears the input and enables Save', async () => {
  await withFakeDom(async () => {
    const m = mount({ users: ['Alex'] });
    await m.add('  Sam ');
    assert.match(m.n['household-list'].html, /Sam/);
    assert.equal(m.n['household-name'].value, '');
    assert.equal(m.n['household-save'].disabled, false);
    assert.equal(m.calls.length, 0, 'nothing is sent until Save');
  });
});

test('a bad name shows the reason and leaves the list alone', async () => {
  await withFakeDom(async () => {
    const m = mount({ users: ['Alex'] });
    await m.add('alex');
    assert.match(m.n['household-reason'].textContent, /already/);
    assert.equal(m.n['household-reason'].classes.has('hidden'), false);
    assert.equal(m.n['household-save'].disabled, true);
  });
});

test('removing a name drops it from the list', async () => {
  await withFakeDom(async () => {
    const m = mount({ users: ['Alex', 'Sam'] });
    await m.remove('Alex');
    assert.doesNotMatch(m.n['household-list'].html, /Alex/);
    assert.match(m.n['household-list'].html, /Sam/);
    assert.equal(m.n['household-save'].disabled, false);
  });
});

test('Save sends the list, toasts, and asks for a state refresh', async () => {
  await withFakeDom(async () => {
    const m = mount({ users: ['Alex'] });
    await m.add('Sam');
    await m.save();
    await settle();
    assert.deepEqual(m.calls, [['Alex', 'Sam']]);
    assert.deepEqual(m.toasts, ['Household saved.']);
    assert.equal(m.changed(), 1);
    assert.equal(m.n['household-save'].disabled, true, 'saved: nothing left to save');
  });
});

test('Save shows the backend message when the list is refused', async () => {
  await withFakeDom(async () => {
    const api = { async updateUsers() { throw new ApiError('INVALID_USERS', 'Add at least one household member.'); } };
    const m = mount({ users: ['Alex'], api });
    await m.remove('Alex');
    await m.save();
    await settle();
    assert.equal(m.n['household-reason'].textContent, 'Add at least one household member.');
    assert.equal(m.n['household-reason'].classes.has('hidden'), false);
    assert.equal(m.changed(), 0);
    assert.equal(m.n['household-save'].disabled, false, 'can be retried');
  });
});

test('a refreshed state replaces a clean list but not a half-edited one', async () => {
  await withFakeDom(async () => {
    const m = mount({ users: ['Alex'] });
    updateManageState(m.teardown, stateWith(['Alex', 'Sam']));
    assert.match(m.n['household-list'].html, /Sam/, 'clean list follows the server');

    await m.add('Robin');
    updateManageState(m.teardown, stateWith(['Alex', 'Sam', 'Pat']));
    assert.match(m.n['household-list'].html, /Robin/, 'the edit survives a refresh');
    assert.doesNotMatch(m.n['household-list'].html, /Pat/);
  });
});
