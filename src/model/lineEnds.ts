// Line end styles (Revu: the "End" / "Start" properties of lines, arrows,
// polylines and callout leaders), with the PDF /LE names they are saved as.
import type { MarkupStyle, MarkupType, Pt } from './types';

export type LineEnd = 'none' | 'openArrow' | 'closedArrow' | 'circle' | 'square' | 'diamond' | 'slash' | 'butt' | 'rOpenArrow' | 'rClosedArrow';
export const LINE_ENDS: { id: LineEnd; name: string }[] = [
  { id: 'none', name: 'None' }, { id: 'openArrow', name: 'Open Arrow' }, { id: 'closedArrow', name: 'Closed Arrow' }, { id: 'circle', name: 'Circle' },
  { id: 'square', name: 'Square' }, { id: 'diamond', name: 'Diamond' }, { id: 'slash', name: 'Slash' }, { id: 'butt', name: 'Butt' },
  { id: 'rOpenArrow', name: 'Reverse Open Arrow' }, { id: 'rClosedArrow', name: 'Reverse Closed Arrow' },
];
const LE_NAMES: Record<LineEnd, string> = { none: 'None', openArrow: 'OpenArrow', closedArrow: 'ClosedArrow', circle: 'Circle', square: 'Square', diamond: 'Diamond', slash: 'Slash', butt: 'Butt', rOpenArrow: 'ROpenArrow', rClosedArrow: 'RClosedArrow' };

/** Markup types with a start and an end (callouts: end only, on every leader). */
export const LINE_END_TYPES = new Set<MarkupType>(['line', 'arrow', 'polyline', 'polylength', 'callout']);

export const leName = (e: LineEnd) => LE_NAMES[e];
export function lineEndOfName(name: string | undefined): LineEnd | undefined {
  const n = (name ?? '').replace(/^\//, '');
  return (Object.keys(LE_NAMES) as LineEnd[]).find((k) => LE_NAMES[k] === n);
}

/** The ends a type has when nothing is set. */
export function defaultEnds(type: MarkupType): { start: LineEnd; end: LineEnd } {
  if (type === 'arrow' || type === 'callout') return { start: 'none', end: 'openArrow' };
  if (type === 'dimension') return { start: 'openArrow', end: 'openArrow' };
  return { start: 'none', end: 'none' };
}

/** The ends of a markup: the style's, else the type's defaults. */
export function endsOf(type: MarkupType, st: Pick<MarkupStyle, 'lineStart' | 'lineEnd' | 'lineEndSize' | 'width'>) {
  const d = defaultEnds(type);
  return { start: st.lineStart ?? d.start, end: st.lineEnd ?? d.end, size: Math.max(4, (st.lineEndSize ?? 1) * Math.max(8, st.width * 5)) };
}

export interface EndShape { fill: Pt[] | null; strokes: Pt[][]; circle?: { c: Pt; r: number } }

/**
 * Geometry of an end drawn at `to`, pointing away from `from`. Reverse
 * arrows point back along the line. `strokes` are open polylines, `fill`
 * a closed shape painted with the line colour.
 */
export function lineEndShape(kind: LineEnd, from: Pt, to: Pt, size: number): EndShape {
  const ang = Math.atan2(to.y - from.y, to.x - from.x);
  const u = { x: Math.cos(ang), y: Math.sin(ang) }, n = { x: -Math.sin(ang), y: Math.cos(ang) };
  const at = (a: number, b: number): Pt => ({ x: to.x + u.x * a + n.x * b, y: to.y + u.y * a + n.y * b });
  const s = 0.45;
  switch (kind) {
    case 'openArrow': return { fill: null, strokes: [[at(-size * Math.cos(s), size * Math.sin(s)), to, at(-size * Math.cos(s), -size * Math.sin(s))]] };
    case 'closedArrow': return { fill: [at(-size * Math.cos(s), size * Math.sin(s)), to, at(-size * Math.cos(s), -size * Math.sin(s))], strokes: [] };
    case 'rOpenArrow': return { fill: null, strokes: [[at(size * Math.cos(s), size * Math.sin(s)), to, at(size * Math.cos(s), -size * Math.sin(s))]] };
    case 'rClosedArrow': return { fill: [at(size * Math.cos(s), size * Math.sin(s)), to, at(size * Math.cos(s), -size * Math.sin(s))], strokes: [] };
    case 'circle': return { fill: null, strokes: [], circle: { c: to, r: size * 0.4 } };
    case 'square': { const h = size * 0.4; return { fill: [at(-h, h), at(h, h), at(h, -h), at(-h, -h)], strokes: [] }; }
    case 'diamond': { const h = size * 0.5; return { fill: [at(-h, 0), at(0, h), at(h, 0), at(0, -h)], strokes: [] }; }
    case 'slash': { const h = size * 0.5; return { fill: null, strokes: [[at(-h * 0.5, h), at(h * 0.5, -h)]] }; }
    case 'butt': { const h = size * 0.5; return { fill: null, strokes: [[at(0, h), at(0, -h)]] }; }
    default: return { fill: null, strokes: [] };
  }
}

/** A callout's leader tips: the first point and any extra leaders (points after the box corners). */
export const calloutTips = (points: Pt[]): Pt[] => [points[0], ...points.slice(3)];
