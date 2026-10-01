import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeConfig, resolveEndpoint } from '../app/js/config.js';
import { formatMoney, formatPct, isValidAmount, relativeDay } from '../app/js/format.js';

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
  assert.equal(formatMoney(340.5), '$340.50');
  assert.equal(formatMoney(0), '$0.00');
  assert.equal(formatMoney(1234.5), '$1,234.50');
  assert.equal(formatMoney(65), '$65.00');
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