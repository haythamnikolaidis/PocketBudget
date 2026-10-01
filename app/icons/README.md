# PocketBudget app icons

Hand-built flat icons: a white wallet on `#0f172a` with a `#10b981` accent dot.
They are rasterised directly from signed-distance-field geometry into PNG bytes
using Node's built-in `zlib` (no ImageMagick/rsvg/inkscape, no npm dependencies,
no alpha channel — iOS rejects alpha in `apple-touch-icon.png`).

Regenerate: `node app/icons/generate-icons.mjs`
Validate:  `node app/icons/verify-icons.mjs`  (asserts IHDR dimensions, opacity,
the `#0f172a` background, accent presence, and the maskable 80% safe zone; exits
non-zero on failure). The maskable variant is the same artwork at 0.88 scale.
