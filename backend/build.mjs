#!/usr/bin/env node
// backend/build.mjs
// Generates the flat .gs files that get pasted into the Apps Script editor.
//
//   canonical: backend/00_Config.gs.js   (ES modules, import/export)
//   generated: backend/00_Config.gs      (flat classic script)
//   generated: backend/Backend.bundle.gs (everything concatenated, in order)
//
// Apps Script has no module system and its editor only reads .gs files, so
// every module must be flattened and concatenated into one script.
//
// Usage: npm run build

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Remove `import` statements WHOLE, including multi-line forms.
 *
 *   import { a } from './x.js';        -> removed entirely
 *   import {                          -> every line until the one ending in ';'
 *     a,
 *     b,
 *   } from './x.js';
 *
 * A naive line filter that drops only lines starting with `import` leaves an
 * orphaned `} from './x.js';` behind, which is a SYNTAX ERROR in Apps Script.
 * That bug shipped in an earlier draft of this generator and a
 * `grep -E "^(import|export)"` check did not catch it — so we also compile the
 * bundle with `node --check` in `npm run check`.
 */
function stripImports(source) {
  const lines = source.split('\n');
  const out = [];
  let inImport = false;

  for (const line of lines) {
    if (!inImport && /^\s*import\s/.test(line)) {
      // Either a complete single-line import, or the opening of a multi-line one.
      if (line.includes(';')) continue;
      inImport = true;
      continue;
    }
    if (inImport) {
      if (line.includes(';')) inImport = false;
      continue;
    }
    out.push(line);
  }
  return out;
}

/**
 * Strip ES module syntax while keeping the declaration bodies:
 *   export const X -> const X
 *   export function f -> function f
 */
/**
 * ES2021 numeric separators (100_000_000) are a Parse Error in the Apps Script
 * V8 runtime — the underscore reads as an ILLEGAL token. Strip them in the
 * generated output so the canonical sources can stay readable.
 */
function stripNumericSeparators(source) {
  return source.replace(/\b(\d[\d_]*_\d[\d_]*)\b/g, (m) => m.replace(/_/g, ''));
}

function flatten(source, file) {
  // Order matters:
  //  - stripNumericSeparators takes a STRING, so it runs while we still have one.
  //  - stripImports returns an ARRAY of lines, so it runs after the string work.
  const cleaned = stripNumericSeparators(source);
  return stripImports(cleaned)
    .filter((line) => !/^\s*export\s+default\s/.test(line))  // drop default exports
    .filter((line) => !/^\s*export\s*\{/.test(line))         // drop export lists
    .map((line) => line.replace(/^(\s*)export\s+/, '$1'))
    .join('\n')
    .replace('// CANONICAL SOURCE.', `// GENERATED from ${file} — DO NOT EDIT.`)
    .trim();
}

const files = (await readdir(here))
  .filter((f) => f.endsWith('.gs.js'))
  .sort();  // numeric prefixes (00_, 01_, ...) give deterministic load order

if (!files.length) {
  console.error('[build] No .gs.js modules found in ' + here);
  process.exit(1);
}

const parts = [
  '// PocketBudget backend — GENERATED FILE, DO NOT EDIT.',
  '// Source of truth: backend/*.gs.js   Rebuild with: npm run build',
  '',
];

for (const f of files) {
  const src = await readFile(join(here, f), 'utf8');
  const outName = basename(f, '.js');  // 00_Config.gs.js -> 00_Config.gs
  const body = flatten(src, outName);

  // Each .gs is written standalone too, so a single module can be pasted if ever needed.
  await writeFile(join(here, outName), body + '\n');

  parts.push('// ' + '='.repeat(70));
  parts.push('// ' + outName);
  parts.push('// ' + '='.repeat(70));
  parts.push(body);
  parts.push('');
  console.log('[build] built ' + outName);
}

await writeFile(join(here, 'Backend.bundle.gs'), parts.join('\n') + '\n');
console.log('[build] built Backend.bundle.gs (' + files.length + ' modules)');

// Inject a content-hash CACHE_VERSION into the service worker. This must run on
// every build: it is what guarantees a new release purges the previous cache.
try {
  const { stdout, stderr } = await execFileAsync('node', [join(here, 'sw-version.mjs')]);
  process.stdout.write(stdout);
  process.stderr.write(stderr);
} catch (err) {
  console.error('[build] failed to stamp the service worker cache version');
  process.stderr.write(err.stdout || '');
  process.stderr.write(err.stderr || '');
  process.exit(1);
}