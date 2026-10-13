// Spaces: nesting by containment and finding the Space a markup is in.
import { centroid, pointInPolygon, polygonArea } from './measure';
import { CLOSED_TYPES } from '../tools/tools';
import type { Markup, Pt, Space } from './types';

const inside = (inner: Space, outer: Space) => inner !== outer && polygonArea(inner.points) < polygonArea(outer.points)
  && inner.points.every((p) => pointInPolygon(p, outer.points));

/** The parent of each Space: the smallest Space containing it (null at top level). */
export function parentsOf(spaces: Space[]): Map<string, Space | null> {
  const out = new Map<string, Space | null>();
  for (const s of spaces) {
    const containers = spaces.filter((o) => inside(s, o)).sort((a, b) => polygonArea(a.points) - polygonArea(b.points));
    out.set(s.id, containers[0] ?? null);
  }
  return out;
}

export interface SpaceNode { space: Space; kids: SpaceNode[] }

/** Spaces as a tree (Revu nests contained Spaces automatically). */
export function spaceTree(spaces: Space[]): SpaceNode[] {
  const parents = parentsOf(spaces);
  const node = (s: Space): SpaceNode => ({ space: s, kids: spaces.filter((k) => parents.get(k.id) === s).map(node) });
  return spaces.filter((s) => !parents.get(s.id)).map(node);
}

/** Point used to place a markup in a Space. */
export function anchorOf(m: Markup): Pt {
  return CLOSED_TYPES.has(m.type) && m.points.length > 2 ? centroid(m.points) : m.points[0];
}

/** Innermost Space containing `p`, if any. */
export function spaceAt(spaces: Space[] | undefined, p: Pt | undefined): Space | undefined {
  if (!spaces?.length || !p) return undefined;
  return spaces.filter((s) => pointInPolygon(p, s.points)).sort((a, b) => polygonArea(a.points) - polygonArea(b.points))[0];
}

/** Would adding/moving `s` partly overlap another Space? (Revu forbids it.) */
export function overlapsPartly(spaces: Space[], s: Space): boolean {
  return spaces.some((o) => {
    if (o.id === s.id) return false;
    const a = s.points.filter((p) => pointInPolygon(p, o.points)).length;
    const b = o.points.filter((p) => pointInPolygon(p, s.points)).length;
    const sInO = a === s.points.length, oInS = b === o.points.length;
    return !sInO && !oInS && (a > 0 || b > 0);
  });
}
