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

/** Similarity transform (scale, rotation, translation) mapping a1→b1 and a2→b2: [a, b, c, d, e, f] as in canvas setTransform. */
export function alignTransform(a1: Pt, a2: Pt, b1: Pt, b2: Pt): [number, number, number, number, number, number] {
  const va = { x: a2.x - a1.x, y: a2.y - a1.y }, vb = { x: b2.x - b1.x, y: b2.y - b1.y };
  const la = Math.hypot(va.x, va.y) || 1;
  const s = Math.hypot(vb.x, vb.y) / la;
  const ang = Math.atan2(vb.y, vb.x) - Math.atan2(va.y, va.x);
  const cos = s * Math.cos(ang), sin = s * Math.sin(ang);
  return [cos, sin, -sin, cos, b1.x - (cos * a1.x - sin * a1.y), b1.y - (sin * a1.x + cos * a1.y)];
}
