// tests/manifest.test.js
// backend/appsscript.json is the deployment contract: the timezone the household
// lives in, the narrow scopes, and who may call the web app. These tests keep it
// consistent with the code that depends on it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { UTC_OFFSET_MINUTES } from '../backend/00_Config.gs.js';

const manifest = JSON.parse(readFileSync(new URL('../backend/appsscript.json', import.meta.url), 'utf8'));

test('the web app runs as the deployer and is callable without a Google login (the token is the auth)', () => {
  assert.deepEqual(manifest.webapp, { executeAs: 'USER_DEPLOYING', access: 'ANYONE_ANONYMOUS' });
});

test('scopes stay narrow: this sheet only, triggers, and the sheet menu', () => {
  assert.deepEqual([...manifest.oauthScopes].sort(), [
    'https://www.googleapis.com/auth/script.container.ui',   // PocketBudget > Refresh report menu (SpreadsheetApp.getUi)
    'https://www.googleapis.com/auth/script.scriptapp',      // the nightly trigger
    'https://www.googleapis.com/auth/spreadsheets.currentonly',
  ]);
});

test('runs on the V8 runtime', () => {
  assert.equal(manifest.runtimeVersion, 'V8');
});

test('UTC_OFFSET_MINUTES matches the manifest timeZone all year (no surprise from daylight saving)', () => {
  const offsetOf = (date) => {
    const part = new Intl.DateTimeFormat('en-US', { timeZone: manifest.timeZone, timeZoneName: 'shortOffset' })
      .formatToParts(date).find((p) => p.type === 'timeZoneName').value;          // e.g. "GMT+2"
    const m = part.match(/^GMT(?:([+-])(\d{1,2})(?::(\d{2}))?)?$/);
    return m && m[1] ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] || 0)) : 0;
  };
  for (const iso of ['2026-01-15T12:00:00Z', '2026-07-15T12:00:00Z']) {
    assert.equal(offsetOf(new Date(iso)), UTC_OFFSET_MINUTES, `${manifest.timeZone} on ${iso}`);
  }
});
