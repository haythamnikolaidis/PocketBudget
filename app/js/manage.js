// app/js/manage.js
// The pocket management screen: create, rename, re-limit, archive.
//
// ---------------------------------------------------------------------------
// WHY THERE IS NO HARD DELETE ANYWHERE IN THIS FILE
// Transactions reference a pocket by id. Removing a pocket row would leave every
// one of those transactions pointing at nothing, so the family's history would
// be silently orphaned. Archiving is the only removal this screen offers, and
// it is a soft one: the row stays, `status` becomes 'Archived', and the home
// feed filters it out. If you are tempted to add a destructive action here,
// read backend/03_Sheets.gs.js first and do not.
// ---------------------------------------------------------------------------
//
// Two behaviours are load-bearing and easy to get subtly wrong:
//
//   1. The backend clamps a pocket's balance to its new limit (updatePocketRow
//      writes Math.min(Math.max(cur, 0), limit)). Lowering a limit under the
//      current balance therefore *reduces the balance*, server-side, with no
//      further prompt. Every path that can lower a limit under the balance says
//      so in plain words before the request goes out.
//   2. An archived pocket must not be editable here. It is filtered out of the
//      home feed, so an edit that appeared to succeed would be a change nobody
//      can see.

import { formatMoney, isValidAmount, parseAmountText, balanceAfterLimitChange } from './format.js';
import { esc } from './render.js';

/* ------------------------------------------------------------- helpers -- */

/** 'R1,200.50' -> 1200.5. Shares isValidAmount's cleaning so both agree. */
function parseAmount(raw) {
  const n = parseAmountText(raw);
  return Number.isFinite(n) ? n : NaN;
}

/** Coerce to a finite number; 0 for anything unusable. */
function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** A pocket is archived if the backend says so, by either spelling. */
function isArchived(p) {
  if (!p) return true;
  return p.status === 'Archived' || p.archived === true;
}

/** Active pockets, in the order the backend supplied them. */
function activePockets(state) {
  const list = state && Array.isArray(state.pockets) ? state.pockets : [];
  return list.filter((p) => p && p.id != null && !isArchived(p));
}

/**
 * Swap escaped markup into `container` using an inert <template>, the same path
 * render.js uses. Never assign innerHTML on a live element.
 */
