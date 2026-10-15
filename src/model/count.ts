// Count measurements (Revu): one markup holds the counted points; its
// symbol and scale are appearance properties. Split Counts, Split All,
// Merge Counts and Delete from Group rearrange the points between markups.
import type { Markup, Pt } from './types';

export type CountSymbol = 'circle' | 'square' | 'triangle' | 'diamond' | 'cross' | 'x' | 'check' | 'star';
export const COUNT_SYMBOLS: CountSymbol[] = ['circle', 'square', 'triangle', 'diamond', 'cross', 'x', 'check', 'star'];
export const COUNT_RADIUS = 5;

/** The symbol's radius for a style scale (1 = Revu's default size). */
export const countRadius = (scale: number | undefined) => COUNT_RADIUS * (scale && scale > 0 ? scale : 1);

/** A filled outline for the symbol (null for circle, cross, x and check, which are drawn as strokes). */
export function countSymbolPolygon(symbol: CountSymbol, p: Pt, r: number): Pt[] | null {
  switch (symbol) {
    case 'square': return [{ x: p.x - r, y: p.y - r }, { x: p.x + r, y: p.y - r }, { x: p.x + r, y: p.y + r }, { x: p.x - r, y: p.y + r }];
    case 'triangle': return [{ x: p.x, y: p.y - r * 1.15 }, { x: p.x + r * 1.15, y: p.y + r * 0.85 }, { x: p.x - r * 1.15, y: p.y + r * 0.85 }];
    case 'diamond': return [{ x: p.x, y: p.y - r * 1.25 }, { x: p.x + r * 1.25, y: p.y }, { x: p.x, y: p.y + r * 1.25 }, { x: p.x - r * 1.25, y: p.y }];
    case 'star': {
      const out: Pt[] = [];
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5, k = i % 2 ? r * 0.5 : r * 1.25;
        out.push({ x: p.x + k * Math.cos(a), y: p.y + k * Math.sin(a) });
      }
      return out;
    }
    default: return null;
  }
}

/** Stroked segments for the line symbols (cross, x, check). */
export function countSymbolStrokes(symbol: CountSymbol, p: Pt, r: number): [Pt, Pt][] {
  switch (symbol) {
    case 'cross': return [[{ x: p.x - r, y: p.y }, { x: p.x + r, y: p.y }], [{ x: p.x, y: p.y - r }, { x: p.x, y: p.y + r }]];
    case 'x': return [[{ x: p.x - r, y: p.y - r }, { x: p.x + r, y: p.y + r }], [{ x: p.x - r, y: p.y + r }, { x: p.x + r, y: p.y - r }]];
    case 'check': return [[{ x: p.x - r, y: p.y }, { x: p.x - r * 0.3, y: p.y + r * 0.8 }], [{ x: p.x - r * 0.3, y: p.y + r * 0.8 }, { x: p.x + r * 1.1, y: p.y - r * 0.9 }]];
    default: return [];
  }
}

/** Revu's /CountStyle name for a symbol, and back. */
export const countStyleName = (s: CountSymbol) => s === 'x' ? 'X' : s[0].toUpperCase() + s.slice(1);
export function symbolOfCountStyle(name: string | undefined): CountSymbol | undefined {
  const s = (name ?? '').toLowerCase();
  return COUNT_SYMBOLS.includes(s as CountSymbol) ? (s as CountSymbol) : undefined;
}

/** Index of the counted point nearest to `p` within `tol`, or -1. */
export function nearestCountIndex(m: Pick<Markup, 'points'>, p: Pt, tol: number): number {
  let best = -1, bestD = tol;
  m.points.forEach((q, i) => { const d = Math.hypot(q.x - p.x, q.y - p.y); if (d <= bestD) { best = i; bestD = d; } });
  return best;
}

/** Split Counts: the points at `indexes` leave the markup for a new one. Nothing happens when every point would leave. */
export function splitCount(points: Pt[], indexes: number[]): { keep: Pt[]; split: Pt[] } | null {
  const set = new Set(indexes.filter((i) => i >= 0 && i < points.length));
  if (!set.size || set.size >= points.length) return null;
  return { keep: points.filter((_, i) => !set.has(i)), split: points.filter((_, i) => set.has(i)) };
}

/** Split All: every point becomes its own Count. */
export const splitAll = (points: Pt[]): Pt[][] => points.map((p) => [p]);

/** Merge Counts: every other markup's points join the target (whose properties win). */
export function mergeCounts(target: Pick<Markup, 'points'>, others: Pick<Markup, 'points'>[]): Pt[] {
  return [...target.points, ...others.flatMap((o) => o.points)];
}

/** Create Count (Tool Chest): the symbol a markup type suggests. */
export function symbolForType(type: Markup['type']): CountSymbol {
  switch (type) {
    case 'rectangle': return 'square';
    case 'polygon': case 'cloud': return 'triangle';
    case 'line': case 'arrow': case 'polyline': return 'cross';
    default: return 'circle';
  }
}
