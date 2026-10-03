#!/usr/bin/env node
// backend/sw-version.mjs
// Injects a build hash into app/sw.js so CACHE_VERSION can never go stale.
//
// Why this exists: CACHE_VERSION is the single string that separates "the assets
// I shipped" from "the assets the user already has". When it was hand-maintained,
// a deploy shipped without bumping it, the activate handler kept the old cache
// (it only deletes caches whose name DIFFERS), and the service worker served a
// pre-fix app.js forever. The result was a dead button with no network traffic
// and no console error — because the code that was supposed to bind the click
// handler was not the code that shipped.
//
// Deriving the version from a hash of the precached files removes the human
// step entirely: any change to any precached file produces a new version, so the
// next activate purges the previous cache. Forgetting becomes impossible.
//
// Usage:
//   node backend/sw-version.mjs           # write the hash into app/sw.js
//   node backend/sw-version.mjs --check   # fail if app/sw.js is out of date (for CI)

import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const SW_PATH = join(repoRoot, 'app', 'sw.js');

const MARKER = /const CACHE_VERSION = '([^']*)'/;

/** The exact list of files whose contents define a release. */
async function precacheList() {
  const sw = await readFile(SW_PATH, 'utf8');
  const m = sw.match(/const PRECACHE_URLS = \[([\s\S]*?)\];/);
  if (!m) throw new Error('could not find PRECACHE_URLS in app/sw.js');
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

/**
 * Hash every precached file's contents (not mtimes — a rebuild can produce new
 * bytes with identical timestamps, and a content hash is what actually matters).
 */
async function buildHash() {
  const entries = await precacheList();
  const hash = createHash('sha256');
  const used = [];

  for (const rel of entries) {
    // './' means index.html; icons and js live under app/.
    const relPath = rel === './' ? './index.html' : rel;
    const abs = join(repoRoot, 'app', relPath.replace(/^\.\//, ''));
    try {
      const buf = await readFile(abs);
      hash.update(relPath);
      hash.update(buf);
      used.push(relPath);
    } catch (err) {
      // A listed-but-missing file is a real error: it means the shell and the
      // precache list have drifted apart, which is how a 404 breaks offline.
      console.error(`[sw-version] precached file missing: ${relPath}`);
      process.exitCode = 1;
    }
  }

  if (process.exitCode) return null;
  return { short: hash.digest('hex').slice(0, 12), files: used.length };
}

const { short, files } = await buildHash() ?? {};
if (!short) process.exit(1);

const version = `pocketbudget-${short}`;
const sw = await readFile(SW_PATH, 'utf8');
const m = sw.match(MARKER);
if (!m) {
  console.error("[sw-version] could not find `const CACHE_VERSION = '...'` in app/sw.js");
  process.exit(1);
}

if (process.argv.includes('--check')) {
  if (m[1] !== version) {
    console.error(`[sw-version] app/sw.js is STALE.`);
    console.error(`          in file: ${m[1]}`);
    console.error(`          expected: ${version}`);
    console.error(`          run: node backend/sw-version.mjs`);
    process.exit(1);
  }
  console.log(`[sw-version] app/sw.js is current (${version}, ${files} files)`);
  process.exit(0);
}

if (m[1] === version) {
  console.log(`[sw-version] already current: ${version} (${files} files)`);
} else {
  // A doc comment, so the const stays documented, and trailing-newline separated
  // so the generated line is never glued to the closing delimiter.
  const banner = [
    '/**',
    ' * Cache namespace for this release.',
    ' *',
    ' * GENERATED — do not edit by hand. `npm run build` replaces the value below',
    ` * with a content hash of ${files} precached files, and \`npm run check\` fails if it is stale.`,
    ' *',
    ' * This was hand-maintained once and that was a mistake: a deploy shipped',
    ' * without bumping it, the previous cache survived activate(), and users kept',
    ' * running pre-fix code with no error to explain it.',
    ' */',
    '',
  ].join('\n');

  let out = sw.replace(MARKER, `const CACHE_VERSION = '${version}'`);

  // Replace any previously-injected banner so repeated builds stay idempotent.
  // Matches the block from the banner down to the closing `//` before the doc
  // comment, whichever wording is currently in the file.
  out = out.replace(
    /\/\*\*[\s\S]*?\*\/\nconst CACHE_VERSION = '[^']*';/,
    banner + "const CACHE_VERSION = '" + version + "';",
  );

  await writeFile(SW_PATH, out);
  console.log(`[sw-version] ${m[1]} -> ${version} (${files} files)`);
}