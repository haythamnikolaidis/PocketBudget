// app/js/render.js
// Home feed renderer: the summary header, pocket rows with pace bars, and the activity feed.
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
// formatMoney/formatRand and still esc() the result. Do not hand this module raw
// values to innerHTML either — mount() only ever parses strings that esc() has
// already had its way with.
// ---------------------------------------------------------------------------

import { formatMoney, formatRand, relativeDay } from './format.js';

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

/* ------------------------------------------------------- status and pace -- */

/**
 * Spending-pace thresholds, in percentage points of the limit ahead of the
 * calendar. A pocket 25 points ahead of the month is "Spending fast"; 40 points
 * ahead, or 85% used, is "Running low". Early-month spending is lumpy (a bill
 * lands on the 1st), so these are deliberately loose.
 */
const FAST_AHEAD = 25;
const LOW_AHEAD = 40;
const LOW_USED = 85;
/** The month as a whole counts as "ahead of pace" once this many points ahead. */
const MONTH_AHEAD = 5;

const STATUS_LABEL = { watch: 'Spending fast', risk: 'Running low', out: 'Depleted' };
const FILL_CLASS = { ok: 'bg-emerald-500', watch: 'bg-amber-500', risk: 'bg-rose-500', out: 'bg-rose-500' };
const PILL_CLASS = {
  watch: 'bg-amber-500/15 text-amber-200',
  risk: 'bg-rose-500/15 text-rose-300',
  out: 'border border-rose-500/50 text-rose-300',
};

/**
 * 'out' (locked) | 'risk' | 'watch' | 'ok'. `pace` is monthProgress()'s result,
 * or null when the month is unknown: then only the plain 85%-used rule applies.
 */
export function pocketStatus(p, pace) {
  const pocket = p || {};
  if (pocket.isLocked === true) return 'out';
  const used = num(pocket.pctUsed);
  if (used >= LOW_USED) return 'risk';
  if (pace && Number.isFinite(pace.elapsedPct)) {
    if (used > pace.elapsedPct + LOW_AHEAD) return 'risk';
    if (used > pace.elapsedPct + FAST_AHEAD) return 'watch';
  }
  return 'ok';
}

/** Share of the limit still unspent, clamped to [0, 100]. */
function leftPct(pocket) {
  const limit = num(pocket.limit);
  return limit > 0 ? Math.max(0, Math.min(100, (num(pocket.balance) / limit) * 100)) : 0;
}

function statusPill(status) {
  return status === 'ok'
    ? ''
    : `<span class="pb-pocket__pill shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${PILL_CLASS[status]}">` +
      `${STATUS_LABEL[status]}</span>`;
}

/**
 * A progress bar that shows money LEFT, not money used, with a tick at the
 * share that should be left today. Fill past the tick: ahead of the month.
 */
function barHtml(pct, status, pace, label, heightClass) {
  const width = barWidth(pct);
  const tick = pace && Number.isFinite(pace.elapsedPct)
    ? `<span class="pb-pocket__tick absolute -bottom-1 -top-1 -ml-px w-0.5 rounded-sm bg-slate-100/80"` +
      ` style="left: ${barWidth(100 - pace.elapsedPct)}%"></span>`
    : '';
  return (
    `<span class="pb-pocket__bar relative col-span-2 block ${heightClass} w-full rounded-full bg-slate-700" role="progressbar"` +
    ` aria-valuemin="0" aria-valuemax="100" aria-valuenow="${width}" aria-label="${esc(label)}">` +
    `<span class="pb-pocket__fill ${FILL_CLASS[status]} absolute inset-y-0 left-0 block rounded-full" style="width: ${width}%"></span>` +
    `${tick}</span>`
  );
}

/* ----------------------------------------------------------- pocket row -- */

/**
 * One pocket row: name, account, amount LEFT of the limit, and a bar of money
 * left with a pace tick. The whole row is the "add an expense here" target; it
 * only opens the add form, so a stray tap never writes anything.
 *
 * A depleted pocket carries a "Depleted" pill, an empty bar, and a disabled row —
 * the UI states the rule before the user can discover it through a server error.
 * Colour is never the only signal: every non-ok status also has a word.
 */
