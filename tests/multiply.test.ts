import { describe, expect, it } from 'vitest';
import { multiplyMarkups, multiplyOffsets } from '../src/model/multiply';
import type { Markup } from '../src/model/types';

const m: Markup = { id: 'a', type: 'rectangle', page: 0, points: [{ x: 100, y: 100 }, { x: 150, y: 140 }], style: { color: '#f00', width: 1, opacity: 1 } as Markup['style'], subject: 'Rectangle', label: '', comment: '', author: 'me', created: '', modified: '', status: 'None' };

describe('Multiply', () => {
  it('offsets copies in a cardinal direction (y down)', () => {
    expect(multiplyOffsets('right', 10, 3)).toEqual([{ dx: 10, dy: 0 }, { dx: 20, dy: 0 }, { dx: 30, dy: 0 }]);
    expect(multiplyOffsets('up', 5, 1)).toEqual([{ dx: 0, dy: -5 }]);
    expect(multiplyOffsets('down', 5, 0)).toEqual([]);
  });
  it('makes independent copies and stops at the sheet edge', () => {
    let k = 0;
    const copies = multiplyMarkups([m], 'right', 100, 10, 400, 300, 'T', () => `c${++k}`);
    // Original spans x 100..150; copies at +100, +200 fit in 400; +300 would end at 450.
    expect(copies.map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(copies[1].points[0]).toEqual({ x: 300, y: 100 });
    expect(copies[0].created).toBe('T');
    expect(multiplyMarkups([m], 'up', 50, 5, 400, 300, 'T').length).toBe(2); // y 100 -> 50 -> 0 fits, -50 does not
  });
});
