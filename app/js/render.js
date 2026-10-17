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

/**
 * Bar segments as percentages of what was available this month (limit plus
 * carried-in; the limit alone when `available` is missing). `own` is this
 * month's money still unspent, `carried` is carried-in money still unspent.
 */
export function barSegments(p) {
  const pocket = p || {};
  const available = num(pocket.available) > 0 ? num(pocket.available) : num(pocket.limit);
  if (!(available > 0)) return { own: 0, carried: 0 };
  const balance = Math.max(0, num(pocket.balance));
  const carriedLeft = Math.min(Math.max(0, num(pocket.carriedIn)), balance);
  const ownLeft = balance - carriedLeft;
  const carried = Math.min(100, (carriedLeft / available) * 100);
  const own = Math.min(100 - carried, (ownLeft / available) * 100);
  return { own, carried };
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** '+R120 from Oct' for the month before `month` (YYYY-MM); '' when nothing was carried in. */
export function carryPillText(p, month) {
  const carriedIn = num((p || {}).carriedIn);
  if (!(carriedIn > 0)) return '';
  const m = /^(\d{4})-(\d{2})$/.exec(String(month ?? ''));
  const index = m ? Number(m[2]) - 2 : NaN;
  const name = MONTH_NAMES[((index % 12) + 12) % 12];
  return m && name ? `+${formatRand(carriedIn)} from ${name}` : `+${formatRand(carriedIn)} carried in`;
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
function barHtml(pct, status, pace, label, heightClass, carriedPct = 0) {
  const width = barWidth(pct);
  const carriedWidth = barWidth(carriedPct);
  const carriedFill = num(carriedPct) > 0
    ? `<span class="pb-carry absolute inset-y-0 block" style="left: ${width}%; width: ${carriedWidth}%"></span>`
    : '';
  const total = barWidth(num(pct) + num(carriedPct));
  const tick = pace && Number.isFinite(pace.elapsedPct)
    ? `<span class="pb-pocket__tick absolute -bottom-1 -top-1 -ml-px w-0.5 rounded-sm bg-slate-100/80"` +
      ` style="left: ${barWidth(100 - pace.elapsedPct)}%"></span>`
    : '';
  return (
    `<span class="pb-pocket__bar relative col-span-2 block ${heightClass} w-full rounded-full bg-slate-700" role="progressbar"` +
    ` aria-valuemin="0" aria-valuemax="100" aria-valuenow="${total}" aria-label="${esc(label)}">` +
    `<span class="pb-pocket__fill ${FILL_CLASS[status]} absolute inset-y-0 left-0 block rounded-full" style="width: ${width}%"></span>` +
    `${carriedFill}${tick}</span>`
  );
}

/* ----------------------------------------------------------- pocket row -- */

function isSavings(p) {
  return !!p && p.kind === 'Savings';
}

const RESET_PILL = `<span class="pb-pocket__reset shrink-0 rounded-full bg-slate-700 px-2 py-0.5 text-xs font-semibold text-slate-300">Reset</span>`;

function carryPill(text) {
  return text
    ? `<span class="pb-pocket__carry pb-carry-pill shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold">${esc(text)}</span>`
    : '';
}

/**
 * One pocket row: name, account, amount LEFT of the limit, and a bar of money
 * left with a pace tick. The whole row is the "add an expense here" target; it
 * only opens the add form, so a stray tap never writes anything.
 *
 * A depleted pocket carries a "Depleted" pill, an empty bar, and a disabled row —
 * the UI states the rule before the user can discover it through a server error.
 * Colour is never the only signal: every non-ok status also has a word.
 */
export function pocketRowHtml(p, pace = null, opts = {}) {
  const pocket = p || {};
  const status = pocketStatus(pocket, pace);
  const locked = status === 'out';
  const id = esc(pocket.id);
  const account = String(pocket.account ?? '').trim();
  const name = String(pocket.name ?? '');
  const seg = barSegments(pocket);
  const carriedIn = num(pocket.carriedIn);
  const carryText = carryPillText(pocket, opts && opts.month);
  const disabled = locked ? ' disabled aria-disabled="true"' : '';
  const label = locked
    ? `Add expense to ${name}, depleted`
    : `Add expense to ${name}, ${formatMoney(pocket.balance)} left of ${formatMoney(num(pocket.available) > 0 ? pocket.available : pocket.limit)}` +
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
    `${accountTag}${statusPill(status)}${carryPill(carryText)}${pocket.rule === 'Reset' ? RESET_PILL : ''}</span>` +
    `<span class="pb-pocket__amount whitespace-nowrap text-right font-bold tabular-nums text-slate-100">` +
    `<span class="pb-pocket__left">${esc(formatRand(pocket.balance))}</span>` +
    (carriedIn > 0
      ? ''
      : ` <span class="pb-pocket__limit text-xs font-normal text-slate-400">/ ${esc(formatRand(pocket.limit))}</span>`) +
    `</span>` +
    barHtml(seg.own, status, locked ? null : pace, `${name} money left`, 'h-1.5', seg.carried) +
    `</button>`
  );
}

/* ------------------------------------------------------------- summary -- */

/**
 * A ring of the share of the budget still left, with a marker where it should be
 * today. The marker is omitted when the month's pace is unknown.
 */
function ringHtml(pct, pace) {
  const r = 36;
  const c = 2 * Math.PI * r;
  const arc = (c * pct) / 100;
  const label = `${Math.round(pct)} percent of the budget left` +
    (pace && Number.isFinite(pace.elapsedPct) ? `, marker at ${Math.round(100 - pace.elapsedPct)} percent expected` : '');
  const marker = pace && Number.isFinite(pace.elapsedPct)
    ? `<line x1="48" y1="2" x2="48" y2="20" stroke="#f1f5f9" stroke-width="2.5"` +
      ` transform="rotate(${Math.round((100 - pace.elapsedPct) * 3.6 * 10) / 10} 48 48)"/>`
    : '';
  return (
    `<svg class="pb-sum__ring shrink-0" viewBox="0 0 96 96" width="96" height="96" role="img" aria-label="${esc(label)}">` +
    `<circle cx="48" cy="48" r="${r}" fill="none" stroke="#334155" stroke-width="10"/>` +
    `<circle cx="48" cy="48" r="${r}" fill="none" stroke="#10b981" stroke-width="10"` +
    ` stroke-dasharray="${arc.toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 48 48)"/>` +
    `${marker}` +
    `<text x="48" y="54" text-anchor="middle" fill="#f1f5f9" font-size="18" font-weight="700"` +
    ` font-family="system-ui, sans-serif">${esc(Math.round(pct))}%</text></svg>`
  );
}

/** "Day 7 of 31", or '' when the month's pace is unknown. */
export function dayLabel(pace) {
  return pace && Number.isFinite(pace.day) && Number.isFinite(pace.daysInMonth)
    ? `Day ${pace.day} of ${pace.daysInMonth}`
    : '';
}

/**
 * The dashboard header: a ring of the budget left (marker where it should be
 * today) beside money left this month, "of" the total limit, and one
 * plain-language verdict. Returns '' when there is no limit to speak of (no
 * pockets yet). The day of the month ("Day 7 of 31") sits on the page title's
 * line; see dayLabel().
 *
 * `summary` is the payload's { totalBalance, totalLimit, totalAvailable }; `pockets` supplies
 * the "needs a look" count; `pace` is monthProgress()'s result or null.
 */
export function summaryHtml(summary, pockets, pace = null) {
  const s = summary || {};
  const list = Array.isArray(pockets) ? pockets : [];
  const balance = Number(s.totalBalance);
  // The balance includes carried-in money, so measure it against limit plus carried-in.
  const limit = num(s.totalAvailable) > 0 ? Number(s.totalAvailable) : Number(s.totalLimit);
  if (!Number.isFinite(balance) || !Number.isFinite(limit) || limit <= 0) return '';

  const pct = Math.max(0, Math.min(100, (balance / limit) * 100));
  const attention = list.filter((p) => !isSavings(p) && pocketStatus(p, pace) !== 'ok').length;

  const needs = attention === 0
    ? 'All pockets on track'
    : `${attention} ${attention === 1 ? 'pocket needs' : 'pockets need'} a look`;
  const ahead = pace && Number.isFinite(pace.elapsedPct) && (100 - pct) > pace.elapsedPct + MONTH_AHEAD;
  const verdict = pace
    ? `<strong class="font-semibold text-slate-100">${ahead ? 'Spending ahead of pace' : 'On pace'}.</strong> ${esc(needs)}`
    : `<strong class="font-semibold text-slate-100">${esc(needs)}</strong>`;

  const carriedTotal = num(s.totalCarriedIn);
  const carriedNote = carriedTotal > 0 ? ` · includes ${esc(formatRand(carriedTotal))} carried in` : '';

  return (
    `<div class="pb-sum flex items-center gap-4">` +
    ringHtml(pct, pace) +
    `<div class="min-w-0">` +
    `<p class="text-xs font-semibold uppercase tracking-wide text-slate-400">Left this month</p>` +
    `<p class="pb-sum__left text-3xl font-extrabold tabular-nums text-slate-100">${esc(formatRand(balance))}</p>` +
    `<p class="pb-sum__of text-xs tabular-nums text-slate-400">of ${esc(formatRand(limit))}${carriedNote}</p>` +
    `<p class="pb-sum__verdict mt-0.5 text-xs text-slate-400">${verdict}</p>` +
    `</div></div>`
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
    ? `<p class="pb-row__note text-sm text-slate-200">${esc(note)}</p>`
    : '';

  const metaLine = meta
    ? `<p class="pb-row__meta text-xs text-slate-400">${meta}</p>`
    : '';

  return (
    `<li class="pb-row flex items-start gap-3 py-3">` +
    `<span class="pb-row__user shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold` +
    ` text-slate-700">${esc(txn.user)}</span>` +
    `<div class="min-w-0 flex-1">${noteLine}${metaLine}</div>` +
    `<span class="pb-row__amount shrink-0 text-sm font-semibold tabular-nums text-slate-100">` +
    `${esc(formatMoney(txn.amount))}</span>` +
    `<button type="button" class="pb-row__delete shrink-0 rounded p-1 text-slate-400 hover:text-rose-400"` +
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

const FULL_MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

/** "2026-10" -> "October"; anything unreadable -> ''. */
function monthName(key) {
  const m = /^\d{4}-(\d{2})$/.exec(String(key ?? ''));
  return m ? FULL_MONTH_NAMES[Number(m[1]) - 1] || '' : '';
}

/**
 * The "<Month> wrapped up" card on Home: what happened to last month's
 * leftovers. Empty string when there is no month-end to show. At most five
 * lines; every value is escaped.
 */
export function monthEndCardHtml(monthEnd) {
  if (!monthEnd || typeof monthEnd !== 'object') return '';
  const items = Array.isArray(monthEnd.items) ? monthEnd.items : [];
  const totals = monthEnd.totals || {};
  const title = `${monthName(monthEnd.fromMonth)} wrapped up`.trim();
  const count = items.length;
  const summary = `${formatRand(totals.all)} left over in ${count} ${count === 1 ? 'pocket' : 'pockets'}. Here's where it went.`;
  const lines = items.slice(0, 5).map((it) => {
    const item = it || {};
    let dest;
    if (item.type === 'sweep') dest = `<span class="pb-monthend__dest">\u2192 ${esc(item.toName)}</span>`;
    else if (item.type === 'forfeit') dest = '<span class="pb-monthend__dest pb-monthend__dest--reset">\u2192 reset</span>';
    else dest = '<span class="pb-monthend__dest">\u2192 carried</span>';
    return `<span class="pb-monthend__name">${esc(item.name)}</span>` +
      `<span class="pb-monthend__val"><strong>${esc(formatRand(item.amount))}</strong> ${dest}</span>`;
  }).join('');
  return (
    `<section class="pb-monthend" aria-labelledby="month-end-title">` +
    `<div class="pb-monthend__head"><div>` +
    `<h2 id="month-end-title" class="pb-monthend__title">${esc(title)}</h2>` +
    `<p class="pb-monthend__sub">${esc(summary)}</p></div>` +
    `<button type="button" class="pb-monthend__x" data-action="monthend-dismiss" aria-label="Dismiss">\u2715</button></div>` +
    `<div class="pb-monthend__lines">${lines}</div>` +
    `<div class="pb-monthend__actions">` +
    `<button type="button" class="pb-monthend__btn" data-action="monthend-review">Review &amp; change</button>` +
    `<button type="button" class="pb-monthend__btn pb-monthend__btn--ok" data-action="monthend-dismiss">Looks good</button>` +
    `</div></section>`
  );
}

/** Paint the month-end card into its container (empty when null). */
export function renderMonthEnd(container, monthEnd) {
  mount(container, monthEndCardHtml(monthEnd));
}

/** "2026-10" -> "November": the month after the one in `key`; anything unreadable -> ''. */
function nextMonthName(key) {
  const m = /^\d{4}-(\d{2})$/.exec(String(key ?? ''));
  return m ? FULL_MONTH_NAMES[Number(m[1]) % 12] || '' : '';
}

/** "A", "A and B", "A, B and C". */
function joinNames(names) {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * The banner offering to switch every Reset pocket to carry over. Empty string
 * when no active, non-Savings pocket still resets.
 */
export function resetBannerHtml(pockets) {
  const names = (Array.isArray(pockets) ? pockets : [])
    .filter((p) => p && p.kind !== 'Savings' && p.status !== 'Archived' && p.archived !== true && (p.rule || 'Reset') === 'Reset')
    .map((p) => esc(p.name));
  if (names.length === 0) return '';
  return (
    `<div class="pb-merev__banner">` +
    `<p class="pb-merev__bannertext"><strong>${joinNames(names)}</strong> still reset at month end.</p>` +
    `<button type="button" class="pb-merev__btn pb-merev__btn--warn" data-action="monthend-switch">Switch to carry over</button>` +
    `</div>`
  );
}

function reviewRowHtml(item, intoMonth) {
  const it = item || {};
  let where;
  let moveId = '';
  if (it.type === 'sweep') {
    where = `Swept to ${esc(it.toName)}`;
    moveId = it.toPocketId;
  } else if (it.type === 'forfeit') {
    where = '<span class="pb-merev__lost">Lost at reset</span>';
  } else {
    where = `Carried into ${esc(intoMonth)}`;
    moveId = it.pocketId;
  }
  const button = moveId
    ? `<button type="button" class="pb-merev__btn" data-action="monthend-move" data-pocket-id="${esc(moveId)}">Move\u2026</button>`
    : '<span></span>';
  return (
    `<div class="pb-merev__row">` +
    `<span class="pb-merev__name">${esc(it.name)}</span>` +
    `<span class="pb-merev__amt">${esc(formatRand(it.amount))}</span>` +
    `<span class="pb-merev__where">${where}</span>${button}</div>`
  );
}

/**
 * The month-end review screen as three pieces of escaped HTML: the reset
 * `banner`, one `list` row per item, and the `totals` strip.
 */
export function monthEndReviewHtml(monthEnd, pockets) {
  const data = monthEnd && typeof monthEnd === 'object' ? monthEnd : {};
  const items = Array.isArray(data.items) ? data.items : [];
  const totals = data.totals || {};
  const intoMonth = nextMonthName(data.fromMonth);
  const cell = (label, value, mod) =>
    `<div class="pb-merev__total"><p class="pb-merev__label">${label}</p>` +
    `<p class="pb-merev__value${mod}">${esc(formatRand(value))}</p></div>`;
  return {
    banner: resetBannerHtml(pockets),
    list: items.map((it) => reviewRowHtml(it, intoMonth)).join(''),
    totals: cell('Carried', totals.carried, ' pb-merev__value--carry') +
      cell('To Savings', totals.swept, '') +
      cell('Reset', totals.forfeited, ' pb-merev__value--reset'),
  };
}

/** Paint the month-end review screen into its three containers. */
export function renderMonthEndReview(containers, monthEnd, pockets) {
  const html = monthEndReviewHtml(monthEnd, pockets);
  const c = containers || {};
  mount(c.banner, html.banner);
  mount(c.list, html.list);
  mount(c.totals, html.totals);
}

/**
 * One Savings row: name, balance, a carry pill if any, and a line saying where
 * the money comes from. Savings has no limit, so it is never depleted or locked,
 * even at R0; the row is always a tappable "add an expense here" target.
 */
export function savingsRowHtml(p, opts = {}) {
  const pocket = p || {};
  const name = String(pocket.name ?? '');
  const carryText = carryPillText(pocket, opts && opts.month);
  return (
    `<button type="button" class="pb-pocket pb-savings grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2` +
    ` border-b border-slate-800 py-3 text-left"` +
    ` data-action="select-pocket" data-pocket-id="${esc(pocket.id)}" data-status="ok"` +
    ` aria-label="${esc(`Add expense to ${name}, ${formatMoney(pocket.balance)} saved`)}">` +
    `<span class="flex min-w-0 items-center gap-2">` +
    `<span class="pb-pocket__name truncate text-[15px] font-semibold text-slate-100">${esc(name)}</span>` +
    `${carryPill(carryText)}</span>` +
    `<span class="pb-pocket__amount whitespace-nowrap text-right font-bold tabular-nums text-slate-100">` +
    `<span class="pb-pocket__left">${esc(formatRand(pocket.balance))}</span></span>` +
    `<span class="pb-savings__note col-span-2 text-xs text-slate-400">No monthly limit · fed by leftovers and transfers</span>` +
    `</button>`
  );
}

/**
 * The Savings section: one row per Savings pocket. With none, the container
 * (and `opts.heading`, the section's title) is hidden and emptied.
 */
export function renderSavings(container, pockets, opts = {}) {
  const list = (Array.isArray(pockets) ? pockets : []).filter(isSavings);
  const heading = opts && opts.heading;
  for (const el of [container, heading]) {
    if (el && el.classList) el.classList.toggle('hidden', list.length === 0);
  }
  mount(container, list.length === 0
    ? ''
    : `<div class="pb-list flex flex-col">` +
      list.map((p) => savingsRowHtml(p, { month: opts && opts.month })).join('') + `</div>`);
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
  const list = (Array.isArray(pockets) ? pockets : []).filter((p) => !isSavings(p));
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
    ? shown.map((p) => pocketRowHtml(p, pace, { month: opts && opts.month })).join('')
    : `<p class="pb-empty px-4 py-8 text-center text-sm text-slate-500">Nothing needs attention.</p>`;

  const legend = list.some((p) => num(p && p.carriedIn) > 0)
    ? `<p class="pb-legend mt-2 text-xs text-slate-400">` +
      `<span class="pb-legend__item"><span class="pb-legend__swatch" style="background: #10b981"></span>This month's budget</span>` +
      `<span class="pb-legend__item"><span class="pb-legend__swatch pb-carry"></span>Carried in</span></p>`
    : '';

  mount(container, chips + `<div class="pb-list flex flex-col">` + body + `</div>` + legend);
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
      `<ul class="pb-day__list divide-y divide-slate-800">${rows.join('')}</ul>` +
      `</section>`
    );
  }).join('');

  mount(container, html);
}