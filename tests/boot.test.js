// tests/boot.test.js
// Regression test for the blank-page bug.
//
// index.html ships every view with `hidden`, and app.js's boot() takes all its
// dependencies by injection. That combination meant nothing ever started the
// app: the module imported cleanly, every unit test passed, and the deployed
// site rendered a completely blank page.
//
// These tests boot the app against a real-ish DOM to prove it actually starts.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeBootDom } from './helpers/fakeBrowser.js';

const html = readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');
const appSrc = readFileSync(new URL('../app/js/app.js', import.meta.url), 'utf8');

/** Every id the shell declares, so the fake DOM can mirror the real one. */
const VIEWS = ['view-setup', 'view-home', 'view-add', 'view-manage'];

test('every view starts hidden in the markup', () => {
  for (const v of VIEWS) {
    const tag = html.match(new RegExp(`<section id="${v}"[^>]*>`))[0];
    assert.match(tag, /hidden/, `${v} ships hidden`);
  }
});

test('app.js contains an auto-boot that binds to the real window', () => {
  // Without this the app renders blank: nothing ever un-hides a view.
  assert.match(appSrc, /autoBoot/, 'app.js must define an auto-boot entry point');
  assert.match(appSrc, /DOMContentLoaded|readyState/, 'auto-boot must wait for the DOM');
});

test('the auto-boot is invoked at module load', () => {
  const after = appSrc.slice(appSrc.indexOf('function autoBoot'));
  assert.match(after, /^\s*autoBoot\(\);?\s*$/m, 'autoBoot() must actually be called');
});

test('booting an unconfigured app reveals the setup screen', async () => {
  const { boot } = await import('../app/js/app.js');
  const { doc, calls } = makeBootDom({ configured: false });

  const handle = boot({
    win: { document: doc }, doc, config: { isConfigured: () => false },
  });

  const setup = doc.getElementById('view-setup');
  assert.equal(setup.classList.contains('hidden'), false,
    'setup view must be revealed or the page looks blank');
  assert.equal(calls.getState, 0, 'must not hit the network before configuration');
  handle?.teardown?.();
});

test('booting a configured app reveals the home screen', async () => {
  const { boot } = await import('../app/js/app.js');
  const state = {
    ok: true, version: '1.0.0', month: '2026-10',
    pockets: [{ id: 'P01', name: 'Groceries', account: 'Chase', limit: 800, balance: 340.5, spent: 459.5, pctUsed: 57.44, isLocked: false }],
    transactions: [],
    summary: { totalLimit: 800, totalBalance: 340.5, totalSpent: 459.5, users: ['Alex', 'Sam'], month: '2026-10' },
  };
  const { doc, calls } = makeBootDom({ configured: true });

  const handle = boot({
    win: { document: doc }, doc,
    config: { isConfigured: () => true, getEndpoint: () => 'https://x/exec', getToken: () => 't' },
    api: {
      getState: async () => { calls.getState++; return state; },
      ping: async () => ({ ok: true }),
    },
  });

  await handle.ready;

  const home = doc.getElementById('view-home');
  assert.equal(home.classList.contains('hidden'), false,
    'home view must be revealed');
  assert.equal(calls.getState, 1, 'exactly one getState on boot — Apps Script is slow');
  handle?.teardown?.();
});

test('a boot failure surfaces a message instead of a blank page', async () => {
  const { boot } = await import('../app/js/app.js');
  const { doc } = makeBootDom({ configured: true, throwOn: 'getState' });

  const handle = boot({
    win: { document: doc }, doc,
    config: { isConfigured: () => true, getEndpoint: () => 'https://x/exec', getToken: () => 't' },
    api: { getState: async () => { throw new Error('boom'); }, ping: async () => ({ ok: true }) },
  });

  await handle.ready;
  // A rejected network call must not leave every view hidden.
  const anyVisible = ['view-home', 'view-setup'].some(
    (v) => doc.getElementById(v).classList.contains('hidden') === false);
  assert.equal(anyVisible, true, 'at least one view must be visible after a failure');
  handle?.teardown?.();
});