import type { Cutout, LengthUnit, Markup, Pt, Scale, ScaleFormat } from './types';

// ---------- geometry ----------

export const dist = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y);

export function pathLength(pts: Pt[], closed = false): number {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += dist(pts[i - 1], pts[i]);
  if (closed && pts.length > 2) total += dist(pts[pts.length - 1], pts[0]);
  return total;
}

/** Signed shoelace area (positive when clockwise in y-down space). */
export function signedArea(pts: Pt[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

/** Angle in degrees at vertex `v` between rays to `a` and `b` (0..180). */
export function angleAt(a: Pt, v: Pt, b: Pt): number {
  const ax = a.x - v.x, ay = a.y - v.y, bx = b.x - v.x, by = b.y - v.y;
  const d = Math.hypot(ax, ay) * Math.hypot(bx, by);
  if (!d) return 0;
  return (Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by) / d))) * 180) / Math.PI;
}

export const polygonArea = (pts: Pt[]) => Math.abs(signedArea(pts));

export function centroid(pts: Pt[]): Pt {
  const n = pts.length || 1;
  return {
    x: pts.reduce((s, p) => s + p.x, 0) / n,
    y: pts.reduce((s, p) => s + p.y, 0) / n,
  };
}

export function bounds(pts: Pt[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

/** Constrain `p` relative to `origin` to 45° increments (Shift while drawing). */
export function ortho(origin: Pt, p: Pt): Pt {
  const dx = p.x - origin.x, dy = p.y - origin.y;
  const len = Math.hypot(dx, dy);
  const step = Math.PI / 4;
  const ang = Math.round(Math.atan2(dy, dx) / step) * step;
  return { x: origin.x + Math.cos(ang) * len, y: origin.y + Math.sin(ang) * len };
}

export function rectCorners(a: Pt, b: Pt): Pt[] {
  return [
    { x: a.x, y: a.y }, { x: b.x, y: a.y },
    { x: b.x, y: b.y }, { x: a.x, y: b.y },
  ];
}

export function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  if (l2 === 0) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2));
  return dist(p, { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
}

export function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Cloud outline as cubic Bézier segments [p0, c1, c2, p1]. Scallops bulge
 * outward from the polygon regardless of winding.
 */
export function cloudSegments(poly: Pt[], arc: number): [Pt, Pt, Pt, Pt][] {
  const out: [Pt, Pt, Pt, Pt][] = [];
  if (poly.length < 2) return out;
  const sign = signedArea(poly) >= 0 ? 1 : -1;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const len = dist(a, b);
    if (len === 0) continue;
    const n = Math.max(1, Math.round(len / arc));
    const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
    // outward normal (y-down space, clockwise polygon => left-hand normal)
    const nx = uy * sign, ny = -ux * sign;
    const step = len / n;
    const bulge = step * 0.66;
    for (let k = 0; k < n; k++) {
      const p0 = { x: a.x + ux * step * k, y: a.y + uy * step * k };
      const p1 = { x: a.x + ux * step * (k + 1), y: a.y + uy * step * (k + 1) };
      out.push([
        p0,
        { x: p0.x + nx * bulge, y: p0.y + ny * bulge },
        { x: p1.x + nx * bulge, y: p1.y + ny * bulge },
        p1,
      ]);
    }
  }
  return out;
}

// ---------- scales ----------

export interface ScalePreset { label: string; factor: number; unit: LengthUnit }

const arch = (paperIn: number, label: string): ScalePreset => ({
  label: `${label} = 1'-0"`,
  factor: 1 / (72 * paperIn), // ft per point
  unit: 'ft-in',
});
const eng = (feet: number): ScalePreset => ({
  label: `1" = ${feet}'`,
  factor: feet / 72,
  unit: 'ft',
});
const metric = (ratio: number): ScalePreset => ({
  label: `1:${ratio}`,
  factor: (25.4 / 72 / 1000) * ratio, // m per point
  unit: 'm',
});

export const SCALE_PRESETS: { group: string; items: ScalePreset[] }[] = [
  {
    group: 'Architectural',
    items: [
      arch(1 / 16, '1/16"'), arch(3 / 32, '3/32"'), arch(1 / 8, '1/8"'), arch(3 / 16, '3/16"'),
      arch(1 / 4, '1/4"'), arch(3 / 8, '3/8"'), arch(1 / 2, '1/2"'), arch(3 / 4, '3/4"'),
      arch(1, '1"'), arch(1.5, '1 1/2"'), arch(3, '3"'),
    ],
  },
  { group: 'Engineering', items: [10, 20, 30, 40, 50, 60, 100].map(eng) },
  { group: 'Metric', items: [1, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000].map(metric) },
];

