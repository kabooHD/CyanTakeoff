import { describe, expect, it } from 'vitest';
import { cloudArcLength, cloudSegments } from '../src/model/measure';

const square = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];

describe('cloud arcs', () => {
  it('scale the arc length with the line width and the Cloud Size', () => {
    expect(cloudArcLength(1)).toBe(14);
    expect(cloudArcLength(3)).toBe(24);
    expect(cloudArcLength(1, 2)).toBe(28);
    expect(cloudArcLength(1, 0)).toBe(14); // 0 means default
    expect(cloudArcLength(1, 99)).toBe(56); // clamped to 4x
  });
  it('bulge outward by default and inward when inverted; a bigger size makes fewer arcs', () => {
    const out = cloudSegments(square, 25);
    const inv = cloudSegments(square, 25, true);
    expect(out.length).toBe(16);
    expect(cloudSegments(square, 50).length).toBe(8);
    // Top edge runs left to right (clockwise on screen): the outward bulge is above (y < 0), inverted below.
    expect(out[0][1].y).toBeLessThan(0);
    expect(inv[0][1].y).toBeGreaterThan(0);
    expect(out[0][0]).toEqual(inv[0][0]);
  });
});
