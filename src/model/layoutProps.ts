// Properties > Layout (Revu): a markup's X, Y, Width and Height in inches
// from the page's lower left, and the points that give it new values.
import type { Markup, Pt } from './types';
import { bounds } from './measure';
import { mapped } from './markup';

export interface Layout { x: number; y: number; width: number; height: number }
const r2 = (v: number) => Math.round(v * 100) / 100;

export function layoutOf(points: Pt[], pageH: number): Layout {
  const b = bounds(points);
  return { x: r2(b.minX / 72), y: r2((pageH - b.maxY) / 72), width: r2(b.w / 72), height: r2(b.h / 72) };
}

/** The markup moved / resized so its layout matches `patch` (inches); a size of 0 keeps the current one. */
export function withLayout(m: Markup, pageH: number, patch: Partial<Layout>): Pick<Markup, 'points' | 'cutouts' | 'handles'> {
  const b = bounds(m.points);
  const cur = layoutOf(m.points, pageH);
  const x = (patch.x ?? cur.x) * 72, w = patch.width && patch.width > 0 ? patch.width * 72 : b.w, h = patch.height && patch.height > 0 ? patch.height * 72 : b.h;
  const yTop = pageH - (patch.y ?? cur.y) * 72 - h; // the lower-left Y in inches, as a top edge in page space
  const kx = b.w > 1e-9 ? w / b.w : 1, ky = b.h > 1e-9 ? h / b.h : 1;
  return mapped(m, (p) => ({ x: x + (p.x - b.minX) * kx, y: yTop + (p.y - b.minY) * ky }));
}