export const DEFAULT_SCALE: Scale = { factor: 1 / 72, unit: 'in', label: '1:1' };

/** Convert `value` in `from` units to inches (ft-in counts as feet). */
const TO_INCHES: Record<LengthUnit, number> = {
  in: 1, ft: 12, 'ft-in': 12, yd: 36, mm: 1 / 25.4, cm: 1 / 2.54, m: 1 / 0.0254,
};

/** Build a scale from a calibration: `pagePts` points on paper equal `realValue` `unit`. */
export function calibrate(pagePts: number, realValue: number, unit: LengthUnit): Scale {
  const factor = realValue / pagePts;
  const paperInches = pagePts / 72;
  const realInches = realValue * TO_INCHES[unit];
  const ratio = realInches / paperInches;
  const label = unit === 'ft' || unit === 'ft-in'
    ? `1" = ${formatLength(ratio / 12, 'ft-in')}`
    : `1:${round(ratio, 2)}`;
  return { factor, unit, label };
}

export type PaperUnit = 'in' | 'mm' | 'cm';
const PAPER_PTS: Record<PaperUnit, number> = { in: 72, mm: 72 / 25.4, cm: 72 / 2.54 };

/** Precision choices, as in Revu's Precision drop-down. */
export const FRACTION_PRECISIONS = [1, 2, 4, 8, 16, 32, 64]; // 1/den inch
export const DECIMAL_PRECISIONS = [0, 1, 2, 3, 4]; // decimal places

/** Apply a precision choice to a scale: a denominator for ft-in, else decimals. */
export function withPrecision(s: Scale, precision: number): Scale {
  const format = { ...(s.format ?? {}) };
  if (s.unit === 'ft-in') format.den = precision;
  else format.decimals = precision;
  return { ...s, format };
}

export function precisionOf(s: Scale): number {
  const f = resolveFormat(s);
  return s.unit === 'ft-in' ? f.den : f.decimals;
}

const num = (v: number) => String(round(v, 4));

/** A custom scale: `paper paperUnit = real realUnit` (Revu's Custom scale). */
export function customScale(paper: number, paperUnit: PaperUnit, real: number, realUnit: LengthUnit): Scale {
  const factor = real / (paper * PAPER_PTS[paperUnit]);
  const realText = realUnit === 'ft-in' ? formatLength(real, 'ft-in') : `${num(real)} ${unitLabel(realUnit)}`;
  return { factor, unit: realUnit, label: `${num(paper)} ${paperUnit} = ${realText}` };
}

/** Parse a page range like "1-3, 5, 9" (1-based) into 0-based indexes. */
export function parsePageRange(text: string, pageCount: number): number[] {
  const out = new Set<number>();
  for (const part of text.split(',')) {
    const m = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!m) continue;
    const a = Number(m[1]), b = m[2] ? Number(m[2]) : a;
    for (let p = Math.min(a, b); p <= Math.max(a, b); p++) if (p >= 1 && p <= pageCount) out.add(p - 1);
  }
  return [...out].sort((x, y) => x - y);
}

// ---------- formatting ----------

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

function gcd(a: number, b: number): number { return b ? gcd(b, a % b) : a; }

/** Format a number with `decimals` places, optionally dropping trailing zeros. */
export function formatNumber(v: number, decimals: number, trim: boolean): string {
  const s = round(v, decimals).toFixed(decimals);
  return trim && s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}

/** Format a length in `unit` (ft-in expects feet). Fractions to 1/`den` inch. */
export function formatLength(v: number, unit: LengthUnit, decimals = 2, den = 16, trim = false): string {
  if (unit === 'ft-in') {
    const sign = v < 0 ? '-' : '';
    let totalEighths = Math.round(Math.abs(v) * 12 * den);
    const ft = Math.floor(totalEighths / (12 * den));
    totalEighths -= ft * 12 * den;
    const inch = Math.floor(totalEighths / den);
    const num = totalEighths - inch * den;
    let frac = '';
    if (num) {
      const g = gcd(num, den);
      frac = ` ${num / g}/${den / g}`;
    }
    return `${sign}${ft}'-${inch}${frac}"`;
  }
  return `${formatNumber(v, decimals, trim)} ${unitLabel(unit)}`;
}

