// app/js/render.js
// Home feed renderer: pocket cards with progress bars, and the activity feed.
//
// ---------------------------------------------------------------------------
// SECURITY — READ BEFORE EDITING
// Every value interpolated into the HTML strings below comes from a human being
// at a keyboard: a pocket's `name` and `account`, a transaction's `note` and
// `user`, and the ids used to key delete/select clicks. This is a shared family
// app, so a missed esc() is a STORED XSS BUG, not a cosmetic defect — one
// spouse pastes `<img src=x onerror=...>` into a note and it fires in the other
// spouse's session on every refresh, forever.
//
// Therefore: esc() EVERY interpolated value, and do not "optimise" those calls
// away because the data "usually" comes from our own backend or "the values
// are already validated". There is no such guarantee. If you add a new field to
// a template, esc() it. If you need a number formatted, pass it through
// formatMoney/formatPct and still esc() the result. Do not hand this module raw
// values to innerHTML either — mount() only ever parses strings that esc() has
// already had its way with.
// ---------------------------------------------------------------------------

import { formatMoney, formatPct, relativeDay } from './format.js';

/** & must be replaced first or the entities we emit would be re-escaped. */
const ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * HTML-escape any value for interpolation into markup or into a quoted
 * attribute value. Missing values become '' so templates never print
 * "undefined"; 0 and false survive, because they are legitimate values.
 */
export function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (ch) => ESCAPES[ch]);
}

/** Coerce anything to a finite number, defaulting to 0. */
function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Bar width percentage: clamped to [0, 100] so the fill can never overflow. */
function barWidth(pct) {
  const clamped = Math.max(0, Math.min(100, num(pct)));
  return String(Math.round(clamped * 100) / 100);
}

/** <60% on track (emerald), 60–85% warning (amber), >85% over (rose). */
function toneClass(pct, locked) {
  if (locked || pct > 85) return 'bg-rose-500';
  if (pct >= 60) return 'bg-amber-500';
  return 'bg-emerald-500';
}

/* ------------------------------------------------------------ pocket card -- */

/**
 * One pocket card: name, bank account, balance of limit, a clamped progress
 * bar coloured by threshold, and a select affordance for the add screen.
 *
 * A locked (depleted) pocket renders rose, carries a "Depleted" badge, and its
 * affordance is disabled — the UI states the rule before the user can discover
 * it the hard way through a server error.
 */
export function pocketCardHtml(p) {
  const pocket = p || {};
  const pct = num(pocket.pctUsed);
  const locked = pocket.isLocked === true;
  const width = barWidth(pct);
  const tone = toneClass(pct, locked);
  const id = esc(pocket.id);
  const account = String(pocket.account ?? '').trim();

  const accountLine = account
    ? `<p class="pb-card__account text-sm text-slate-500">${esc(account)}</p>`
    : '';

  const badge = locked
    ? `<span class="pb-card__badge ml-2 shrink-0 rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-700">Depleted</span>`
    : '';

  const disabled = locked ? ' disabled aria-disabled="true"' : '';

  return (
    `<article class="pb-card rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" data-pocket-id="${id}">` +
    `<header class="flex items-start justify-between gap-2">` +
    `<div class="min-w-0">` +
    `<h3 class="pb-card__name truncate text-base font-semibold text-slate-900">${esc(pocket.name)}</h3>` +
    accountLine +
    `</div>${badge}</header>` +
    `<p class="pb-card__amount mt-2 text-lg font-semibold tabular-nums text-slate-900">` +
    `<span class="pb-card__num">${esc(formatMoney(pocket.balance))}</span> of ` +
    `<span class="pb-card__num">${esc(formatMoney(pocket.limit))}</span></p>` +
    `<div class="pb-card__bar mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-200" role="progressbar"` +
    ` aria-valuemin="0" aria-valuemax="100" aria-valuenow="${width}"` +
    ` aria-label="${esc(pocket.name)} used">` +
    `<div class="pb-card__fill ${tone} h-full rounded-full" style="width: ${width}%"></div></div>` +
    `<footer class="mt-3 flex items-center justify-between gap-2">` +
    `<span class="pb-card__pct text-xs font-medium text-slate-500">${esc(formatPct(pct))} used</span>` +
    `<button type="button" class="pb-card__add rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold` +
    ` text-white disabled:cursor-not-allowed disabled:bg-slate-300"` +
    ` data-action="select-pocket" data-pocket-id="${id}"${disabled}>Add expense</button>` +
    `</footer>` +
    `</article>`
  );
}

/* ---------------------------------------------------------- activity row -- */

