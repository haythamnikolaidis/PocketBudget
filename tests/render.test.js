// tests/render.test.js
// Renderer tests. The escaping assertions here are the security net: `note`,
// `name`, `account`, and `user` are user-entered and land in an HTML string, so
// a regression in esc() is a stored-XSS regression, not a cosmetic one.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  esc,
  pocketCardHtml,
  activityRowHtml,
  renderPockets,
  renderActivity,
} from '../app/js/render.js';

/* ------------------------------------------------------------- fixtures -- */

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

function txn(over = {}) {
  return {
    id: 'T1001',
    timestamp: '2026-10-01T14:20:00.000Z',
    user: 'Alex',
    pocketId: 'P01',
    amount: 65.2,
    note: 'Whole Foods',
    ...over,
  };
}

/** An ISO timestamp n whole days back, so relativeDay() is stable in tests. */
function isoDaysAgo(n, hour = 12) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}

/**
 * Minimal DOM stand-in. Node has no document, so mounters are exercised through
 * a fake that records what would have been parsed and swapped in. render.js
 * reads `globalThis.document` at call time precisely so this works.
 *
 * `template.content` is a getter on purpose: in a real DOM it reflects the
 * markup most recently parsed into the template, and a fake that returns a
 * frozen object would let a broken mount() pass unnoticed.
 */
function fakeContainer() {
  return {
    replaced: 0,
    appended: 0,
    templateInner: '',
    replaceChildren(frag) {
      this.replaced += 1;
      this.templateInner = frag && typeof frag.__templateHtml === 'string'
        ? frag.__templateHtml
        : '';
    },
    get firstChild() { return this.templateInner === '' ? null : { __child: true }; },
    removeChild() {},
    appendChild(node) {
      this.appended += 1;
      this.templateInner = node && typeof node.__templateHtml === 'string'
        ? node.__templateHtml
        : '';
    },
  };
}

async function withFakeDom(fn) {
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
  try {
    return await fn(fakeContainer());
  } finally {
    if (had) globalThis.document = prev;
    else delete globalThis.document;
  }
}

