// backend/05_Api.gs.js
// CANONICAL SOURCE. `backend/*.gs` is generated from this file by `npm run build`.
//
// Invariants enforced here:
//   1. Auth is checked before any data is read or written.
//   2. A balance can never go negative.
//   3. The script lock is always released, even on the rejection paths.
//   4. No handler throws to the client; failures come back as { ok:false, error }.

import { ACTIONS, USERS, SHEETS } from './00_Config.gs.js';
import {
  toDollars, parseAmountInput, isValidUser, money, ok, fail,
} from './01_Utils.gs.js';
import { verifyToken } from './02_Auth.gs.js';
import {
  readPockets, readTransactions, findPocketRow, writeBalance,
  appendTransaction, appendPocket, updatePocketRow, archivePocketRow,
  deleteTransactionRow,
} from './03_Sheets.gs.js';
import { monthKey } from './04_Rollover.gs.js';

/** Milliseconds to wait for the script lock before giving up. */
const LOCK_TIMEOUT_MS = 20000;

/* --------------------------------------------------------------- helpers -- */

/** Round dollars to 2dp. Every value crossing the API boundary goes through this. */
const r2 = (n) => Math.round(Number(n) * 100) / 100;

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
  const pockets = readPockets();
  const transactions = readTransactions({ limit: 10 });

  const spentByPocket = {};
  for (const t of readTransactions()) {
    if (!t.timestamp || !t.timestamp.startsWith(month)) continue;
    spentByPocket[t.pocketId] = (spentByPocket[t.pocketId] || 0) + t.amount;
  }

  const present = pockets.map((p) => presentPocket(p, spentByPocket));
  const sum = (k) => r2(present.reduce((s, p) => s + p[k], 0));

  return ok({
    serverTime: new Date().toISOString(),
    month,
    pockets: present,
    transactions,
    summary: {
      totalLimit: sum('limit'),
      totalBalance: sum('balance'),
      totalSpent: sum('spent'),
      users: [...USERS],
    },
  });
}

export function createPocket(params) {
  if (!verifyToken(params.token)) return fail('UNAUTHORIZED', 'Invalid or missing token.');

  const name = String(params.name ?? '').trim();
  if (!name) return fail('INVALID_NAME', 'Pocket name is required.');

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
    lock.releaseLock();
  }
}

export function updatePocket(params) {
  if (!verifyToken(params.token)) return fail('UNAUTHORIZED', 'Invalid or missing token.');

  const pocketId = String(params.pocketId ?? '');
  if (!findPocketRow(pocketId)) return fail('POCKET_NOT_FOUND', 'Pocket not found: ' + pocketId);

  let limit;
  if (params.limit != null) {
    try {
      limit = toDollars(parseAmountInput(params.limit));
    } catch (err) {
      return fail('INVALID_AMOUNT', err.message);
    }
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
    const pocket = updatePocketRow(pocketId, patch);
    if (!pocket) return fail('POCKET_NOT_FOUND', 'Pocket not found: ' + pocketId);
    return ok({ pocket: presentPocket(pocket) });
  } finally {
    lock.releaseLock();
  }
}

/**
 * The hot path. Order matters: auth -> validate -> lock -> re-read -> check -> deduct -> append.
 *
 * The balance is re-read INSIDE the lock, never from the caller's payload, so a stale
 * client cannot cause an incorrect deduction.
 */
export function createTransaction(params) {
  if (!verifyToken(params.token)) return fail('UNAUTHORIZED', 'Invalid or missing token.');

  const user = String(params.user ?? '');
  if (!isValidUser(user)) return fail('INVALID_USER', 'Unknown user: ' + user);

  const pocketId = String(params.pocketId ?? '');
  const note = String(params.note ?? '').trim().slice(0, 120);

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

    const newBalance = toDollars(remainingCents);
    writeBalance(pocketId, newBalance);
    const txnId = appendTransaction({
      user, pocketId, amount: toDollars(amountCents), note,
      timestamp: params.timestamp ? new Date(params.timestamp) : new Date(),
    });

    return ok({
      pocket: presentPocket({ ...pocket, balance: newBalance }),
      transaction: {
        id: txnId,
        timestamp: new Date().toISOString(),
        user, pocketId,
        amount: toDollars(amountCents),
        note,
      },
    });
  } finally {
    lock.releaseLock();   // released on every path, success and rejection alike
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
    const record = deleteTransactionRow(txnId);
    if (!record) return fail('TRANSACTION_NOT_FOUND', 'Transaction not found: ' + txnId);

    const pocket = readPockets({ includeArchived: true }).find((p) => p.id === record.pocketId);
    // Declared out here on purpose: the original plan scoped this `const` inside the
    // `if` block below and then read it after the block, which throws ReferenceError.
    let refunded = null;
    if (pocket) {
      refunded = r2(Math.min(pocket.limit, pocket.balance + record.amount));
      writeBalance(record.pocketId, refunded);
    }

    return ok({
      deleted: { id: record.id, pocketId: record.pocketId, amount: record.amount },
      pocket: pocket ? presentPocket({ ...pocket, balance: refunded }) : null,
    });
  } finally {
    lock.releaseLock();
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