function paint(container, html) {
  if (!container) return;
  const doc = globalThis.document;
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

/* ---------------------------------------------------------------- rows -- */

/**
 * One pocket row: name, account, the current balance against its limit, and
 * Edit + Archive. Every user-supplied value goes through esc().
 *
 * `data-action` / `data-pocket-id` are the delegation keys the click handler
 * reads, so the handler survives a re-render without rebinding per row.
 */
function rowHtml(p) {
  const id = esc(p.id);
  const account = String(p.account ?? '').trim();
  const accountLine = account
    ? `<p class="pb-manage__account text-xs text-slate-500">${esc(account)}</p>`
    : '';

  return (
    `<li class="pb-manage__row flex items-start justify-between gap-3 rounded-xl border` +
    ` border-slate-200 bg-white p-3" data-pocket-id="${id}">` +
    `<div class="min-w-0">` +
    `<p class="pb-manage__name truncate text-sm font-semibold text-slate-900">${esc(p.name)}</p>` +
    accountLine +
    `<p class="pb-manage__amount mt-1 text-xs tabular-nums text-slate-600">` +
    `<span class="pb-manage__balance">${esc(formatMoney(p.balance))}</span> of` +
    `<span class="pb-manage__limit"> ${esc(formatMoney(p.limit))}</span></p>` +
    `</div>` +
    `<div class="pb-manage__actions flex shrink-0 gap-2">` +
    `<button type="button" class="pb-manage__edit rounded-lg border border-slate-300 px-2.5 py-1` +
    ` text-xs font-semibold text-slate-700" data-action="edit" data-pocket-id="${id}">Edit</button>` +
    `<button type="button" class="pb-manage__archive rounded-lg border border-slate-300 px-2.5` +
    ` py-1 text-xs font-semibold text-slate-500" data-action="archive"` +
    ` data-pocket-id="${id}">Archive</button>` +
    `</div></li>`
  );
}

/**
 * The warning for a limit change that would pull the balance down, and the same
 * sentence used as the confirm text. Both figures are named explicitly, because
 * "the limit changed" is exactly the kind of message a user reads past and then
 * cannot explain a missing balance.
 */
function clampWarning(newLimit, pocket) {
  const next = balanceAfterLimitChange(pocket.balance, pocket.limit, newLimit);
  return (
    `Lowering the limit to ${formatMoney(newLimit)} will also reduce the current balance,` +
    ` currently ${formatMoney(pocket.balance)}, to ${formatMoney(next)}.`
  );
}

/** The gentler note for a raise: the extra limit becomes extra balance. */
function raiseNote(newLimit, pocket) {
  const next = balanceAfterLimitChange(pocket.balance, pocket.limit, newLimit);
  return (
    `Raising the limit to ${formatMoney(newLimit)} adds ${formatMoney(next - num(pocket.balance))}` +
    ` to the current balance, making it ${formatMoney(next)}.`
  );
}

/* ------------------------------------------------------------- mounting -- */

/**
 * Mount the pocket management screen into `root`.
 *
 * @param {object}   opts
 * @param {Element}  opts.root       element to query the manage-* ids from
 * @param {object}   opts.api        api client (createPocket / updatePocket)
 * @param {object}   opts.state      latest getState payload
 * @param {Function} opts.onChanged  called after any successful mutation
 * @param {Function} [opts.toast]    optional success message sink
 * @returns {Function} teardown
 */
export function mountManage({ root, api, state, onChanged, toast } = {}) {
  /** Latest getState payload; replaced by update() so a refresh never re-mounts this screen. */
  let current = state;

  const pick = (id) => (root && typeof root.querySelector === 'function' ? root.querySelector('#' + id) : null);

  const list = pick('manage-list');
  const form = pick('manage-form');
  const nameInput = pick('manage-name');
  const accountInput = pick('manage-account');
  const limitInput = pick('manage-limit');
  const submitBtn = pick('manage-submit');
  const reasonEl = pick('manage-reason');

  /** id of the pocket being edited, or null when the form is in create mode. */
  let editingId = null;
  let busy = false;

  /* ------------------------------------------------------------- state -- */

  const say = (message) => {
    if (!reasonEl) return;
    reasonEl.textContent = message || '';
    if (message) {
      if (reasonEl.classList && typeof reasonEl.classList.remove === 'function') {
        reasonEl.classList.remove('hidden');
      }
    } else if (reasonEl.classList && typeof reasonEl.classList.add === 'function') {
      reasonEl.classList.add('hidden');
    }
  };

  const notify = (message) => {
    if (typeof toast === 'function') {
      try { toast(message); } catch (_) { /* a broken toast must not break the save */ }
    }
  };

  const announce = () => {
    if (typeof onChanged === 'function') onChanged();
  };

  const findPocket = (id) => activePockets(current).find((p) => String(p.id) === String(id));

  /* ------------------------------------------------------------ render -- */

  const render = () => {
    const pockets = activePockets(current);
    if (pockets.length === 0) {
      paint(list, '<p class="pb-empty px-1 py-6 text-center text-sm text-slate-500">' +
        'No active pockets yet. Create one below.</p>');
      return;
    }
    paint(list, '<ul class="pb-manage__list space-y-3">' +
      pockets.map(rowHtml).join('') + '</ul>');
  };

  /* ------------------------------------------------------------- form -- */

  const setMode = (editing) => {
    editingId = editing ? String(editing) : null;
    if (submitBtn) {
      submitBtn.textContent = editing ? 'Save changes' : 'Create pocket';
    }
  };

  const clearFields = () => {
    for (const input of [nameInput, accountInput, limitInput]) {
      if (input) input.value = '';
    }
  };

  const loadIntoForm = (p) => {
    if (nameInput) nameInput.value = String(p.name ?? '');
    if (accountInput) accountInput.value = String(p.account ?? '');
    if (limitInput) limitInput.value = String(num(p.limit));
  };

  /**
   * True when the pending limit would drag the balance down. Only meaningful
   * while editing a specific pocket: a brand new pocket starts at balance ===
   * limit, so a create can never clamp anything.
   */
  const wouldClamp = (limit, pocket) =>
    Boolean(pocket) && Number.isFinite(limit)
    && balanceAfterLimitChange(pocket.balance, pocket.limit, limit) < num(pocket.balance);

  const wouldRaise = (limit, pocket) =>
    Boolean(pocket) && Number.isFinite(limit)
    && balanceAfterLimitChange(pocket.balance, pocket.limit, limit) > num(pocket.balance);

  /** The pocket currently loaded into the form, or null in create mode. */
  const editingPocket = () => (editingId === null ? null : findPocket(editingId));

  /**
   * `globalThis.confirm` is read at call time so tests can substitute it and so
   * a non-browser host (no confirm) degrades to "ask as much as we can" rather
   * than throwing. Returns true when there is no dialog to ask.
   */
  const ask = (message) => {
    if (typeof globalThis.confirm !== 'function') return true;
    return globalThis.confirm(message) === true;
  };

  /* ----------------------------------------------------------- mutations -- */

  const create = async ({ name, account, limit }) => {
    await api.createPocket({ name, account, limit });
    clearFields();
    setMode(null);
    say('');
    notify(`Created ${name}.`);
    announce();
  };

  const update = async ({ pocket, name, account, limit }) => {
    await api.updatePocket({ pocketId: String(pocket.id), name, account, limit });
    clearFields();
    setMode(null);
    say('');
    notify(`Saved ${name}.`);
    announce();
  };

  const archive = async (pocket) => {
    await api.updatePocket({ pocketId: String(pocket.id), archive: true });
    if (editingId === String(pocket.id)) {
      clearFields();
      setMode(null);
    }
    say('');
    notify(`Archived ${String(pocket.name ?? '').trim()}.`);
    announce();
  };

  /* ----------------------------------------------------------- handlers -- */

  const onListClick = (ev) => {
    const btn = ev && ev.target && typeof ev.target.closest === 'function'
      ? ev.target.closest('[data-action]')
      : null;
    if (!btn) return;
    const dataset = btn.dataset || {};
    const action = String(dataset.action || '');
    const pocket = findPocket(dataset.pocketId);
    // An unknown or archived pocket gets no action at all.
    if (!pocket) return;

    if (action === 'edit') {
      if (editingId === String(pocket.id)) {
        clearFields();       // second click on the same row cancels the edit
        setMode(null);
        say('');
        return;
      }
      loadIntoForm(pocket);
      setMode(pocket.id);
      say('');
      if (typeof (nameInput && nameInput.focus) === 'function') nameInput.focus();
      return;
    }

    if (action === 'archive') {
      if (busy) return;
      const label = String(pocket.name ?? '').trim();
      const ok = ask(
        `Archive ${label}? It will be hidden from your pocket list,` +
        ` but its transactions are kept.`
      );
      if (!ok) return;
      busy = true;
      Promise.resolve()
        .then(() => archive(pocket))
        .catch((err) => { say(describe(err)); })
        .finally(() => { busy = false; });
    }
  };

  const onLimitInput = () => {
    const pocket = editingPocket();
    if (!pocket) return;
    const limit = parseAmount(limitInput && limitInput.value);
    if (Number.isFinite(limit) && wouldClamp(limit, pocket)) {
      say(clampWarning(limit, pocket));
    } else if (Number.isFinite(limit) && wouldRaise(limit, pocket)) {
      say(raiseNote(limit, pocket));
    }
  };

  const onSubmit = (ev) => {
    if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
    if (busy) return;

    const name = String((nameInput && nameInput.value) || '').trim();
    const account = String((accountInput && accountInput.value) || '').trim();
    const rawLimit = limitInput && limitInput.value;
    const limit = parseAmount(rawLimit);

    if (name === '') {
      say('Pocket name is required.');
      return;
    }
    if (!isValidAmount(rawLimit)) {
      say('Enter a monthly limit greater than zero.');
      return;
    }

    const pocket = editingPocket();
    if (editingId !== null && !pocket) {
      // The pocket vanished or was archived out from under the open edit.
      clearFields();
      setMode(null);
      say('That pocket is no longer editable. Create a new one instead.');
      return;
    }

    if (pocket && wouldClamp(limit, pocket) &&
        !ask(clampWarning(limit, pocket))) {
      say(clampWarning(limit, pocket));
      return;
    }

    busy = true;
    if (submitBtn) submitBtn.disabled = true;
    const done = pocket
      ? update({ pocket, name, account, limit })
      : create({ name, account, limit });

    Promise.resolve(done)
      .catch((err) => { say(describe(err)); })
      .finally(() => {
        busy = false;
        if (submitBtn) submitBtn.disabled = false;
      });
  };

  /** Readable text for anything thrown by the api client. */
  function describe(err) {
    if (err && typeof err.message === 'string' && err.message.trim() !== '') {
      return err.message.trim();
    }
    return 'Something went wrong. Please try again.';
  }

  /* ---------------------------------------------------------- listeners -- */

  const bindings = [
    [list, 'click', onListClick],
    [form, 'submit', onSubmit],
    [limitInput, 'input', onLimitInput],
  ];
  for (const [target, type, fn] of bindings) {
    if (target && typeof target.addEventListener === 'function') {
      target.addEventListener(type, fn);
    }
  }

  render();

  function teardown() {
    for (const [target, type, fn] of bindings) {
      if (target && typeof target.removeEventListener === 'function') {
        target.removeEventListener(type, fn);
      }
    }
    editingId = null;
    busy = false;
  }

  /**
   * Take a refreshed payload WITHOUT rebuilding the screen. Re-mounting on every
   * refresh (including the one when you switch back to the app) reset the edit
   * mode and the busy flag while leaving the typed values behind, so "Save
   * changes" on an edited pocket quietly became "Create pocket" and made a
   * duplicate.
   */
  teardown._applyState = (next) => {
    current = next;
    render();
    if (editingId !== null && !findPocket(editingId)) {
      // The pocket being edited was archived or removed elsewhere.
      clearFields();
      setMode(null);
      say('That pocket is no longer editable. Create a new one instead.');
    } else if (editingId !== null) {
      onLimitInput();   // the balance may have moved: refresh the warning
    }
  };

  return teardown;
}

/**
 * Push a refreshed getState payload into a mounted manage screen.
 * @param {Function} mounted the teardown returned by mountManage()
 * @param {object} state
 */
export function updateManageState(mounted, state) {
  if (typeof mounted === 'function' && typeof mounted._applyState === 'function') {
    mounted._applyState(state);
  }
}