// app/js/pocket.js
// The pocket detail screen: one pocket's month at a glance. The HTML builder is
// pure and tested; mountPocket() is the thin DOM wiring around it.
//
// Every interpolated value passes through esc(): names, notes and users are
// typed by people (see the security note at the top of render.js).

import { esc, barSegments } from './render.js';
import { formatMoney, relativeDay } from './format.js';
import { ruleLabel } from './manage.js';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

/** The most rows shown under "This month". */
const MAX_ROWS = 20;

const MINUS = '−';

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Whole cents, so "is this line zero?" never depends on float noise. */
function cents(value) {
  return Math.round(num(value) * 100);
}

/** 'YYYY-MM' to a month name, or '' when unreadable. `shift` moves by whole months. */
function monthNameOf(key, shift = 0) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(key ?? ''));
  if (!m) return '';
  const index = Number(m[2]) - 1 + shift;
  return MONTH_NAMES[((index % 12) + 12) % 12] || '';
}

function barPct(value) {
  return String(Math.round(Math.max(0, Math.min(100, num(value))) * 100) / 100);
}

/** One label/value line of the breakdown. */
function lineHtml(label, value, tone) {
  const cls = tone ? ` pb-pd__val--${tone}` : '';
  return `<span class="pb-pd__label">${esc(label)}</span><span class="pb-pd__val${cls}">${esc(value)}</span>`;
}

function plural(n, one, many) {
  return n === 1 ? one : many;
}

/**
 * The tag, title, sign and meta words for one adjustment, seen from `pocketId`.
 * `names` maps pocket id to name.
 */
function adjustmentView(a, pocketId, names, month) {
  const into = String(a.toPocketId) === String(pocketId);
  const other = into ? a.fromPocketId : a.toPocketId;
  const otherName = names[other] || other || 'another pocket';
  if (a.type === 'carry') {
    const prev = monthNameOf(a.month || month, -1);
    return { tag: 'Carried', title: prev ? `Left over from ${prev}` : 'Left over from last month', sign: 1 };
  }
  if (a.type === 'forfeit') {
    return { tag: 'Reset', title: 'Cleared at month end', sign: -1 };
  }
  if (a.type === 'sweep') {
    return into
      ? { tag: 'Moved', title: `Swept in from ${otherName}`, sign: 1 }
      : { tag: 'Moved', title: `Swept to ${otherName}`, sign: -1 };
  }
  return into
    ? { tag: 'Moved', title: `From ${otherName}`, sign: 1 }
    : { tag: 'Moved', title: `To ${otherName}`, sign: -1 };
}

function rowHtml(row, pocketId, names, month, now) {
  if (row.kind === 'txn') {
    const t = row.item;
    const note = String(t.note ?? '').trim();
    const day = relativeDay(t.timestamp, now);
    return (
      `<div class="pb-pd__row"><span class="pb-pd__who">${esc(t.user)}</span>` +
      `<span class="pb-pd__what"><span class="pb-pd__title">${esc(note || 'Expense')}</span>` +
      `<span class="pb-pd__meta">${esc(day)}</span></span>` +
      `<span class="pb-pd__amt">${esc(formatMoney(t.amount))}</span></div>`
    );
  }
  const a = row.item;
  const v = adjustmentView(a, pocketId, names, month);
  const note = String(a.note ?? '').trim();
  const meta = [note ? `“${note}”` : '', relativeDay(a.timestamp, now), String(a.user ?? '').trim()]
    .filter((part) => part !== '')
    .map(esc)
    .join(' · ');
  const amount = (v.sign > 0 ? '+' : MINUS) + formatMoney(a.amount);
  return (
    `<div class="pb-pd__row"><span class="pb-pd__adj">${esc(v.tag)}</span>` +
    `<span class="pb-pd__what"><span class="pb-pd__title">${esc(v.title)}</span>` +
    `<span class="pb-pd__meta">${meta}</span></span>` +
    `<span class="pb-pd__amt${v.sign > 0 ? ' pb-pd__amt--in' : ''}">${esc(amount)}</span></div>`
  );
}

