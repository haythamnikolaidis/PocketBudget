// tests/bundle.test.js
// The Apps Script bundle concatenates every backend module into ONE script scope,
// so two modules declaring the same top-level name is a SyntaxError that the
// per-module unit tests can never see. Compile the real bundle to catch it.
//
// Reads the file `npm run build` generates; `npm run check` builds first.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const BUNDLE_PATH = new URL('../backend/Backend.bundle.gs', import.meta.url);

test('the compiled bundle has no duplicate top-level declarations', () => {
  let source;
  try {
    source = readFileSync(BUNDLE_PATH, 'utf8');
  } catch {
    assert.fail('backend/Backend.bundle.gs is missing - run `npm run build` first');
  }
  assert.doesNotThrow(() => new vm.Script(source, { filename: 'Backend.bundle.gs' }));
});

test('the compile check does reject a duplicate top-level declaration', () => {
  const twice = 'const toCents = (n) => n;\nfunction f() {}\nconst toCents = (n) => n;\n';
  assert.throws(() => new vm.Script(twice), /already been declared/);
});
