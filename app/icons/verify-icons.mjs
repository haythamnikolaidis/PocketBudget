/**
 * Validates the PocketBudget PWA icons by reading the real bytes on disk:
 *   - PNG signature + IHDR chunk (bytes 16..24 = width, height, big-endian uint32)
 *   - colour type / bit depth sanity
 *   - non-trivial file size
 *   - for the maskable icon: every non-background pixel must lie inside the
 *     centre 80% safe zone (max distance from centre <= 0.40 of the canvas)
 *
 * Usage:  node app/icons/verify-icons.mjs     (exit code 1 on any failure)
 */
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = dirname(fileURLToPath(import.meta.url));
const EXPECTED = [
  { file: 'icon-192.png', w: 192, h: 192, maskable: false },
  { file: 'icon-512.png', w: 512, h: 512, maskable: false },
  { file: 'icon-maskable-512.png', w: 512, h: 512, maskable: true },
  { file: 'apple-touch-icon.png', w: 180, h: 180, maskable: false },
];

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const COLOUR_TYPES = { 0: 'greyscale', 2: 'truecolour', 3: 'indexed', 4: 'greyscale+alpha', 6: 'truecolour+alpha' };
const pct = (v, n) => ((100 * v) / n).toFixed(1);
let failures = 0;
const fail = (m) => { failures++; console.log(`  FAIL  ${m}`); };

