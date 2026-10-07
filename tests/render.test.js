// tests/render.test.js
// Renderer tests. The escaping assertions here are the security net: `note`,
// `name`, `account`, and `user` are user-entered and land in an HTML string, so
// a regression in esc() is a stored-XSS regression, not a cosmetic one.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  esc,
  pocketRowHtml,
  pocketStatus,
  summaryHtml,
  dayLabel,
  renderSummary,
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

/* -------------------------------------------------------- pocket row HTML -- */

/** Day 7 of a 31-day month: 22.58% elapsed, so 77.4% of a limit should be left. */
const PACE = { day: 7, daysInMonth: 31, daysLeft: 24, elapsedPct: (7 / 31) * 100 };

/** A pocket by how much of its 1000 limit is spent. */
const spentPct = (pct, over = {}) => ({
  ...POCKET,
  limit: 1000,
  balance: 1000 - pct * 10,
  spent: pct * 10,
  pctUsed: pct,
  isLocked: false,
  ...over,
});

test('pocketRowHtml escapes a name carrying an img onerror payload', () => {
  const html = pocketRowHtml({ ...POCKET, name: '<img src=x onerror=alert(1)>' });
  assert.doesNotMatch(html, /<img/i);
  assert.doesNotMatch(html, liveAttr('onerror'), 'payload broke out into a live attribute');
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'), html);
  // The row is one button; nothing extra opened.
  assert.equal(buttonTags(html).length, 1);
});

test('pocketRowHtml escapes the account name, including the data attribute copy', () => {
  const html = pocketRowHtml({ ...POCKET, account: '"><script>alert(2)</script>' });
  assert.doesNotMatch(html, /<script/i);
  assert.ok(html.includes('&lt;script&gt;alert(2)&lt;/script&gt;'), html);
  assert.doesNotMatch(html, liveAttr('onerror'));
});

