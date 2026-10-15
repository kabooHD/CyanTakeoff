// VisualSearch: find copies of a symbol on rendered pages.
//
// Pages and the symbol are turned into ink masks (dark pixels). A window of
// the page matches when the symbol's ink lands on page ink (recall) and the
// page ink in the window lands on the symbol (precision), each allowing one
// pixel of slack; the score is their harmonic mean. An integral image skips
// windows whose amount of ink is far from the symbol's, so blank paper costs
// almost nothing.

export interface Mask { w: number; h: number; data: Uint8Array }
export interface Match { x: number; y: number; w: number; h: number; score: number; angle: number; rank?: number }

/** Ink mask from RGBA pixels: dark enough and not transparent. */
export function toMask(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number, threshold = 170): Mask {
  const data = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < data.length; i++, j += 4) {
    const a = rgba[j + 3];
    const lum = (rgba[j] * 299 + rgba[j + 1] * 587 + rgba[j + 2] * 114) / 1000;
    data[i] = a > 64 && lum < threshold ? 1 : 0;
  }
  return { w, h, data };
}

export type RGB = [number, number, number];

/**
 * The colours drawn in a picture (Revu's Filter by Color swatches): opaque,
 * non-white pixels quantised to 32 levels per channel, the most frequent
 * first, with colours closer than `merge` folded into a stronger one.
 */
export function paletteOf(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number, max = 6, merge = 64): RGB[] {
  const counts = new Map<number, number>();
  for (let j = 0; j < w * h * 4; j += 4) {
    if (rgba[j + 3] <= 64) continue;
    const r = rgba[j] >> 3, g = rgba[j + 1] >> 3, b = rgba[j + 2] >> 3;
    if (r >= 30 && g >= 30 && b >= 30) continue; // paper
    const key = (r << 10) | (g << 5) | b;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const sorted = [...counts].sort((a, b) => b[1] - a[1]);
  const out: RGB[] = [];
  for (const [key] of sorted) {
    const c: RGB = [((key >> 10) & 31) * 8 + 4, ((key >> 5) & 31) * 8 + 4, (key & 31) * 8 + 4];
    if (out.some((o) => dist(o, c) < merge)) continue;
    out.push(c);
    if (out.length >= max) break;
  }
  return out;
}

const dist = (a: RGB, b: RGB) => Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);

/** Ink mask of the pixels close to one of `colors` (the colours left on in Filter by Color). */
export function toColorMask(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number, colors: RGB[], tolerance = 64): Mask {
  const data = new Uint8Array(w * h);
  if (!colors.length) return { w, h, data };
  const t2 = tolerance * tolerance;
  for (let i = 0, j = 0; i < data.length; i++, j += 4) {
    if (rgba[j + 3] <= 64) continue;
    const r = rgba[j], g = rgba[j + 1], b = rgba[j + 2];
    for (const c of colors) {
      if ((r - c[0]) ** 2 + (g - c[1]) ** 2 + (b - c[2]) ** 2 <= t2) { data[i] = 1; break; }
    }
  }
  return { w, h, data };
}

/** Grow ink by one pixel (3×3). */
export function dilate(m: Mask): Mask {
  const { w, h, data } = m;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!data[y * w + x]) continue;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx >= 0 && xx < w) out[yy * w + xx] = 1; }
      }
    }
  }
  return { w, h, data: out };
}

/** Crop to the ink's bounding box (null when there is no ink). */
export function trim(m: Mask): { mask: Mask; dx: number; dy: number } | null {
  let x0 = m.w, y0 = m.h, x1 = -1, y1 = -1;
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (m.data[y * m.w + x]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  if (x1 < 0) return null;
  const w = x1 - x0 + 1, h = y1 - y0 + 1, data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) data.set(m.data.subarray((y0 + y) * m.w + x0, (y0 + y) * m.w + x0 + w), y * w);
  return { mask: { w, h, data }, dx: x0, dy: y0 };
}

/** Rotate a mask by a multiple of 90° clockwise. */
export function rotate90(m: Mask, quarter: number): Mask {
  const q = ((quarter % 4) + 4) % 4;
  if (!q) return m;
  const w = q % 2 ? m.h : m.w, h = q % 2 ? m.w : m.h, data = new Uint8Array(w * h);
  for (let y = 0; y < m.h; y++) {
    for (let x = 0; x < m.w; x++) {
      if (!m.data[y * m.w + x]) continue;
      const [nx, ny] = q === 1 ? [m.h - 1 - y, x] : q === 2 ? [m.w - 1 - x, m.h - 1 - y] : [y, m.w - 1 - x];
      data[ny * w + nx] = 1;
    }
  }
  return { w, h, data };
}

