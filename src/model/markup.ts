import type { Markup, Pt } from './types';

const shift = (pts: Pt[], dx: number, dy: number) => pts.map((p) => ({ x: p.x + dx, y: p.y + dy }));

/** Geometry of a markup moved by (dx, dy), cutouts included. */
export function translated(m: Markup, dx: number, dy: number): Pick<Markup, 'points' | 'cutouts'> {
  return {
    points: shift(m.points, dx, dy),
    cutouts: m.cutouts?.map((c) => ({ ...c, points: shift(c.points, dx, dy) })),
  };
}

/**
 * Erase the part of a pen stroke within `r` of `p`: returns the remaining
 * pieces (none if the whole stroke was erased, one if untouched).
 */
export function eraseStroke(points: Pt[], p: Pt, r: number): Pt[][] {
  const pieces: Pt[][] = [];
  let cur: Pt[] = [];
  for (const q of points) {
    if (Math.hypot(q.x - p.x, q.y - p.y) <= r) {
      if (cur.length > 1) pieces.push(cur);
      cur = [];
    } else cur.push(q);
  }
  if (cur.length > 1) pieces.push(cur);
  return pieces;
}

/** Auto-size for a typewriter markup's text: [top-left, bottom-right]. */
export function typewriterBox(at: Pt, text: string, fontSize: number): [Pt, Pt] {
  const lines = (text || ' ').split('\n');
  const w = Math.max(20, Math.max(...lines.map((l) => l.length)) * fontSize * 0.56 + 8);
  return [at, { x: at.x + w, y: at.y + lines.length * fontSize * 1.2 + 6 }];
}