for (const exp of EXPECTED) {
  const path = join(OUT_DIR, exp.file);
  console.log(`\n${exp.file}`);
  let buf;
  try {
    buf = readFileSync(path);
  } catch (e) {
    fail(`cannot read file: ${e.message}`);
    continue;
  }
  console.log(`  bytes on disk : ${buf.length}`);
  if (buf.length < 200) fail(`file is only ${buf.length} bytes - looks like an empty/stub file`);
  if (!buf.subarray(0, 8).equals(SIG)) fail('bad PNG signature (first 8 bytes are not 89 50 4E 47 0D 0A 1A 0A)');
  if (buf.subarray(12, 16).toString('ascii') !== 'IHDR') fail('first chunk is not IHDR');

  // Real dimensions straight out of the IHDR payload.
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  const bitDepth = buf[24];
  const colourType = buf[25];
  console.log(`  IHDR width    : ${w}`);
  console.log(`  IHDR height   : ${h}`);
  console.log(`  bit depth     : ${bitDepth}`);
  console.log(`  colour type   : ${colourType} (${COLOUR_TYPES[colourType]})`);
  if (w !== exp.w || h !== exp.h) fail(`expected ${exp.w}x${exp.h}, measured ${w}x${h}`);
  if (w !== h) fail(`not square: ${w}x${h}`);
  if (bitDepth !== 8) fail(`unexpected bit depth ${bitDepth}`);
  if (colourType !== 2) fail(`expected opaque truecolour (2), got ${colourType} - iOS rejects alpha in apple-touch-icon`);

  // Decode to pixels: collect IDAT payloads, inflate, strip per-scanline filters.
  const idat = [];
  let off = 8;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.subarray(off + 4, off + 8).toString('ascii');
    if (type === 'IDAT') idat.push(buf.subarray(off + 8, off + 8 + len));
    if (type === 'IEND') break;
    off += 12 + len;
  }
  if (idat.length === 0) { fail('no IDAT chunk'); continue; }
  const raw = inflateSync(Buffer.concat(idat));
  const bpp = 3;
  const stride = w * bpp;
  if (raw.length !== h * (stride + 1)) fail(`raw scanline size ${raw.length} != expected ${h * (stride + 1)}`);
  const px = Buffer.alloc(w * h * bpp);
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const cur = px.subarray(y * stride, (y + 1) * stride);
    const prior = y > 0 ? px.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prior ? prior[i] : 0;
      const c = prior && i >= bpp ? prior[i - bpp] : 0;
      let v = line[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[i] = v & 0xff;
    }
  }

  // Corner pixel proves the background really is the flat brand navy.
  const at = (x, y) => {
    const o = (y * w + x) * bpp;
    return [px[o], px[o + 1], px[o + 2]];
  };
  const corner = at(0, 0);
  console.log(`  bg @ (0,0)   : rgb(${corner.join(', ')})  #${corner.map((c) => c.toString(16).padStart(2, '0')).join('')}`);
  if (!(Math.abs(corner[0] - 0x0f) <= 2 && Math.abs(corner[1] - 0x17) <= 2 && Math.abs(corner[2] - 0x2a) <= 2)) {
    fail(`background is not flat #0f172a (got rgb(${corner.join(', ')}))`);
  }

  // Count distinct colours: flat design => a small palette (antialias edges add blends).
  const colours = new Set();
  for (let i = 0; i < px.length; i += bpp) colours.add(`${px[i]},${px[i + 1]},${px[i + 2]}`);
  console.log(`  distinct rgb : ${colours.size}`);

  // The emerald accent must actually be visible - a shape-painting-order bug can
  // hide it entirely while every other check still passes.
  let emerald = 0;
  for (let i = 0; i < px.length; i += bpp) {
    if (Math.abs(px[i] - 0x10) <= 24
      && Math.abs(px[i + 1] - 0xb9) <= 24 && Math.abs(px[i + 2] - 0x81) <= 24) emerald++;
  }
  console.log(`  emerald px   : ${emerald} (${pct(emerald, w * h)}% of canvas)`);
  if (emerald < w * h * 0.005) fail(`emerald accent #10b981 is missing or too small (${emerald}px) - it is being painted underneath another shape`);

  // Bounding box + extent of the artwork relative to the canvas.
  let minX = w, maxX = -1, minY = h, maxY = -1, nonBg = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * bpp;
      if (Math.abs(px[o] - 0x0f) <= 6 && Math.abs(px[o + 1] - 0x17) <= 6 && Math.abs(px[o + 2] - 0x2a) <= 6) continue;
      nonBg++;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  if (nonBg === 0) { fail('no artwork pixels found - canvas is entirely background'); continue; }
  const pctFrac = (v, n) => ((100 * v) / n).toFixed(1);
  console.log(`  artwork px   : ${nonBg} (${pctFrac(nonBg, w * h)}% of canvas)`);
  console.log(`  artwork bbox : x ${minX}..${maxX} (${pctFrac(minX, w)}%..${pctFrac(maxX, w)}%), y ${minY}..${maxY} (${pctFrac(minY, h)}%..${pctFrac(maxY, h)}%)`);

  // Design must span >= 25% of the canvas to stay legible at 40px.
  const spanPct = (100 * Math.max(maxX - minX, maxY - minY)) / w;
  console.log(`  max span     : ${spanPct.toFixed(1)}% of canvas`);
  if (spanPct < 25) fail(`artwork spans only ${spanPct.toFixed(1)}% of canvas - too small to read at 40px`);

  if (exp.maskable) {
    // Safe zone = circle of radius 0.40 * w centred on the icon (centre 80%).
    const cx = w / 2, cy = h / 2, limit = 0.4 * w;
    let maxR = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * bpp;
        if (Math.abs(px[o] - 0x0f) <= 6 && Math.abs(px[o + 1] - 0x17) <= 6 && Math.abs(px[o + 2] - 0x2a) <= 6) continue;
        const r = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (r > maxR) maxR = r;
      }
    }
    const insidePct = pct(maxR, w);
    console.log(`  safe zone    : max artwork radius ${maxR.toFixed(1)}px = ${insidePct}% of canvas (limit 40.0%)`);
    if (maxR > limit) fail(`artwork escapes the centre 80% safe zone (${insidePct}% > 40.0%)`);
  }
}

console.log(failures === 0 ? '\nALL ICONS VALID' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
