import { describe, expect, it } from 'vitest';
import {
  SCALE_PRESETS, calibrate, cloudSegments, formatLength, measure, polygonArea,
} from '../src/model/measure';

const preset = (label: string) =>
  SCALE_PRESETS.flatMap((g) => g.items).find((p) => p.label === label)!;

describe('formatLength', () => {
  it('formats feet-inches with reduced fractions', () => {
    expect(formatLength(12.5, 'ft-in')).toBe(`12'-6"`);
    expect(formatLength(10 + 3.25 / 12, 'ft-in')).toBe(`10'-3 1/4"`);
    expect(formatLength(0.999999, 'ft-in')).toBe(`1'-0"`);
  });
  it('formats decimals', () => {
    expect(formatLength(3.14159, 'm')).toBe('3.14 m');
  });
});

describe('scales', () => {
  it('1/8" = 1\'-0": one paper inch is 8 feet', () => {
    const s = preset(`1/8" = 1'-0"`);
    expect(72 * s.factor).toBeCloseTo(8, 10);
  });
  it('1:100 metric: 10 mm on paper is 1 m', () => {
    const s = preset('1:100');
    expect((72 / 25.4) * 10 * s.factor).toBeCloseTo(1, 10);
  });
  it('calibrate from a known dimension', () => {
    const s = calibrate(144, 20, 'ft'); // 2 paper inches = 20 ft
    expect(s.factor * 72).toBeCloseTo(10, 10);
    expect(s.label).toBe(`1" = 10'-0"`);
  });
});

describe('measure', () => {
  const scale = { factor: 1 / 72, unit: 'ft' as const, label: '' }; // 1 in = 1 ft
  const square = [
    { x: 0, y: 0 }, { x: 720, y: 0 }, { x: 720, y: 720 }, { x: 0, y: 720 },
  ];
  it('length', () => {
    const m = measure({ type: 'length', points: [{ x: 0, y: 0 }, { x: 0, y: 720 }], scale });
    expect(m!.length).toBeCloseTo(10);
  });
  it('area and perimeter', () => {
    expect(measure({ type: 'area', points: square, scale })!.area).toBeCloseTo(100);
    expect(measure({ type: 'perimeter', points: square, scale })!.length).toBeCloseTo(40);
  });
  it('volume uses depth', () => {
    expect(measure({ type: 'volume', points: square, scale, depth: 0.5 })!.volume).toBeCloseTo(50);
  });
  it('count', () => {
    expect(measure({ type: 'count', points: square, scale })!.text).toBe('4');
  });
  it('area is winding-independent', () => {
    expect(polygonArea([...square].reverse())).toBe(polygonArea(square));
  });
});

describe('cloudSegments', () => {
  it('scallops bulge outward for both windings', () => {
    const sq = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
    for (const poly of [sq, [...sq].reverse()]) {
      const segs = cloudSegments(poly, 20);
      expect(segs.length).toBe(20);
      for (const [, c1] of segs) {
        const inside = c1.x > 0 && c1.x < 100 && c1.y > 0 && c1.y < 100;
        expect(inside).toBe(false);
      }
    }
  });
});
