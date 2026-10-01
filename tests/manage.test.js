// tests/manage.test.js
// Pocket management screen.
//
// Two of these tests are the load-bearing ones:
//   * the limit-clamp warning, because the backend silently pulls the balance
//     down to the new limit and a user who did not know that would think the
//     app had lost their money;
//   * the no-hard-delete assertion, because transactions reference pockets and
//     a real delete would orphan a family's history.
//
// Node has no DOM, so the mounters are exercised through the tiny stub below.
// No npm dependencies: the whole fake is 60 lines of plain objects.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { mountManage } from '../app/js/manage.js';
import { ApiError } from '../app/js/api.js';

/* ------------------------------------------------------------- fake DOM -- */

function makeEl(id = '') {
  const el = {
    id,
    value: '',
    textContent: '',
    disabled: false,
    type: '',
    focused: false,
    dataset: {},
    classes: new Set(),
    handlers: new Map(),
    html: '',          // last markup swapped into this container
    classList: {
      add(...names) { names.forEach((n) => el.classes.add(n)); },
      remove(...names) { names.forEach((n) => el.classes.delete(n)); },
      contains(name) { return el.classes.has(name); },
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
    replaceChildren(frag) {
      el.html = frag && typeof frag.__templateHtml === 'string' ? frag.__templateHtml : '';
    },
    appendChild(node) {
      el.html = node && typeof node.__templateHtml === 'string' ? node.__templateHtml : '';
    },
    get firstChild() { return el.html === '' ? null : { __child: true }; },
    removeChild() {},
    focus() { el.focused = true; },
    /** The module never calls closest() on a container, only on event targets. */
    closest() { return null; },
  };
  return el;
}

/**
 * The shell from index.html: root owns the seven ids via querySelector, exactly
 * as the browser resolves them. `manage-reason` ships with the `hidden` class,
 * which the real markup also carries.
 */
function fakeShell() {
  const ids = ['manage-list', 'manage-form', 'manage-name', 'manage-account',
               'manage-limit', 'manage-submit', 'manage-reason'];
  const nodes = {};
  for (const id of ids) nodes[id] = makeEl(id);
  nodes['manage-form'].type = 'form';
  nodes['manage-submit'].type = 'submit';
  nodes['manage-submit'].textContent = 'Create pocket';
  nodes['manage-reason'].classes.add('hidden');

  const root = makeEl('root');
  root.querySelector = (sel) => nodes[String(sel).replace(/^#/, '')] || null;
  return { root, nodes };
}

/** render.js-style template stub: `content` mirrors the markup just parsed. */
function withFakeDom(fn) {
  const had = Object.prototype.hasOwnProperty.call(globalThis, 'document');
  const prev = globalThis.document;
  globalThis.document = {
    createElement(tag) {
      const tpl = { tagName: String(tag).toUpperCase(), innerHTML: '' };
      Object.defineProperty(tpl, 'content', {
        get() { return { __templateHtml: tpl.innerHTML }; },
      });
      return tpl;
    },
  };
  return Promise.resolve(fn()).finally(() => {
    if (had) globalThis.document = prev;
    else delete globalThis.document;
  });
}

/** A click that lands on a delegated [data-action] button. */
function clickOn(action, pocketId) {
  const target = {
    dataset: { action, pocketId },
    closest(sel) { return sel === '[data-action]' ? target : null; },
  };
  return { type: 'click', target, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
}

const submitEvent = () => ({
  type: 'submit',
  defaultPrevented: false,
  preventDefault() { this.defaultPrevented = true; },
});

const fire = (el, type, ev) => {
  const list = el.handlers.get(type) || [];
  return list.map((fn) => fn(ev));
};

/* ------------------------------------------------------------ fixtures -- */

const POCKET = {
  id: 'P01',
  name: 'Groceries',
  account: 'Chase Checking',
  limit: 800,
  balance: 340.5,
  spent: 459.5,
  pctUsed: 57.44,
  isLocked: false,
};

const OTHER = {
  id: 'P02',
  name: 'Gas',
  account: '',
  limit: 120,
  balance: 120,
  spent: 0,
  pctUsed: 0,
  isLocked: false,
};

function stateWith(pockets) {
  return { month: '2026-10', pockets, transactions: [], summary: {} };
}

function fakeApi(overrides = {}) {
  const calls = { createPocket: [], updatePocket: [] };
  return {
    calls,
    async createPocket(p) { calls.createPocket.push(p); return { ok: true, pocket: p }; },
    async updatePocket(p) { calls.updatePocket.push(p); return { ok: true, pocket: p }; },
    ...overrides,
  };
}

/** Record every confirm() prompt and answer it with `answer`. */
function withConfirm(answer, fn) {
  const prev = globalThis.confirm;
  const prompts = [];
  globalThis.confirm = (message) => { prompts.push(message); return answer; };
  return Promise.resolve(fn(prompts)).finally(() => {
    if (prev === undefined) delete globalThis.confirm;
    else globalThis.confirm = prev;
  });
}

async function mount(pockets, { api = fakeApi(), state = stateWith(pockets), onChanged, toast } = {}) {
  const shell = fakeShell();
  let changed = 0;
  const toasts = [];
  const teardown = mountManage({
    root: shell.root,
    api,
    state,
    onChanged: onChanged || (() => { changed += 1; }),
    toast: toast || ((msg) => { toasts.push(msg); }),
  });
  return {
    ...shell,
    api,
    teardown,
    changedCount: () => changed,
    toasts,
    async submit() { await Promise.all(fire(shell.nodes['manage-form'], 'submit', submitEvent())); },
    async click(action, pocketId) { await Promise.all(fire(shell.nodes['manage-list'], 'click', clickOn(action, pocketId))); },
    type(name, value) { shell.nodes[`manage-${name}`].value = value; },
  };
}

/* ------------------------------------------------------------------ list -- */

test('mounting lists each pocket with its formatted balance', async () => {
  await withFakeDom(async () => {
    const m = await mount([POCKET, OTHER]);
    assert.match(m.nodes['manage-list'].html, /Groceries/);
    assert.match(m.nodes['manage-list'].html, /\$340\.50/, 'balance of P01 is formatted');
    assert.match(m.nodes['manage-list'].html, /\$800\.00/, 'limit of P01 is formatted');
    assert.match(m.nodes['manage-list'].html, /Gas/);
    assert.match(m.nodes['manage-list'].html, /\$120\.00/);
  });
});

test('every listed pocket row carries an Edit and an Archive action', async () => {
  await withFakeDom(async () => {
    const m = await mount([POCKET, OTHER]);
    const html = m.nodes['manage-list'].html;
    assert.equal((html.match(/data-action="edit"/g) || []).length, 2);
    assert.equal((html.match(/data-action="archive"/g) || []).length, 2);
    assert.match(html, /data-pocket-id="P01"/);
    assert.match(html, /data-pocket-id="P02"/);
  });
});

test('an archived pocket is not listed and cannot be edited', async () => {
  await withFakeDom(async () => {
    const archived = { ...POCKET, id: 'P09', name: 'Old car fund', status: 'Archived' };
    const m = await mount([POCKET, archived]);
    assert.doesNotMatch(m.nodes['manage-list'].html, /Old car fund/);

    // Even if a stale click arrives for it, nothing is sent to the server.
    await m.click('edit', 'P09');
    assert.equal(m.changedCount(), 0);
    assert.equal(m.api.calls.updatePocket.length, 0);
    assert.notEqual(m.nodes['manage-submit'].textContent, 'Save changes');
  });
});

test('pocket names are escaped, not injected as markup', async () => {
  await withFakeDom(async () => {
    const m = await mount([{ ...POCKET, name: '<img src=x onerror=alert(1)>' }]);
    const html = m.nodes['manage-list'].html;
    assert.doesNotMatch(html, /<img/i);
    assert.match(html, /&lt;img/);
  });
});

/* -------------------------------------------------------------- creation -- */

test('an empty name blocks submission and never reaches the api', async () => {
  await withFakeDom(async () => {
    const m = await mount([]);
    m.type('name', '   ');
    m.type('limit', '250');
    await m.submit();
    assert.equal(m.api.calls.createPocket.length, 0);
    assert.equal(m.changedCount(), 0);
    assert.ok(m.nodes['manage-reason'].textContent.length > 0, 'a reason is shown');
    assert.ok(!m.nodes['manage-reason'].classes.has('hidden'), 'the reason is visible');
  });
});

test('an invalid monthly limit blocks submission and never reaches the api', async () => {
  for (const bad of ['', 'abc', '0', '-5', '1.234']) {
    await withFakeDom(async () => {
      const m = await mount([]);
      m.type('name', 'Utilities');
      m.type('limit', bad);
      await m.submit();
      assert.equal(m.api.calls.createPocket.length, 0, `limit ${JSON.stringify(bad)} must be rejected`);
      assert.equal(m.changedCount(), 0);
    });
  }
});

test('creating a pocket trims the fields, sends a numeric limit, then calls onChanged', async () => {
  await withFakeDom(async () => {
    const m = await mount([]);
    m.type('name', '  Groceries  ');
    m.type('account', '  Chase Checking  ');
    m.type('limit', ' 1,200.50 ');
    await m.submit();

    assert.equal(m.api.calls.createPocket.length, 1);
    assert.deepEqual(m.api.calls.createPocket[0], {
      name: 'Groceries',
      account: 'Chase Checking',
      limit: 1200.5,
    });
    assert.equal(typeof m.api.calls.createPocket[0].limit, 'number', 'limit crosses as a number');
    assert.equal(m.changedCount(), 1);
    assert.equal(m.nodes['manage-name'].value, '', 'the form clears after a successful create');
  });
});

test('the account is optional', async () => {
  await withFakeDom(async () => {
    const m = await mount([]);
    m.type('name', 'Cash');
    m.type('account', '   ');
    m.type('limit', '40');
    await m.submit();
    assert.equal(m.api.calls.createPocket.length, 1);
    assert.equal(m.api.calls.createPocket[0].account, '');
  });
});

test('an ApiError from createPocket surfaces a readable message and skips onChanged', async () => {
  await withFakeDom(async () => {
    const api = fakeApi({
      createPocket: async () => { throw new ApiError('INVALID_NAME', 'Pocket name is required.'); },
    });
    const m = await mount([], { api });
    m.type('name', 'Groceries');
    m.type('limit', '250');
    await m.submit();

    const shown = m.nodes['manage-reason'].textContent;
    assert.match(shown, /Pocket name is required\./, 'the server message reaches the user verbatim');
    assert.ok(!m.nodes['manage-reason'].classes.has('hidden'));
    assert.equal(m.changedCount(), 0, 'a failed create must not announce a change');
  });
});

/* --------------------------------------------------------------- archive -- */

test('archive confirms that the pocket is hidden but its transactions are kept', async () => {
  await withFakeDom(() => withConfirm(true, async (prompts) => {
    const m = await mount([POCKET, OTHER]);
    await m.click('archive', 'P02');

    assert.equal(prompts.length, 1);
    assert.match(prompts[0], /Gas/);
    assert.match(prompts[0], /hidden/i);
    assert.match(prompts[0], /transactions are kept/i);
  }));
});

test('archive calls api.updatePocket with archive:true and the right pocketId', async () => {
  await withFakeDom(() => withConfirm(true, async () => {
    const m = await mount([POCKET, OTHER]);
    await m.click('archive', 'P02');

    assert.equal(m.api.calls.updatePocket.length, 1);
    assert.deepEqual(m.api.calls.updatePocket[0], { pocketId: 'P02', archive: true });
    assert.equal(m.changedCount(), 1);
  }));
});

test('declining the archive confirm sends nothing to the server', async () => {
  await withFakeDom(() => withConfirm(false, async () => {
    const m = await mount([POCKET]);
    await m.click('archive', 'P01');
    assert.equal(m.api.calls.updatePocket.length, 0);
    assert.equal(m.changedCount(), 0);
  }));
});

/* -------------------------------------------------- limit change warning -- */

test('lowering the limit below the balance warns that the balance will be reduced', async () => {
  await withFakeDom(() => withConfirm(true, async (prompts) => {
    const m = await mount([POCKET]);   // balance 340.50, limit 800

    await m.click('edit', 'P01');

    // The live warning appears as soon as the field drops below the balance,
    // before the user has committed to anything.
    m.type('limit', '50');
    await Promise.all(fire(m.nodes['manage-limit'], 'input', { target: m.nodes['manage-limit'] }));
    const live = m.nodes['manage-reason'].textContent;
    assert.match(live, /\$50\.00/, 'the warning names the new limit');
    assert.match(live, /\$340\.50/, 'the warning names the balance that is about to drop');
    assert.equal(m.api.calls.updatePocket.length, 0, 'typing a limit changes nothing on its own');

    await m.submit();

    assert.equal(prompts.length, 1);
    const msg = prompts[0];
    assert.match(msg, /balance/i);
    assert.match(msg, /reduce/i, 'the wording says the balance goes down, not just that it changes');
    assert.match(msg, /\$50\.00/, 'both figures are in the confirm text');
    assert.match(msg, /\$340\.50/);

    assert.equal(m.api.calls.updatePocket.length, 1);
    assert.deepEqual(m.api.calls.updatePocket[0], { pocketId: 'P01', name: 'Groceries', account: 'Chase Checking', limit: 50 });
    assert.equal(m.changedCount(), 1);
  }));
});

test('declining the clamp warning cancels the limit change', async () => {
  await withFakeDom(() => withConfirm(false, async () => {
    const m = await mount([POCKET]);
    await m.click('edit', 'P01');
    m.type('limit', '50');
    await m.submit();
    assert.equal(m.api.calls.updatePocket.length, 0);
  }));
});

test('raising a limit above the balance needs no clamp warning', async () => {
  await withFakeDom(() => withConfirm(true, async (prompts) => {
    const m = await mount([POCKET]);
    await m.click('edit', 'P01');
    m.type('limit', '900');
    await m.submit();
    assert.equal(prompts.length, 0, 'no balance-clamp prompt when the balance survives');
    assert.deepEqual(m.api.calls.updatePocket[0], { pocketId: 'P01', name: 'Groceries', account: 'Chase Checking', limit: 900 });
  }));
});

test('editing renames and re-limits a pocket, and the second Edit click cancels', async () => {
  await withFakeDom(() => withConfirm(true, async () => {
    const m = await mount([POCKET]);
    await m.click('edit', 'P01');
    assert.equal(m.nodes['manage-submit'].textContent, 'Save changes');
    assert.equal(m.nodes['manage-name'].value, 'Groceries');
    assert.equal(m.nodes['manage-limit'].value, '800');

    await m.click('edit', 'P01');   // toggle off
    assert.equal(m.nodes['manage-submit'].textContent, 'Create pocket');
    assert.equal(m.nodes['manage-name'].value, '');
    assert.equal(m.api.calls.updatePocket.length, 0);

    await m.click('edit', 'P01');
    m.type('name', '  Food  ');
    m.type('account', '  Amex  ');
    m.type('limit', '600');
    await m.submit();
    assert.deepEqual(m.api.calls.updatePocket[0], { pocketId: 'P01', name: 'Food', account: 'Amex', limit: 600 });
    assert.equal(m.nodes['manage-submit'].textContent, 'Create pocket', 'the form returns to create mode');
  }));
});

/* ---------------------------------------------------------- no hard delete -- */

test('the module renders no hard-delete control', async () => {
  await withFakeDom(() => withConfirm(true, async () => {
    const m = await mount([POCKET, OTHER]);
    await m.click('edit', 'P01');
    await m.click('archive', 'P02');

    const surfaces = [m.nodes['manage-list'].html, m.nodes['manage-form'].outerHTML || ''];
    for (const html of surfaces) {
      assert.doesNotMatch(html, /delete/i, 'no markup may mention delete');
    }

    const actions = [...m.nodes['manage-list'].html.matchAll(/data-action="([^"]+)"/g)].map((x) => x[1]);
    assert.deepEqual([...new Set(actions)].sort(), ['archive', 'edit']);

    // The api double only ever saw the two documented write calls.
    assert.deepEqual(Object.keys(m.api.calls).sort(), ['createPocket', 'updatePocket']);
    for (const call of [...m.api.calls.createPocket, ...m.api.calls.updatePocket]) {
      assert.equal(call.delete, undefined);
    }
  }));
});

test('teardown removes every listener it registered', async () => {
  await withFakeDom(async () => {
    const m = await mount([POCKET]);
    const before = [...m.nodes['manage-form'].handlers.values(), ...m.nodes['manage-list'].handlers.values()]
      .reduce((n, list) => n + list.length, 0);
    assert.ok(before > 0, 'the module registered listeners');
    m.teardown();
    const after = [...m.nodes['manage-form'].handlers.values(), ...m.nodes['manage-list'].handlers.values()]
      .reduce((n, list) => n + list.length, 0);
    assert.equal(after, 0);
  });
});