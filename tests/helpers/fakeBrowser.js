// tests/helpers/fakeBrowser.js
// A DOM stub good enough to boot the real app.js and prove it starts.
//
// The blank-page bug was invisible to unit tests because boot() takes every
// dependency by injection and nothing ever called it in a browser. These stubs
// mirror the real index.html structure closely enough that a missing auto-boot
// or an un-revealed view fails the suite.

import { readFileSync } from 'node:fs';

/** Parse id="..." out of the shell so the fake DOM matches reality. */
function idsFromShell() {
  const html = readFileSync(new URL('../../app/index.html', import.meta.url), 'utf8');
  return [...html.matchAll(/id="([\w-]+)"/g)].map((m) => m[1]);
}

class FakeClassList {
  constructor(el) { this.el = el; }
  add(...c) { for (const x of c) if (!this.el._classes.has(x)) this.el._classes.add(x); }
  remove(...c) { for (const x of c) this.el._classes.delete(x); }
  contains(c) { return this.el._classes.has(c); }
  toggle(c, force) {
    const has = this.el._classes.has(c);
    const want = force === undefined ? !has : Boolean(force);
    if (want) this.el._classes.add(c); else this.el._classes.delete(c);
    return want;
  }
  get value() { return [...this.el._classes].join(' '); }
}

class FakeElement {
  constructor(id, tag = 'div') {
    this.id = id;
    this.tagName = tag.toUpperCase();
    this._classes = new Set();
    this._children = [];
    this.textContent = '';
    this.value = '';
    this.disabled = false;
    this.hidden = false;
    this.innerHTML = '';
    this.attributes = {};
    this.classList = new FakeClassList(this);
    this.listeners = {};
  }
  set className(v) { this._classes = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get className() { return this.classList.value; }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return this.attributes[k] ?? null; }
  removeAttribute(k) { delete this.attributes[k]; }
  appendChild(c) { this._children.push(c); return c; }
  addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); }
  removeEventListener(t, fn) {
    this.listeners[t] = (this.listeners[t] || []).filter((f) => f !== fn);
  }
  dispatch(t, ev = {}) {
    for (const fn of this.listeners[t] || []) fn({ type: t, target: this, preventDefault() {}, ...ev });
  }
  /** Fire the listener async-safe: catches async handlers that reject. */
  async fire(t, ev = {}) {
    const results = (this.listeners[t] || []).map((fn) => fn({ type: t, target: this, preventDefault() {}, ...ev }));
    await Promise.allSettled(results);
  }
  querySelector(sel) {
    const want = sel.replace(/^#/, '');
    return this._findById(want);
  }
  querySelectorAll(sel) {
    const found = this._findAllById(sel.replace(/^#/, ''));
    return { length: found.length, forEach: (f) => found.forEach(f), [Symbol.iterator]: function* () { yield* found; } };
  }
  _findById(id) {
    if (this.id === id) return this;
    for (const c of this._children) { const f = c._findById?.(id); if (f) return f; }
    return null;
  }
  _findAllById(id) {
    const out = this.id === id ? [this] : [];
    for (const c of this._children) out.push(...(c._findAllById?.(id) || []));
    return out;
  }
  focus() { this.focused = true; }
  click() { this.dispatch('click'); }
  closest() { return null; }
  get innerText() { return this.textContent; }
}

/**
 * Build a document mirroring the shell's ids, plus a call counter.
 */
export function makeBootDom({ configured = false, throwOn = null } = {}) {
  const root = new FakeElement('root');
  for (const id of idsFromShell()) root.appendChild(new FakeElement(id));

  // Mirror the markup's initial classes: every view ships hidden.
  for (const v of ['view-setup', 'view-home', 'view-add', 'view-manage']) {
    root._findById(v)?.classList.add('hidden');
  }
  root._findById('version-banner')?.classList.add('hidden');
  root._findById('stale-banner')?.classList.add('hidden');

  const calls = { getState: 0, ping: 0 };
  const byId = (id) => root._findById(id);

  const doc = {
    readyState: 'complete',
    documentElement: root,
    body: root,
    getElementById: byId,
    querySelector: (s) => root.querySelector(s),
    querySelectorAll: (s) => root.querySelectorAll(s),
    createElement: (tag) => new FakeElement('', tag),
    addEventListener() {},
    removeEventListener() {},
  };

  return { doc, root, byId, calls, configured, throwOn };
}

export { FakeElement, FakeClassList };