/** Transactions and adjustments as one list, newest first (ties keep expenses first). */
function mergedRows(transactions, adjustments) {
  const rows = [
    ...transactions.map((item) => ({ kind: 'txn', item })),
    ...adjustments.map((item) => ({ kind: 'adj', item })),
  ];
  const stamp = (r) => String((r.item && r.item.timestamp) || '');
  return rows
    .map((row, index) => ({ row, index }))
    .sort((x, y) => {
      const a = stamp(x.row);
      const b = stamp(y.row);
      if (a !== b) return a < b ? 1 : -1;
      return x.index - y.index;
    })
    .map((entry) => entry.row);
}

/**
 * The body of the pocket detail screen, as escaped HTML.
 *
 * @param {object} data   the getPocket payload: { pocket, breakdown, transactions, adjustments }
 * @param {string} month  the month shown, 'YYYY-MM'
 * @param {object} [opts] { pockets } to name the other side of a move and the sweep target;
 *                        { now } to fix "today" for relative dates
 */
export function pocketDetailHtml(data, month, opts = {}) {
  const d = data || {};
  const pocket = d.pocket || {};
  const b = d.breakdown || {};
  const pockets = Array.isArray(opts && opts.pockets) ? opts.pockets : [];
  const now = (opts && opts.now) || new Date();
  const transactions = Array.isArray(d.transactions) ? d.transactions : [];
  const adjustments = Array.isArray(d.adjustments) ? d.adjustments : [];

  const names = {};
  for (const p of pockets) if (p && p.id != null) names[p.id] = String(p.name ?? '');

  const account = String(pocket.account ?? '').trim();
  const monthName = monthNameOf(month);
  const header = [account ? `Funded from ${account}` : '', monthName].filter((s) => s !== '').join(' · ');

  const seg = barSegments({ ...pocket, balance: b.left != null ? b.left : pocket.balance });
  const bar =
    `<div class="pb-pd__bar" role="progressbar" aria-valuemin="0" aria-valuemax="100"` +
    ` aria-valuenow="${esc(barPct(seg.own + seg.carried))}" aria-label="${esc(`${pocket.name ?? 'Pocket'} money left`)}">` +
    `<span class="pb-pd__fill" style="width: ${barPct(seg.own)}%"></span>` +
    `<span class="pb-pd__fill pb-carry" style="width: ${barPct(seg.carried)}%"></span></div>`;

  const prev = monthNameOf(month, -1);
  const count = Math.max(0, Math.round(num(b.count)));
  const lines = [];
  if (cents(b.limit) !== 0) lines.push(lineHtml('Monthly limit', formatMoney(b.limit)));
  if (cents(b.carriedIn) !== 0) {
    lines.push(lineHtml(prev ? `Carried in from ${prev}` : 'Carried in', `+ ${formatMoney(b.carriedIn)}`, 'in'));
  }
  if (cents(b.movedIn) !== 0) lines.push(lineHtml('Moved in', `+ ${formatMoney(b.movedIn)}`, 'in'));
  if (cents(b.movedOut) !== 0) lines.push(lineHtml('Moved out', `${MINUS} ${formatMoney(b.movedOut)}`));
  if (cents(b.spent) !== 0 || count > 0) {
    lines.push(lineHtml(`Spent (${count} ${plural(count, 'expense', 'expenses')})`, `${MINUS} ${formatMoney(b.spent)}`));
  }
  lines.push(
    `<span class="pb-pd__label pb-pd__total">Left</span>` +
    `<span class="pb-pd__val pb-pd__total pb-pd__val--strong">${esc(formatMoney(b.left))}</span>`,
  );

  const card =
    `<div class="pb-pd__card"><p class="pb-pd__meta">Left</p>` +
    `<p class="pb-pd__big">${esc(formatMoney(b.left))}</p>${bar}` +
    `<div class="pb-pd__lines">${lines.join('')}</div></div>`;

  const rule =
    `<h2 class="pb-pd__sec">At month end</h2>` +
    `<button type="button" class="pb-pd__rule" data-action="pocket-settings">` +
    `<span class="pb-pd__rulename">${esc(ruleLabel(pocket, pockets))}</span>` +
    `<span class="pb-pd__meta">Change</span></button>`;

  const rows = mergedRows(transactions, adjustments);
  const shown = rows.slice(0, MAX_ROWS);
  const list = shown.length === 0
    ? `<p class="pb-pd__empty">Nothing yet this month.</p>`
    : shown.map((r) => rowHtml(r, pocket.id, names, month, now)).join('') +
      (rows.length > shown.length
        ? `<p class="pb-pd__more">Showing ${shown.length} of ${rows.length}</p>`
        : '');

  return (
    `<p class="pb-pd__sub">${esc(header)}</p>` +
    card +
    `<div class="pb-pd__rest">${rule}<h2 class="pb-pd__sec">This month</h2>${list}</div>`
  );
}

