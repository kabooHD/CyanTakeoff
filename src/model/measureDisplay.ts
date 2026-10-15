// How a measurement shows on the drawing (Revu's measurement properties):
// the caption, per-segment values, the centroid, and units chosen for one
// markup instead of the page scale's.
import type { LengthUnit, Markup, Pt } from './types';
import { areaLabel, formatLength, formatNumber, measure, resolveFormat, volumeLabel, type Measurement } from './measure';
import { flatPoints } from './curves';

export interface MeasureDisplay {
  /** Which caption shows on the drawing: the value (default), the label, both, or none. */
  caption?: 'value' | 'label' | 'both' | 'none';
  segments?: boolean;
  segmentAlign?: 'center' | 'inside' | 'outside';
  centroid?: boolean;
  lengthUnit?: LengthUnit;
  areaUnit?: LengthUnit;
  volumeUnit?: LengthUnit;
  /** Caption moved from its default place (page units) and turned (degrees counter-clockwise). */
  captionOffset?: Pt;
  captionAngle?: number;
  /** Length captions moved off the line get a leader line (Revu: Show Caption Leader Line); false hides it. */
  captionLeader?: boolean;
}

const INCHES: Record<LengthUnit, number> = { in: 1, ft: 12, 'ft-in': 12, yd: 36, mm: 1 / 25.4, cm: 1 / 2.54, m: 1000 / 25.4 };
export const LENGTH_UNITS: LengthUnit[] = ['in', 'ft', 'ft-in', 'yd', 'mm', 'cm', 'm'];

/** A length (or area/volume with `power` 2/3) converted between units. */
export function convertLength(v: number, from: LengthUnit, to: LengthUnit, power = 1): number {
  return v * (INCHES[from] / INCHES[to]) ** power;
}

/** The measurement's value text, in the markup's own units when set. */
export function displayText(m: Markup, meas: Measurement | null = measure(m)): string {
  if (!meas) return '';
  const d = m.display, scale = m.scale;
  if (!d || !scale) return meas.text;
  const f = resolveFormat(scale);
  if (meas.volume !== undefined && d.volumeUnit && d.volumeUnit !== scale.unit) return `${formatNumber(convertLength(meas.volume, scale.unit, d.volumeUnit, 3), f.decimals, f.trim)} ${volumeLabel(d.volumeUnit)}`;
  if (meas.area !== undefined && meas.volume === undefined && d.areaUnit && d.areaUnit !== scale.unit) return `${formatNumber(convertLength(meas.area, scale.unit, d.areaUnit, 2), f.decimals, f.trim)} ${areaLabel(d.areaUnit)}`;
  if (meas.length !== undefined && meas.area === undefined && meas.volume === undefined && d.lengthUnit && d.lengthUnit !== scale.unit) return formatLength(convertLength(meas.length, scale.unit, d.lengthUnit), d.lengthUnit, f.decimals, f.den, f.trim);
  return meas.text;
}

/** The caption drawn on the markup, or null when captions are off. */
export function captionText(m: Markup, meas: Measurement | null = measure(m)): string | null {
  const mode = m.display?.caption ?? 'value';
  if (mode === 'none' || !meas) return null;
  const value = displayText(m, meas);
  if (mode === 'label') return m.label || null;
  if (mode === 'both') return m.label ? `${m.label}: ${value}` : value;
  return value;
}

/** Types that can show a value on each segment. */
export const SEGMENT_TYPES = new Set(['polylength', 'perimeter', 'area', 'volume', 'polygon']);

/** Each segment's length text and where to draw it (page space), offset to the chosen side. */
export function segmentValues(m: Markup, offset = 8): { at: Pt; text: string }[] {
  if (!m.scale || !SEGMENT_TYPES.has(m.type)) return [];
  const pts = flatPoints(m);
  const closed = m.type !== 'polylength';
  const n = closed ? pts.length : pts.length - 1;
  if (pts.length < 2) return [];
  // Inside/outside of a closed shape depends on its winding (y is down on the page).
  const signed = pts.reduce((a, p, i) => { const q = pts[(i + 1) % pts.length]; return a + p.x * q.y - q.x * p.y; }, 0);
  const align = m.display?.segmentAlign ?? 'center';
  const out: { at: Pt; text: string }[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const seg = measure({ type: 'length', points: [a, b], scale: m.scale });
    if (!seg) continue;
    const text = displayText({ ...m, type: 'length', points: [a, b] } as Markup, seg);
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    // Left normal of the travel direction; for a clockwise-on-screen shape that points inside.
    let nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
    if (closed && align !== 'center') {
      // Positive signed area (y down) means the outline runs clockwise on screen: the left normal points inside.
      const leftIsInside = signed > 0;
      const wantInside = align === 'inside';
      if (leftIsInside !== wantInside) { nx = -nx; ny = -ny; }
    }
    const k = align === 'center' ? 0 : offset;
    out.push({ at: { x: (a.x + b.x) / 2 + nx * k, y: (a.y + b.y) / 2 + ny * k }, text });
  }
  return out;
}

/** Where a measurement's caption sits by default (page space, from the markup's points). */
export function captionAnchor(type: Markup['type'], P: Pt[]): Pt {
  if (type === 'length' || type === 'polylength' || type === 'radius' || type === 'diameter' || type === 'dimension') return { x: (P[0].x + P[1].x) / 2, y: (P[0].y + P[1].y) / 2 - 3 };
  if (type === 'angle' && P[1]) return { x: P[1].x + 8, y: P[1].y - 8 };
  const n = P.length;
  if (n < 3) return P[0];
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < n; i++) {
    const p = P[i], q = P[(i + 1) % n], f = p.x * q.y - q.x * p.y;
    a += f; cx += (p.x + q.x) * f; cy += (p.y + q.y) * f;
  }
  if (Math.abs(a) < 1e-9) return { x: P.reduce((t, p) => t + p.x, 0) / n, y: P.reduce((t, p) => t + p.y, 0) / n };
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

/** The caption's place: its anchor moved by the offset the user dragged it to. */
export function captionPosition(m: Pick<Markup, 'type' | 'display'>, P: Pt[]): Pt {
  const a = captionAnchor(m.type, P), o = m.display?.captionOffset;
  return o ? { x: a.x + o.x, y: a.y + o.y } : a;
}

/** The leader joining a moved Length caption to the middle of its line (Revu), or null when there is none. */
export function captionLeaderLine(m: Pick<Markup, 'type' | 'display'>, P: Pt[]): { from: Pt; to: Pt } | null {
  if (m.type !== 'length' || !m.display?.captionOffset || m.display.captionLeader === false || P.length < 2) return null;
  return { from: { x: (P[0].x + P[1].x) / 2, y: (P[0].y + P[1].y) / 2 }, to: captionPosition(m, P) };
}

/** Caption rotation while dragging its anchor: 15° steps, 1° with `fine` (Shift), in degrees counter-clockwise. */
export function snapCaptionAngle(deg: number, fine: boolean): number {
  const step = fine ? 1 : 15;
  const a = Math.round(deg / step) * step;
  return ((a % 360) + 360) % 360;
}

/** Types whose caption can be moved (Revu: not Radius, Diameter and Angle). */
export const MOVABLE_CAPTION = new Set(['length', 'polylength', 'perimeter', 'area', 'volume']);
