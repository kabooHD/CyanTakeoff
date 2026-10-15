import { describe, expect, it } from 'vitest';
import { bandOf, inBand } from '../src/model/select';
import { captionLeaderLine } from '../src/model/measureDisplay';
import type { Markup } from '../src/model/types';

describe('band selection', () => {
  const mb = { minX: 10, minY: 10, maxX: 20, maxY: 20 };
  it('left to right picks markups entirely inside, right to left those touched', () => {
    const inside = bandOf({ x: 0, y: 0 }, { x: 30, y: 30 });
    expect(inside.touch).toBe(false);
    expect(inBand(mb, inside.box, inside.touch)).toBe(true);
    const partial = bandOf({ x: 0, y: 0 }, { x: 15, y: 30 });
    expect(inBand(mb, partial.box, partial.touch)).toBe(false);
    const touch = bandOf({ x: 15, y: 30 }, { x: 0, y: 0 });
    expect(touch.touch).toBe(true);
    expect(touch.box).toEqual({ minX: 0, minY: 0, maxX: 15, maxY: 30 });
    expect(inBand(mb, touch.box, touch.touch)).toBe(true);
    expect(inBand(mb, { minX: 0, minY: 0, maxX: 5, maxY: 5 }, true)).toBe(false);
  });
});

describe('caption leader line', () => {
  const style = { color: '#ff0000', fill: null, opacity: 1, fillOpacity: 1, width: 1, lineStyle: 'solid' as const, fontSize: 10 };
  const len = (display?: Markup['display'], type: Markup['type'] = 'length'): Markup => ({
    id: 'l', type, page: 0, points: [{ x: 0, y: 100 }, { x: 100, y: 100 }], style, subject: '', label: '', comment: '', author: '', created: '', modified: '', status: 'None', display,
  });
  it('joins a moved Length caption to the line, unless hidden; other captions have none', () => {
    expect(captionLeaderLine(len(), len().points)).toBeNull();
    const moved = len({ captionOffset: { x: 30, y: -40 } });
    const l = captionLeaderLine(moved, moved.points)!;
    expect(l).not.toBeNull();
    expect(l.from).toEqual({ x: 50, y: 100 });
    expect(l.to.x).toBeCloseTo(80, 6);
    expect(captionLeaderLine(len({ captionOffset: { x: 30, y: -40 }, captionLeader: false }), moved.points)).toBeNull();
    expect(captionLeaderLine(len({ captionOffset: { x: 30, y: -40 } }, 'area'), moved.points)).toBeNull();
  });
});
