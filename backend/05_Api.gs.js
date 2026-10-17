// backend/05_Api.gs.js
// CANONICAL SOURCE. `backend/*.gs` is generated from this file by `npm run build`.
//
// Invariants enforced here:
//   1. Auth is checked before any data is read or written.
//   2. A balance can never go negative.
//   3. The script lock is always released, even on the rejection paths, and only
//      after the writes made under it have been flushed to the sheet.
//   4. No handler throws to the client; failures come back as { ok:false, error }.

import { ACTIONS, SHEETS, LOCK_TIMEOUT_MS, MAX_NAME_LENGTH } from './00_Config.gs.js';
import {
  toDollars, parseAmountInput, isValidUser, isValidRequestId, money, ok, fail,
} from './01_Utils.gs.js';
import { verifyToken, getUsers } from './02_Auth.gs.js';
import {
  readPockets, readTransactions, readRecentTransactions, readAdjustments, findPocketRow, writeBalance,
  writePocketRollover, getAdjustmentSheet, appendTransaction, appendPocket, updatePocketRow, archivePocketRow,
  deleteTransactionRow, getTransactionRecord, findTransactionByRequestId, flushWrites,
  appendAdjustments, findAdjustmentByRequestId,
} from './03_Sheets.gs.js';
import { monthKey, localParts, applyRollover, shouldRollover } from './04_Rollover.gs.js';

/* --------------------------------------------------------------- helpers -- */

/** Round dollars to 2dp. Every value crossing the API boundary goes through this. */
const r2 = (n) => Math.round(Number(n) * 100) / 100;

/**
 * Release the script lock, flushing buffered writes first. Without the flush,
 * the next request can take the lock and still read the pre-write balance.
 */
