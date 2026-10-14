// Sketch to Scale (Revu's Sketch toolbar): markups drawn by typing sizes in
// the page's scale units instead of dragging. Angles are degrees
// counter-clockwise from the page's x axis (page space is y-down, so a
// positive angle goes up the sheet).
import type { Pt, Scale, ToolId } from './types';

export type SketchKind = 'polygon' | 'polyline' | 'rectangle' | 'ellipse';
export const SKETCH_TOOLS: Partial<Record<ToolId, SketchKind>> = {
  'sketch-polygon': 'polygon', 'sketch-polyline': 'polyline', 'sketch-rectangle': 'rectangle', 'sketch-ellipse': 'ellipse',
};

/** A typed length: a number in the scale's unit, or feet and inches (12'6", 12' 6, 12-6) when the unit is feet. */
export function parseLengthInput(text: string, unit: Scale['unit'] | null): number | null {
  const t = text.trim().replace(/[”″]/g, '"').replace(/[’′]/g, "'");
  if (!t) return null;
  const feet = unit === 'ft' || unit === 'ft-in';
  const fi = feet ? /^(-?\d+(?:\.\d+)?)\s*'\s*(?:(\d+(?:\.\d+)?)\s*(?:(\d+)\/(\d+))?\s*"?)?$/.exec(t) ?? /^(-?\d+)\s*-\s*(\d+(?:\.\d+)?)$/.exec(t) : null;
  if (fi) {
    const ft = Number(fi[1]), inch = Number(fi[2] ?? 0) + (fi[3] && fi[4] ? Number(fi[3]) / Number(fi[4]) : 0);
    return ft + Math.sign(ft || 1) * inch / 12;
  }
  const n = Number(t.replace(/"$/, ''));
  return Number.isFinite(n) ? n : null;
}

/** A length in scale units (inches without a scale) as page points. */
export const sketchPt = (v: number, scale: Scale | null, vertical = false) => (scale ? v / (vertical && scale.yFactor ? scale.yFactor : scale.factor) : v * 72);

/** The point `len` points from `from` at `angle` degrees. */
export function nextPoint(from: Pt, len: number, angle: number): Pt {
  const a = (angle * Math.PI) / 180;
  return { x: from.x + len * Math.cos(a), y: from.y - len * Math.sin(a) };
}

const rotateAbout = (p: Pt, c: Pt, angle: number): Pt => {
  const a = (angle * Math.PI) / 180, dx = p.x - c.x, dy = p.y - c.y;
  return { x: c.x + dx * Math.cos(a) + dy * Math.sin(a), y: c.y - dx * Math.sin(a) + dy * Math.cos(a) };
};

/** Rectangle corners from its top-left `anchor`, `w` × `h` points, turned `angle` degrees about the anchor. */
export function sketchRectangle(anchor: Pt, w: number, h: number, angle = 0): Pt[] {
  const c = [anchor, { x: anchor.x + w, y: anchor.y }, { x: anchor.x + w, y: anchor.y + h }, { x: anchor.x, y: anchor.y + h }];
  return angle ? c.map((p) => rotateAbout(p, anchor, angle)) : c;
}

/** Ellipse outline inside the box at `anchor` (top-left), `w` × `h` points, turned `angle` degrees about the anchor. */
export function sketchEllipse(anchor: Pt, w: number, h: number, angle = 0, n = 72): Pt[] {
  const cx = anchor.x + w / 2, cy = anchor.y + h / 2;
  return Array.from({ length: n }, (_, i) => {
    const t = (i / n) * 2 * Math.PI;
    const p = { x: cx + (w / 2) * Math.cos(t), y: cy + (h / 2) * Math.sin(t) };
    return angle ? rotateAbout(p, anchor, angle) : p;
  });
}
