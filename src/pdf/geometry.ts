import { OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFPageProxy, PageViewport } from 'pdfjs-dist';
import type { Pt } from '../model/types';

/**
 * Vector geometry of a page's drawing content (lines and path vertices) in
 * page space, with a grid index for fast snapping ("Content" snap).
 */
export interface SnapGeometry {
  /** Snap targets: vertices / endpoints, flattened x,y. */
  points: Float32Array;
  /** Straight segments, flattened x1,y1,x2,y2. */
  segments: Float32Array;
  /** Curves flattened into short segments (for comparing drawings, not snapping). */
  curves: Float32Array;
  pointGrid: Map<number, number[]>;
  segGrid: Map<number, number[]>;
}

const CELL = 24;
const MAX_POINTS = 400_000;
const key = (cx: number, cy: number) => cx * 100_003 + cy;

type M = [number, number, number, number, number, number];
const mul = (m: M, n: M): M => [
  m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5],
];

const cache = new WeakMap<PDFPageProxy, Promise<SnapGeometry>>();

export function snapGeometry(page: PDFPageProxy, vp: PageViewport): Promise<SnapGeometry> {
  let p = cache.get(page);
  if (!p) { p = extract(page, vp); cache.set(page, p); }
  return p;
}

async function extract(page: PDFPageProxy, vp: PageViewport): Promise<SnapGeometry> {
  const ops = await page.getOperatorList();
  const pts: number[] = [];
  const segs: number[] = [];
  const curves: number[] = [];
  /** Flatten a Bezier from `a` through control points into 8 chords. */
  const bezier = (a: [number, number], c: [number, number][], end: [number, number]) => {
    const P = [a, ...c, end];
    let prev = a;
    for (let k = 1; k <= 8; k++) {
      const t = k / 8, u = 1 - t;
      const q: [number, number] = P.length === 4
        ? [u * u * u * P[0][0] + 3 * u * u * t * P[1][0] + 3 * u * t * t * P[2][0] + t * t * t * P[3][0],
          u * u * u * P[0][1] + 3 * u * u * t * P[1][1] + 3 * u * t * t * P[2][1] + t * t * t * P[3][1]]
        : [u * u * P[0][0] + 2 * u * t * P[1][0] + t * t * P[2][0], u * u * P[0][1] + 2 * u * t * P[1][1] + t * t * P[2][1]];
      curves.push(prev[0], prev[1], q[0], q[1]);
      prev = q;
    }
  };
  // Device transform: PDF user space -> page space (viewport at scale 1).
  let ctm: M = vp.transform as M;
  const stack: M[] = [];
  const tp = (x: number, y: number): [number, number] => [
    ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5],
  ];
  const { fnArray, argsArray } = ops;
  for (let i = 0; i < fnArray.length && pts.length < MAX_POINTS * 2; i++) {
    const fn = fnArray[i];
    const args = argsArray[i] as unknown[];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() ?? ctm;
    else if (fn === OPS.transform) ctm = mul(args as M, ctm);
    else if (fn === OPS.paintFormXObjectBegin) {
      stack.push(ctm);
      const m = args[0] as M | null;
      if (m) ctm = mul(m, ctm);
    } else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() ?? ctm;
    else if (fn === OPS.constructPath) {
      const op = args[0] as number;
      if (op === OPS.endPath) continue; // clipping paths only
      const data = (args[1] as (Float32Array | null)[])?.[0];
      if (!data) continue;
      let cur: [number, number] | null = null;
      let start: [number, number] | null = null;
      for (let j = 0; j < data.length;) {
        switch (data[j++]) {
          case 0: { // moveTo
            cur = start = tp(data[j++], data[j++]);
            pts.push(cur[0], cur[1]);
            break;
          }
          case 1: { // lineTo
            const n = tp(data[j++], data[j++]);
            if (cur) segs.push(cur[0], cur[1], n[0], n[1]);
            pts.push(n[0], n[1]);
            cur = n;
            break;
          }
          case 2: { // curveTo
            const c1 = tp(data[j++], data[j++]), c2 = tp(data[j++], data[j++]);
            const n = tp(data[j++], data[j++]);
            if (cur) bezier(cur, [c1, c2], n);
            cur = n;
            pts.push(cur[0], cur[1]);
            break;
          }
          case 3: { // quadraticCurveTo
            const c1 = tp(data[j++], data[j++]);
            const n = tp(data[j++], data[j++]);
            if (cur) bezier(cur, [c1], n);
            cur = n;
            pts.push(cur[0], cur[1]);
            break;
          }
          case 4: // closePath
            if (cur && start) segs.push(cur[0], cur[1], start[0], start[1]);
            cur = start;
            break;
          default:
            j = data.length;
        }
      }
    }
  }
  const points = new Float32Array(pts);
  const segments = new Float32Array(segs);
  const pointGrid = new Map<number, number[]>();
  for (let i = 0; i < points.length; i += 2) {
    const k = key(Math.floor(points[i] / CELL), Math.floor(points[i + 1] / CELL));
    let a = pointGrid.get(k);
    if (!a) pointGrid.set(k, (a = []));
    a.push(i);
  }
  const segGrid = new Map<number, number[]>();
  for (let i = 0; i < segments.length; i += 4) {
    const x0 = Math.floor(Math.min(segments[i], segments[i + 2]) / CELL), x1 = Math.floor(Math.max(segments[i], segments[i + 2]) / CELL);
    const y0 = Math.floor(Math.min(segments[i + 1], segments[i + 3]) / CELL), y1 = Math.floor(Math.max(segments[i + 1], segments[i + 3]) / CELL);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 400) continue; // skip huge diagonal lines (borders) in the grid
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const k = key(cx, cy);
        let a = segGrid.get(k);
        if (!a) segGrid.set(k, (a = []));
        a.push(i);
      }
    }
  }
  return { points, segments, curves: new Float32Array(curves), pointGrid, segGrid };
}