function unlock(lock) {
  try {
    flushWrites();
  } finally {
    lock.releaseLock();
  }
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Roll the month over if it has changed. CALLER MUST HOLD THE SCRIPT LOCK. Returns true if it rolled. */
export function rolloverIfDue(now = new Date()) {
  const props = PropertiesService.getScriptProperties();
  const lastKey = props.getProperty('LAST_ROLLOVER_KEY');

  if (!lastKey) {
    // No record of ever rolling over: this is either a brand-new install or one set
    // up before the key existed. Either way, resetting now would wipe whatever has
    // been spent so far this month. Record the month and start rolling from the next.
    props.setProperty('LAST_ROLLOVER_KEY', monthKey(now));
    if (typeof Logger !== 'undefined') {
      Logger.log('PocketBudget rollover: first run, recorded ' + monthKey(now) + ' without resetting.');
    }
    return false;
  }
  if (!shouldRollover(lastKey, now)) return false;

  const pockets = readPockets({ includeArchived: true });
  const fromMonthLabel = MONTH_NAMES[Number(lastKey.slice(5, 7)) - 1] || '';
  const { pockets: reset, adjustments, resetCount } = applyRollover(pockets, { fromMonthLabel });
  reset.forEach((after) => {
    if (after.status === 'Active') writePocketRollover(after.id, after.balance, after.carriedIn);
  });
  if (adjustments.length) {
    if (getAdjustmentSheet()) {
      appendAdjustments(adjustments.map((a) => ({ ...a, month: monthKey(now), user: 'system', timestamp: now })));
    } else if (typeof Logger !== 'undefined') {
      Logger.log('PocketBudget rollover: Adjustments sheet is missing, so ' + adjustments.length + ' leftover rows were not recorded. Run migrateV2().');
    }
  }
  props.setProperty('LAST_ROLLOVER_KEY', monthKey(now));
  if (typeof Logger !== 'undefined') {
    Logger.log('PocketBudget rollover: reset ' + resetCount + ' pockets for ' + monthKey(now));
  }
  return true;
}

/**
 * Validate a pocket name / account. Returns an error envelope, or null when fine.
 * `required` is true for a name (never blank), false for an optional account.
 */
function checkText(value, label, required) {
  const text = String(value).trim();
  if (required && !text) return fail('INVALID_NAME', label + ' is required.');
  if (text.length > MAX_NAME_LENGTH) {
    return fail('INVALID_NAME', label + ' must be ' + MAX_NAME_LENGTH + ' characters or fewer.');
  }
  return null;
}

/** Shape a stored pocket row into the API's pocket object. */
function presentPocket(p, spentByPocket = {}) {
  const spent = r2(p.limit - p.balance);
  const monthSpent = spentByPocket[p.id] ?? spent;
  const carriedIn = p.carriedIn || 0;
  const available = r2(p.limit + carriedIn);
  return {
    id: p.id,
    name: p.name,
    account: p.account,
    limit: r2(p.limit),
    balance: r2(p.balance),
    spent: r2(monthSpent),
    pctUsed: available > 0 ? r2((monthSpent / available) * 100) : 0,
    isLocked: p.balance <= 0,
    rule: p.rule || 'Reset',
    sweepTo: p.sweepTo || '',
    carriedIn: r2(carriedIn),
    kind: p.kind || 'Spend',
    available,
  };
}

/**
 * Validate a leftover rule for a pocket. Returns an error envelope, or null when fine.
 * `selfId` is the pocket being edited ('' for a new one) so Sweep cannot point at itself.
 */
function checkRule(rule, sweepTo, limitCents, selfId) {
  if (rule !== 'Carry' && rule !== 'Reset' && rule !== 'Sweep') {
    return fail('INVALID_RULE', 'Leftover rule must be Carry, Reset or Sweep.');
  }
  if (rule === 'Sweep') {
    const target = readPockets().find((p) => p.id === sweepTo);
    if (!target || target.id === selfId) {
      return fail('INVALID_RULE', 'Sweep needs another active pocket to move the leftover into.');
    }
  }
  if (limitCents === 0 && rule === 'Reset') {
    return fail('INVALID_AMOUNT', 'A pocket that resets needs a monthly limit above R0.');
  }
  return null;
}

/* --------------------------------------------------------------- handlers -- */

/** Liveness + version. Still requires a token, so it doubles as a config check. */
export function ping(params) {
  if (!verifyToken(params.token)) return fail('UNAUTHORIZED', 'Invalid or missing token.');
  return ok({ serverTime: new Date().toISOString() });
}

/**
 * The "what happened to last month's leftovers" banner for the first week of a month.
 * Null after day 7 or when the rollover left nothing to report. Sums are done in cents.
 */
export function buildMonthEnd(adjustments, pockets, now = new Date()) {
  const { year, month, day } = localParts(now);
  if (day > 7) return null;
  const nameOf = (id) => {
    const p = (pockets || []).find((x) => x.id === id);
    return p ? p.name : '';
  };
  const items = (adjustments || [])
    .filter((a) => a.type === 'carry' || a.type === 'sweep' || a.type === 'forfeit')
    .map((a) => {
      const pocketId = a.type === 'carry' ? a.toPocketId : a.fromPocketId;
      const toPocketId = a.type === 'sweep' ? a.toPocketId : '';
      return {
        pocketId, name: nameOf(pocketId), type: a.type, amount: r2(a.amount),
        toPocketId, toName: toPocketId ? nameOf(toPocketId) : '',
      };
    })
    .sort((a, b) => b.amount - a.amount);
  if (items.length === 0) return null;
  const cents = { carry: 0, sweep: 0, forfeit: 0 };
  for (const it of items) cents[it.type] += Math.round(it.amount * 100);
  const prev = month === 1 ? { y: year - 1, m: 12 } : { y: year, m: month - 1 };
  return {
    fromMonth: prev.y + '-' + String(prev.m).padStart(2, '0'),
    items,
    totals: {
      carried: cents.carry / 100,
      swept: cents.sweep / 100,
      forfeited: cents.forfeit / 100,
      all: (cents.carry + cents.sweep + cents.forfeit) / 100,
    },
  };
}

/**
 * The whole home screen in one round trip.
 * `spent` is month-scoped so it survives rollover; `balance` is the live figure.
 */
export function getState(params) {
  if (!verifyToken(params.token)) return fail('UNAUTHORIZED', 'Invalid or missing token.');

  // The first read of a new month rolls it over; the nightly trigger is only a backup.
  // When the month has not changed no lock is taken, so reads stay fast.
  const props = PropertiesService.getScriptProperties();
  if (shouldRollover(props.getProperty('LAST_ROLLOVER_KEY'))) {
    const lock = LockService.getScriptLock();
    if (lock.tryLock(LOCK_TIMEOUT_MS)) {
      try { rolloverIfDue(); } finally { unlock(lock); }
    } // busy: skip; the next request will do it
  }

  const month = params.month || monthKey(new Date());
  const everyPocket = readPockets({ includeArchived: true });
  const pockets = everyPocket.filter((p) => p.status !== 'Archived');
  const archivedPockets = everyPocket
    .filter((p) => p.status === 'Archived')
    .map((p) => ({ id: p.id, name: p.name, account: p.account, limit: r2(p.limit) }));
  // Only the recent tail of the Transactions sheet is read (this month and newer, plus
  // enough rows for the feed), sorted newest-first, so the feed is just its head.
  const everyTransaction = readRecentTransactions({ month });
  const transactions = everyTransaction.slice(0, 10);

  const spentByPocket = {};
  for (const t of everyTransaction) {
    if (!t.timestamp || monthKey(new Date(t.timestamp)) !== month) continue;
    spentByPocket[t.pocketId] = (spentByPocket[t.pocketId] || 0) + t.amount;
  }

  const present = pockets.map((p) => presentPocket(p, spentByPocket));
  const sum = (k) => r2(present.filter((p) => p.kind !== 'Savings').reduce((s, p) => s + p[k], 0));

  return ok({
    serverTime: new Date().toISOString(),
    month,
    pockets: present,
    archivedPockets,
    transactions,
    adjustments: readAdjustments({ month }),
    monthEnd: buildMonthEnd(readAdjustments({ month: monthKey(new Date()) }), everyPocket, new Date()),
    summary: {
      totalLimit: sum('limit'),
      totalAvailable: sum('available'),
      totalBalance: sum('balance'),
      totalSpent: sum('spent'),
      totalCarriedIn: sum('carriedIn'),
      users: getUsers(),
    },
  });
}

/** Dollars (or a stored number) to whole cents; lenient, unlike the strict parser `toCents` in 01_Utils. */
const dollarsToCents = (n) => Math.round(Number(n) * 100);

/**
 * Where a pocket's money went this month, worked in cents and returned in dollars.
 * `left = limit + carriedIn + movedIn - movedOut - spent`.
 */
export function pocketBreakdown(pocket, transactions = [], adjustments = []) {
  const moves = adjustments.filter((a) => a.type === 'transfer' || a.type === 'sweep');
  const movedIn = moves.filter((a) => a.toPocketId === pocket.id).reduce((s, a) => s + dollarsToCents(a.amount), 0);
  const movedOut = moves.filter((a) => a.fromPocketId === pocket.id).reduce((s, a) => s + dollarsToCents(a.amount), 0);
  const spent = transactions.reduce((s, t) => s + dollarsToCents(t.amount), 0);
  const limit = dollarsToCents(pocket.limit);
  const carriedIn = dollarsToCents(pocket.carriedIn || 0);
  return {
    limit: toDollars(limit),
    carriedIn: toDollars(carriedIn),
    movedIn: toDollars(movedIn),
    movedOut: toDollars(movedOut),
    spent: toDollars(spent),
    count: transactions.length,
    left: toDollars(limit + carriedIn + movedIn - movedOut - spent),
  };
}

/** One pocket's month: its transactions, the adjustments touching it, and the breakdown. A read: no lock. */
export function getPocket(params) {
  if (!verifyToken(params.token)) return fail('UNAUTHORIZED', 'Invalid or missing token.');

  const pocketId = String(params.pocketId ?? '');
  const pocket = readPockets({ includeArchived: true }).find((p) => p.id === pocketId);
  if (!pocket) return fail('POCKET_NOT_FOUND', 'Pocket not found: ' + pocketId);

  const month = params.month || monthKey(new Date());
  const transactions = readRecentTransactions({ month }).filter((t) =>
    t.pocketId === pocketId && t.timestamp && monthKey(new Date(t.timestamp)) === month);
  const adjustments = readAdjustments({ month }).filter((a) =>
    a.fromPocketId === pocketId || a.toPocketId === pocketId);

  return ok({
    pocket: presentPocket(pocket),
    transactions,
    adjustments,
    breakdown: pocketBreakdown(pocket, transactions, adjustments),
  });
}

export function createPocket(params) {
  if (!verifyToken(params.token)) return fail('UNAUTHORIZED', 'Invalid or missing token.');

  const name = String(params.name ?? '').trim();
  const nameProblem = checkText(name, 'Pocket name', true) || checkText(params.account ?? '', 'Bank account', false);
  if (nameProblem) return nameProblem;

  let limitCents;
  try {
    limitCents = parseAmountInput(params.limit);
  } catch (err) {
    return fail('INVALID_AMOUNT', err.message);
  }
  const rule = params.rule == null ? 'Carry' : String(params.rule);
  const sweepTo = rule === 'Sweep' ? String(params.sweepTo ?? '') : '';
  const ruleProblem = checkRule(rule, sweepTo, limitCents, '');
  if (ruleProblem) return ruleProblem;

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_TIMEOUT_MS)) {
    return fail('BUSY', 'Another update is in progress. Please try again.');
  }
  try {
    rolloverIfDue();
    const pocket = appendPocket({ name, account: String(params.account ?? '').trim(), limit: toDollars(limitCents), rule, sweepTo });
    return ok({ pocket: presentPocket(pocket) });
  } finally {
    unlock(lock);
  }
}

