import { bounds, distToSegment, pointInPolygon, rectCorners } from '../model/measure';
import type { Markup, Pt } from '../model/types';

/** Outline used for hit-testing and rubber-band selection. */
export function outline(m: Markup): { pts: Pt[]; closed: boolean } {
  const P = m.points;
  switch (m.type) {
    case 'rectangle': case 'ellipse': case 'highlight': case 'textbox':
      return { pts: P.length > 1 ? rectCorners(P[0], P[1]) : P, closed: true };
    case 'callout':
      return { pts: P.length > 2 ? rectCorners(P[1], P[2]) : P, closed: true };
    case 'note':
      return { pts: rectCorners(P[0], { x: P[0].x + 18, y: P[0].y + 18 }), closed: true };
    case 'polygon': case 'area': case 'perimeter': case 'volume': case 'cloud':
      return { pts: P, closed: true };
    default:
      return { pts: P, closed: false };
  }
}

export function hitTest(m: Markup, p: Pt, tol: number): boolean {
  const { pts, closed } = outline(m);
  const t = tol + m.style.width / 2;
  if (m.type === 'count') return pts.some((q) => Math.hypot(q.x - p.x, q.y - p.y) <= 5 + t);
  if (m.type === 'callout' && distToSegment(p, m.points[0], m.points[1]) <= t) return true;
  if (closed && pointInPolygon(p, pts)) return true;
  for (let i = 1; i < pts.length; i++) if (distToSegment(p, pts[i - 1], pts[i]) <= t) return true;
  if (closed && pts.length > 2 && distToSegment(p, pts[pts.length - 1], pts[0]) <= t) return true;
  return pts.length === 1 && Math.hypot(pts[0].x - p.x, pts[0].y - p.y) <= t;
}

export function markupBounds(m: Markup) {
  return bounds(outline(m).pts);
}
