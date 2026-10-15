// Crop Image (Revu Markup > Image > Crop Image): the part of an image
// markup to keep, as a box and the matching source pixel rectangle.
import type { Pt } from './types';
import { bounds } from './measure';

export interface Crop { box: [Pt, Pt]; sx: number; sy: number; sw: number; sh: number }

/** The crop of an image markup with corners `points` and a `w` × `h` pixel picture, from a dragged `a`–`b` area (page space). */
export function cropRect(points: Pt[], w: number, h: number, a: Pt, b: Pt): Crop | null {
  const m = bounds(points);
  const x0 = Math.max(m.minX, Math.min(a.x, b.x)), x1 = Math.min(m.maxX, Math.max(a.x, b.x));
  const y0 = Math.max(m.minY, Math.min(a.y, b.y)), y1 = Math.min(m.maxY, Math.max(a.y, b.y));
  if (x1 - x0 < 1 || y1 - y0 < 1 || m.w <= 0 || m.h <= 0) return null;
  const kx = w / m.w, ky = h / m.h;
  return {
    box: [{ x: x0, y: y0 }, { x: x1, y: y1 }],
    sx: Math.round((x0 - m.minX) * kx), sy: Math.round((y0 - m.minY) * ky),
    sw: Math.max(1, Math.round((x1 - x0) * kx)), sh: Math.max(1, Math.round((y1 - y0) * ky)),
  };
}
