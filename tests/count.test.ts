import { describe, expect, it } from 'vitest';
import { countRadius, countStyleName, countSymbolPolygon, countSymbolStrokes, mergeCounts, nearestCountIndex, splitAll, splitCount, symbolForType, symbolOfCountStyle } from '../src/model/count';

const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }, { x: 30, y: 0 }];

describe('Count groups', () => {
  it('splits selected items off, refuses to empty the group, and splits all', () => {
    expect(splitCount(pts, [1, 3])).toEqual({ keep: [pts[0], pts[2]], split: [pts[1], pts[3]] });
    expect(splitCount(pts, [0, 1, 2, 3])).toBeNull();
    expect(splitCount(pts, [9])).toBeNull();
    expect(splitAll(pts)).toHaveLength(4);
  });
  it('merges counts into the target and finds the nearest item', () => {
    expect(mergeCounts({ points: [pts[0]] }, [{ points: [pts[1], pts[2]] }, { points: [] }])).toEqual([pts[0], pts[1], pts[2]]);
    expect(nearestCountIndex({ points: pts }, { x: 21, y: 1 }, 3)).toBe(2);
    expect(nearestCountIndex({ points: pts }, { x: 50, y: 0 }, 3)).toBe(-1);
  });
  it('draws symbols at the scaled radius', () => {
    expect(countRadius(undefined)).toBe(5);
    expect(countRadius(2)).toBe(10);
    expect(countSymbolPolygon('square', { x: 0, y: 0 }, 5)).toEqual([{ x: -5, y: -5 }, { x: 5, y: -5 }, { x: 5, y: 5 }, { x: -5, y: 5 }]);
    expect(countSymbolPolygon('star', { x: 0, y: 0 }, 5)).toHaveLength(10);
    expect(countSymbolPolygon('circle', { x: 0, y: 0 }, 5)).toBeNull();
    expect(countSymbolStrokes('x', { x: 0, y: 0 }, 5)).toHaveLength(2);
    expect(countSymbolStrokes('square', { x: 0, y: 0 }, 5)).toHaveLength(0);
  });
  it('maps symbols to Revu CountStyle names and tool types', () => {
    expect(countStyleName('circle')).toBe('Circle');
    expect(countStyleName('x')).toBe('X');
    expect(symbolOfCountStyle('Triangle')).toBe('triangle');
    expect(symbolOfCountStyle('Bogus')).toBeUndefined();
    expect(symbolForType('rectangle')).toBe('square');
    expect(symbolForType('textbox')).toBe('circle');
  });
});
