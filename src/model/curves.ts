// Curved segments (Revu: Working with Curved Markups). A multi-segment
// markup's vertex may carry Bézier handlebars: `in` and `out` offsets from
// the vertex. The segment from vertex i to the next is a cubic Bézier with
// control points P[i] + out[i] and P[i+1] + in[i+1]; with no handles on
// either side it is a straight line.
import type { Markup, Pt } from './types';

export interface Handle { in: Pt; out: Pt }
export type Handles = (Handle | null)[];

/** Markup types whose segments can be curved. */
export const CURVABLE = new Set(['polyline', 'polygon', 'polylength', 'perimeter', 'area', 'volume']);
/** Closed shapes have a segment from the last vertex back to the first. */
export const closedType = (t: string) => t === 'polygon' || t === 'area' || t === 'volume';

export const hasCurves = (h: Handles | undefined) => !!h?.some(Boolean);

const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });

/** The segments of the path: [from, c1, c2, to], c1/c2 null for straight segments. */
export function segments(P: Pt[], h: Handles | undefined, closed: boolean): [Pt, Pt | null, Pt | null, Pt][] {
  const out: [Pt, Pt | null, Pt | null, Pt][] = [];
  const n = P.length;
  const count = closed && n > 2 ? n : n - 1;
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % n;
    const nz = (v: Pt | undefined) => (v && (v.x || v.y) ? v : undefined);
    const a = nz(h?.[i]?.out), b = nz(h?.[j]?.in);
    out.push(a || b ? [P[i], add(P[i], a ?? { x: 0, y: 0 }), add(P[j], b ?? { x: 0, y: 0 }), P[j]] : [P[i], null, null, P[j]]);
  }
  return out;
}

export function bezierAt(p0: Pt, c1: Pt, c2: Pt, p1: Pt, t: number): Pt {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p1.x,
    y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p1.y,
  };
}

/**
 * Vertices of the path with curves replaced by `steps` chords each (for
 * measuring, hit-testing and readers without curve support). Without curves
 * the points come back unchanged.
 */
export function flattenPath(P: Pt[], h: Handles | undefined, closed: boolean, steps = 64): Pt[] {
  if (!hasCurves(h) || P.length < 2) return P;
  const out: Pt[] = [P[0]];
  const segs = segments(P, h, closed);
  segs.forEach(([a, c1, c2, b], k) => {
    const last = closed && k === segs.length - 1; // back at the start: don't repeat it
    if (!c1 || !c2) { if (!last) out.push(b); return; }
    for (let s = 1; s <= steps; s++) if (!(last && s === steps)) out.push(bezierAt(a, c1, c2, b, s / steps));
  });
  return out;
}

/** The markup's outline with curves flattened. */
export const flatPoints = (m: Pick<Markup, 'type' | 'points' | 'handles'>): Pt[] => flattenPath(m.points, m.handles, closedType(m.type));

/** SVG path data with real curves. */
export function svgPath(P: Pt[], h: Handles | undefined, closed: boolean): string {
  if (!P.length) return '';
  let d = `M${P[0].x} ${P[0].y}`;
  for (const [, c1, c2, b] of segments(P, h, closed)) d += c1 && c2 ? `C${c1.x} ${c1.y} ${c2.x} ${c2.y} ${b.x} ${b.y}` : `L${b.x} ${b.y}`;
  return closed ? `${d}Z` : d;
}

/** Revu's Ctrl+click on a control point: straight ↔ curve. A new curve is smooth, along the neighbours. */
export function toggleCurve(P: Pt[], h: Handles | undefined, i: number, closed: boolean): Handles {
  const H: Handles = P.map((_, k) => h?.[k] ?? null);
  if (H[i]) { H[i] = null; return H; }
  const n = P.length;
  const prev = i > 0 ? P[i - 1] : closed ? P[n - 1] : P[i];
  const next = i < n - 1 ? P[i + 1] : closed ? P[0] : P[i];
  const dx = next.x - prev.x, dy = next.y - prev.y, len = Math.hypot(dx, dy) || 1;
  const toNext = Math.hypot(next.x - P[i].x, next.y - P[i].y) / 3;
  const toPrev = Math.hypot(P[i].x - prev.x, P[i].y - prev.y) / 3;
  H[i] = { out: { x: (dx / len) * toNext, y: (dy / len) * toNext }, in: { x: (-dx / len) * toPrev, y: (-dy / len) * toPrev } };
  return H;
}

