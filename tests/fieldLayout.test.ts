import { describe, expect, it } from 'vitest';
import { alignRects, moved, tabOrderIndexes, type Rect } from '../src/model/fieldLayout';

const page = { width: 612, height: 792 };
const a: Rect = [100, 700, 200, 720], b: Rect = [150, 600, 300, 640], c: Rect = [400, 500, 440, 510];

describe('form field alignment', () => {
  it('aligns edges, centres and sizes to the first field', () => {
    expect(alignRects([a, b], 'left', page)[1]).toEqual([100, 600, 250, 640]);
    expect(alignRects([a, b], 'right', page)[1]).toEqual([50, 600, 200, 640]);
    expect(alignRects([a, b], 'top', page)[1]).toEqual([150, 680, 300, 720]);
    expect(alignRects([a, b], 'bottom', page)[1]).toEqual([150, 700, 300, 740]);
    expect(alignRects([a, b], 'center', page)[1]).toEqual([75, 600, 225, 640]);
    expect(alignRects([a, b], 'middle', page)[1]).toEqual([150, 690, 300, 730]);
    expect(alignRects([a, b], 'width', page)[1]).toEqual([150, 600, 250, 640]);
    expect(alignRects([a, b], 'height', page)[1]).toEqual([150, 620, 300, 640]);
    expect(alignRects([a, b], 'size', page)[1]).toEqual([150, 620, 250, 640]);
    expect(alignRects([a, b], 'left', page)[0]).toEqual(a);
  });
  it('centres the selection in the document and distributes evenly', () => {
    const [ca] = alignRects([a], 'centerDoc', page);
    expect((ca[0] + ca[2]) / 2).toBe(306);
    expect((ca[1] + ca[3]) / 2).toBe(396);
    const dh = alignRects([a, c, b], 'distributeH', page);
    expect(dh[0][0]).toBe(100); // leftmost stays
    expect(dh[2][0]).toBeCloseTo(100 + 100 + (340 - 290) / 2, 6); // b after a, with equal gaps
    expect(dh[1][2]).toBe(440); // rightmost stays
    expect(alignRects([a, b], 'distributeH', page)).toEqual([a, b]);
    const dv = alignRects([a, b, c], 'distributeV', page);
    expect(dv[0][3]).toBe(720);
    expect(dv[2][1]).toBe(500);
  });
  it('orders tabs by row or column and moves list items', () => {
    const rects: Rect[] = [[300, 700, 350, 720], [100, 702, 150, 722], [100, 600, 150, 620], [300, 601, 350, 621]];
    expect(tabOrderIndexes(rects, 'R')).toEqual([1, 0, 2, 3]);
    expect(tabOrderIndexes(rects, 'C')).toEqual([1, 2, 0, 3]);
    expect(moved(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
    expect(moved(['a', 'b', 'c'], 0, 5)).toEqual(['a', 'b', 'c']);
  });
});
