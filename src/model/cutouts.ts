// Adding a cutout to an Area or Volume measurement, with Revu's rules:
// overlapping polygon cutouts fuse into one; a polygon cutout that crosses
// the markup's edge trims the markup instead of becoming a cutout; curved
// (ellipse) cutouts may not overlap other cutouts or the edge.
import polygonClipping, { type Polygon, type Ring } from 'polygon-clipping';
import { polygonArea } from './measure';
import { flattenPath, hasCurves } from './curves';
import type { Cutout, Markup, Pt } from './types';

const ring = (pts: Pt[]): Ring => pts.map((p) => [p.x, p.y] as [number, number]);
/** polygon-clipping rings repeat the first point at the end. */
const fromRing = (r: Ring): Pt[] => {
  const pts = r.map(([x, y]) => ({ x, y }));
  const [a, b] = [pts[0], pts[pts.length - 1]];
  return a && b && a.x === b.x && a.y === b.y ? pts.slice(0, -1) : pts;
};

export function ellipsePolygon(a: Pt, b: Pt, n = 128): Pt[] {
  const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2, rx = Math.abs(b.x - a.x) / 2, ry = Math.abs(b.y - a.y) / 2;
  return Array.from({ length: n }, (_, i) => ({ x: cx + rx * Math.cos((2 * Math.PI * i) / n), y: cy + ry * Math.sin((2 * Math.PI * i) / n) }));
}

const cutoutPolygon = (c: Cutout): Polygon => [ring(c.kind === 'ellipse' ? ellipsePolygon(c.points[0], c.points[1]) : hasCurves(c.handles) ? flattenPath(c.points, c.handles, true) : c.points)];
const multiArea = (mp: Polygon[]) => mp.reduce((t, p) => t + polygonArea(fromRing(p[0])) - p.slice(1).reduce((h, r) => h + polygonArea(fromRing(r)), 0), 0);
const overlap = (a: Polygon, b: Polygon) => multiArea(polygonClipping.intersection(a, b));

export type CutoutResult = { points: Pt[]; cutouts: Cutout[] } | { error: string };

export function applyCutout(m: Pick<Markup, 'points' | 'cutouts'>, c: Cutout): CutoutResult {
  const shape: Polygon = [ring(m.points)];
  const cp = cutoutPolygon(c);
  const cArea = multiArea([cp]);
  if (cArea <= 0) return { error: 'The cutout has no area.' };
  const eps = Math.max(1e-6, cArea * 1e-6);
  const existing = m.cutouts ?? [];
  const inside = Math.abs(overlap(shape, cp) - cArea) <= eps;

  if (c.kind === 'ellipse') {
    if (!inside || existing.some((e) => overlap(cutoutPolygon(e), cp) > eps)) {
      return { error: 'Curved cutouts cannot overlap other cutouts or the edge of the markup.' };
    }
    return { points: m.points, cutouts: [...existing, c] };
  }

  if (!inside) {
    // Crossing the edge: remove that part from the markup itself.
    const pieces = polygonClipping.difference(shape, cp);
    if (!pieces.length) return { error: 'The cutout covers the whole markup.' };
    const biggest = pieces.reduce((a, b) => (multiArea([b]) > multiArea([a]) ? b : a));
    let points = fromRing(biggest[0]);
    let cutouts: Cutout[] = [];
    const partial: Cutout[] = [];
    for (const e of existing) {
      const ep = cutoutPolygon(e);
      const o = overlap([ring(points)], ep);
      if (o <= eps) continue; // now outside the markup
      if (Math.abs(o - multiArea([ep])) <= eps || e.kind === 'ellipse') cutouts.push(e);
      else partial.push(e);
    }
    // Polygon cutouts now crossing the edge trim the markup too.
    for (const e of partial) {
      const r = applyCutout({ points, cutouts }, e);
      if ('points' in r) ({ points, cutouts } = r);
    }
    return { points, cutouts };
  }

  // Inside: fuse with any polygon cutouts it overlaps.
  const touching = existing.filter((e) => e.kind === 'polygon' && overlap(cutoutPolygon(e), cp) > eps);
  if (existing.some((e) => e.kind === 'ellipse' && overlap(cutoutPolygon(e), cp) > eps)) {
    return { error: 'Curved cutouts cannot overlap other cutouts or the edge of the markup.' };
  }
  if (!touching.length) return { points: m.points, cutouts: [...existing, c] };
  const fused = polygonClipping.union(cp, ...touching.map(cutoutPolygon));
  const outer = fused.reduce((a, b) => (multiArea([b]) > multiArea([a]) ? b : a));
  return {
    points: m.points,
    cutouts: [...existing.filter((e) => !touching.includes(e)), { kind: 'polygon', points: fromRing(outer[0]) }],
  };
}