/** Revu's "Convert to Arc" on segment i: handles making the segment a circular-looking arc bulging to its left. */
export function arcSegment(P: Pt[], h: Handles | undefined, i: number, closed: boolean, bulge = 0.5): Handles {
  const H: Handles = P.map((_, k) => h?.[k] ?? null);
  const j = (i + 1) % P.length;
  const a = P[i], b = P[j];
  const dx = b.x - a.x, dy = b.y - a.y;
  // A quarter-circle-ish bulge: controls offset perpendicular by `bulge` × chord × 4/3 / 2.
  const k = (bulge * 4) / 3 / 2;
  const nx = -dy * k, ny = dx * k;
  H[i] = { in: H[i]?.in ?? { x: 0, y: 0 }, out: { x: dx / 4 + nx, y: dy / 4 + ny } };
  H[j] = { out: H[j]?.out ?? { x: 0, y: 0 }, in: { x: -dx / 4 + nx, y: -dy / 4 + ny } };
  void closed;
  return H;
}

/** Handles for a point inserted at index `at` (no curve there), keeping the others. */
export const insertHandle = (h: Handles | undefined, n: number, at: number): Handles | undefined => {
  if (!hasCurves(h)) return h;
  const H = Array.from({ length: n }, (_, k) => h?.[k] ?? null);
  H.splice(at, 0, null);
  return H;
};

export const removeHandle = (h: Handles | undefined, at: number): Handles | undefined => {
  if (!hasCurves(h)) return h;
  const H = [...(h ?? [])];
  H.splice(at, 1);
  return hasCurves(H) ? H : undefined;
};

/** PDF 2.0 /Path operands (12.5.6.9): [x y] for moveto/lineto, [x1 y1 x2 y2 x3 y3] for curveto. */
export function pdfPath(P: Pt[], h: Handles | undefined, closed: boolean, map: (p: Pt) => [number, number]): number[][] {
  if (!P.length) return [];
  const out: number[][] = [map(P[0])];
  for (const [, c1, c2, b] of segments(P, h, closed)) out.push(c1 && c2 ? [...map(c1), ...map(c2), ...map(b)] : map(b));
  return out;
}

/** Read a PDF /Path back into vertices and handles (inverse of pdfPath). */
export function fromPdfPath(path: number[][], map: (x: number, y: number) => Pt, closed: boolean): { points: Pt[]; handles?: Handles } {
  const points: Pt[] = [];
  const handles: Handles = [];
  for (const op of path) {
    if (op.length === 2) { points.push(map(op[0], op[1])); handles.push(null); continue; }
    if (op.length !== 6 || !points.length) continue;
    const prev = points[points.length - 1];
    const c1 = map(op[0], op[1]), c2 = map(op[2], op[3]), b = map(op[4], op[5]);
    const hp = handles[handles.length - 1] ?? { in: { x: 0, y: 0 }, out: { x: 0, y: 0 } };
    handles[handles.length - 1] = { ...hp, out: { x: c1.x - prev.x, y: c1.y - prev.y } };
    points.push(b);
    handles.push({ in: { x: c2.x - b.x, y: c2.y - b.y }, out: { x: 0, y: 0 } });
  }
  // A closed path's last curve ends on the first vertex: fold it back.
  if (closed && points.length > 2) {
    const f = points[0], l = points[points.length - 1];
    if (Math.abs(f.x - l.x) < 1e-6 && Math.abs(f.y - l.y) < 1e-6) {
      const lh = handles.pop()!;
      points.pop();
      handles[0] = { in: lh?.in ?? { x: 0, y: 0 }, out: handles[0]?.out ?? { x: 0, y: 0 } };
    }
  }
  const norm = handles.map((x) => (x && (x.in.x || x.in.y || x.out.x || x.out.y) ? x : null));
  return { points, handles: hasCurves(norm) ? norm : undefined };
}
