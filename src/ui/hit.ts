import { arcPoints, arcThrough, bounds, distToSegment, pointInPolygon, rectCorners, rectPairs } from '../model/measure';
import type { Markup, Pt } from '../model/types';
import { CURVABLE, flatPoints, flattenPath, hasCurves } from '../model/curves';

/** Outline used for hit-testing and rubber-band selection. */
export function outline(m: Markup): { pts: Pt[]; closed: boolean } {
  const P = m.points;
  switch (m.type) {
    case 'highlight': case 'strikeout': case 'underline': case 'squiggly': case 'redaction':
      if (P.length > 2 || m.type !== 'highlight') {
        const b = bounds(P);
        return { pts: rectCorners({ x: b.minX, y: b.minY }, { x: b.maxX, y: b.maxY }), closed: true };
      }
      return { pts: P.length > 1 ? rectCorners(P[0], P[1]) : P, closed: true };
    case 'stamp': case 'image': case 'link': case 'typewriter': case 'legend': case 'caret':
      return { pts: P.length > 1 ? rectCorners(P[0], P[1]) : P, closed: true };
    case 'cloudplus': {
      const all = P.length >= 4 ? [...rectCorners(P[0], P[1]), ...rectCorners(P[2], P[3])] : P;
      const b = bounds(all);
      return { pts: rectCorners({ x: b.minX, y: b.minY }, { x: b.maxX, y: b.maxY }), closed: true };
    }
    case 'arc':
      return { pts: P.length > 2 ? arcThrough(P[0], P[1], P[2]) : P, closed: false };
    case 'flag': case 'attachment':
      return { pts: rectCorners(P[0], { x: P[0].x + 18, y: P[0].y + 20 }), closed: true };
    case 'rectangle': case 'ellipse': case 'textbox':
      return { pts: P.length > 1 ? rectCorners(P[0], P[1]) : P, closed: true };
    case 'callout':
      return { pts: P.length > 2 ? rectCorners(P[1], P[2]) : P, closed: true };
    case 'radius': case 'diameter': {
      if (P.length < 2) return { pts: P, closed: false };
      if (m.type === 'radius' && P.length > 2) return { pts: [P[0], ...arcPoints(P[0], P[1], P[2], -1)], closed: false };
      const r = Math.hypot(P[1].x - P[0].x, P[1].y - P[0].y) / (m.type === 'radius' ? 1 : 2);
      const c = m.type === 'radius' ? P[0] : { x: (P[0].x + P[1].x) / 2, y: (P[0].y + P[1].y) / 2 };
      const ring = Array.from({ length: 32 }, (_, i) => ({ x: c.x + r * Math.cos((i / 32) * 2 * Math.PI), y: c.y + r * Math.sin((i / 32) * 2 * Math.PI) }));
      return { pts: ring, closed: true };
    }
    case 'note':
      return { pts: rectCorners(P[0], { x: P[0].x + 18, y: P[0].y + 18 }), closed: true };
    case 'polygon': case 'area': case 'volume': case 'cloud':
      return { pts: flatPoints(m), closed: true };
    default:
      return { pts: CURVABLE.has(m.type) ? flatPoints(m) : P, closed: false };
  }
}

/** Index of the cutout of `m` containing `p`, or -1. */
export function cutoutAt(m: Markup, p: Pt): number {
  return (m.cutouts ?? []).findIndex((c) => {
    if (c.kind === 'polygon') return pointInPolygon(p, hasCurves(c.handles) ? flattenPath(c.points, c.handles, true) : c.points);
    const [a, b] = c.points;
    const rx = Math.abs(b.x - a.x) / 2, ry = Math.abs(b.y - a.y) / 2;
    if (!rx || !ry) return false;
    const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    return ((p.x - cx) / rx) ** 2 + ((p.y - cy) / ry) ** 2 <= 1;
  });
}

const inCutout = (m: Markup, p: Pt) => cutoutAt(m, p) >= 0;

export function hitTest(m: Markup, p: Pt, tol: number): boolean {
  const { pts, closed } = outline(m);
  const t = tol + m.style.width / 2;
  if ((m.type === 'strikeout' || m.type === 'underline' || m.type === 'squiggly' || m.type === 'redaction' || (m.type === 'highlight' && m.points.length > 2))) {
    return rectPairs(m.points).some(([a, b]) => { const r = bounds([a, b]); return p.x >= r.minX - tol && p.x <= r.maxX + tol && p.y >= r.minY - tol && p.y <= r.maxY + tol; });
  }
  if (m.type === 'count') return pts.some((q) => Math.hypot(q.x - p.x, q.y - p.y) <= 5 + t);
  if (m.type === 'callout' && distToSegment(p, m.points[0], m.points[1]) <= t) return true;
  if (closed && pointInPolygon(p, pts) && !inCutout(m, p)) return true;
  for (let i = 1; i < pts.length; i++) if (distToSegment(p, pts[i - 1], pts[i]) <= t) return true;
  if (closed && pts.length > 2 && distToSegment(p, pts[pts.length - 1], pts[0]) <= t) return true;
  return pts.length === 1 && Math.hypot(pts[0].x - p.x, pts[0].y - p.y) <= t;
}

export function markupBounds(m: Markup) {
  return bounds(outline(m).pts);
}
