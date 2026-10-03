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
  readPockets, readTransactions, findPocketRow, writeBalance,
  appendTransaction, appendPocket, updatePocketRow, archivePocketRow,
  deleteTransactionRow, getTransactionRecord, findTransactionByRequestId, flushWrites,
} from './03_Sheets.gs.js';
import { monthKey } from './04_Rollover.gs.js';

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
  return {
    id: p.id,
    name: p.name,
    account: p.account,
    limit: r2(p.limit),
    balance: r2(p.balance),
    spent: r2(monthSpent),
    pctUsed: p.limit > 0 ? r2((monthSpent / p.limit) * 100) : 0,
    isLocked: p.balance <= 0,
  };
}

/* --------------------------------------------------------------- handlers -- */

/** Liveness + version. Still requires a token, so it doubles as a config check. */
export function ping(params) {
  if (!verifyToken(params.token)) return fail('UNAUTHORIZED', 'Invalid or missing token.');
  return ok({ serverTime: new Date().toISOString() });
}

/**
 * The whole home screen in one round trip.
 * `spent` is month-scoped so it survives rollover; `balance` is the live figure.
 */
export function getState(params) {
  if (!verifyToken(params.token)) return fail('UNAUTHORIZED', 'Invalid or missing token.');

  const month = params.month || monthKey(new Date());
  const everyPocket = readPockets({ includeArchived: true });
  const pockets = everyPocket.filter((p) => p.status !== 'Archived');
  const archivedPockets = everyPocket
    .filter((p) => p.status === 'Archived')
    .map((p) => ({ id: p.id, name: p.name, account: p.account, limit: r2(p.limit) }));
  const transactions = readTransactions({ limit: 10 });

  const spentByPocket = {};
  for (const t of readTransactions()) {
    if (!t.timestamp || monthKey(new Date(t.timestamp)) !== month) continue;
    spentByPocket[t.pocketId] = (spentByPocket[t.pocketId] || 0) + t.amount;
  }

  const present = pockets.map((p) => presentPocket(p, spentByPocket));
  const sum = (k) => r2(present.reduce((s, p) => s + p[k], 0));

  return ok({
    serverTime: new Date().toISOString(),
    month,
    pockets: present,
    archivedPockets,
    transactions,
    summary: {
      totalLimit: sum('limit'),
      totalBalance: sum('balance'),
      totalSpent: sum('spent'),
      users: getUsers(),
    },
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
  if (limitCents === 0) return fail('INVALID_AMOUNT', 'Monthly limit must be greater than zero.');

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_TIMEOUT_MS)) {
    return fail('BUSY', 'Another update is in progress. Please try again.');
  }
  try {
    const pocket = appendPocket({ name, account: String(params.account ?? '').trim(), limit: toDollars(limitCents) });
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
  if (params.limit != null) {
    let limitCents;
    try {
      limitCents = parseAmountInput(params.limit);
    } catch (err) {
      return fail('INVALID_AMOUNT', err.message);
    }
    if (limitCents === 0) return fail('INVALID_AMOUNT', 'Monthly limit must be greater than zero.');
    limit = toDollars(limitCents);
  }

  const patch = {};
  if (params.name != null) patch.name = String(params.name).trim();
  if (params.account != null) patch.account = String(params.account).trim();
  if (limit != null) patch.limit = limit;
  if (params.archive === true) patch.status = 'Archived';
  if (params.unarchive === true) patch.status = 'Active';

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_TIMEOUT_MS)) {
    return fail('BUSY', 'Another update is in progress. Please try again.');
  }
  try {
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

    const row = findPocketRow(pocketId);
    if (!row) return fail('POCKET_NOT_FOUND', 'Pocket not found: ' + pocketId);

    // Re-read under the lock: authoritative, not client-supplied.
    const pocket = readPockets({ includeArchived: true }).find((p) => p.id === pocketId);
    if (!pocket || pocket.status !== 'Active') {
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
      refunded = r2(Math.min(pocket.limit, pocket.balance + record.amount));
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

/* ------------------------------------------------------------- dispatch -- */

const HANDLERS = {
  ping,
  getState,
  createPocket,
  updatePocket,
  createTransaction,
  deleteTransaction,
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
