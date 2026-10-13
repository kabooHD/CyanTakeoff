// Drawing comparison (Revu: Compare Documents, Overlay Pages) on rasterised
// pages: ink masks, differences grouped into rectangles, two-colour overlays,
// and the alignment transform from picked point pairs.
import type { Pt } from './types';

/** Darkness 0..255 per pixel from RGBA data (white paper = 0). */
export function inkOf(rgba: Uint8ClampedArray | Uint8Array): Uint8Array {
  const out = new Uint8Array(rgba.length / 4);
  for (let i = 0; i < out.length; i++) {
    const a = rgba[i * 4 + 3] / 255;
    const lum = (0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2]) * a + 255 * (1 - a);
    out[i] = 255 - lum;
  }
  return out;
}

/** Grow ink by `r` pixels so tiny shifts (anti-aliasing) don't count as changes. */
export function spread(ink: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r <= 0) return ink;
  let src = ink;
  for (let k = 0; k < r; k++) {
    const out = new Uint8Array(src);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      out[i] = Math.max(src[i], x > 0 ? src[i - 1] : 0, x < w - 1 ? src[i + 1] : 0, y > 0 ? src[i - w] : 0, y < h - 1 ? src[i + w] : 0);
    }
    src = out;
  }
  return src;
}

/**
 * Pixels where one drawing has ink the other lacks (beyond `tolerance`
 * pixels): 1 = only in A (removed), 2 = only in B (added).
 */
export function diffMask(a: Uint8Array, b: Uint8Array, w: number, h: number, tolerance = 1, threshold = 96): Uint8Array {
  const aw = spread(a, w, h, tolerance), bw = spread(b, w, h, tolerance);
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) {
    if (a[i] > threshold && bw[i] <= threshold / 2) out[i] = 1;
    else if (b[i] > threshold && aw[i] <= threshold / 2) out[i] = 2;
  }
  return out;
}

export interface DiffBox { x0: number; y0: number; x1: number; y1: number; kind: 'added' | 'removed' | 'changed'; pixels: number }

/**
 * Group difference pixels into rectangles: cells of `cell` px with any
 * difference are joined with neighbours within `gap` cells.
 */
export function diffBoxes(mask: Uint8Array, w: number, h: number, cell = 8, gap = 2, minPixels = 6): DiffBox[] {
  const cw = Math.ceil(w / cell), ch = Math.ceil(h / cell);
  const cnt = new Int32Array(cw * ch), kinds = new Uint8Array(cw * ch);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = mask[y * w + x];
    if (!v) continue;
    const c = Math.floor(y / cell) * cw + Math.floor(x / cell);
    cnt[c]++; kinds[c] |= v;
  }
  const seen = new Uint8Array(cw * ch);
  const boxes: DiffBox[] = [];
  for (let s = 0; s < cw * ch; s++) {
    if (!cnt[s] || seen[s]) continue;
    const stack = [s]; seen[s] = 1;
    let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1, px = 0, k = 0;
    while (stack.length) {
      const c = stack.pop()!;
      const cx = c % cw, cy = (c - cx) / cw;
      x0 = Math.min(x0, cx); y0 = Math.min(y0, cy); x1 = Math.max(x1, cx); y1 = Math.max(y1, cy);
      px += cnt[c]; k |= kinds[c];
      for (let dy = -gap; dy <= gap; dy++) for (let dx = -gap; dx <= gap; dx++) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue;
        const n = ny * cw + nx;
        if (cnt[n] && !seen[n]) { seen[n] = 1; stack.push(n); }
      }
    }
    if (px < minPixels) continue;
    boxes.push({ x0: x0 * cell, y0: y0 * cell, x1: Math.min(w, (x1 + 1) * cell), y1: Math.min(h, (y1 + 1) * cell), kind: k === 1 ? 'removed' : k === 2 ? 'added' : 'changed', pixels: px });
  }
  return boxes.sort((p, q) => p.y0 - q.y0 || p.x0 - q.x0);
}