export function updatePocket(params) {
  if (!verifyToken(params.token)) return fail('UNAUTHORIZED', 'Invalid or missing token.');

  const pocketId = String(params.pocketId ?? '');
  if (!findPocketRow(pocketId)) return fail('POCKET_NOT_FOUND', 'Pocket not found: ' + pocketId);

  // The client checks these too, but the server is the one that must hold: a blank
  // name or a zero limit (which locks the pocket) must not be savable by any caller.
  if (params.name != null) {
    const problem = checkText(params.name, 'Pocket name', true);
    if (problem) return problem;
  }
  if (params.account != null) {
    const problem = checkText(params.account, 'Bank account', false);
    if (problem) return problem;
  }

  let limit;
  let limitCents;
  if (params.limit != null) {
    try {
      limitCents = parseAmountInput(params.limit);
    } catch (err) {
      return fail('INVALID_AMOUNT', err.message);
    }
    limit = toDollars(limitCents);
  }

  // Check the rule and limit as they will be after this update, not just the fields sent.
  const current = readPockets({ includeArchived: true }).find((p) => p.id === pocketId);
  const rule = params.rule != null ? String(params.rule) : current.rule;
  const sweepTo = rule === 'Sweep' ? String(params.sweepTo ?? current.sweepTo) : '';
  const effectiveLimitCents = limitCents != null ? limitCents : parseAmountInput(current.limit);
  const ruleProblem = checkRule(rule, sweepTo, effectiveLimitCents, pocketId);
  if (ruleProblem) return ruleProblem;

  const patch = {};
  if (params.name != null) patch.name = String(params.name).trim();
  if (params.account != null) patch.account = String(params.account).trim();
  if (limit != null) patch.limit = limit;
  if (params.rule != null || params.sweepTo != null) {
    patch.rule = rule;
    patch.sweepTo = sweepTo;
  }
  if (params.archive === true) patch.status = 'Archived';
  if (params.unarchive === true) patch.status = 'Active';

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_TIMEOUT_MS)) {
    return fail('BUSY', 'Another update is in progress. Please try again.');
  }
  try {
    rolloverIfDue();
    const before = readPockets({ includeArchived: true }).find((p) => p.id === pocketId);
    const reopening = params.unarchive === true && Boolean(before) && before.status === 'Archived';

    let pocket = updatePocketRow(pocketId, patch);
    if (!pocket) return fail('POCKET_NOT_FOUND', 'Pocket not found: ' + pocketId);

    if (reopening) {
      // An archived pocket is skipped by every rollover, so its stored balance is
      // whatever it was on the day it was archived. Give it what this month's
      // spending actually leaves.
      const month = monthKey(new Date());
      const spent = readTransactions()
        .filter((t) => t.pocketId === pocketId && t.timestamp && monthKey(new Date(t.timestamp)) === month)
        .reduce((sum, t) => sum + t.amount, 0);
      const balance = r2(Math.max(0, pocket.limit - spent));
      writeBalance(pocketId, balance);
      pocket = { ...pocket, balance };
    }
    return ok({ pocket: presentPocket(pocket) });
  } finally {
    unlock(lock);
  }
}