function integral(m: Mask): Int32Array {
  const W = m.w + 1, s = new Int32Array(W * (m.h + 1));
  for (let y = 0; y < m.h; y++) {
    let row = 0;
    for (let x = 0; x < m.w; x++) { row += m.data[y * m.w + x]; s[(y + 1) * W + x + 1] = s[y * W + x + 1] + row; }
  }
  return s;
}

/**
 * Windows of `page` that match `tmpl` with a score of at least `threshold`
 * (0..1), best first, overlapping weaker ones dropped.
 */
export function findMatches(page: Mask, tmpl: Mask, threshold = 0.8, angle = 0, max = 2000): Match[] {
  const { w: tw, h: th } = tmpl;
  if (tw > page.w || th > page.h) return [];
  const tInk: number[] = [];
  for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) if (tmpl.data[y * tw + x]) tInk.push(y * page.w + x);
  const tCount = tInk.length;
  if (!tCount) return [];
  const pageDil = dilate(page).data, tDil = dilate(tmpl).data;
  const S = integral(page), W = page.w + 1;
  const need = Math.ceil(tCount * threshold);
  const found: Match[] = [];
  for (let y = 0; y + th <= page.h; y++) {
    for (let x = 0; x + tw <= page.w; x++) {
      const ink = S[(y + th) * W + x + tw] - S[y * W + x + tw] - S[(y + th) * W + x] + S[y * W + x];
      if (ink < tCount * 0.5 || ink > tCount * 2) continue;
      // Recall: the symbol's ink found on (slightly grown) page ink.
      const base = y * page.w + x;
      let hits = 0, exact = 0, left = tCount;
      for (const o of tInk) { if (pageDil[base + o]) { hits++; exact += page.data[base + o]; } left--; if (hits + left < need) break; }
      if (hits < need) continue;
      // Precision: the window's ink lying on the (slightly grown) symbol.
      let on = 0;
      for (let yy = 0; yy < th; yy++) {
        const row = (y + yy) * page.w + x;
        for (let xx = 0; xx < tw; xx++) if (page.data[row + xx] && tDil[yy * tw + xx]) on++;
      }
      const r = hits / tCount, p = on / ink, score = (2 * p * r) / (p + r);
      // Exact overlap breaks ties between windows a pixel apart.
      if (score >= threshold) found.push({ x, y, w: tw, h: th, score, angle, rank: score + (exact / tCount) * 1e-3 });
    }
  }
  return suppress(found, max);
}

/** Keep the best of overlapping matches. */
export function suppress(ms: Match[], max = 2000): Match[] {
  const out: Match[] = [];
  for (const m of [...ms].sort((a, b) => (b.rank ?? b.score) - (a.rank ?? a.score))) {
    const overlaps = out.some((o) => {
      const ix = Math.max(0, Math.min(o.x + o.w, m.x + m.w) - Math.max(o.x, m.x));
      const iy = Math.max(0, Math.min(o.y + o.h, m.y + m.h) - Math.max(o.y, m.y));
      return ix * iy > 0.3 * Math.min(o.w * o.h, m.w * m.h);
    });
    if (!overlaps) out.push(m);
    if (out.length >= max) break;
  }
  return out;
}

/** Rotate a mask by any angle (degrees, clockwise), nearest neighbour; exact for multiples of 90°. */
export function rotateMask(m: Mask, deg: number): Mask {
  const a = ((deg % 360) + 360) % 360;
  if (a % 90 === 0) return rotate90(m, a / 90);
  const r = (a * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  const w = Math.ceil(Math.abs(m.w * c) + Math.abs(m.h * s)), h = Math.ceil(Math.abs(m.w * s) + Math.abs(m.h * c));
  const data = new Uint8Array(w * h);
  const cx = m.w / 2, cy = m.h / 2, ox = w / 2, oy = h / 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Inverse rotation back into the source.
      const dx = x + 0.5 - ox, dy = y + 0.5 - oy;
      const sx = Math.floor(c * dx + s * dy + cx), sy = Math.floor(-s * dx + c * dy + cy);
      if (sx >= 0 && sy >= 0 && sx < m.w && sy < m.h && m.data[sy * m.w + sx]) data[y * w + x] = 1;
    }
  }
  return trim({ w, h, data })?.mask ?? { w, h, data };
}

/** Resize a mask by a factor (nearest neighbour, ink kept). */
export function scaleMask(m: Mask, f: number): Mask {
  if (Math.abs(f - 1) < 1e-6) return m;
  const w = Math.max(1, Math.round(m.w * f)), h = Math.max(1, Math.round(m.h * f)), data = new Uint8Array(w * h);
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (m.data[y * m.w + x]) data[Math.min(h - 1, Math.floor(y * f)) * w + Math.min(w - 1, Math.floor(x * f))] = 1;
  return { w, h, data };
}