/** Two-colour overlay: ink only in A in `ca`, only in B in `cb`, in both dark grey. */
export function overlayImage(a: Uint8Array, b: Uint8Array, out: Uint8ClampedArray, ca: [number, number, number], cb: [number, number, number]) {
  for (let i = 0; i < a.length; i++) {
    const x = a[i] / 255, y = b[i] / 255;
    const both = Math.min(x, y), onlyA = x - both, onlyB = y - both;
    for (let c = 0; c < 3; c++) {
      const v = 255 - both * 225 - onlyA * (255 - ca[c]) - onlyB * (255 - cb[c]);
      out[i * 4 + c] = Math.max(0, Math.min(255, v));
    }
    out[i * 4 + 3] = 255;
  }
}

export type Mat = [number, number, number, number, number, number];

/** Similarity transform (scale, rotation, translation) mapping a1→b1 and a2→b2: [a, b, c, d, e, f] as in canvas setTransform. */
export function alignTransform(a1: Pt, a2: Pt, b1: Pt, b2: Pt): Mat {
  const va = { x: a2.x - a1.x, y: a2.y - a1.y }, vb = { x: b2.x - b1.x, y: b2.y - b1.y };
  const la = Math.hypot(va.x, va.y) || 1;
  const s = Math.hypot(vb.x, vb.y) / la;
  const ang = Math.atan2(vb.y, vb.x) - Math.atan2(va.y, va.x);
  const cos = s * Math.cos(ang), sin = s * Math.sin(ang);
  return [cos, sin, -sin, cos, b1.x - (cos * a1.x - sin * a1.y), b1.y - (sin * a1.x + cos * a1.y)];
}

export const applyMat = (m: Mat, p: Pt): Pt => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] });

export function invertMat(m: Mat): Mat {
  const det = m[0] * m[3] - m[1] * m[2] || 1;
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
}

/** Bounding box of rectangle (x0,y0)-(x1,y1) after transform `m`. */
export function mapBox(m: Mat, b: Rect): Rect {
  const c = [applyMat(m, { x: b.x0, y: b.y0 }), applyMat(m, { x: b.x1, y: b.y0 }), applyMat(m, { x: b.x0, y: b.y1 }), applyMat(m, { x: b.x1, y: b.y1 })];
  return { x0: Math.min(...c.map((p) => p.x)), y0: Math.min(...c.map((p) => p.y)), x1: Math.max(...c.map((p) => p.x)), y1: Math.max(...c.map((p) => p.y)) };
}

// ---------------- Vector comparison ----------------

export interface Rect { x0: number; y0: number; x1: number; y1: number }
/** A page's drawing as vectors, in page space: straight segments (x1,y1,x2,y2...) and text runs. */
export interface VectorPage { segments: Float32Array; texts: (Rect & { str: string })[] }

/** Grid of segments for "is there a line within tol of this point" queries. */
class SegIndex {
  private grid = new Map<number, number[]>();
  private big: number[] = [];
  constructor(private s: Float32Array, private cell: number) {
    for (let i = 0; i < s.length; i += 4) {
      const x0 = Math.floor(Math.min(s[i], s[i + 2]) / cell), x1 = Math.floor(Math.max(s[i], s[i + 2]) / cell);
      const y0 = Math.floor(Math.min(s[i + 1], s[i + 3]) / cell), y1 = Math.floor(Math.max(s[i + 1], s[i + 3]) / cell);
      if ((x1 - x0 + 1) * (y1 - y0 + 1) > 4000) { this.big.push(i); continue; }
      for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) {
        const k = cx * 100_003 + cy;
        let a = this.grid.get(k);
        if (!a) this.grid.set(k, (a = []));
        a.push(i);
      }
    }
  }
  private d2(i: number, x: number, y: number) {
    const s = this.s, ax = s[i], ay = s[i + 1], dx = s[i + 2] - ax, dy = s[i + 3] - ay;
    const l = dx * dx + dy * dy;
    const t = l ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l)) : 0;
    return (ax + t * dx - x) ** 2 + (ay + t * dy - y) ** 2;
  }
  near(x: number, y: number, tol: number): boolean {
    const t2 = tol * tol;
    for (let cx = Math.floor((x - tol) / this.cell); cx <= Math.floor((x + tol) / this.cell); cx++) {
      for (let cy = Math.floor((y - tol) / this.cell); cy <= Math.floor((y + tol) / this.cell); cy++) {
        for (const i of this.grid.get(cx * 100_003 + cy) ?? []) if (this.d2(i, x, y) <= t2) return true;
      }
    }
    return this.big.some((i) => this.d2(i, x, y) <= t2);
  }
}

