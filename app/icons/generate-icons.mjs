/**
 * PocketBudget PWA icon generator.
 *
 * Dependency-free: rasterises the icon geometry with signed-distance fields
 * (4x4 supersampled for antialiasing) and encodes PNG bytes directly using
 * Node's built-in zlib. Output is 8-bit truecolour (no alpha), opaque, so
 * iOS accepts apple-touch-icon.png and Android gets a full-bleed maskable icon.
 *
 * Usage:  node app/icons/generate-icons.mjs
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------- palette --
const NAVY = [0x0f, 0x17, 0x2a]; // #0f172a background
const WHITE = [0xff, 0xff, 0xff]; // #ffffff wallet body
const EMERALD = [0x10, 0xb9, 0x81]; // #10b981 accent

// --------------------------------------------------------------- geometry --
// All coordinates in unit space (0..1, y grows downward), so the same shape
// renders identically at every output size. Painter's order, back to front:
// BODY -> SLOT -> TAB -> DOT.
const BODY = { cx: 0.5, cy: 0.5, hw: 0.3, hh: 0.235, r: 0.105 }; // wallet body
const SLOT = { cx: 0.68, cy: 0.5, hw: 0.135, hh: 0.115, r: 0.115 }; // card slot, opens right
const TAB = { cx: 0.705, cy: 0.5, hw: 0.11, hh: 0.075, r: 0.075 }; // white tab in the slot
const DOT = { cx: 0.705, cy: 0.5, r: 0.058 }; // emerald accent dot

// Geometric preflight: the accent must sit fully inside the white tab, and the
// tab must sit inside the slot, or the dot renders underneath the tab.
for (const [name, inner, outer] of [['DOT in TAB', DOT, TAB], ['TAB in SLOT', TAB, SLOT], ['SLOT in BODY', SLOT, BODY]]) {
  const fits = Math.abs(inner.cx - outer.cx) + inner.r <= outer.hw
    && Math.abs(inner.cy - outer.cy) + inner.r <= outer.hh;
  if (!fits) throw new Error(`geometry: ${name} does not fit - accent would be hidden`);
}

/** Signed distance to an axis-aligned rounded box. Negative == inside. */
function sdRoundBox(px, py, b) {
  const qx = Math.abs(px - b.cx) - (b.hw - b.r);
  const qy = Math.abs(py - b.cy) - (b.hh - b.r);
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  return Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(qx, qy), 0) - b.r;
}

/**
 * Colour of a point given in canvas UV. `scale` shrinks the artwork about the
 * canvas centre (scale < 1 => maskable safe-zone inset).
 */
function colourAt(u, v, scale) {
  // Map canvas space back into design space for the uniform scale about centre.
  const x = 0.5 + (u - 0.5) / scale;
  const y = 0.5 + (v - 0.5) / scale;
  // Front-to-back paint order: the accent dot sits ON TOP of the white tab,
  // which sits inside the navy slot, which is cut out of the white body.
  if (Math.hypot(x - DOT.cx, y - DOT.cy) <= DOT.r) return EMERALD;
  if (sdRoundBox(x, y, TAB) <= 0) return WHITE;
  if (sdRoundBox(x, y, SLOT) <= 0) return NAVY;
  if (sdRoundBox(x, y, BODY) <= 0) return WHITE;
  return NAVY;
}

// -------------------------------------------------------------- rasteriser --
const SS = 4; // 4x4 = 16 samples per pixel

function render(size, scale) {
  const rgb = Buffer.alloc(size * size * 3);
  const step = 1 / (size * SS);
  let p = 0;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < SS; sy++) {
        const v = (py * SS + sy + 0.5) * step;
        for (let sx = 0; sx < SS; sx++) {
          const u = (px * SS + sx + 0.5) * step;
          const c = colourAt(u, v, scale);
          r += c[0];
          g += c[1];
          b += c[2];
        }
      }
      const n = SS * SS;
      rgb[p++] = Math.round(r / n);
      rgb[p++] = Math.round(g / n);
      rgb[p++] = Math.round(b / n);
    }
  }
  return rgb;
}

// ------------------------------------------------------------ PNG encoder --
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgb) {
  const stride = width * 3;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter type 0 (None)
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type 2 = truecolour RGB (opaque, no alpha)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ------------------------------------------------------------------ output --
const TARGETS = [
  { file: 'icon-192.png', size: 192, scale: 1.0 },
  { file: 'icon-512.png', size: 512, scale: 1.0 },
  { file: 'icon-maskable-512.png', size: 512, scale: 0.88 },
  { file: 'apple-touch-icon.png', size: 180, scale: 1.0 },
];

for (const t of TARGETS) {
  const png = encodePng(t.size, t.size, render(t.size, t.scale));
  const path = join(OUT_DIR, t.file);
  writeFileSync(path, png);
  console.log(`wrote ${t.file}  ${t.size}x${t.size}  ${png.length} bytes  (artwork scale ${t.scale})`);
}
