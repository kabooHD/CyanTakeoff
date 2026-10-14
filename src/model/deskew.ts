// Deskew (Revu, Document > Deskew): find how far a scanned page's text lines
// are tilted, by the projection-profile method: rotate the dark pixels by
// trial angles and keep the angle whose row histogram is sharpest (lines of
// text fall into few rows).

/**
 * Tilt of the lines in a 1-bit image (`dark[y * w + x]` non-zero = ink), in
 * degrees, y pointing down: positive means lines descend to the right.
 */
export function estimateSkew(dark: Uint8Array, w: number, h: number, maxDeg = 10): number {
  // At most ~40k sample points keep this fast on large pages.
  const pts: number[] = [];
  let count = 0;
  for (let i = 0; i < dark.length; i++) if (dark[i]) count++;
  const stride = Math.max(1, Math.floor(count / 40000));
  let k = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (dark[y * w + x] && k++ % stride === 0) pts.push(x - w / 2, y - h / 2);
  if (pts.length < 40) return 0;
  const diag = Math.ceil(Math.hypot(w, h)) + 2;
  const bins = new Float64Array(diag * 2);
  const score = (deg: number) => {
    const t = (deg * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
    bins.fill(0);
    for (let i = 0; i < pts.length; i += 2) bins[Math.round(pts[i + 1] * c - pts[i] * s) + diag]++;
    let sum = 0;
    for (const b of bins) sum += b * b;
    return sum;
  };
  const search = (lo: number, hi: number, step: number) => {
    let best = 0, bestScore = -1;
    for (let a = lo; a <= hi + 1e-9; a += step) { const v = score(a); if (v > bestScore) { bestScore = v; best = a; } }
    return best;
  };
  const coarse = search(-maxDeg, maxDeg, 0.5);
  const fine = search(coarse - 0.5, coarse + 0.5, 0.05);
  return Math.round(fine * 100) / 100;
}

/**
 * PDF matrix rotating a page's content about (cx, cy) by `deg` degrees
 * counterclockwise as seen on screen; deskewing a tilt of `t` uses `deg = t`.
 */
export function rotationAbout(deg: number, cx: number, cy: number): [number, number, number, number, number, number] {
  const t = (deg * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
  return [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy];
}
