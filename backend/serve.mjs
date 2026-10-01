#!/usr/bin/env node
// backend/serve.mjs
// Zero-dependency static file server for local development of the PWA.
//
// Usage: npm run dev   ->  http://localhost:8080
//
// Exists because ES modules require a real HTTP origin. Opening index.html via
// file:// fails on module CORS, which looks like a code bug and is not one.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(join(here, '..', 'app'));
const PORT = Number(process.env.PORT) || 8080;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',   // REQUIRED for ES modules
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === '/') pathname = '/index.html';

    const target = resolve(join(ROOT, normalize(pathname)));

    // Path traversal guard: the resolved path must stay inside ROOT.
    if (target !== ROOT && !target.startsWith(ROOT + '/')) {
      res.writeHead(403, { 'Content-Type': 'text/plain' }).end('Forbidden');
      return;
    }

    const data = await readFile(target);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(target)] || 'application/octet-stream',
      'Cache-Control': 'no-store',   // always serve fresh while developing
    });
    res.end(data);
  } catch (err) {
    const code = err && err.code === 'ENOENT' ? 404 : 500;
    res.writeHead(code, { 'Content-Type': 'text/plain' })
       .end(code === 404 ? 'Not found' : 'Server error');
  }
}).listen(PORT, () => {
  console.log('[dev] PocketBudget dev server: http://localhost:' + PORT);
  console.log('[dev] serving: ' + ROOT);
});