function mapSegs(s: Float32Array, m: Mat | null): Float32Array {
  if (!m) return s;
  const out = new Float32Array(s.length);
  for (let i = 0; i < s.length; i += 2) {
    out[i] = m[0] * s[i] + m[2] * s[i + 1] + m[4];
    out[i + 1] = m[1] * s[i] + m[3] * s[i + 1] + m[5];
  }
  return out;
}

/** Points sampled along `segs` (every `step`) that have no line of `idx` within `tol`. */
function uncovered(segs: Float32Array, idx: SegIndex, tol: number, step: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < segs.length; i += 4) {
    const ax = segs[i], ay = segs[i + 1], dx = segs[i + 2] - ax, dy = segs[i + 3] - ay;
    const n = Math.min(400, Math.max(1, Math.ceil(Math.hypot(dx, dy) / step)));
    for (let k = 0; k <= n; k++) {
      const x = ax + (dx * k) / n, y = ay + (dy * k) / n;
      if (!idx.near(x, y, tol)) out.push({ x, y });
    }
  }
  return out;
}

const center = (r: Rect) => ({ x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 });

/** Text runs of `a` with no run of the same text at about the same place in `b`. */
function unmatchedText(a: (Rect & { str: string })[], b: (Rect & { str: string })[], tol: number): Rect[] {
  const byStr = new Map<string, Pt[]>();
  for (const t of b) {
    const k = t.str.trim();
    if (!byStr.has(k)) byStr.set(k, []);
    byStr.get(k)!.push(center(t));
  }
  return a.filter((t) => {
    const c = center(t), lim = Math.max(tol * 2, (t.y1 - t.y0) * 0.5);
    return !(byStr.get(t.str.trim()) ?? []).some((q) => Math.abs(q.x - c.x) <= lim && Math.abs(q.y - c.y) <= lim);
  });
}

/**
 * Compare two pages as vectors (lines, curves and text), in the space of `b`.
 * `m` maps page `a` onto page `b` (alignment points), or null when the pages
 * line up as drawn. Linework is sampled every `step` and counts as changed
 * where the other page has no line within `tol` (page units).
 */
export function vectorDiff(a: VectorPage, b: VectorPage, m: Mat | null, tol = 1, step = 2) {
  const sa = mapSegs(a.segments, m);
  const ta = m ? a.texts.map((t) => ({ ...mapBox(m, t), str: t.str })) : a.texts;
  const cell = 16;
  return {
    removed: uncovered(sa, new SegIndex(b.segments, cell), tol, step),
    added: uncovered(b.segments, new SegIndex(sa, cell), tol, step),
    removedText: unmatchedText(ta, b.texts, tol),
    addedText: unmatchedText(b.texts, ta, tol),
  };
}

/** Rasterise a vectorDiff at `k` px per unit into a diffMask-style mask (1 removed, 2 added). */
export function vectorMask(d: ReturnType<typeof vectorDiff>, w: number, h: number, k: number): Uint8Array {
  const mask = new Uint8Array(w * h);
  const dot = (p: Pt, v: number) => {
    const x = Math.floor(p.x * k), y = Math.floor(p.y * k);
    if (x >= 0 && y >= 0 && x < w && y < h) mask[y * w + x] |= v;
  };
  const box = (r: Rect, v: number) => {
    for (let y = Math.max(0, Math.floor(r.y0 * k)); y < Math.min(h, Math.ceil(r.y1 * k)); y++) {
      for (let x = Math.max(0, Math.floor(r.x0 * k)); x < Math.min(w, Math.ceil(r.x1 * k)); x++) mask[y * w + x] |= v;
    }
  };
  d.removed.forEach((p) => dot(p, 1)); d.added.forEach((p) => dot(p, 2));
  d.removedText.forEach((r) => box(r, 1)); d.addedText.forEach((r) => box(r, 2));
  return mask;
}