export function pocketRowHtml(p, pace = null) {
  const pocket = p || {};
  const status = pocketStatus(pocket, pace);
  const locked = status === 'out';
  const id = esc(pocket.id);
  const account = String(pocket.account ?? '').trim();
  const name = String(pocket.name ?? '');
  const pct = leftPct(pocket);
  const disabled = locked ? ' disabled aria-disabled="true"' : '';
  const label = locked
    ? `Add expense to ${name}, depleted`
    : `Add expense to ${name}, ${formatMoney(pocket.balance)} left of ${formatMoney(pocket.limit)}` +
      (status === 'ok' ? '' : `, ${STATUS_LABEL[status].toLowerCase()}`);

  const accountTag = account
    ? `<span class="pb-pocket__account shrink-0 text-xs text-slate-400">${esc(account)}</span>`
    : '';

  return (
    `<button type="button" class="pb-pocket grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2` +
    ` border-b border-slate-800 py-3 text-left disabled:cursor-not-allowed"` +
    ` data-action="select-pocket" data-pocket-id="${id}" data-status="${status}"` +
    ` data-account="${esc(account)}" aria-label="${esc(label)}"${disabled}>` +
    `<span class="flex min-w-0 items-center gap-2">` +
    `<span class="pb-pocket__name truncate text-[15px] font-semibold text-slate-100">${esc(name)}</span>` +
    `${accountTag}${statusPill(status)}</span>` +
    `<span class="pb-pocket__amount whitespace-nowrap text-right font-bold tabular-nums text-slate-100">` +
    `<span class="pb-pocket__left">${esc(formatRand(pocket.balance))}</span>` +
    ` <span class="pb-pocket__limit text-xs font-normal text-slate-400">/ ${esc(formatRand(pocket.limit))}</span></span>` +
    barHtml(pct, status, locked ? null : pace, `${name} money left`, 'h-1.5') +
    `</button>`
  );
}

/* ------------------------------------------------------------- summary -- */

/**
 * The dashboard header: money left this month, of the total limit, the day of
 * the month, an overall bar with the pace tick, and one plain-language verdict.
 * Returns '' when there is no limit to speak of (no pockets yet).
 *
 * `summary` is the payload's { totalBalance, totalLimit }; `pockets` supplies
 * the "needs a look" count; `pace` is monthProgress()'s result or null.
 */
