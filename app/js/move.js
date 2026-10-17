// Move money: the pure logic behind the Move money screen.
// All arithmetic is done in integer cents so 0.10 + 0.20 stays exact.

import { formatMoney, parseAmountText } from './format.js';

const cents = (rands) => Math.round((Number(rands) || 0) * 100);

/** Pockets that are not archived, in the order the state supplies them. */
export function activePockets(state) {
  const list = state && Array.isArray(state.pockets) ? state.pockets : [];
  return list.filter((p) => p && p.id != null && p.status !== 'Archived' && p.archived !== true);
}

function findPocket(state, id) {
  return activePockets(state).find((p) => String(p.id) === String(id)) || null;
}

/** The typed amount in cents, or 0 when it is not a positive amount. */
function amountCents(amountText) {
  const n = parseAmountText(amountText);
  return Number.isFinite(n) && n > 0 ? cents(n) : 0;
}

/** null when the move is fine, otherwise the message to show. */
export function moveProblem(state, fromId, toId, amountText) {
  const from = findPocket(state, fromId);
  const to = findPocket(state, toId);
  if (!from || !to || String(fromId) === String(toId)) return 'Choose two different pockets.';
  const amount = amountCents(amountText);
  if (amount <= 0) return 'Enter an amount greater than zero.';
  if (amount > cents(from.balance)) return `Only ${formatMoney(from.balance)} left in ${from.name}.`;
  return null;
}

/** Balances before and after the move, in rands; null when the amount is invalid. */
export function movePreview(state, fromId, toId, amountText) {
  const from = findPocket(state, fromId);
  const to = findPocket(state, toId);
  const amount = amountCents(amountText);
  if (!from || !to || String(fromId) === String(toId) || amount <= 0) return null;
  return {
    from: { name: from.name, before: cents(from.balance) / 100, after: (cents(from.balance) - amount) / 100 },
    to: { name: to.name, before: cents(to.balance) / 100, after: (cents(to.balance) + amount) / 100 },
  };
}

/** Quick-pick amounts that fit in the balance, then "all of it". */
export function quickAmounts(balance) {
  const bal = cents(balance);
  const out = [100, 200, 300].filter((n) => n * 100 <= bal);
  if (bal > 0) out.push({ all: bal / 100 });
  return out;
}

/**
 * The household member to record a move against: the name remembered on this phone
 * when the server still lists it, else the first listed member. With no household
 * list to check against, the remembered name is passed through for the server to judge.
 */
export function actingUser(saved, users) {
  const list = (Array.isArray(users) ? users : []).map((u) => String(u ?? '').trim()).filter(Boolean);
  const name = String(saved ?? '').trim();
  if (list.length === 0) return name;
  return list.includes(name) ? name : list[0];
}

/** What to tell the person when a move fails; an unknown user gets a way forward. */
export function moveFailureMessage(err, user) {
  if (err && err.code === 'INVALID_USER') {
    return `"${user}" is not a household member. Pick your name on the Add screen, then try again.`;
  }
  return err && err.message ? String(err.message) : 'Could not move the money.';
}

/* ------------------------------------------------------------ the screen -- */

/** A fresh idempotency key: a UUID where available, else a random string of the same shape. */
function newRequestId() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const rand = () => Math.random().toString(16).slice(2, 10).padEnd(8, '0');
  return rand() + '-' + rand() + '-' + Date.now().toString(16);
}

/**
 * Wire the Move money screen.
 *
 * @param {object} deps
 * @param {Element} deps.root      the #view-move section
 * @param {object}  deps.api       a makeApi() client
 * @param {Function} deps.getState () => the latest state
 * @param {Function} deps.getUser  () => the household member using this phone
 * @param {Function} deps.onDone   called after a successful move
 * @param {Function} deps.toast    (message, kind) => void
 * @param {Document} [deps.doc]
 * @returns {{ open: (fromId?: string) => void }}
 */
