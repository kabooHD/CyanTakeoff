// Line styles and hatch patterns (Revu's Line Style and Hatch lists).
//
// A line style is one or more parallel lines, each offset from the drawn
// path and made of repeating components: dashes, spaces, dots and text
// (e.g. "— G —" for a gas line). With "scale with line thickness" the
// lengths are multiples of the line width. A hatch pattern is a square tile
// of lines and dots repeated over the inside of a closed markup.
//
// The same geometry draws the markup on screen (SVG) and in the saved
// appearance stream, so what you see is what Revu and other viewers show.
// A markup keeps a copy of a custom style or hatch it uses (changing the
// style later does not change markups already drawn, as in Revu), and the
// copy is saved with it so the file is self-contained.
import type { Markup, Pt } from './types';
import { arcThrough, rectCorners } from './measure';
import { flatPoints } from './curves';

export interface LineComponent {
  kind: 'dash' | 'space' | 'dot' | 'text';
  /** Length (dash, space) in line widths when scaled, else points. */
  len?: number;
  text?: string;
}
export interface LineDef { offset: number; components: LineComponent[] }
export interface LineStyleDef { id: string; name: string; lines: LineDef[]; scale: boolean; description?: string }

const D = (len: number): LineComponent => ({ kind: 'dash', len });
const S = (len: number): LineComponent => ({ kind: 'space', len });
const DOT: LineComponent = { kind: 'dot' };
const T = (text: string): LineComponent => ({ kind: 'text', text });
const one = (id: string, name: string, components: LineComponent[], description?: string): LineStyleDef =>
  ({ id, name, scale: true, lines: [{ offset: 0, components }], description });

/** The Standard set (read only). Ids 'solid', 'dashed', 'dotted' are what older files store. */
export const STANDARD_LINE_STYLES: LineStyleDef[] = [
  one('solid', 'Solid', []),
  one('dashed', 'Dashed', [D(4), S(3)]),
  one('dotted', 'Dotted', [DOT, S(2)]),
  one('dash-dot', 'Dash Dot', [D(6), S(2), DOT, S(2)]),
  one('dash-dot-dot', 'Dash Dot Dot', [D(6), S(2), DOT, S(2), DOT, S(2)]),
  one('long-dash', 'Long Dash', [D(12), S(4)]),
  one('center', 'Center', [D(16), S(3), D(4), S(3)], 'Centerline: long dash, short dash'),
  one('hidden', 'Hidden', [D(3), S(2)], 'Hidden line: short dashes'),
  one('phantom', 'Phantom', [D(16), S(3), D(3), S(3), D(3), S(3)], 'Long dash, two short dashes'),
  { id: 'double', name: 'Double', scale: true, lines: [{ offset: -1.5, components: [] }, { offset: 1.5, components: [] }] },
  one('gas', 'Gas Line', [D(20), S(1), T('G'), S(1)]),
  one('water', 'Water Line', [D(20), S(1), T('W'), S(1)]),
  one('sewer', 'Sewer Line', [D(20), S(1), T('SS'), S(1)]),
  one('electric', 'Electric Line', [D(20), S(1), T('E'), S(1)]),
  one('fence', 'Fence', [D(16), S(1), T('X'), S(1)]),
];

export const BASIC_LINE_STYLES = new Set(['solid', 'dashed', 'dotted']);

/** The definition for a markup style: its own copy, else the standard one, else solid. */
export function lineStyleOf(st: { lineStyle: string; lineDef?: LineStyleDef }): LineStyleDef {
  return st.lineDef ?? STANDARD_LINE_STYLES.find((x) => x.id === st.lineStyle) ?? STANDARD_LINE_STYLES[0];
}

/** Text size of text components for a line width. */
export const lineTextSize = (width: number, def: LineStyleDef) => (def.scale ? Math.max(5, width * 6) : 8);
/** Estimated text width (Helvetica, average glyph 0.6 em). */
export const textWidth = (text: string, size: number) => text.length * size * 0.6;

/** One stroked line of the style: its path, dash array (null: solid) and the texts along it. */
export interface StyledLine { pts: Pt[]; closed: boolean; dash: number[] | null }
export interface StyledText { at: Pt; angle: number; text: string; size: number }

