// tests/api-client.test.js
// Tests for the Apps Script transport client.
//
// The single most important assertion in this file is
// "createTransaction POSTs text/plain, never application/json" — see
// IMPLEMENTATION_PLAN.md §0. If that header ever regresses to application/json,
// the browser sends a CORS preflight that Apps Script cannot answer (no
// doOptions => 405) and the entire app stops working in production while every
// other test still passes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApi, ApiError } from '../app/js/api.js';
import { makeConfig } from '../app/js/config.js';

/** A config already populated, as if the user had completed setup. */
function memStore(overrides = {}) {
  const mem = {
    'pb.endpoint': 'https://script.google.com/macros/s/ABC/exec',
    'pb.token': 'tok',
    ...overrides,
  };
  return { getItem: (k) => (k in mem ? mem[k] : null), setItem: () => {} };
}

function emptyStore() {
  return { getItem: () => null, setItem: () => {} };
}

function apiWith(fetchImpl, store = memStore()) {
  return makeApi(makeConfig({ store }), { fetchImpl });
}

/** Minimal successful Response double. */
function okJson(body) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  };
}

test('getState sends a GET with the action and token in the query string', async () => {
  const seen = [];
  const api = apiWith(async (url, opts) => {
    seen.push({ url, opts });
    return okJson({ ok: true, pockets: [], transactions: [] });
  });

  await api.getState();

  assert.equal(seen.length, 1);
  assert.equal(seen[0].opts.method, 'GET');
  assert.match(seen[0].url, /action=getState/);
  assert.match(seen[0].url, /token=tok/);
  // The token must never appear in a URL that gets logged by a proxy.
  assert.ok(!seen[0].opts.body, 'a GET must not carry a body');
});

test('getState passes the month through when supplied', async () => {
  const seen = [];
  const api = apiWith(async (url) => {
    seen.push(url);
    return okJson({ ok: true });
  });
  await api.getState('2026-10');
  assert.match(seen[0], /month=2026-10/);
});

test('TRANSPORT: createTransaction POSTs text/plain, never application/json', async () => {
  const seen = [];
  const api = apiWith(async (url, opts) => {
    seen.push({ url, opts });
    return okJson({ ok: true, transaction: { id: 'T1003' } });
  });

  await api.createTransaction({ user: 'Alex', pocketId: 'P01', amount: 5 });

  const { opts } = seen[0];
  assert.equal(opts.method, 'POST');
  assert.equal(
    opts.headers['Content-Type'],
    'text/plain;charset=utf-8',
    'REGRESSION: application/json triggers a CORS preflight that Apps Script 405s',
  );
  assert.notEqual(opts.headers['Content-Type'], 'application/json');
  assert.equal(opts.headers['Content-Type'].startsWith('text/plain'), true);

  // These two are what actually make the request survive the 302.
  assert.equal(opts.redirect, 'follow', 'must follow the 302 to googleusercontent');
  assert.deepEqual(JSON.parse(opts.body).action, 'createTransaction');
});

test('TRANSPORT: every mutating call uses the safe header', async () => {
  const seen = [];
  const api = apiWith(async (url, opts) => {
    seen.push(opts);
    return okJson({ ok: true });
  });

  await api.createPocket({ name: 'Fuel', account: 'Chase', limit: 200 });
  await api.updatePocket({ pocketId: 'P01', limit: 900 });
  await api.createTransaction({ user: 'Sam', pocketId: 'P01', amount: 1 });
  await api.deleteTransaction('T1001');

  assert.equal(seen.length, 4);
  for (const opts of seen) {
    assert.equal(opts.method, 'POST');
    assert.equal(opts.headers['Content-Type'], 'text/plain;charset=utf-8');
    assert.equal(opts.redirect, 'follow');
  }
});

test('every POST body carries the token', async () => {
  const seen = [];
  const api = apiWith(async (url, opts) => {
    seen.push(JSON.parse(opts.body));
    return okJson({ ok: true });
  });

  await api.createTransaction({ user: 'Alex', pocketId: 'P01', amount: 5 });
  assert.equal(seen[0].token, 'tok');
});

test('an INSUFFICIENT_FUNDS envelope becomes a thrown ApiError', async () => {
  const api = apiWith(async () => okJson({
    ok: false,
    error: 'INSUFFICIENT_FUNDS',
    message: 'Insufficient funds in Dining Out. Remaining: $15.00',
    context: { pocketId: 'P02', remaining: 15, amount: 99.99 },
  }));

  await assert.rejects(() => api.createTransaction({ user: 'Sam', pocketId: 'P02', amount: 99.99 }), (err) => {
    assert.equal(err.code, 'INSUFFICIENT_FUNDS');
    assert.equal(err.message, 'Insufficient funds in Dining Out. Remaining: $15.00');
    assert.equal(err.context.remaining, 15);
    return true;
  });
});

test('an UNAUTHORIZED envelope surfaces a readable message', async () => {
  const api = apiWith(async () => okJson({
    ok: false, error: 'UNAUTHORIZED', message: 'Invalid or missing token.',
  }));
  await assert.rejects(() => api.getState(), (err) => {
    assert.equal(err.code, 'UNAUTHORIZED');
    assert.match(err.message, /Invalid or missing token/);
    return true;
  });
});

test("a TypeError becomes a NETWORK ApiError with a readable message", async () => {
  const api = apiWith(async () => { throw new TypeError('Failed to fetch'); });
  await assert.rejects(() => api.getState(), (err) => {
    assert.equal(err.code, 'NETWORK');
    assert.match(err.message, /Could not reach the server/);
    return true;
  });
});

test('a non-2xx status becomes an HTTP_ error', async () => {
  const api = apiWith(async () => ({ ok: false, status: 502, json: async () => ({}) }));
  await assert.rejects(() => api.getState(), (err) => {
    assert.equal(err.code, 'HTTP_502');
    return true;
  });
});

test('an unconfigured app refuses to make a request', async () => {
  let called = false;
  const api = apiWith(async () => { called = true; return okJson({ ok: true }); }, emptyStore());

  await assert.rejects(() => api.getState(), (e) => e.code === 'NOT_CONFIGURED');
  assert.equal(called, false, 'must not hit the network when unconfigured');
});

test('a non-JSON response becomes BAD_JSON rather than an unhandled throw', async () => {
  const api = apiWith(async () => ({
    ok: true,
    status: 200,
    json: async () => { throw new SyntaxError('Unexpected token <'); },
  }));
  await assert.rejects(() => api.getState(), (e) => e.code === 'BAD_JSON');
});

test('an empty response body becomes EMPTY_RESPONSE', async () => {
  const api = apiWith(async () => ({ ok: true, status: 200, json: async () => null }));
  await assert.rejects(() => api.getState(), (e) => e.code === 'EMPTY_RESPONSE');
});

test('ping reaches the server and returns the version', async () => {
  const api = apiWith(async () => okJson({ ok: true, version: '1.0.0', serverTime: 'x' }));
  const res = await api.ping();
  assert.equal(res.version, '1.0.0');
});

test('ApiError carries its code and context', () => {
  const e = new ApiError('BUSY', 'Another update is in progress.', { retry: true });
  assert.equal(e.code, 'BUSY');
  assert.equal(e.context.retry, true);
  assert.ok(e instanceof Error);
});