/**
 * The hot path. Order matters:
 *   auth -> validate -> lock -> (repeat?) -> re-read -> check -> record -> deduct.
 *
 * The balance is re-read INSIDE the lock, never from the caller's payload, so a
 * stale client cannot cause an incorrect deduction.
 *
 * IDEMPOTENCY: the client sends a `requestId` and reuses it when a request may
 * or may not have landed (timeout, dropped connection). If a transaction with
 * that id is already recorded, the original result is returned and NOTHING is
 * deducted again. Without this, a lost response made the user retry and spend
 * the same money twice.
 *
 * ATOMICITY: the transaction row is appended BEFORE the balance is written. If
 * the append fails nothing has changed; if the balance write fails the row is
 * removed again. The old order (balance, then row) could deduct money and leave
 * no record of why.
 */
export function createTransaction(params) {
  if (!verifyToken(params.token)) return fail('UNAUTHORIZED', 'Invalid or missing token.');

  const user = String(params.user ?? '');
  if (!isValidUser(user, getUsers())) return fail('INVALID_USER', 'Unknown user: ' + user);

  const pocketId = String(params.pocketId ?? '');
  const note = String(params.note ?? '').trim().slice(0, 120);

  const requestId = params.requestId == null ? '' : String(params.requestId);
  if (requestId && !isValidRequestId(requestId)) {
    return fail('INVALID_REQUEST', 'requestId must be 8-64 letters, digits or hyphens.');
  }

  let amountCents;
  try {
    amountCents = parseAmountInput(params.amount);
  } catch (err) {
    return fail('INVALID_AMOUNT', err.message);
  }
  if (amountCents <= 0) return fail('INVALID_AMOUNT', 'Amount must be greater than zero.');

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_TIMEOUT_MS)) {
    return fail('BUSY', 'Another update is in progress. Please try again.');
  }

  try {
    rolloverIfDue();
    // A retry of something already recorded: answer with the original, change nothing.
    const prior = findTransactionByRequestId(requestId);
    if (prior) {
      if (prior.pocketId !== pocketId || Math.round(prior.amount * 100) !== amountCents) {
        return fail('INVALID_REQUEST', 'requestId was already used for a different expense.');
      }
      const current = readPockets({ includeArchived: true }).find((p) => p.id === pocketId);
      return ok({
        pocket: current ? presentPocket(current) : null,
        transaction: prior,
        duplicate: true,
      });
    }

    // Re-read under the lock: authoritative, not client-supplied. (One read; a
    // separate findPocketRow beforehand was a second round trip for nothing.)
    const pocket = readPockets({ includeArchived: true }).find((p) => p.id === pocketId);
    if (!pocket) return fail('POCKET_NOT_FOUND', 'Pocket not found: ' + pocketId);
    if (pocket.status !== 'Active') {
      return fail('POCKET_NOT_FOUND', 'Pocket is not available: ' + pocketId);
    }

    const balanceCents = Math.round(pocket.balance * 100);
    const remainingCents = balanceCents - amountCents;

    // The non-negative guarantee. Exact-balance spending is allowed; over is not.
    if (remainingCents < 0) {
      return fail(
        'INSUFFICIENT_FUNDS',
        `Insufficient funds in ${pocket.name}. Remaining: ${money(balanceCents)}`,
        { pocketId, remaining: toDollars(balanceCents), amount: toDollars(amountCents) },
      );
    }

    // The server stamps the time. A client-supplied timestamp could backdate an
    // expense out of the current month, or be malformed after money had moved.
    const now = new Date();
    const newBalance = toDollars(remainingCents);
    const txnId = appendTransaction({
      user, pocketId, amount: toDollars(amountCents), note, timestamp: now, requestId,
    });
    try {
      writeBalance(pocketId, newBalance);
    } catch (err) {
      try {
        deleteTransactionRow(txnId);
      } catch (undoErr) {
        throw new Error(err.message + ' (and ' + txnId + ' could not be removed — check the Transactions sheet)');
      }
      throw err;
    }

    return ok({
      pocket: presentPocket({ ...pocket, balance: newBalance }),
      transaction: {
        id: txnId,
        timestamp: now.toISOString(),
        user, pocketId,
        amount: toDollars(amountCents),
        note,
      },
    });
  } finally {
    unlock(lock);   // flushed, then released: on every path, success and rejection alike
  }
}

