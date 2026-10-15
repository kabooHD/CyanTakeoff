import { describe, expect, it } from 'vitest';
import { aspectCorner, hasScaleHandles, oppositeCorner, scaleAbout, scaleFactor, scaleHandles } from '../src/model/scale';
import type { Markup } from '../src/model/types';

const style = { color: '#ff0000', fill: null, opacity: 1, fillOpacity: 1, width: 1, lineStyle: 'solid' as const, fontSize: 10 };
const mk = (type: Markup['type'], points: Markup['points'], extra: Partial<Markup> = {}): Markup => ({
  id: 'm', type, page: 0, points, style, subject: '', label: '', comment: '', author: '', created: '', modified: '', status: 'None', ...extra,
});
const near = (p: { x: number; y: number }, x: number, y: number) => { expect(p.x).toBeCloseTo(x, 6); expect(p.y).toBeCloseTo(y, 6); };

describe('scale handles', () => {
  const poly = mk('polygon', [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 20 }, { x: 0, y: 20 }]);
  it('are the box corners of point shapes, not of lines or boxes', () => {
    expect(hasScaleHandles(poly)).toBe(true);
    expect(hasScaleHandles(mk('line', [{ x: 0, y: 0 }, { x: 1, y: 1 }]))).toBe(false);
    expect(hasScaleHandles(mk('rectangle', [{ x: 0, y: 0 }, { x: 1, y: 1 }]))).toBe(false);
    expect(hasScaleHandles({ ...poly, locked: true })).toBe(false);
    const h = scaleHandles(poly);
    expect(h).toEqual([{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 20 }, { x: 0, y: 20 }]);
    expect(oppositeCorner(h, 2)).toEqual({ x: 0, y: 0 });
    expect(scaleHandles(poly, 5)[0]).toEqual({ x: -5, y: -5 });
    expect(scaleHandles(poly, 5)[2]).toEqual({ x: 45, y: 25 });
  });
  it('keep proportions along the diagonal, or scale each axis when free', () => {
    const fixed = { x: 0, y: 0 }, corner = { x: 40, y: 20 };
    expect(scaleFactor(fixed, corner, { x: 80, y: 40 }, false)).toEqual({ kx: 2, ky: 2 });
    const k = scaleFactor(fixed, corner, { x: 80, y: 0 }, false); // off the diagonal: its projection counts
    expect(k.kx).toBeCloseTo(1.6, 6); expect(k.ky).toBeCloseTo(1.6, 6);
    expect(scaleFactor(fixed, corner, { x: 80, y: 10 }, true)).toEqual({ kx: 2, ky: 0.5 });
    expect(scaleFactor(fixed, corner, { x: -100, y: -100 }, false).kx).toBe(0.02); // never collapses
  });
  it('scale the points, cutouts and handlebars about the fixed corner', () => {
    const m = { ...poly, cutouts: [{ kind: 'polygon' as const, points: [{ x: 10, y: 5 }, { x: 20, y: 5 }, { x: 20, y: 10 }] }], handles: [{ in: { x: -2, y: 0 }, out: { x: 2, y: 0 } }, null, null, null] };
    const r = scaleAbout(m, { x: 0, y: 0 }, 2, 0.5);
    near(r.points![2], 80, 10);
    near(r.cutouts![0].points[1], 40, 2.5);
    near(r.handles![0]!.out, 4, 0);
  });
  it('keeps a box in proportion when Ctrl+dragging a corner', () => {
    near(aspectCorner({ x: 0, y: 0 }, { x: 40, y: 20 }, { x: 80, y: 0 }), 64, 32);
    near(aspectCorner({ x: 0, y: 0 }, { x: 40, y: 20 }, { x: 80, y: 40 }), 80, 40);
    near(aspectCorner({ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 10, y: 10 }), 10, 10); // a flat box is left alone
  });
});
