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