/** Delete an expense and refund its amount to the pocket. */
export function deleteTransaction(params) {
  if (!verifyToken(params.token)) return fail('UNAUTHORIZED', 'Invalid or missing token.');

  const txnId = String(params.txnId ?? '');
  if (!txnId) return fail('INVALID_REQUEST', 'txnId is required.');

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_TIMEOUT_MS)) {
    return fail('BUSY', 'Another update is in progress. Please try again.');
  }

  try {
    rolloverIfDue();
    // Look first, change second. Deleting the row before the refund could lose the
    // transaction and then fail to give the money back.
    const record = getTransactionRecord(txnId);
    if (!record) return fail('TRANSACTION_NOT_FOUND', 'Transaction not found: ' + txnId);

    const pocket = readPockets({ includeArchived: true }).find((p) => p.id === record.pocketId);
    // Declared out here on purpose: the original plan scoped this `const` inside the
    // `if` block below and then read it after the block, which throws ReferenceError.
    let refunded = null;
    // Only this month's spending is given back. This month's budget never paid for
    // an earlier month's expense, so refunding it would hand out money the pocket
    // does not owe (and the rollover has already reset last month's balance).
    const inCurrentMonth = Boolean(record.timestamp)
      && monthKey(new Date(record.timestamp)) === monthKey(new Date());
    if (pocket && inCurrentMonth) {
      refunded = r2(pocket.balance + record.amount);
      writeBalance(record.pocketId, refunded);
      try {
        deleteTransactionRow(txnId);
      } catch (err) {
        try {
          writeBalance(record.pocketId, pocket.balance);   // undo the refund
        } catch (undoErr) {
          throw new Error(err.message + ' (and the refund to ' + record.pocketId + ' could not be undone)');
        }
        throw err;
      }
    } else {
      deleteTransactionRow(txnId);
    }

    return ok({
      deleted: { id: record.id, pocketId: record.pocketId, amount: record.amount },
      refunded: refunded !== null,
      pocket: pocket ? presentPocket({ ...pocket, balance: refunded !== null ? refunded : pocket.balance }) : null,
    });
  } finally {
    unlock(lock);
  }
}