/** Offset a polyline sideways (positive: to the left of the direction of travel, in y-down page space to the right). */
export function offsetPath(pts: Pt[], closed: boolean, d: number): Pt[] {
  if (!d || pts.length < 2) return pts;
  const n = pts.length;
  const normal = (a: Pt, b: Pt) => { const l = Math.hypot(b.x - a.x, b.y - a.y) || 1; return { x: -(b.y - a.y) / l, y: (b.x - a.x) / l }; };
  return pts.map((p, i) => {
    const prev = i > 0 ? pts[i - 1] : closed ? pts[n - 1] : null;
    const next = i < n - 1 ? pts[i + 1] : closed ? pts[0] : null;
    const n1 = prev ? normal(prev, p) : null, n2 = next ? normal(p, next) : null;
    if (!n1 || !n2) { const q = (n1 ?? n2)!; return { x: p.x + q.x * d, y: p.y + q.y * d }; }
    // Miter: along the bisector, longer at sharp corners (capped).
    const bx = n1.x + n2.x, by = n1.y + n2.y, bl = Math.hypot(bx, by);
    if (bl < 1e-6) return { x: p.x + n1.x * d, y: p.y + n1.y * d };
    const k = Math.min(4, 2 / bl); // 1 / cos(half the turn)
    return { x: p.x + (bx / bl) * d * k, y: p.y + (by / bl) * d * k };
  });
}

/** Lines and texts to draw a path in a style at a line width. */
export function styledStroke(pts: Pt[], closed: boolean, def: LineStyleDef, width: number): { lines: StyledLine[]; texts: StyledText[] } {
  const unit = def.scale ? Math.max(width, 0.5) : 1;
  const size = lineTextSize(width, def);
  const lines: StyledLine[] = [];
  const texts: StyledText[] = [];
  for (const ln of def.lines) {
    const path = offsetPath(pts, closed, ln.offset * unit);
    const comps = ln.components;
    if (!comps.length) { lines.push({ pts: path, closed, dash: null }); continue; }
    // Dash array (on, off, on, off...): text leaves a gap its width.
    const dash: number[] = [];
    const marks: { at: number; text: string; w: number }[] = [];
    let pos = 0;
    const push = (on: boolean, len: number) => {
      if (dash.length % 2 === (on ? 0 : 1)) dash.push(len);
      else if (dash.length) dash[dash.length - 1] += len;
      else { dash.push(0, len); }
      pos += len;
    };
    for (const c of comps) {
      if (c.kind === 'dash') push(true, (c.len ?? 4) * unit);
      else if (c.kind === 'space') push(false, (c.len ?? 2) * unit);
      else if (c.kind === 'dot') push(true, 0);
      else {
        const w = textWidth(c.text ?? '', size) + size * 0.4;
        marks.push({ at: pos + w / 2, text: c.text ?? '', w });
        push(false, w);
      }
    }
    if (dash.length % 2) dash.push(0);
    const period = dash.reduce((a, b) => a + b, 0);
    lines.push({ pts: path, closed, dash: period > 0 ? dash : null });
    if (!marks.length || period <= 0) continue;
    // Texts along the path, each centred in its gap and kept upright.
    const ring = closed ? [...path, path[0]] : path;
    const cum = [0];
    for (let i = 1; i < ring.length; i++) cum.push(cum[i - 1] + Math.hypot(ring[i].x - ring[i - 1].x, ring[i].y - ring[i - 1].y));
    const total = cum[cum.length - 1];
    let seg = 1;
    for (let k = 0; k * period < total && texts.length < 5000; k++) {
      for (const mk of marks) {
        const s = k * period + mk.at;
        if (s + mk.w / 2 > total) continue;
        while (seg < cum.length - 1 && cum[seg] < s) seg++;
        while (seg > 1 && cum[seg - 1] > s) seg--;
        const a = ring[seg - 1], b = ring[seg];
        const t = (s - cum[seg - 1]) / ((cum[seg] - cum[seg - 1]) || 1);
        let angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
        if (angle > 90) angle -= 180; else if (angle < -90) angle += 180;
        texts.push({ at: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, angle, text: mk.text, size });
      }
    }
  }
  return { lines, texts };
}

/** Can the style be drawn as a single dashed stroke (SVG stroke-dasharray / PDF d)? */
export const isSimpleStyle = (def: LineStyleDef) => def.lines.length === 1 && !def.lines[0].offset && !def.lines[0].components.some((c) => c.kind === 'text');

/** Dash pattern of a style's first line (texts left out): the whole style when it is simple. */
export function lineDash(def: LineStyleDef, width: number): number[] | null {
  const first = def.lines[0];
  if (!first) return null;
  return dashArray({ ...def, lines: [{ offset: 0, components: first.components.filter((c) => c.kind !== 'text') }] }, width);
}

/** Dash array for a simple style (null: solid). */
export function dashArray(def: LineStyleDef, width: number): number[] | null {
  return styledStroke([{ x: 0, y: 0 }, { x: 1, y: 0 }], false, def, width).lines[0]?.dash ?? null;
}

// ---------- hatch patterns ----------

/** A tile of `size` points (at scale 1); lines and dots in tile units (0..1, y down). */
export interface HatchDef { id: string; name: string; size: number; lines: [number, number, number, number][]; dots: [number, number, number][] }

