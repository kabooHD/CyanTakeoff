import { describe, expect, it } from 'vitest';
import { layoutOf, withLayout } from '../src/model/layoutProps';
import type { Markup } from '../src/model/types';

const m = { id: 'a', type: 'rectangle', page: 0, points: [{ x: 72, y: 72 }, { x: 216, y: 144 }], style: {} as Markup['style'], subject: '', label: '', comment: '', author: '', created: '', modified: '', status: 'None' } as Markup;

describe('Properties Layout', () => {
  it('reads X/Y from the lower left in inches', () => {
    expect(layoutOf(m.points, 792)).toEqual({ x: 1, y: 9, width: 2, height: 1 });
  });
  it('moves and resizes the markup to new values', () => {
    expect(withLayout(m, 792, { x: 2 }).points).toEqual([{ x: 144, y: 72 }, { x: 288, y: 144 }]);
    expect(withLayout(m, 792, { y: 8 }).points).toEqual([{ x: 72, y: 144 }, { x: 216, y: 216 }]);
    const wider = withLayout(m, 792, { width: 4 });
    expect(layoutOf(wider.points, 792)).toEqual({ x: 1, y: 9, width: 4, height: 1 });
    const taller = withLayout(m, 792, { height: 2 });
    expect(layoutOf(taller.points, 792)).toEqual({ x: 1, y: 9, width: 2, height: 2 });
  });
});
