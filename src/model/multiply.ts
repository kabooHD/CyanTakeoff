// Multiply (Revu: right-click a markup > Multiply): parallel copies of the
// selected markups in one of the four directions, a set distance apart. The
// number of copies is capped by what fits on the sheet.
import type { Markup } from './types';
import { bounds } from './measure';
import { translated } from './markup';

export type Direction = 'up' | 'down' | 'left' | 'right';

/** Offsets (page points, y down) of copy 1..n in `dir`, `dist` apart. */
export function multiplyOffsets(dir: Direction, dist: number, n: number): { dx: number; dy: number }[] {
  const [ux, uy] = dir === 'up' ? [0, -1] : dir === 'down' ? [0, 1] : dir === 'left' ? [-1, 0] : [1, 0];
  return Array.from({ length: Math.max(0, Math.floor(n)) }, (_, i) => ({ dx: ux * dist * (i + 1), dy: uy * dist * (i + 1) }));
}

/** Copies of `markups` that still lie on a page of `w` × `h` points (the rest are dropped, as in Revu). */
export function multiplyMarkups(markups: Markup[], dir: Direction, dist: number, n: number, w: number, h: number, now: string, id: () => string = () => crypto.randomUUID()): Markup[] {
  const out: Markup[] = [];
  for (const { dx, dy } of multiplyOffsets(dir, dist, n)) {
    const batch = markups.map((m): Markup => ({ ...m, id: id(), created: now, modified: now, source: undefined, groupId: undefined, ...translated(m, dx, dy) }));
    const fits = batch.every((m) => { const b = bounds(m.points); return b.minX >= 0 && b.minY >= 0 && b.maxX <= w && b.maxY <= h; });
    if (!fits) break;
    out.push(...batch);
  }
  return out;
}