/** The month key ('YYYY-MM') for today, used when the app has no state yet. */
function currentMonthKey(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Wire the pocket detail screen.
 *
 * @param {object}   deps
 * @param {Element}  deps.root        the #view-pocket section
 * @param {object}   deps.api         a makeApi() client
 * @param {Function} deps.onAdd       (pocketId) => void, the Add expense button
 * @param {Function} deps.onMove      (pocketId) => void, the Move money button
 * @param {Function} deps.onSettings  (pocketId) => void, the settings button and the rule row
 * @param {Function} [deps.getState]  () => the latest state, for the month and the other pockets
 * @returns {{ open: (pocketId: string) => void }}
 */
export function mountPocket({ root, api, onAdd, onMove, onSettings, getState } = {}) {
  const pick = (id) => (root && typeof root.querySelector === 'function' ? root.querySelector('#' + id) : null);
  const bodyEl = pick('pocket-body');
  const headingEl = pick('pocket-heading');
  const addEl = pick('pocket-add');
  const moveEl = pick('pocket-move');
  const settingsEl = pick('pocket-settings');

  let currentId = '';
  /** Bumped on every open(), so a slow answer for a pocket you left never paints over the new one. */
  let ticket = 0;

  const state = () => (typeof getState === 'function' ? getState() : null) || {};

  function paint(html) {
    if (!bodyEl) return;
    const doc = bodyEl.ownerDocument || globalThis.document;
    if (!doc || typeof doc.createElement !== 'function') return;
    const tpl = doc.createElement('template');
    tpl.innerHTML = html;
    if (typeof bodyEl.replaceChildren === 'function') bodyEl.replaceChildren(tpl.content);
    else {
      while (bodyEl.firstChild) bodyEl.removeChild(bodyEl.firstChild);
      bodyEl.appendChild(tpl.content);
    }
  }

  function open(pocketId) {
    currentId = String(pocketId ?? '');
    ticket += 1;
    const mine = ticket;
    const known = (Array.isArray(state().pockets) ? state().pockets : [])
      .find((p) => String(p.id) === currentId);
    if (headingEl) headingEl.textContent = known ? String(known.name ?? '') : '';
    paint('<p class="pb-pd__empty">Loading…</p>');

    return Promise.resolve()
      .then(() => api.getPocket(currentId, state().month))
      .then((data) => {
        if (mine !== ticket) return;
        const s = state();
        if (headingEl && data && data.pocket) headingEl.textContent = String(data.pocket.name ?? '');
        paint(pocketDetailHtml(data, s.month || currentMonthKey(), { pockets: s.pockets }));
      })
      .catch((err) => {
        if (mine !== ticket) return;
        const reason = err && err.message ? String(err.message) : 'Please try again.';
        paint(`<p class="pb-pd__empty">Could not load this pocket. ${esc(reason)}</p>`);
      });
  }

  const call = (fn) => () => {
    if (currentId && typeof fn === 'function') fn(currentId);
  };
  const listeners = [
    [addEl, call(onAdd)],
    [moveEl, call(onMove)],
    [settingsEl, call(onSettings)],
    [bodyEl, (ev) => {
      const target = ev && ev.target && typeof ev.target.closest === 'function' ? ev.target : null;
      if (target && target.closest('[data-action="pocket-settings"]')) call(onSettings)();
    }],
  ];
  for (const [el, fn] of listeners) {
    if (el && typeof el.addEventListener === 'function') el.addEventListener('click', fn);
  }

  return { open };
}
