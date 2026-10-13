// Raster flood fill and contour tracing for Dynamic Fill (pure, testable).
// The mask is a grid of `w` x `h` cells: 1 = wall (drawing content or a
// temporary boundary), 0 = open. A fill grows from seed cells over open
// cells; its outline is traced along cell edges and simplified.
import type { Pt } from './types';

export interface Grid { w: number; h: number; data: Uint8Array }

/** Incremental flood fill: call `step` repeatedly (e.g. per animation frame). */
export class Flood {
  readonly filled: Uint8Array;
  private queue: Int32Array;
  private head = 0;
  private tail = 0;
  constructor(readonly mask: Grid, filled?: Uint8Array) {
    this.filled = filled ?? new Uint8Array(mask.w * mask.h);
    this.queue = new Int32Array(mask.w * mask.h);
  }
  /** Add a seed cell (ignored on walls or already filled cells). */
  seed(x: number, y: number) {
    const { w, h, data } = this.mask;
    x = Math.floor(x); y = Math.floor(y);
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = y * w + x;
    if (data[i] || this.filled[i]) return;
    this.filled[i] = 1;
    this.queue[this.tail++] = i;
  }
  get done() { return this.head === this.tail; }
  /** Grow by up to `budget` cells; returns the number added. */
  step(budget = Infinity): number {
    const { w, h, data } = this.mask;
    const f = this.filled, q = this.queue;
    let n = 0;
    while (this.head < this.tail && n < budget) {
      const i = q[this.head++];
      const x = i % w, y = (i - x) / w;
      const visit = (j: number) => { if (!data[j] && !f[j]) { f[j] = 1; q[this.tail++] = j; n++; } };
      if (x > 0) visit(i - 1);
      if (x < w - 1) visit(i + 1);
      if (y > 0) visit(i - w);
      if (y < h - 1) visit(i + w);
    }
    return n;
  }
}

/** Mark cells along a polyline as wall, `radius` cells thick (temporary boundaries). */
export function drawWall(g: Grid, pts: Pt[], radius: number) {
  const r = Math.max(0, Math.round(radius));
  const plot = (cx: number, cy: number) => {
    for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
      if (x >= 0 && y >= 0 && x < g.w && y < g.h && (x - cx) ** 2 + (y - cy) ** 2 <= r * r + r) g.data[y * g.w + x] = 1;
    }
  };
  for (let k = 1; k < pts.length; k++) {
    const a = pts[k - 1], b = pts[k];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)));
    for (let i = 0; i <= n; i++) plot(Math.round(a.x + ((b.x - a.x) * i) / n), Math.round(a.y + ((b.y - a.y) * i) / n));
  }
  if (pts.length === 1) plot(Math.round(pts[0].x), Math.round(pts[0].y));
}

/** Thicken walls by `r` cells (edge sensitivity: closes hairline gaps). */
export function dilate(g: Grid, r: number): Grid {
  if (r <= 0) return g;
  const { w, h } = g;
  let src = g.data;
  for (let k = 0; k < r; k++) {
    const out = new Uint8Array(src);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (src[i]) continue;
      if ((x > 0 && src[i - 1]) || (x < w - 1 && src[i + 1]) || (y > 0 && src[i - w]) || (y < h - 1 && src[i + w])) out[i] = 1;
    }
    src = out;
  }
  return { w, h, data: src };
}

/**
 * Closed outlines of the filled region, along cell edges, in cell units.
 * Outer outlines run one way and holes the other (signed area > 0 = outer,
 * in y-down coordinates).
 */
export function traceRegion(filled: Uint8Array, w: number, h: number): Pt[][] {
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && filled[y * w + x] === 1;
  // Directed boundary edges with the filled cell on the right (y down),
  // keyed by start vertex. Vertex id = y * (w + 1) + x.
  const W = w + 1;
  const next = new Map<number, number[]>();
  const add = (x0: number, y0: number, x1: number, y1: number) => {
    const a = y0 * W + x0, b = y1 * W + x1;
    const l = next.get(a);
    if (l) l.push(b); else next.set(a, [b]);
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!at(x, y)) continue;
    if (!at(x, y - 1)) add(x, y, x + 1, y); // top edge, left to right
    if (!at(x + 1, y)) add(x + 1, y, x + 1, y + 1); // right edge, downwards
    if (!at(x, y + 1)) add(x + 1, y + 1, x, y + 1); // bottom edge, right to left
    if (!at(x - 1, y)) add(x, y + 1, x, y); // left edge, upwards
  }
  const loops: Pt[][] = [];
  const pt = (v: number) => ({ x: v % W, y: Math.floor(v / W) });
  for (const start of [...next.keys()]) {
    while (next.get(start)?.length) {
      const loop: Pt[] = [];
      let v = start;
      let prevDir: Pt | null = null;
      for (let guard = 0; guard < 4 * (w + 1) * (h + 1); guard++) {
        const outs = next.get(v);
        if (!outs?.length) break;
        // At a pinch vertex (two edges out), turn right to keep regions separate.
        let k = 0;
        if (outs.length > 1 && prevDir) {
          const p = pt(v);
          const right = { x: -prevDir.y, y: prevDir.x };
          const j = outs.findIndex((o) => { const q = pt(o); return q.x - p.x === right.x && q.y - p.y === right.y; });
          if (j >= 0) k = j;
        }
        const u = outs.splice(k, 1)[0];
        const a = pt(v), b = pt(u);
        prevDir = { x: b.x - a.x, y: b.y - a.y };
        loop.push(a);
        v = u;
        if (v === start) break;
      }
      if (loop.length >= 4) loops.push(collinearFree(loop));
    }
  }
  return loops;
}

/** Drop vertices in the middle of straight runs. */
function collinearFree(pts: Pt[]): Pt[] {
  const n = pts.length;
  return pts.filter((p, i) => {
    const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
    return (p.x - a.x) * (b.y - p.y) - (p.y - a.y) * (b.x - p.x) !== 0;
  });
}

/** Douglas-Peucker simplification of a closed outline. */
export function simplifyClosed(pts: Pt[], tol: number): Pt[] {
  if (pts.length <= 4) return pts;
  // Split at the vertex farthest from the first so both halves are open chains.
  let far = 0, best = -1;
  pts.forEach((p, i) => { const d = (p.x - pts[0].x) ** 2 + (p.y - pts[0].y) ** 2; if (d > best) { best = d; far = i; } });
  const a = dp([...pts.slice(0, far + 1)], tol);
  const b = dp([...pts.slice(far), pts[0]], tol);
  const out = [...a.slice(0, -1), ...b.slice(0, -1)];
  return out.length >= 3 ? out : pts;
}

function dp(pts: Pt[], tol: number): Pt[] {
  if (pts.length < 3) return pts;
  const a = pts[0], b = pts[pts.length - 1];
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1e-9;
  let idx = 0, max = -1;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs((b.x - a.x) * (a.y - pts[i].y) - (a.x - pts[i].x) * (b.y - a.y)) / len;
    if (d > max) { max = d; idx = i; }
  }
  if (max <= tol) return [a, b];
  return [...dp(pts.slice(0, idx + 1), tol).slice(0, -1), ...dp(pts.slice(idx), tol)];
}