/** Nearest content vertex within `tol`, else nearest point on a content line. */
export function snapToContent(g: SnapGeometry, p: Pt, tol: number): { p: Pt; kind: 'point' | 'line' } | null {
  const c0x = Math.floor((p.x - tol) / CELL), c1x = Math.floor((p.x + tol) / CELL);
  const c0y = Math.floor((p.y - tol) / CELL), c1y = Math.floor((p.y + tol) / CELL);
  let best: Pt | null = null, bestD = tol;
  for (let cx = c0x; cx <= c1x; cx++) {
    for (let cy = c0y; cy <= c1y; cy++) {
      for (const i of g.pointGrid.get(key(cx, cy)) ?? []) {
        const d = Math.hypot(g.points[i] - p.x, g.points[i + 1] - p.y);
        if (d < bestD) { bestD = d; best = { x: g.points[i], y: g.points[i + 1] }; }
      }
    }
  }
  if (best) return { p: best, kind: 'point' };
  bestD = tol * 0.6;
  for (let cx = c0x; cx <= c1x; cx++) {
    for (let cy = c0y; cy <= c1y; cy++) {
      for (const i of g.segGrid.get(key(cx, cy)) ?? []) {
        const ax = g.segments[i], ay = g.segments[i + 1], bx = g.segments[i + 2], by = g.segments[i + 3];
        const l2 = (bx - ax) ** 2 + (by - ay) ** 2;
        if (!l2) continue;
        const t = Math.max(0, Math.min(1, ((p.x - ax) * (bx - ax) + (p.y - ay) * (by - ay)) / l2));
        const q = { x: ax + t * (bx - ax), y: ay + t * (by - ay) };
        const d = Math.hypot(q.x - p.x, q.y - p.y);
        if (d < bestD) { bestD = d; best = q; }
      }
    }
  }
  return best ? { p: best, kind: 'line' } : null;
}
