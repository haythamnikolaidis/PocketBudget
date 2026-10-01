// app/js/format.js
// Presentation helpers. Pure and tested — formatting bugs are silent and annoying.

export function formatMoney(dollars) {
  const n = Number(dollars) || 0;
  const neg = n < 0;
  const abs = Math.abs(n);
  const whole = Math.floor(abs);
  const cents = String(Math.round((abs - whole) * 100)).padStart(2, '0');
  const withCommas = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? '-$' : '$') + withCommas + '.' + cents;
}

export function formatPct(pct) {
  const n = Number(pct) || 0;
  if (n === 0) return '0%';
  return (Math.round(n * 10) / 10).toFixed(1) + '%';
}

/** Mirror of the backend's parseAmountInput rules, for instant client-side feedback. */
export function isValidAmount(input) {
  const s = String(input ?? '').replace(/[$,\s]/g, '');
  if (s === '') return false;
  const n = Number(s);
  if (!Number.isFinite(n)) return false;
  if (n < 0) return false;
  if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-9) return false;
  return n > 0;
}

/** 'Today' | 'Yesterday' | 'Sep 28' */
export function relativeDay(iso, now = new Date()) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const a = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const b = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const days = Math.round((b - a) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return MON[d.getUTCMonth()] + ' ' + d.getUTCDate();
}