/** Every `width: N%` emitted by a card, as numbers. */
function barWidths(html) {
  return [...html.matchAll(/style="width:\s*(-?[\d.]+)%/g)].map((m) => Number(m[1]));
}

/**
 * True when a payload is only ever present as inert text. Escaped output still
 * *contains* the literal substring "onerror=alert(1)" — that is harmless. What
 * matters is that no quote escaped its attribute and no tag was opened, so we
 * look for the breakout forms only.
 */
const liveAttr = (name) => new RegExp(`${name}\\s*=\\s*["']`, 'i');

/** The `disabled` ATTRIBUTE (not a Tailwind `disabled:` variant class). */
const DISABLED_ATTR = /(?<![-\w])disabled(?![\w:-])/;
function buttonTags(html) {
  return [...html.matchAll(/<button\b[^>]*>/g)].map((m) => m[0]);
}

/* ------------------------------------------------------------------ esc -- */

test('esc neutralises a script tag', () => {
  assert.equal(esc('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.doesNotMatch(esc('<script>alert(1)</script>'), /<script/i);
});

test('esc replaces all five dangerous characters', () => {
  assert.equal(esc('&'), '&amp;');
  assert.equal(esc('<'), '&lt;');
  assert.equal(esc('>'), '&gt;');
  assert.equal(esc('"'), '&quot;');
  assert.equal(esc("'"), '&#39;');
  assert.equal(esc('a & b < c > d " e \' f'), 'a &amp; b &lt; c &gt; d &quot; e &#39; f');
});

test('esc escapes the ampersand first so entities are not double-encoded by accident', () => {
  // '&lt;' must become '&amp;lt;' — a single pass, ampersand handled first.
  assert.equal(esc('&lt;'), '&amp;lt;');
});

test('esc turns nullish into an empty string but keeps 0 and false', () => {
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
  assert.equal(esc(0), '0');
  assert.equal(esc(false), 'false');
});

/* ------------------------------------------------------- pocket card HTML -- */

test('pocketCardHtml escapes a name carrying an img onerror payload', () => {
  const html = pocketCardHtml({ ...POCKET, name: '<img src=x onerror=alert(1)>' });
  assert.doesNotMatch(html, /<img/i);
  assert.doesNotMatch(html, liveAttr('onerror'), 'payload broke out into a live attribute');
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'), html);
  // The card still has exactly one element per known part; nothing extra opened.
  assert.equal(buttonTags(html).length, 1);
  assert.equal((html.match(/<h3\b/g) || []).length, 1);
});

test('pocketCardHtml escapes the account name too', () => {
  const html = pocketCardHtml({ ...POCKET, account: '"><script>alert(2)</script>' });
  assert.doesNotMatch(html, /<script/i);
  assert.ok(html.includes('&lt;script&gt;alert(2)&lt;/script&gt;'), html);
});

test('pocketCardHtml shows the balance of the limit, formatted as money', () => {
  const html = pocketCardHtml(POCKET);
  assert.ok(html.includes('$340.50'), 'balance');
  assert.ok(html.includes('$800.00'), 'limit');
  assert.match(html, /\$340\.50[\s\S]{0,80}of[\s\S]{0,80}\$800\.00/);
});

test('pocketCardHtml renders a progress bar at pctUsed percent', () => {
  const html = pocketCardHtml(POCKET);
  assert.ok(html.includes('width: 57.44%'), html);
});

test('pocketCardHtml clamps the progress width to 100 when pctUsed exceeds 100', () => {
  const html = pocketCardHtml({ ...POCKET, limit: 100, balance: 0, spent: 143.2, pctUsed: 143.2 });
  const widths = barWidths(html);
  assert.deepEqual(widths, [100], `expected one clamped bar, got ${widths}`);
  assert.ok(widths.every((w) => w >= 0 && w <= 100), 'bar overflowed its track');
  assert.ok(html.includes('width: 100%'), html);
  // aria-valuenow must not lie about the clamped geometry either.
  assert.ok(html.includes('aria-valuenow="100"'), html);
  // The honest number is still reported in the label: 143.2% used.
  assert.ok(html.includes('143.2% used'), html);
});

test('pocketCardHtml clamps a negative pctUsed to zero rather than a negative bar', () => {
  const html = pocketCardHtml({ ...POCKET, pctUsed: -12 });
  assert.deepEqual(barWidths(html), [0], html);
  assert.doesNotMatch(html, /width: -/);
});

test('pocketCardHtml colours by threshold: emerald below 60', () => {
  const html = pocketCardHtml({ ...POCKET, pctUsed: 59.9 });
  assert.ok(html.includes('bg-emerald-500'), html);
  assert.doesNotMatch(html, /bg-amber-500|bg-rose-500/);
});

test('pocketCardHtml colours exactly 60 as amber', () => {
  const html = pocketCardHtml({ ...POCKET, pctUsed: 60 });
  assert.ok(html.includes('bg-amber-500'), html);
  assert.doesNotMatch(html, /bg-emerald-500|bg-rose-500/);
});

test('pocketCardHtml colours exactly 85 as amber', () => {
  const html = pocketCardHtml({ ...POCKET, pctUsed: 85 });
  assert.ok(html.includes('bg-amber-500'), html);
  assert.doesNotMatch(html, /bg-emerald-500|bg-rose-500/);
});

test('pocketCardHtml colours 85.1 as rose', () => {
  const html = pocketCardHtml({ ...POCKET, pctUsed: 85.1 });
  assert.ok(html.includes('bg-rose-500'), html);
  assert.doesNotMatch(html, /bg-emerald-500|bg-amber-500/);
});

test('pocketCardHtml shows a percentage label via formatPct', () => {
  assert.ok(pocketCardHtml({ ...POCKET, pctUsed: 57.44 }).includes('57.4%'));
});

test('pocketCardHtml on a locked pocket is rose, badged, and its affordance disabled', () => {
  const html = pocketCardHtml({ ...POCKET, balance: 0, isLocked: true });
  assert.ok(html.includes('bg-rose-500'), html);
  assert.ok(/Depleted/.test(html), 'Depleted badge');
  const [btn] = buttonTags(html);
  assert.match(btn, DISABLED_ATTR, 'add/select affordance must carry the disabled attribute');
  assert.match(btn, /aria-disabled="true"/);
});

test('pocketCardHtml on an unlocked pocket leaves the affordance enabled', () => {
  const html = pocketCardHtml(POCKET);
  const [btn] = buttonTags(html);
  assert.match(btn, /data-action="select-pocket"/);
  assert.match(btn, /data-pocket-id="P01"/);
  assert.doesNotMatch(btn, DISABLED_ATTR,
    'unlocked pocket must not render a disabled attribute');
  assert.doesNotMatch(btn, /aria-disabled/);
  assert.doesNotMatch(html, /Depleted/);
});

test('pocketCardHtml survives a pocket with missing numeric fields', () => {
  const html = pocketCardHtml({ id: 'P09', name: 'No Numbers' });
  assert.ok(html.includes('width: 0%'), html);
  assert.ok(html.includes('$0.00'), html);
});

/* ---------------------------------------------------- activity row HTML -- */

test('activityRowHtml escapes a note containing a script tag', () => {
  const html = activityRowHtml(txn({ note: '<script>alert(1)</script>' }), { P01: 'Groceries' });
  assert.doesNotMatch(html, /<script/i);
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), html);
});

test("activityRowHtml shows a '<b>x</b>' note escaped, never as a live tag", () => {
  const html = activityRowHtml(txn({ note: '<b>x</b>' }), { P01: 'Groceries' });
  assert.doesNotMatch(html, /<b[\s>]/i);
  assert.ok(html.includes('&lt;b&gt;x&lt;/b&gt;'), html);
});

test('activityRowHtml escapes the user name', () => {
  const html = activityRowHtml(txn({ user: '"><img src=x onerror=alert(1)>' }), {});
  assert.doesNotMatch(html, /<img/i);
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'), html);
});

test('activityRowHtml escapes the transaction id inside data-txn-id', () => {
  const html = activityRowHtml(txn({ id: 'T" onmouseover="alert(1)' }), {});
  assert.doesNotMatch(html, liveAttr('onmouseover'), 'id broke out into a live attribute');
  assert.ok(html.includes('data-txn-id="T&quot; onmouseover=&quot;alert(1)"'), html);
  // The id is used twice (row + delete button) and never opens a new tag.
  assert.equal((html.match(/data-txn-id=/g) || []).length, 2);
  assert.equal(buttonTags(html).length, 1);
});

test('activityRowHtml shows user, formatted amount, note, and relative day', () => {
  const html = activityRowHtml(txn({ timestamp: isoDaysAgo(0) }), { P01: 'Groceries' });
  assert.ok(html.includes('Alex'), 'user tag');
  assert.ok(html.includes('$65.20'), 'amount');
  assert.ok(html.includes('Whole Foods'), 'note');
  assert.ok(html.includes('Today'), 'relativeDay');
});

test('activityRowHtml renders the day from relativeDay (yesterday and dated)', () => {
  assert.ok(activityRowHtml(txn({ timestamp: isoDaysAgo(1) }), {}).includes('Yesterday'));
  const older = activityRowHtml(txn({ timestamp: isoDaysAgo(9) }), {});
  assert.ok(/[A-Z][a-z]{2} \d{1,2}/.test(older), older);
});

test('activityRowHtml resolves the pocket name from the lookup map', () => {
  const html = activityRowHtml(txn({ pocketId: 'P02' }), { P01: 'Groceries', P02: 'Dining Out' });
  assert.ok(html.includes('Dining Out'), html);
  assert.doesNotMatch(html, />\s*P02\s*</);
});

test('activityRowHtml falls back to the raw pocketId when the name is unknown', () => {
  const html = activityRowHtml(txn({ pocketId: 'P77' }), { P01: 'Groceries' });
  assert.ok(html.includes('P77'), html);
});

test('activityRowHtml falls back gracefully when no lookup map is supplied', () => {
  const html = activityRowHtml(txn({ pocketId: 'P01' }));
  assert.ok(html.includes('P01'), html);
});

test('activityRowHtml carries a delete affordance keyed by data-txn-id', () => {
  const html = activityRowHtml(txn({ id: 'T1001' }), {});
  assert.match(html, /data-action="delete-txn"/);
  assert.ok(html.includes('data-txn-id="T1001"'), html);
  assert.match(html, /<button[^>]*data-action="delete-txn"/);
});

test('activityRowHtml omits the note line and any dangling separator when the note is empty', () => {
  const html = activityRowHtml(txn({ note: '' }), { P01: 'Groceries' });
  assert.doesNotMatch(html, /pb-row__note[^>]*>\s*</, 'empty note element rendered');
  assert.doesNotMatch(html, /·\s*·/, 'dangling separator');
  assert.equal(html.split('·').length - 1, 1, 'exactly one separator, between pocket and day');
  assert.ok(html.includes('Groceries') && html.includes('Today'), html);
});

test('activityRowHtml omits the note line when the note is nullish', () => {
  for (const note of [null, undefined, '   ']) {
    const html = activityRowHtml(txn({ note }), { P01: 'Groceries' });
    assert.doesNotMatch(html, /pb-row__note[^>]*>\s*</, `note=${JSON.stringify(note)}`);
    assert.doesNotMatch(html, /·\s*·/, `note=${JSON.stringify(note)}`);
  }
});

/* ------------------------------------------------------------- mounting -- */

test('renderPockets mounts every pocket card into the container', async () => {
  await withFakeDom(async (container) => {
    const second = { ...POCKET, id: 'P02', name: 'Dining Out' };
    renderPockets(container, [POCKET, second]);

    assert.equal(container.replaced, 1, 'container must be swapped in exactly once');
    const html = container.templateInner;
    // A grid/layout wrapper around the cards is fine; the cards themselves
    // must all be present, in order, and nothing else may be rendered.
    assert.ok(html.includes(pocketCardHtml(POCKET)), 'first card missing');
    assert.ok(html.includes(pocketCardHtml(second)), 'second card missing');
    assert.ok(html.indexOf('data-pocket-id="P01"') < html.indexOf('data-pocket-id="P02"'),
      'cards rendered out of order');
    assert.equal((html.match(/<article\b/g) || []).length, 2, 'extra or missing cards');
  });
});

test('renderPockets output stays escaped after mounting', async () => {
  await withFakeDom(async (container) => {
    renderPockets(container, [{ ...POCKET, name: '<img src=x onerror=alert(1)>' }]);
    assert.doesNotMatch(container.templateInner, /<img/i);
    assert.ok(container.templateInner.includes('&lt;img'));
  });
});

test('renderPockets renders an empty state for no pockets', async () => {
  await withFakeDom(async (container) => {
    renderPockets(container, []);
    assert.match(container.templateInner, /No pockets/i);
  });
});

test('renderPockets tolerates a missing pocket list', async () => {
  await withFakeDom(async (container) => {
    renderPockets(container);
    assert.equal(typeof container.templateInner, 'string');
  });
});

test('renderActivity groups rows under Today then Yesterday, newest first', async () => {
  await withFakeDom(async (container) => {
    renderActivity(container, [
      txn({ id: 'T1', timestamp: isoDaysAgo(0, 14), note: 'newest' }),
      txn({ id: 'T2', timestamp: isoDaysAgo(0, 9), note: 'also today' }),
      txn({ id: 'T3', timestamp: isoDaysAgo(1, 18), note: 'yesterday' }),
    ]);
    const html = container.templateInner;
    assert.ok(html.includes('>Today<'), html);
    assert.ok(html.includes('>Yesterday<'), html);
    assert.ok(html.indexOf('>Today<') < html.indexOf('>Yesterday<'), 'headings out of order');
    assert.ok(html.indexOf('newest') < html.indexOf('also today'), 'today rows out of order');
    assert.ok(html.indexOf('also today') < html.indexOf('yesterday'), 'grouping broken');
  });
});

test('renderActivity keeps each day in its own heading section', async () => {
  await withFakeDom(async (container) => {
    renderActivity(container, [
      txn({ id: 'T1', timestamp: isoDaysAgo(0) }),
      txn({ id: 'T3', timestamp: isoDaysAgo(1) }),
      txn({ id: 'T9', timestamp: isoDaysAgo(6) }),
    ]);
    const html = container.templateInner;
    const today = html.indexOf('>Today<');
    const yesterday = html.indexOf('>Yesterday<');
    const dated = html.search(/>[A-Z][a-z]{2} \d{1,2}</);
    assert.ok(today !== -1 && yesterday !== -1 && dated !== -1, html);
    assert.ok(today < yesterday && yesterday < dated, 'day headings not in newest-first order');
    assert.equal(html.match(/pb-day__heading/g).length, 3, 'one heading per day group');
  });
});

test('renderActivity renders an empty state for no transactions', async () => {
  await withFakeDom(async (container) => {
    renderActivity(container, []);
    assert.match(container.templateInner, /No activity/i);
  });
});

test('renderActivity tolerates a missing transaction list', async () => {
  await withFakeDom(async (container) => {
    renderActivity(container);
    assert.equal(typeof container.templateInner, 'string');
  });
});

test('renderers are inert when handed no container', () => {
  assert.equal(renderPockets(null, [POCKET]), undefined);
  assert.equal(renderActivity(undefined, [txn()]), undefined);
});