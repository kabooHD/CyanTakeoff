import type { Markup, Pt } from './types';

const shift = (pts: Pt[], dx: number, dy: number) => pts.map((p) => ({ x: p.x + dx, y: p.y + dy }));

/** Geometry of a markup moved by (dx, dy), cutouts included. */
export function translated(m: Markup, dx: number, dy: number): Pick<Markup, 'points' | 'cutouts'> {
  return {
    points: shift(m.points, dx, dy),
    cutouts: m.cutouts?.map((c) => ({ ...c, points: shift(c.points, dx, dy) })),
  };
}