test('pocketRowHtml leads with the amount LEFT, then the limit, in whole rands', () => {
  const html = pocketRowHtml(POCKET);
  assert.match(html, /pb-pocket__left">R340</, 'balance, rounded down');
  assert.match(html, /\/ R800</, 'limit');
  assert.doesNotMatch(html.replace(/aria-label="[^"]*"/, ''), /R340\.50|R800\.00/, 'no cents on screen');
  assert.doesNotMatch(html.replace(/aria-label="[^"]*"/, ''), /\bof\b/, 'no "X of Y" phrasing on screen');
  assert.ok(buttonTags(html)[0].includes('R340.50'), 'exact balance stays in the accessible label');
});

test('pocketRowHtml keeps cents for amounts under R10', () => {
  assert.match(pocketRowHtml({ ...POCKET, balance: 2.5 }), /pb-pocket__left">R2\.50</);
});

test('pocketRowHtml bar shows money left, not money used', () => {
  const html = pocketRowHtml(POCKET);   // 340.5 of 800 left = 42.5625%
  assert.ok(html.includes('width: 42.56%'), html);
  assert.ok(html.includes('aria-valuenow="42.56"'), html);
});

test('pocketRowHtml clamps the bar to the track when the balance exceeds the limit', () => {
  const html = pocketRowHtml({ ...POCKET, limit: 100, balance: 143.2 });
  assert.deepEqual(barWidths(html), [100], html);
});

test('pocketRowHtml clamps a negative balance to an empty bar', () => {
  const html = pocketRowHtml({ ...POCKET, balance: -5 });
  assert.deepEqual(barWidths(html), [0], html);
  assert.doesNotMatch(html, /width: -/);
});

test('pocketRowHtml draws the pace tick where money left should be today', () => {
  const html = pocketRowHtml(POCKET, PACE);
  assert.match(html, /pb-pocket__tick[^>]*left: 77\.42%/, html);
});

test('pocketRowHtml draws no tick when pace is unknown', () => {
  assert.doesNotMatch(pocketRowHtml(POCKET, null), /pb-pocket__tick/);
});

test('pocketRowHtml gives every non-ok status a word as well as a colour', () => {
  assert.doesNotMatch(pocketRowHtml(spentPct(20), PACE), /pb-pocket__pill/);
  assert.match(pocketRowHtml(spentPct(50), PACE), /Spending fast/);
  assert.match(pocketRowHtml(spentPct(70), PACE), /Running low/);
  assert.match(pocketRowHtml(spentPct(100, { balance: 0, isLocked: true }), PACE), /Depleted/);
});

test('pocketRowHtml colours the fill by status', () => {
  assert.ok(pocketRowHtml(spentPct(20), PACE).includes('bg-emerald-500'));
  assert.ok(pocketRowHtml(spentPct(50), PACE).includes('bg-amber-500'));
  assert.ok(pocketRowHtml(spentPct(70), PACE).includes('bg-rose-500'));
});

test('pocketRowHtml on a locked pocket is disabled, tickless and empty', () => {
  const html = pocketRowHtml({ ...POCKET, balance: 0, isLocked: true }, PACE);
  const [btn] = buttonTags(html);
  assert.match(btn, DISABLED_ATTR, 'row must carry the disabled attribute');
  assert.match(btn, /aria-disabled="true"/);
  assert.ok(html.includes('bg-rose-500'));
  assert.deepEqual(barWidths(html), [0]);
  assert.doesNotMatch(html, /pb-pocket__tick/);
});

test('pocketRowHtml on an unlocked pocket is an enabled select-pocket target', () => {
  const [btn] = buttonTags(pocketRowHtml(POCKET));
  assert.match(btn, /data-action="select-pocket"/);
  assert.match(btn, /data-pocket-id="P01"/);
  assert.doesNotMatch(btn, DISABLED_ATTR, 'unlocked pocket must not render a disabled attribute');
  assert.doesNotMatch(btn, /aria-disabled/);
});

test('pocketRowHtml survives a pocket with missing numeric fields', () => {
  const html = pocketRowHtml({ id: 'P09', name: 'No Numbers' });
  assert.ok(html.includes('width: 0%'), html);
  assert.match(html, /pb-pocket__left">R0</, html);
});

/* -------------------------------------------------------- pocket status -- */

test('pocketStatus without pace only flags 85% used and locked pockets', () => {
  assert.equal(pocketStatus(spentPct(84.9), null), 'ok');
  assert.equal(pocketStatus(spentPct(85), null), 'risk');
  assert.equal(pocketStatus(spentPct(100, { isLocked: true }), null), 'out');
});

test('pocketStatus compares spending to the calendar', () => {
  // elapsed 22.58%: watch above 47.58% used, risk above 62.58%.
  assert.equal(pocketStatus(spentPct(47), PACE), 'ok');
  assert.equal(pocketStatus(spentPct(48), PACE), 'watch');
  assert.equal(pocketStatus(spentPct(62), PACE), 'watch');
  assert.equal(pocketStatus(spentPct(63), PACE), 'risk');
});

test('pocketStatus gives the same spend more room late in the month', () => {
  const late = { day: 28, daysInMonth: 31, daysLeft: 3, elapsedPct: (28 / 31) * 100 };
  assert.equal(pocketStatus(spentPct(70), late), 'ok');
  assert.equal(pocketStatus(spentPct(70), PACE), 'risk');
});

test('pocketStatus treats a locked pocket as out whatever its pace', () => {
  assert.equal(pocketStatus(spentPct(0, { isLocked: true }), PACE), 'out');
});

/* ---------------------------------------------------------- summary HTML -- */

const SUMMARY = { totalBalance: 1100, totalLimit: 1500 };

test('summaryHtml shows a ring of the budget left beside money left and the total', () => {
  const html = summaryHtml(SUMMARY, [], PACE);
  assert.match(html, /pb-sum__left[^>]*>R1,100</);
  assert.match(html, /pb-sum__of[^>]*>of R1,500</);
  assert.match(html, /Left this month/);
  assert.match(html, /<svg[^>]*role="img"[^>]*aria-label="73 percent of the budget left, marker at 77 percent expected"/);
  assert.match(html, /<text[^>]*>73%<\/text>/);
  assert.match(html, /stroke-dasharray="165\.9 226\.2"/, 'arc is 73.33% of the circumference');
  assert.match(html, /<line[^>]*rotate\(278\.7 48 48\)/, 'marker sits where 77.4% should be left');
  assert.doesNotMatch(html, /Day \d/, 'the day lives on the title line, not in the header block');
});

test('dayLabel names the day of the month, and is empty without pace', () => {
  assert.equal(dayLabel(PACE), 'Day 7 of 31');
  assert.equal(dayLabel(null), '');
});

test('summaryHtml says on pace within five points of the calendar, ahead beyond it', () => {
  assert.match(summaryHtml({ totalBalance: 790, totalLimit: 1000 }, [], PACE), /On pace\./);
  assert.match(summaryHtml({ totalBalance: 700, totalLimit: 1000 }, [], PACE), /Spending ahead of pace\./);
});

test('summaryHtml counts the pockets that need a look', () => {
  const pockets = [spentPct(10), spentPct(50), spentPct(70, { id: 'P3' })];
  assert.match(summaryHtml(SUMMARY, pockets, PACE), /2 pockets need a look/);
  assert.match(summaryHtml(SUMMARY, [pockets[1]], PACE), /1 pocket needs a look/);
  assert.match(summaryHtml(SUMMARY, [pockets[0]], PACE), /All pockets on track/);
});

test('summaryHtml without pace drops the marker and the pace verdict', () => {
  const html = summaryHtml(SUMMARY, [spentPct(10)], null);
  assert.doesNotMatch(html, /<line|marker|On pace|ahead of pace/);
  assert.match(html, /All pockets on track/);
});

test('summaryHtml renders nothing when there is no limit to speak of', () => {
  assert.equal(summaryHtml({ totalBalance: 0, totalLimit: 0 }, [], PACE), '');
  assert.equal(summaryHtml(undefined, [], PACE), '');
  assert.equal(summaryHtml({ totalBalance: 'x', totalLimit: 1500 }, [], PACE), '');
});

test('summaryHtml clamps the ring when the balance exceeds the limit', () => {
  const html = summaryHtml({ totalBalance: 2000, totalLimit: 1500 }, [], PACE);
  assert.match(html, /stroke-dasharray="226\.2 226\.2"/);
  assert.match(html, />100%<\/text>/);
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
  // The id lives on the delete button only, and never opens a new tag.
  assert.equal((html.match(/data-txn-id=/g) || []).length, 1);
  assert.equal(buttonTags(html).length, 1);
});

test('activityRowHtml shows user, formatted amount, note, and relative day', () => {
  const html = activityRowHtml(txn({ timestamp: isoDaysAgo(0) }), { P01: 'Groceries' });
  assert.ok(html.includes('Alex'), 'user tag');
  assert.ok(html.includes('R65.20'), 'amount');
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

test('activityRowHtml keeps the transaction id OFF the row, so tapping a row cannot delete it', () => {
  const html = activityRowHtml(txn({ id: 'T1001' }), {});
  const li = html.match(/<li[^>]*>/)[0];
  assert.doesNotMatch(li, /data-txn-id/, li);
  assert.doesNotMatch(li, /data-action/, li);
});

test('activityRowHtml omits the note line and any dangling separator when the note is empty', () => {
  const html = activityRowHtml(txn({ note: '' }), { P01: 'Groceries' });
  assert.doesNotMatch(html, /pb-row__note[^>]*>\s*</, 'empty note element rendered');
  assert.doesNotMatch(html, /·\s*·/, 'dangling separator');
  assert.equal(html.split('·').length - 1, 1, 'exactly one separator, between pocket and day');
  // Deliberately not asserting a specific day label: the fixture timestamp is
  // fixed, so whether it reads 'Today' or 'Yesterday' changes with the wall
  // clock. Assert the pocket name and a day label is present instead.
  assert.ok(html.includes('Groceries'), html);
  assert.match(html, /pb-row__meta[^>]*>[^<]*·\s*(Today|Yesterday|[A-Z][a-z]{2} \d+)/, html);
});

test('activityRowHtml omits the note line when the note is nullish', () => {
  for (const note of [null, undefined, '   ']) {
    const html = activityRowHtml(txn({ note }), { P01: 'Groceries' });
    assert.doesNotMatch(html, /pb-row__note[^>]*>\s*</, `note=${JSON.stringify(note)}`);
    assert.doesNotMatch(html, /·\s*·/, `note=${JSON.stringify(note)}`);
  }
});

/* ------------------------------------------------------------- mounting -- */

test('renderPockets mounts every pocket row into the container, in order', async () => {
  await withFakeDom(async (container) => {
    const second = { ...POCKET, id: 'P02', name: 'Dining Out' };
    renderPockets(container, [POCKET, second]);

    assert.equal(container.replaced, 1, 'container must be swapped in exactly once');
    const html = container.templateInner;
    assert.ok(html.includes(pocketRowHtml(POCKET, null)), 'first row missing');
    assert.ok(html.includes(pocketRowHtml(second, null)), 'second row missing');
    assert.ok(html.indexOf('data-pocket-id="P01"') < html.indexOf('data-pocket-id="P02"'),
      'rows rendered out of order');
    assert.equal((html.match(/<button\b/g) || []).length, 2, 'extra or missing rows');
  });
});

/** Seven pockets on two accounts, so filter chips appear. */
function manyPockets() {
  return [
    spentPct(10, { id: 'P1', name: 'Groceries', account: 'Les' }),
    spentPct(70, { id: 'P2', name: 'Gifts', account: 'Ivan' }),
    spentPct(10, { id: 'P3', name: 'Fuel', account: 'Ivan' }),
    spentPct(10, { id: 'P4', name: 'Cars', account: 'Ivan' }),
    spentPct(10, { id: 'P5', name: 'Gas', account: 'Ivan' }),
    spentPct(100, { id: 'P6', name: 'Pet Care', account: 'Les', balance: 0, isLocked: true }),
  ];
}

test('renderPockets shows no filter chips for a short list', async () => {
  await withFakeDom(async (container) => {
    renderPockets(container, [POCKET], { pace: PACE });
    assert.doesNotMatch(container.templateInner, /filter-pockets/);
  });
});

test('renderPockets shows All, Needs attention and one chip per account for a long list', async () => {
  await withFakeDom(async (container) => {
    renderPockets(container, manyPockets(), { pace: PACE });
    const html = container.templateInner;
    assert.match(html, /data-filter="all"[^>]*aria-pressed="true">All 6</);
    assert.match(html, /data-filter="attention"[^>]*aria-pressed="false">Needs attention 2</);
    assert.match(html, /data-filter="account:Les"[^>]*>Les 2</);
    assert.match(html, /data-filter="account:Ivan"[^>]*>Ivan 4</);
  });
});

test('renderPockets omits account chips when there is only one account', async () => {
  await withFakeDom(async (container) => {
    renderPockets(container, manyPockets().map((p) => ({ ...p, account: 'Joint' })), { pace: PACE });
    assert.doesNotMatch(container.templateInner, /data-filter="account:/);
  });
});

test('renderPockets applies the attention filter, keeping server order', async () => {
  await withFakeDom(async (container) => {
    const applied = renderPockets(container, manyPockets(), { pace: PACE, filter: 'attention' });
    const html = container.templateInner;
    assert.equal(applied, 'attention');
    assert.match(html, /data-filter="attention"[^>]*aria-pressed="true"/);
    assert.equal((html.match(/data-action="select-pocket"/g) || []).length, 2);
    assert.ok(html.indexOf('data-pocket-id="P2"') < html.indexOf('data-pocket-id="P6"'));
  });
});

test('renderPockets applies an account filter', async () => {
  await withFakeDom(async (container) => {
    renderPockets(container, manyPockets(), { pace: PACE, filter: 'account:Les' });
    const html = container.templateInner;
    assert.equal((html.match(/data-action="select-pocket"/g) || []).length, 2);
    assert.ok(html.includes('data-pocket-id="P1"') && html.includes('data-pocket-id="P6"'));
  });
});

test('renderPockets falls back to All when the filtered account no longer exists', async () => {
  await withFakeDom(async (container) => {
    const applied = renderPockets(container, manyPockets(), { pace: PACE, filter: 'account:Gone' });
    assert.equal(applied, 'all');
    assert.equal((container.templateInner.match(/data-action="select-pocket"/g) || []).length, 6);
  });
});

test('renderPockets says so when nothing needs attention', async () => {
  await withFakeDom(async (container) => {
    const calm = manyPockets().map((p) => ({ ...p, ...spentPct(10), id: p.id, name: p.name, account: p.account }));
    renderPockets(container, calm, { pace: PACE, filter: 'attention' });
    assert.match(container.templateInner, /Nothing needs attention/);
    assert.match(container.templateInner, /data-filter="attention"[^>]*aria-pressed="true"/);
  });
});

test('renderPockets escapes an account name in the chips', async () => {
  await withFakeDom(async (container) => {
    const list = manyPockets();
    list[0] = { ...list[0], account: '"><img src=x onerror=alert(3)>' };
    renderPockets(container, list, { pace: PACE });
    assert.doesNotMatch(container.templateInner, /<img/i);
    assert.doesNotMatch(container.templateInner, liveAttr('onerror'));
  });
});

test('renderSummary mounts the header, and clears it when there is nothing to show', async () => {
  await withFakeDom(async (container) => {
    renderSummary(container, SUMMARY, [], PACE);
    assert.match(container.templateInner, /Left this month/);
    renderSummary(container, { totalBalance: 0, totalLimit: 0 }, [], PACE);
    assert.equal(container.templateInner, '');
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
  // renderPockets reports the filter it applied, which is 'all' when nothing was drawn.
  assert.equal(renderPockets(null, [POCKET]), 'all');
  assert.equal(renderActivity(undefined, [txn()]), undefined);
});
/* ------------------------------------- activity text is legible on the dark page -- */

test('activityRowHtml uses light text for the note, meta and amount (the page is dark)', () => {
  const html = activityRowHtml(txn(), { P01: 'Groceries' });
  assert.match(html, /pb-row__note[^"]*text-slate-200/);
  assert.match(html, /pb-row__meta[^"]*text-slate-400/);
  assert.match(html, /pb-row__amount[^"]*text-slate-100/);
  assert.doesNotMatch(html, /pb-row__(note|meta|amount)[^"]*text-slate-(500|600|700|800|900)/);
});
