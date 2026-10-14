// Markups List position and size columns (Revu): X and Y from the lower
// left of the page, the centre, the size on the sheet (inches) and the
// real-world size at the markup's scale.
import type { Pt, Scale } from './types';
import { bounds } from './measure';

export interface PlaceCols { x: number; y: number; xCenter: number; yCenter: number; docWidth: number; docHeight: number; width?: number; height?: number }

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Columns for a markup with `points` (page space, y down) on a page `pageH` points high; sizes in inches, real sizes in `scale` units. */
export function placeColumns(points: Pt[], pageH: number, scale?: Scale | null): PlaceCols {
  const b = bounds(points);
  const out: PlaceCols = {
    x: r2(b.minX / 72), y: r2((pageH - b.maxY) / 72),
    xCenter: r2((b.minX + b.w / 2) / 72), yCenter: r2((pageH - b.minY - b.h / 2) / 72),
    docWidth: r2(b.w / 72), docHeight: r2(b.h / 72),
  };
  if (scale) { out.width = r2(b.w * scale.factor); out.height = r2(b.h * (scale.yFactor ?? scale.factor)); }
  return out;
}