export function summaryHtml(summary, pockets, pace = null) {
  const s = summary || {};
  const list = Array.isArray(pockets) ? pockets : [];
  const balance = Number(s.totalBalance);
  const limit = Number(s.totalLimit);
  if (!Number.isFinite(balance) || !Number.isFinite(limit) || limit <= 0) return '';

  const pct = Math.max(0, Math.min(100, (balance / limit) * 100));
  const attention = list.filter((p) => pocketStatus(p, pace) !== 'ok').length;

  const needs = attention === 0
    ? 'All pockets on track'
    : `${attention} ${attention === 1 ? 'pocket needs' : 'pockets need'} a look`;
  const ahead = pace && Number.isFinite(pace.elapsedPct) && (100 - pct) > pace.elapsedPct + MONTH_AHEAD;
  const verdict = pace
    ? `<strong class="font-semibold text-slate-100">${ahead ? 'Spending ahead of pace' : 'On pace'}.</strong> ${esc(needs)}`
    : `<strong class="font-semibold text-slate-100">${esc(needs)}</strong>`;
  const status = ahead ? 'watch' : 'ok';
  const dayLine = pace ? `<br>Day ${esc(pace.day)} of ${esc(pace.daysInMonth)}` : '';

  return (
    `<div class="pb-sum grid grid-cols-2 gap-x-3 gap-y-2">` +
    `<div class="min-w-0">` +
    `<p class="text-xs font-semibold uppercase tracking-wide text-slate-400">Left this month</p>` +
    `<p class="pb-sum__left text-3xl font-extrabold tabular-nums text-slate-100">${esc(formatRand(balance))}</p></div>` +
    `<p class="pb-sum__of self-end text-right text-xs tabular-nums text-slate-400">of ${esc(formatRand(limit))}${dayLine}</p>` +
    barHtml(pct, status, pace, 'Budget left this month', 'h-2') +
    `<p class="pb-sum__verdict col-span-2 text-xs text-slate-400">${verdict}</p>` +
    `</div>`
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

/** The dashboard header (see summaryHtml). Clears the container when there is nothing to show. */
export function renderSummary(container, summary, pockets, pace = null) {
  mount(container, summaryHtml(summary, pockets, pace));
}

/** Only worth the screen space once the list is long enough to scan. */
const CHIPS_FROM = 6;

function accountsOf(list) {
  const seen = [];
  for (const p of list) {
    const a = String((p && p.account) ?? '').trim();
    if (a && !seen.includes(a)) seen.push(a);
  }
  return seen;
}

function chipHtml(value, text, count, active) {
  const tone = active
    ? 'border-slate-100 bg-slate-100 text-slate-900'
    : 'border-slate-700 text-slate-300';
  return (
    `<button type="button" class="pb-chip shrink-0 rounded-full border px-3 py-1 text-xs font-semibold ${tone}"` +
    ` data-action="filter-pockets" data-filter="${esc(value)}" aria-pressed="${active ? 'true' : 'false'}">` +
    `${esc(text)} ${esc(count)}</button>`
  );
}

/** Does `p` belong under the filter 'all' | 'attention' | 'account:<name>'? */
function inFilter(p, filter, pace) {
  if (filter === 'all') return true;
  if (filter === 'attention') return pocketStatus(p, pace) !== 'ok';
  return String((p && p.account) ?? '').trim() === filter.slice('account:'.length);
}

/**
 * The pocket list: filter chips (for longer lists), then one row per pocket in
 * the order the server sent them, so a pocket never moves under your thumb.
 *
 * `opts.filter` is 'all' | 'attention' | 'account:<name>'; one that no longer
 * matches anything (the account was renamed away) falls back to 'all'.
 * Returns the filter that was actually applied.
 */
export function renderPockets(container, pockets, opts = {}) {
  const list = Array.isArray(pockets) ? pockets : [];
  const pace = (opts && opts.pace) || null;
  if (list.length === 0) {
    mount(container, `<p class="pb-empty px-4 py-8 text-center text-sm text-slate-500">` +
      `No pockets yet. Add one to get started.</p>`);
    return 'all';
  }

  const accounts = accountsOf(list);
  const attention = list.filter((p) => pocketStatus(p, pace) !== 'ok').length;
  const showChips = list.length >= CHIPS_FROM;
  const wanted = String((opts && opts.filter) || 'all');
  const valid = wanted === 'all' || wanted === 'attention'
    || (wanted.startsWith('account:') && accounts.includes(wanted.slice('account:'.length)));
  const filter = showChips && valid ? wanted : 'all';

  let chips = '';
  if (showChips) {
    const items = [chipHtml('all', 'All', list.length, filter === 'all'),
      chipHtml('attention', 'Needs attention', attention, filter === 'attention')];
    if (accounts.length > 1) {
      for (const a of accounts) {
        const value = 'account:' + a;
        const n = list.filter((p) => inFilter(p, value, pace)).length;
        items.push(chipHtml(value, a, n, filter === value));
      }
    }
    chips = `<div class="pb-filters mb-1 flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Filter pockets">` +
      items.join('') + `</div>`;
  }

  const shown = list.filter((p) => inFilter(p, filter, pace));
  const body = shown.length > 0
    ? shown.map((p) => pocketRowHtml(p, pace)).join('')
    : `<p class="pb-empty px-4 py-8 text-center text-sm text-slate-500">Nothing needs attention.</p>`;

  mount(container, chips + `<div class="pb-list flex flex-col">` + body + `</div>`);
  return filter;
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