const H = (id: string, name: string, size: number, lines: HatchDef['lines'], dots: HatchDef['dots'] = []): HatchDef => ({ id, name, size, lines, dots });
export const STANDARD_HATCHES: HatchDef[] = [
  H('ansi31', 'Diagonal (ANSI31)', 8, [[0, 1, 1, 0]]),
  H('ansi37', 'Cross Diagonal (ANSI37)', 8, [[0, 1, 1, 0], [0, 0, 1, 1]]),
  H('horizontal', 'Horizontal', 6, [[0, 0.5, 1, 0.5]]),
  H('vertical', 'Vertical', 6, [[0.5, 0, 0.5, 1]]),
  H('grid', 'Grid', 8, [[0, 0.5, 1, 0.5], [0.5, 0, 0.5, 1]]),
  H('brick', 'Brick', 12, [[0, 0, 1, 0], [0, 0.5, 1, 0.5], [0, 0, 0, 0.5], [0.5, 0.5, 0.5, 1]]),
  H('dots', 'Dots', 6, [], [[0.5, 0.5, 0.08]]),
  H('concrete', 'Concrete', 16, [[0.1, 0.3, 0.25, 0.15], [0.25, 0.15, 0.3, 0.35], [0.3, 0.35, 0.1, 0.3], [0.6, 0.7, 0.75, 0.6]],
    [[0.55, 0.2, 0.03], [0.8, 0.35, 0.03], [0.2, 0.75, 0.03], [0.45, 0.9, 0.03]]),
  H('earth', 'Earth', 12, [[0.05, 0.2, 0.45, 0.2], [0.05, 0.3, 0.45, 0.3], [0.05, 0.4, 0.45, 0.4], [0.6, 0.55, 0.6, 0.95], [0.7, 0.55, 0.7, 0.95], [0.8, 0.55, 0.8, 0.95]]),
  H('insulation', 'Insulation', 12, [[0, 0.5, 0.25, 0], [0.25, 0, 0.5, 0.5], [0.5, 0.5, 0.75, 1], [0.75, 1, 1, 0.5]]),
];

export const hatchById = (id: string | undefined) => STANDARD_HATCHES.find((h) => h.id === id);
/** The tile size in points for a hatch at a scale. */
export const hatchTile = (h: HatchDef, scale = 1) => Math.max(1, h.size * (scale || 1));

// ---------- markup geometry the styles apply to ----------

/** Markup types whose outline can take any line style (others use the dash pattern only). */
export const STYLED_TYPES = new Set(['line', 'arrow', 'length', 'polyline', 'polylength', 'perimeter', 'pen', 'polygon', 'area', 'volume', 'rectangle', 'ellipse', 'arc']);
/** Closed markup types that can be hatched. */
export const HATCH_TYPES = new Set(['polygon', 'area', 'volume', 'rectangle', 'ellipse', 'cloud']);

function ring(a: Pt, b: Pt, n = 72): Pt[] {
  const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2, rx = Math.abs(b.x - a.x) / 2, ry = Math.abs(b.y - a.y) / 2;
  return Array.from({ length: n }, (_, i) => ({ x: cx + rx * Math.cos((i / n) * 2 * Math.PI), y: cy + ry * Math.sin((i / n) * 2 * Math.PI) }));
}

/** The path a markup's line runs along (null: not a styled type). */
export function strokeOutline(m: Markup): { pts: Pt[]; closed: boolean } | null {
  const P = m.points;
  if (!STYLED_TYPES.has(m.type) || P.length < 2) return null;
  switch (m.type) {
    case 'line': case 'arrow': case 'length': return { pts: [P[0], P[1]], closed: false };
    case 'rectangle': return { pts: rectCorners(P[0], P[1]), closed: true };
    case 'ellipse': return { pts: ring(P[0], P[1]), closed: true };
    case 'arc': return { pts: P.length > 2 ? arcThrough(P[0], P[1], P[2]) : P, closed: false };
    case 'polygon': case 'area': case 'volume': return { pts: flatPoints(m), closed: true };
    default: return { pts: flatPoints(m), closed: false };
  }
}

/** The region a hatch fills (outer outline; cutouts are holes). */
export function fillOutline(m: Markup): Pt[] | null {
  const P = m.points;
  if (!HATCH_TYPES.has(m.type) || P.length < 2) return null;
  if (m.type === 'rectangle') return rectCorners(P[0], P[1]);
  if (m.type === 'ellipse') return ring(P[0], P[1]);
  return flatPoints(m);
}

/** Line width of a hatch's strokes for a tile size. */
export const hatchLineWidth = (tile: number) => Math.max(0.25, tile / 24);