export function mountMove({ root, api, getState, getUser, onDone, toast, doc } = {}) {
  const ownerDoc = doc || (root && root.ownerDocument) || globalThis.document || null;
  const pick = (id) => {
    if (root && typeof root.querySelector === 'function') {
      const found = root.querySelector('#' + id);
      if (found) return found;
    }
    return ownerDoc && typeof ownerDoc.getElementById === 'function' ? ownerDoc.getElementById(id) : null;
  };

  const fromEl = pick('move-from');
  const toEl = pick('move-to');
  const swapEl = pick('move-swap');
  const amountEl = pick('move-amount');
  const quickEl = pick('move-quick');
  const noteEl = pick('move-note');
  const previewEl = pick('move-preview');
  const reasonEl = pick('move-reason');
  const submitEl = pick('move-submit');

  let inFlight = false;
  /** The in-doubt attempt, if any: `{ id, fingerprint }`. Retrying the same move reuses its id. */
  let pendingAttempt = null;

  const state = () => (typeof getState === 'function' ? getState() : null) || {};
  const make = (tag, text) => {
    const el = ownerDoc.createElement(tag);
    if (text !== undefined) el.textContent = text;
    return el;
  };
  const clear = (el) => { if (el) el.textContent = ''; };
  const notify = (message, kind) => {
    try { if (typeof toast === 'function') toast(message, kind); } catch (_) { /* nothing more to do */ }
  };

  function fillSelect(select, pockets, selectedId) {
    clear(select);
    for (const p of pockets) {
      const option = make('option', `${p.name} \u2014 ${formatMoney(p.balance)} left`);
      option.value = String(p.id);
      select.appendChild(option);
    }
    select.value = String(selectedId ?? '');
  }

  function drawQuick(fromId) {
    if (!quickEl) return;
    clear(quickEl);
    const from = activePockets(state()).find((p) => String(p.id) === String(fromId));
    if (!from) return;
    for (const q of quickAmounts(from.balance)) {
      const all = typeof q === 'object';
      const value = all ? q.all : q;
      const chip = make('button', all ? `All ${formatMoney(value)}` : `R${value}`);
      chip.type = 'button';
      chip.className = 'pb-chip';
      chip.addEventListener('click', () => {
        amountEl.value = Number(value).toFixed(2);
        redraw();
      });
      quickEl.appendChild(chip);
    }
  }

  function drawPreview(preview) {
    if (!previewEl) return;
    clear(previewEl);
    if (!preview) return;
    for (const side of [preview.from, preview.to]) {
      previewEl.appendChild(make('span', side.name));
      const figures = make('span', `${formatMoney(side.before)} \u2192 `);
      figures.appendChild(make('strong', formatMoney(side.after)));
      previewEl.appendChild(figures);
    }
  }

  function redraw() {
    const fromId = fromEl ? fromEl.value : '';
    const toId = toEl ? toEl.value : '';
    const text = amountEl ? amountEl.value : '';
    const problem = moveProblem(state(), fromId, toId, text);
    drawQuick(fromId);
    drawPreview(movePreview(state(), fromId, toId, text));
    if (reasonEl) {
      const show = problem !== null && String(text).trim() !== '';
      reasonEl.textContent = show ? problem : '';
      reasonEl.classList.toggle('hidden', !show);
    }
    if (submitEl) {
      submitEl.disabled = problem !== null || inFlight;
      const n = parseAmountText(text);
      submitEl.textContent = problem === null ? `Move ${formatMoney(n)}` : 'Move money';
    }
  }

  function open(fromId) {
    const pockets = activePockets(state());
    const first = pockets.find((p) => String(p.id) === String(fromId)) || pockets[0] || null;
    const other = pockets.find((p) => first && p.id !== first.id) || null;
    if (fromEl) fillSelect(fromEl, pockets, first && first.id);
    if (toEl) fillSelect(toEl, pockets, other && other.id);
    if (amountEl) amountEl.value = '';
    if (noteEl) noteEl.value = '';
    pendingAttempt = null;
    redraw();
  }

  async function submit() {
    if (inFlight) return;
    const fromPocketId = String(fromEl ? fromEl.value : '');
    const toPocketId = String(toEl ? toEl.value : '');
    const text = amountEl ? amountEl.value : '';
    if (moveProblem(state(), fromPocketId, toPocketId, text) !== null) return;

    const amount = parseAmountText(text);
    const note = noteEl ? String(noteEl.value || '').trim() : '';
    const user = typeof getUser === 'function' ? String(getUser() ?? '') : '';
    if (!user) {
      notify('No household member is set up, so this move cannot be recorded.', 'error');
      return;
    }
    const payload = { user, fromPocketId, toPocketId, amount, note };

    const fingerprint = JSON.stringify([user, fromPocketId, toPocketId, amount, note]);
    if (!pendingAttempt || pendingAttempt.fingerprint !== fingerprint) {
      pendingAttempt = { id: newRequestId(), fingerprint };
    }
    payload.requestId = pendingAttempt.id;

    const toPocket = activePockets(state()).find((p) => String(p.id) === toPocketId);
    inFlight = true;
    if (submitEl) submitEl.disabled = true;
    try {
      await api.transferFunds(payload);
      pendingAttempt = null;
      notify(`Moved ${formatMoney(amount)} to ${toPocket ? toPocket.name : 'the pocket'}.`, 'success');
      if (typeof onDone === 'function') onDone();
    } catch (err) {
      notify(moveFailureMessage(err, user), 'error');
    } finally {
      inFlight = false;
      redraw();
    }
  }

  const listen = (el, type, fn) => { if (el) el.addEventListener(type, fn); };
  listen(fromEl, 'change', redraw);
  listen(toEl, 'change', redraw);
  listen(amountEl, 'input', redraw);
  listen(noteEl, 'input', redraw);
  listen(swapEl, 'click', () => {
    if (!fromEl || !toEl) return;
    const was = fromEl.value;
    fromEl.value = toEl.value;
    toEl.value = was;
    redraw();
  });
  listen(submitEl, 'click', () => { submit(); });

  return { open };
}