export function unitLabel(unit: LengthUnit): string {
  return unit === 'ft-in' ? 'ft' : unit;
}

export function areaLabel(unit: LengthUnit): string {
  switch (unit) {
    case 'ft': case 'ft-in': return 'sf';
    case 'in': return 'sq in';
    case 'yd': return 'sq yd';
    case 'm': return 'm²';
    case 'cm': return 'cm²';
    case 'mm': return 'mm²';
  }
}

export function volumeLabel(unit: LengthUnit): string {
  switch (unit) {
    case 'ft': case 'ft-in': return 'cu ft';
    case 'in': return 'cu in';
    case 'yd': return 'cu yd';
    case 'm': return 'm³';
    case 'cm': return 'cm³';
    case 'mm': return 'mm³';
  }
}

// ---------- markup measurements ----------

export const MEASURE_TYPES = new Set(['length', 'polylength', 'area', 'perimeter', 'volume', 'count', 'angle', 'radius', 'diameter']);

export interface Measurement {
  length?: number;
  /** Degrees. */
  angle?: number;
  area?: number;
  volume?: number;
  count?: number;
  /** Display string, e.g. 12'-6" or 240.00 sf */
  text: string;
}

/**
 * Display format for a scale. Defaults follow Revu's (nearest 1/4", two
 * decimals without trailing zeros, sf / cu ft) unless the file says otherwise.
 */
export function resolveFormat(s: Scale): Required<ScaleFormat> {
  const f = s.format ?? {};
  return {
    den: f.den ?? 4,
    decimals: f.decimals ?? 2,
    trim: f.trim ?? true,
    areaLabel: f.areaLabel ?? areaLabel(s.unit),
    volumeLabel: f.volumeLabel ?? volumeLabel(s.unit),
  };
}

export function cutoutArea(c: Cutout): number {
  if (c.kind === 'polygon') return polygonArea(c.points);
  const b = bounds(c.points);
  return (Math.PI * b.w * b.h) / 4;
}

/** Area of the shape minus its cutouts, in square points. */
export function netArea(m: Pick<Markup, 'points' | 'cutouts'>): number {
  return Math.max(0, polygonArea(m.points) - (m.cutouts ?? []).reduce((t, c) => t + cutoutArea(c), 0));
}

export function measure(m: Pick<Markup, 'type' | 'points' | 'scale' | 'depth' | 'cutouts'>): Measurement | null {
  if (!MEASURE_TYPES.has(m.type)) return null;
  const s = m.scale ?? DEFAULT_SCALE;
  const f = s.factor;
  const fmt = resolveFormat(s);
  const len = (v: number) => formatLength(v, s.unit, fmt.decimals, fmt.den, fmt.trim);
  switch (m.type) {
    case 'length':
    case 'polylength':
    case 'perimeter': {
      // Like Revu, a perimeter is the length of its segments as drawn; the
      // perimeter tool closes the shape by repeating the first point.
      const length = pathLength(m.points) * f;
      return { length, text: len(length) };
    }
    case 'area': {
      const area = netArea(m) * f * f;
      const length = pathLength(m.points, true) * f;
      return { area, length, text: `${formatNumber(area, fmt.decimals, fmt.trim)} ${fmt.areaLabel}` };
    }
    case 'volume': {
      const area = netArea(m) * f * f;
      const volume = area * (m.depth ?? 0);
      return { area, volume, text: `${formatNumber(volume, fmt.decimals, fmt.trim)} ${fmt.volumeLabel}` };
    }
    case 'radius':
    case 'diameter': {
      // radius: [center, point on circle]; diameter: [end, end]
      const length = (m.points.length > 1 ? dist(m.points[0], m.points[1]) : 0) * f;
      return { length, text: len(length) };
    }
    case 'angle': {
      // angle at the middle vertex between the two arms (Revu's PolyLineAngle)
      const [a, v, b] = m.points;
      if (!a || !v || !b) return { angle: 0, text: '0°' };
      const ang = angleAt(a, v, b);
      return { angle: ang, text: `${formatNumber(ang, fmt.decimals, fmt.trim)}°` };
    }
    case 'count':
      return { count: m.points.length, text: String(m.points.length) };
  }
  return null;
}
