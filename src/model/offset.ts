// Offset (Revu, select a markup and press O): a parallel copy of a markup at
// a distance, on the side the user picks, optionally as another markup type
// and optionally replacing the original. Corners sharper than the miter
// limit are bevelled.
import type { Markup, MarkupType, Pt } from './types';
import { bounds } from './measure';

export const OPEN_TYPES: MarkupType[] = ['line', 'length', 'polyline', 'polylength', 'arrow'];
export const CLOSED_TYPES: MarkupType[] = ['polygon', 'area', 'cloud', 'perimeter'];
export const OFFSET_AS: MarkupType[] = ['polyline', 'polylength', 'polygon', 'area', 'perimeter', 'cloud', 'line', 'length'];

const closedType = (t: MarkupType) => CLOSED_TYPES.includes(t);

/**
 * Offset a path by `d` (positive: to the right of the direction of travel in
 * y-down page space). At corners the miter point is used while its length is
 * at most `miter` times `d`; sharper corners get two points (a bevel).
 */
export function offsetPoints(pts: Pt[], closed: boolean, d: number, miter = 4): Pt[] {
  if (!d || pts.length < 2) return pts.map((p) => ({ ...p }));
  const n = pts.length;
  const normal = (a: Pt, b: Pt) => { const l = Math.hypot(b.x - a.x, b.y - a.y) || 1; return { x: -(b.y - a.y) / l, y: (b.x - a.x) / l }; };
  const out: Pt[] = [];
  pts.forEach((p, i) => {
    const prev = i > 0 ? pts[i - 1] : closed ? pts[n - 1] : null;
    const next = i < n - 1 ? pts[i + 1] : closed ? pts[0] : null;
    const n1 = prev ? normal(prev, p) : null, n2 = next ? normal(p, next) : null;
    if (!n1 || !n2) { const q = (n1 ?? n2)!; out.push({ x: p.x + q.x * d, y: p.y + q.y * d }); return; }
    const bx = n1.x + n2.x, by = n1.y + n2.y, bl = Math.hypot(bx, by);
    const k = bl < 1e-9 ? Infinity : 2 / bl; // 1 / cos(half the turn)
    if (k <= miter) out.push({ x: p.x + (bx / bl) * d * k, y: p.y + (by / bl) * d * k });
    else out.push({ x: p.x + n1.x * d, y: p.y + n1.y * d }, { x: p.x + n2.x * d, y: p.y + n2.y * d });
  });
  return out;
}

const area = (pts: Pt[]) => Math.abs(pts.reduce((a, p, i) => { const q = pts[(i + 1) % pts.length]; return a + p.x * q.y - q.x * p.y; }, 0)) / 2;

function nearestSegment(pts: Pt[], closed: boolean, c: Pt): [Pt, Pt] {
  let best: [Pt, Pt] = [pts[0], pts[1]], bd = Infinity;
  const segs = pts.length - (closed ? 0 : 1);
  for (let i = 0; i < segs; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((c.x - a.x) * dx + (c.y - a.y) * dy) / l2));
    const dd = Math.hypot(a.x + t * dx - c.x, a.y + t * dy - c.y);
    if (dd < bd) { bd = dd; best = [a, b]; }
  }
  return best;
}

const inside = (pts: Pt[], p: Pt) => {
  let r = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) r = !r;
  }
  return r;
};

/** The markup's outline as a path: points and whether it is closed (rectangles and ellipses as boxes). */
function pathOf(m: Markup): { pts: Pt[]; closed: boolean } | null {
  if (m.type === 'rectangle' || m.type === 'ellipse') {
    const b = bounds(m.points);
    return { pts: [{ x: b.minX, y: b.minY }, { x: b.maxX, y: b.minY }, { x: b.maxX, y: b.maxY }, { x: b.minX, y: b.maxY }], closed: true };
  }
  if (OPEN_TYPES.includes(m.type)) return { pts: m.points, closed: false };
  if (m.type === 'perimeter') return { pts: m.points.slice(0, -1), closed: true };
  if (CLOSED_TYPES.includes(m.type)) return { pts: m.points, closed: true };
  return null;
}

export const canOffset = (m: Markup) => pathOf(m) !== null && !m.handles?.some(Boolean);

/**
 * Points of the offset copy of `m`, `dist` page points away on the side of
 * `toward`, as markup type `as` (default: the same type). Null when the
 * markup or the conversion is not supported.
 */
export function offsetMarkup(m: Markup, dist: number, toward: Pt, miter = 4, as?: MarkupType): { type: MarkupType; points: Pt[] } | null {
  const path = pathOf(m);
  if (!path || path.pts.length < 2) return null;
  const type = as ?? m.type;
  if (m.type === 'rectangle' || m.type === 'ellipse') {
    if (type === m.type) {
      // Boxes grow or shrink by the distance on every side.
      const b = bounds(m.points), d = inside(path.pts, toward) ? -dist : dist;
      if (b.w + 2 * d <= 0 || b.h + 2 * d <= 0) return null;
      return { type, points: [{ x: b.minX - d, y: b.minY - d }, { x: b.maxX + d, y: b.maxY + d }] };
    }
  }
  let d: number;
  if (path.closed) {
    const grow = offsetPoints(path.pts, true, dist, miter);
    const outward = area(grow) > area(path.pts) ? 1 : -1;
    d = inside(path.pts, toward) ? -outward * dist : outward * dist;
  } else {
    const [a, b] = nearestSegment(path.pts, false, toward);
    const cross = (b.x - a.x) * (toward.y - a.y) - (b.y - a.y) * (toward.x - a.x);
    d = cross >= 0 ? dist : -dist;
  }
  let pts = offsetPoints(path.pts, path.closed, d, miter);
  const toClosed = closedType(type) || type === 'rectangle' || type === 'ellipse';
  if (type === 'line' || type === 'length' || type === 'arrow') { if (pts.length !== 2) return null; }
  else if (type === 'rectangle' || type === 'ellipse') { const bb = bounds(pts); pts = [{ x: bb.minX, y: bb.minY }, { x: bb.maxX, y: bb.maxY }]; }
  else if (!toClosed && path.closed) pts = [...pts, pts[0]]; // a closed outline as an open line goes all the way round
  else if (toClosed && pts.length < 3) return null;
  if (type === 'perimeter') pts = [...pts, pts[0]];
  return { type, points: pts };
}
