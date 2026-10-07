import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeConfig, resolveEndpoint } from '../app/js/config.js';
import { formatMoney, formatPct, formatRand, monthProgress, isValidAmount, relativeDay, parseAmountText, normaliseAmountText, balanceAfterLimitChange } from '../app/js/format.js';

test('makeConfig stores the endpoint and token', () => {
  const cfg = makeConfig();
  cfg.configure('https://script.google.com/macros/s/X/exec', 'tok-123');
  assert.equal(cfg.getToken(), 'tok-123');
  assert.equal(cfg.getEndpoint(), 'https://script.google.com/macros/s/X/exec');
  assert.equal(cfg.isConfigured(), true);
});

test('makeConfig reports unconfigured before setup', () => {
  assert.equal(makeConfig().isConfigured(), false);
});

test('makeConfig persists to localStorage when a store is supplied', () => {
  const mem = {};
  const store = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); } };
  makeConfig({ store }).configure('https://x/exec', 'tok');
  assert.equal(mem['pb.endpoint'], 'https://x/exec');
  assert.equal(mem['pb.token'], 'tok');
});

test('makeConfig reloads an existing configuration from storage', () => {
  const mem = { 'pb.endpoint': 'https://y/exec', 'pb.token': 'saved' };
  const store = { getItem: (k) => (k in mem ? mem[k] : null), setItem: () => {} };
  const cfg = makeConfig({ store });
  assert.equal(cfg.isConfigured(), true);
  assert.equal(cfg.getToken(), 'saved');
});

test('resolveEndpoint trims whitespace and rejects non-https URLs', () => {
  assert.equal(resolveEndpoint('  https://script.google.com/macros/s/A/exec '),
               'https://script.google.com/macros/s/A/exec');
  assert.throws(() => resolveEndpoint('http://insecure.example/exec'), /https/i);
  assert.throws(() => resolveEndpoint('not a url'), /https/i);
  assert.throws(() => resolveEndpoint(''), /empty/i);
});

test('formatMoney renders dollars with cents', () => {
  assert.equal(formatMoney(340.5), 'R340.50');
  assert.equal(formatMoney(0), 'R0.00');
  assert.equal(formatMoney(1234.5), 'R1,234.50');
  assert.equal(formatMoney(65), 'R65.00');
});

test('formatRand shows whole rands, rounded down so a balance is never overstated', () => {
  assert.equal(formatRand(1200), 'R1,200');
  assert.equal(formatRand(340.5), 'R340');
  assert.equal(formatRand(4499.99), 'R4,499');
  assert.equal(formatRand(10), 'R10');
  assert.equal(formatRand(0), 'R0');
  assert.equal(formatRand('x'), 'R0');
});

test('formatRand keeps cents under R10 so a nearly-empty pocket is not shown as R0', () => {
  assert.equal(formatRand(2.5), 'R2.50');
  assert.equal(formatRand(0.4), 'R0.40');
  assert.equal(formatRand(9.99), 'R9.99');
});

test('monthProgress reports the day, the days left and the share of the month elapsed', () => {
  const p = monthProgress(new Date(2026, 9, 7, 15, 0), '2026-10');
  assert.deepEqual({ day: p.day, daysInMonth: p.daysInMonth, daysLeft: p.daysLeft }, { day: 7, daysInMonth: 31, daysLeft: 24 });
  assert.ok(Math.abs(p.elapsedPct - 22.5806) < 1e-3, String(p.elapsedPct));
});

test('monthProgress knows a short month and a leap February', () => {
  assert.equal(monthProgress(new Date(2026, 1, 28), '2026-02').daysInMonth, 28);
  assert.equal(monthProgress(new Date(2028, 1, 15), '2028-02').daysInMonth, 29);
  assert.equal(monthProgress(new Date(2026, 1, 28), '2026-02').daysLeft, 0);
});

test('monthProgress is null when the payload is from another month, and works without one', () => {
  assert.equal(monthProgress(new Date(2026, 9, 7), '2026-09'), null);
  assert.equal(monthProgress(new Date(2026, 9, 7), '2026-11'), null);
  assert.equal(monthProgress(new Date(2026, 9, 7)).day, 7);
});

