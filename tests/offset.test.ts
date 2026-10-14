import { describe, expect, it } from 'vitest';
import { offsetMarkup, offsetPoints } from '../src/model/offset';
import type { Markup, MarkupType, Pt } from '../src/model/types';

const mk = (type: MarkupType, points: Pt[]): Markup => ({
  id: 'm', type, page: 0, points,
  style: { color: '#000000', fill: null, opacity: 1, fillOpacity: 1, width: 1, lineStyle: 'solid', fontSize: 10 },
  subject: '', label: '', comment: '', author: '', created: '', modified: '', status: 'None',
});
const sq = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
const round = (ps: Pt[]) => ps.map((p) => ({ x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100 }));

describe('offset', () => {
  it('moves a line to the side of the cursor', () => {
    const m = mk('line', [{ x: 0, y: 0 }, { x: 100, y: 0 }]);
    expect(round(offsetMarkup(m, 10, { x: 50, y: 30 })!.points)).toEqual([{ x: 0, y: 10 }, { x: 100, y: 10 }]);
    expect(round(offsetMarkup(m, 10, { x: 50, y: -30 })!.points)).toEqual([{ x: 0, y: -10 }, { x: 100, y: -10 }]);
  });
  it('grows a polygon outward and shrinks it inward', () => {
    const m = mk('polygon', sq);
    expect(round(offsetMarkup(m, 10, { x: 200, y: 50 })!.points)).toEqual([{ x: -10, y: -10 }, { x: 110, y: -10 }, { x: 110, y: 110 }, { x: -10, y: 110 }]);
    expect(round(offsetMarkup(m, 10, { x: 50, y: 50 })!.points)).toEqual([{ x: 10, y: 10 }, { x: 90, y: 10 }, { x: 90, y: 90 }, { x: 10, y: 90 }]);
  });
  it('works the same for either winding', () => {
    const m = mk('area', [...sq].reverse());
    const out = offsetMarkup(m, 10, { x: 200, y: 50 })!.points;
    expect(Math.min(...out.map((p) => p.x))).toBeCloseTo(-10);
  });
  it('bevels corners sharper than the miter limit', () => {
    const spike = [{ x: 0, y: 0 }, { x: 100, y: 5 }, { x: 0, y: 10 }];
    expect(offsetPoints(spike, false, 2, 4)).toHaveLength(4);
    expect(offsetPoints(spike, false, 2, 1000)).toHaveLength(3);
  });
  it('grows rectangles by the distance on each side', () => {
    const m = mk('rectangle', [{ x: 0, y: 0 }, { x: 100, y: 50 }]);
    expect(offsetMarkup(m, 5, { x: 200, y: 0 })!.points).toEqual([{ x: -5, y: -5 }, { x: 105, y: 55 }]);
    expect(offsetMarkup(m, 30, { x: 50, y: 25 })).toBeNull(); // would vanish
  });
  it('offsets as another type', () => {
    const r = offsetMarkup(mk('polygon', sq), 10, { x: 200, y: 50 }, 4, 'polylength')!;
    expect(r.type).toBe('polylength');
    expect(r.points).toHaveLength(5); // closed outline as an open line returns to its start
    expect(offsetMarkup(mk('polyline', sq.slice(0, 3)), 5, { x: 0, y: 50 }, 4, 'line')).toBeNull();
  });
});