/**
 * Move money from one pocket to another. Limits never change; only the two balances do.
 * Same shape as createTransaction: auth -> validate -> lock -> (repeat?) -> re-read ->
 * check -> record -> write. Both balances are re-read inside the lock, and the source
 * can never go below zero. A retry with the same requestId changes nothing.
 */
export function transferFunds(params) {
  if (!verifyToken(params.token)) return fail('UNAUTHORIZED', 'Invalid or missing token.');

  const user = String(params.user ?? '');
  if (!isValidUser(user, getUsers())) return fail('INVALID_USER', 'Unknown user: ' + user);

  const fromPocketId = String(params.fromPocketId ?? '');
  const toPocketId = String(params.toPocketId ?? '');
  if (!fromPocketId || !toPocketId) {
    return fail('INVALID_REQUEST', 'fromPocketId and toPocketId are required.');
  }
  if (fromPocketId === toPocketId) {
    return fail('INVALID_REQUEST', 'Choose two different pockets.');
  }

  let amountCents;
  try {
    amountCents = parseAmountInput(params.amount);
  } catch (err) {
    return fail('INVALID_AMOUNT', err.message);
  }
  if (amountCents <= 0) return fail('INVALID_AMOUNT', 'Amount must be greater than zero.');

  const note = String(params.note ?? '').trim().slice(0, 120);

  const requestId = params.requestId == null ? '' : String(params.requestId);
  if (requestId && !isValidRequestId(requestId)) {
    return fail('INVALID_REQUEST', 'requestId must be 8-64 letters, digits or hyphens.');
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_TIMEOUT_MS)) {
    return fail('BUSY', 'Another update is in progress. Please try again.');
  }

  try {
    rolloverIfDue();
    // A retry of something already recorded: answer with the original, change nothing.
    const prior = findAdjustmentByRequestId(requestId);
    if (prior) {
      const all = readPockets({ includeArchived: true });
      const currentFrom = all.find((p) => p.id === prior.fromPocketId);
      const currentTo = all.find((p) => p.id === prior.toPocketId);
      return ok({
        adjustment: prior,
        from: currentFrom ? presentPocket(currentFrom) : null,
        to: currentTo ? presentPocket(currentTo) : null,
        duplicate: true,
      });
    }

    const all = readPockets({ includeArchived: true });
    const from = all.find((p) => p.id === fromPocketId);
    const to = all.find((p) => p.id === toPocketId);
    if (!from) return fail('POCKET_NOT_FOUND', 'Pocket not found: ' + fromPocketId);
    if (!to) return fail('POCKET_NOT_FOUND', 'Pocket not found: ' + toPocketId);
    if (from.status !== 'Active') return fail('POCKET_NOT_FOUND', 'Pocket is not available: ' + fromPocketId);
    if (to.status !== 'Active') return fail('POCKET_NOT_FOUND', 'Pocket is not available: ' + toPocketId);

    const fromCents = Math.round(from.balance * 100);
    const toCents = Math.round(to.balance * 100);
    const remainingCents = fromCents - amountCents;

    // The non-negative guarantee. Moving the exact balance is allowed; over is not.
    if (remainingCents < 0) {
      return fail(
        'INSUFFICIENT_FUNDS',
        `Insufficient funds in ${from.name}. Remaining: ${money(fromCents)}`,
        { pocketId: fromPocketId, remaining: toDollars(fromCents), amount: toDollars(amountCents) },
      );
    }

    const now = new Date();
    const fromBalance = toDollars(remainingCents);
    const toBalance = toDollars(toCents + amountCents);
    const amount = toDollars(amountCents);
    const [adjId] = appendAdjustments([{
      timestamp: now, user, month: monthKey(now), type: 'transfer',
      fromPocketId, toPocketId, amount, note, requestId,
    }]);

    writeBalance(fromPocketId, fromBalance);
    try {
      writeBalance(toPocketId, toBalance);
    } catch (err) {
      try {
        writeBalance(fromPocketId, from.balance);   // undo the debit
      } catch (undoErr) {
        throw new Error(err.message + ' (and the debit to ' + fromPocketId + ' could not be undone)');
      }
      throw err;
    }

    return ok({
      adjustment: {
        id: adjId,
        timestamp: now.toISOString(),
        user, month: monthKey(now), type: 'transfer',
        fromPocketId, toPocketId, amount, note, requestId, accountId: '',
      },
      from: presentPocket({ ...from, balance: fromBalance }),
      to: presentPocket({ ...to, balance: toBalance }),
    });
  } finally {
    unlock(lock);
  }
}

/* ------------------------------------------------------------- dispatch -- */

const HANDLERS = {
  ping,
  getState,
  createPocket,
  updatePocket,
  createTransaction,
  deleteTransaction,
  transferFunds,
  getPocket,
};

/**
 * Single entry point for both doGet and doPost.
 * `action` comes from the query string on GET and the JSON body on POST.
 * Never throws: every failure becomes an error envelope.
 */
export function handleRequest(request = {}) {
  const { action, params = {} } = request || {};
  if (!ACTIONS.includes(action)) {
    return fail('UNKNOWN_ACTION', 'Unknown action: ' + action);
  }
  try {
    return HANDLERS[action](params);
  } catch (err) {
    return fail('SERVER_ERROR', (err && err.message) ? err.message : 'Unexpected error');
  }
}