test('formatPct renders one decimal, guarding zero', () => {
  assert.equal(formatPct(57.44), '57.4%');
  assert.equal(formatPct(0), '0%');
});

test('isValidAmount rejects the inputs the backend would reject', () => {
  assert.equal(isValidAmount('12.34'), true);
  assert.equal(isValidAmount('12.345'), false);
  assert.equal(isValidAmount('-5'), false);
  assert.equal(isValidAmount(''), false);
  assert.equal(isValidAmount('abc'), false);
});

test('relativeDay labels recent activity for the feed', () => {
  const now = new Date('2026-10-01T20:00:00Z');
  assert.equal(relativeDay('2026-10-01T14:20:00.000Z', now), 'Today');
  assert.equal(relativeDay('2026-09-30T14:20:00.000Z', now), 'Yesterday');
  assert.equal(relativeDay('2026-09-28T14:20:00.000Z', now), 'Sep 28');
});

test('formatMoney is rand: R prefix, comma thousands, negatives as -R', () => {
  assert.equal(formatMoney(1234.5), 'R1,234.50');
  assert.equal(formatMoney(-12), '-R12.00');
  assert.ok(!formatMoney(5).includes('$'));
});

test('typed amounts understand R, space thousands and the decimal comma, exactly like the server', () => {
  assert.equal(parseAmountText('R12.50'), 12.5);
  assert.equal(parseAmountText('12,50'), 12.5, 'a decimal comma, not 1250');
  assert.equal(parseAmountText('R1 234,56'), 1234.56);
  assert.equal(parseAmountText('1,234'), 1234);
  assert.equal(parseAmountText('1,234.56'), 1234.56);
  assert.ok(Number.isNaN(parseAmountText('abc')));
  assert.equal(isValidAmount('12,50'), true);
  assert.equal(isValidAmount('R0'), false);
  assert.equal(isValidAmount('12.505'), false, 'more than two decimals is still refused');
});

test('the client and server amount normalisers agree on every input', async () => {
  const { normaliseAmountText: server } = await import('../backend/01_Utils.gs.js');
  const inputs = ['R12,50', 'R1 234,56', '1 234,5', '1,234', '1,234.56', '12,345', '12.5', ' r 7 ', '$9',
    '', 'R', '1,2,3', '1.234,56', '0,5', '1234,567', '12,50\u00a0', 'abc', '1R2'];
  for (const s of inputs) assert.equal(normaliseAmountText(s), server(s), JSON.stringify(s));
});


test('the client preview of a limit change matches the server rule exactly', async () => {
  const { balanceAfterLimitChange: server } = await import('../backend/01_Utils.gs.js');
  for (const [b, o, n] of [[500, 800, 1000], [500, 800, 600], [100, 800, 50], [0, 120, 300], [340.5, 800, 800], [0.1, 0.3, 0.6]]) {
    assert.equal(balanceAfterLimitChange(b, o, n), server(b, o, n), `${b} ${o} ${n}`);
  }
});

test('relativeDay uses the viewer\'s own calendar, not UTC (Johannesburg, 01:30 on the 3rd)', () => {
  const prev = process.env.TZ;
  process.env.TZ = 'Africa/Johannesburg';
  try {
    const now = new Date('2026-10-03T01:30:00+02:00');           // still the 2nd in UTC
    assert.equal(relativeDay('2026-10-03T00:10:00+02:00', now), 'Today');
    assert.equal(relativeDay('2026-10-02T23:50:00+02:00', now), 'Yesterday');
    assert.equal(relativeDay('2026-09-28T12:00:00+02:00', now), 'Sep 28');
  } finally {
    if (prev === undefined) delete process.env.TZ; else process.env.TZ = prev;
  }
});

test('the client rejects JS number syntax exactly like the server', async () => {
  const { parseAmountInput } = await import('../backend/01_Utils.gs.js');
  for (const bad of ['1e3', '0x10', 'Infinity', '+5', '1_000', '1.2.3', '.']) {
    assert.equal(isValidAmount(bad), false, bad);
    assert.ok(Number.isNaN(parseAmountText(bad)), bad);
    assert.throws(() => parseAmountInput(bad), /Not a number/, bad);
  }
  for (const good of ['12', '12.', '.5', '12,50', 'R1 234,56']) {
    assert.equal(isValidAmount(good), true, good);
  }
});
