import { describe, expect, it } from 'vitest';
import { GAP, layoutPages, rotateIn, rotateOut, rotatedSize, shownPages, slotAt, type ViewRotation } from '../src/model/layout';

const sizes = [{ w: 100, h: 200 }, { w: 100, h: 200 }, { w: 300, h: 100 }];
const view = { w: 50, h: 50 };

describe('view modes', () => {
  it('shows the right pages', () => {
    expect(shownPages('single', 5, 3)).toEqual([3]);
    expect(shownPages('side', 5, 3)).toEqual([2, 3]);
    expect(shownPages('side', 5, 4)).toEqual([4]);
    expect(shownPages('continuous', 3, 1)).toEqual([0, 1, 2]);
  });

  it('stacks pages in continuous mode', () => {
    const { slots, innerW, innerH } = layoutPages(sizes, 'continuous', 0, 10, view);
    expect(innerW).toBe(320);
    expect(innerH).toBe(200 + 200 + 100 + GAP * 2 + 20);
    expect(slots[1].y).toBe(10 + 200 + GAP);
    expect(slots[0].x).toBe(110); // centred in the widest row
    expect(slots[2].x).toBe(10);
  });

  it('pairs pages side by side', () => {
    const { slots } = layoutPages(sizes, 'continuous-side', 0, 10, view);
    expect(slots.map((s) => s.index)).toEqual([0, 1, 2]);
    expect(slots[1].x - slots[0].x).toBe(100 + GAP);
    expect(slots[0].y).toBe(slots[1].y);
    expect(slots[2].y).toBe(10 + 200 + GAP);
  });

  it('finds the page under a point', () => {
    const { slots } = layoutPages(sizes, 'continuous', 0, 10, view);
    expect(slotAt(slots, 150, 300)?.index).toBe(1);
    expect(slotAt(slots, 5, 5)?.index).toBe(0); // margin: nearest page
  });
});

describe('rotate view', () => {
  it('round-trips points for every rotation', () => {
    for (const r of [0, 90, 180, 270] as ViewRotation[]) {
      const o = rotateOut(30, 10, 100, 50, r);
      const box = rotatedSize(100, 50, r);
      expect(o.x).toBeGreaterThanOrEqual(0); expect(o.x).toBeLessThanOrEqual(box.w);
      expect(o.y).toBeGreaterThanOrEqual(0); expect(o.y).toBeLessThanOrEqual(box.h);
      expect(rotateIn(o.x, o.y, 100, 50, r)).toEqual({ x: 30, y: 10 });
    }
  });

  it('turns the page clockwise', () => {
    // The page's top-left corner ends up top-right after 90 degrees clockwise.
    expect(rotateOut(0, 0, 100, 50, 90)).toEqual({ x: 50, y: 0 });
    expect(rotateOut(0, 0, 100, 50, 270)).toEqual({ x: 0, y: 100 });
  });
});