/**
 * One activity feed row: user tag, amount, note, pocket name and relative day,
 * plus a delete button for app.js to delegate from. The id lives on the BUTTON only:
 * a row-level id made every tap on a row a delete.
 *
 * `pocketNameById` maps pocketId -> pocket name; an unknown or missing pocket
 * falls back to the raw id rather than rendering a blank pocket label.
 */
export function activityRowHtml(t, pocketNameById, now = new Date()) {
  const txn = t || {};
  const map = pocketNameById || {};
  const note = String(txn.note ?? '').trim();
  const day = relativeDay(txn.timestamp, now);

  const mappedName = map[txn.pocketId];
  const pocketLabel = String(mappedName ?? txn.pocketId ?? '').trim();

  // Filter before joining so an empty piece can never leave a dangling "·".
  const metaParts = [esc(pocketLabel), esc(day)].filter((part) => part !== '');
  const meta = metaParts.join(' · ');

  const noteLine = note
    ? `<p class="pb-row__note text-sm text-slate-700">${esc(note)}</p>`
    : '';

  const metaLine = meta
    ? `<p class="pb-row__meta text-xs text-slate-500">${meta}</p>`
    : '';

  return (
    `<li class="pb-row flex items-start gap-3 py-3">` +
    `<span class="pb-row__user shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold` +
    ` text-slate-700">${esc(txn.user)}</span>` +
    `<div class="min-w-0 flex-1">${noteLine}${metaLine}</div>` +
    `<span class="pb-row__amount shrink-0 text-sm font-semibold tabular-nums text-slate-900">` +
    `${esc(formatMoney(txn.amount))}</span>` +
    `<button type="button" class="pb-row__delete shrink-0 rounded p-1 text-slate-400 hover:text-rose-600"` +
    ` data-action="delete-txn" data-txn-id="${esc(txn.id)}" aria-label="Delete transaction">✕</button>` +
    `</li>`
  );
}

/* --------------------------------------------------------------- mounting -- */

/**
 * Swap freshly parsed markup into `container`.
 *
 * The HTML string handed here has already been escaped value-by-value by esc();
 * parsing it through an inert <template> is the standard way to turn a string
 * into nodes without re-interpreting anything esc() already neutralised. The
 * replaceChildren/appendChild path never assigns a live element's innerHTML to
 * unescaped user data.
 */
function mount(container, html) {
  if (!container) return;
  const doc = globalThis.document;
  // No DOM (unit tests, non-browser host): there is nothing to mount into.
  if (!doc || typeof doc.createElement !== 'function') return;

  const tpl = doc.createElement('template');
  tpl.innerHTML = html;
  const nodes = tpl.content;

  if (typeof container.replaceChildren === 'function') {
    container.replaceChildren(nodes);
    return;
  }
  while (container.firstChild) container.removeChild(container.firstChild);
  container.appendChild(nodes);
}

/** Horizontal list of pocket cards, or an empty state. */
export function renderPockets(container, pockets) {
  const list = Array.isArray(pockets) ? pockets : [];
  if (list.length === 0) {
    mount(container, `<p class="pb-empty px-4 py-8 text-center text-sm text-slate-500">` +
      `No pockets yet. Add one to get started.</p>`);
    return;
  }
  mount(container, `<div class="pb-grid grid gap-3 sm:grid-cols-2">` +
    list.map(pocketCardHtml).join('') + `</div>`);
}

/**
 * Activity feed grouped under Today / Yesterday / date headings, preserving the
 * newest-first order the caller supplied. Days are merged by label so a repeated
 * day yields one heading, and an unusable timestamp yields no heading at all
 * rather than a blank one.
 */
export function renderActivity(container, transactions, pocketNameById) {
  const list = Array.isArray(transactions) ? transactions : [];
  if (list.length === 0) {
    mount(container, `<p class="pb-empty px-4 py-8 text-center text-sm text-slate-500">` +
      `No activity yet.</p>`);
    return;
  }

  // One `now` for the whole pass, so a render straddling midnight cannot split
  // the same day across two headings.
  const now = new Date();
  const groups = new Map();
  for (const txn of list) {
    const label = relativeDay(txn && txn.timestamp, now);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(activityRowHtml(txn, pocketNameById, now));
  }

  const html = [...groups.entries()].map(([label, rows]) => {
    const heading = label
      ? `<h3 class="pb-day__heading px-1 pb-1 pt-4 text-xs font-semibold uppercase tracking-wide` +
        ` text-slate-400">${esc(label)}</h3>`
      : '';
    return (
      `<section class="pb-day" data-day="${esc(label)}">${heading}` +
      `<ul class="pb-day__list divide-y divide-slate-100">${rows.join('')}</ul>` +
      `</section>`
    );
  }).join('');

  mount(container, html);
}