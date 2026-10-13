import { describe, expect, it } from 'vitest';
import type { Pt } from '../src/model/types';
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
    expect(measure({ type: 'perimeter', points: [...square, square[0]], scale })!.length).toBeCloseTo(40);
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

describe('scale dialog helpers', async () => {
  const { customScale, parsePageRange, withPrecision } = await import('../src/model/measure');
  it('custom scale: 1 in = 10 ft', () => {
    const s = customScale(1, 'in', 10, 'ft');
    expect(s.factor * 72).toBeCloseTo(10);
    expect(s.label).toBe('1 in = 10 ft');
  });
  it('custom scale mixing systems: 10 mm = 1 m', () => {
    expect(customScale(10, 'mm', 1, 'm').factor * (72 / 25.4) * 10).toBeCloseTo(1);
  });
  it('page ranges', () => {
    expect(parsePageRange('1-3, 5, 9', 6)).toEqual([0, 1, 2, 4]);
    expect(parsePageRange('3-1', 5)).toEqual([0, 1, 2]);
  });
  it('precision controls rounding', () => {
    const s = withPrecision({ factor: 1 / 72, unit: 'ft-in', label: '' }, 16);
    expect(formatLength(10 + 3.0625 / 12, s.unit, 2, s.format!.den)).toBe(`10'-3 1/16"`);
  });
});

describe('cutouts', async () => {
  const { netArea } = await import('../src/model/measure');
  const sq = (x: number, y: number, w: number) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + w }, { x, y: y + w }];
  it('polygon cutout subtracts its area', () => {
    expect(netArea({ points: sq(0, 0, 100), cutouts: [{ kind: 'polygon', points: sq(10, 10, 20) }] })).toBeCloseTo(10000 - 400);
  });
  it('ellipse cutout subtracts pi*a*b', () => {
    expect(netArea({ points: sq(0, 0, 100), cutouts: [{ kind: 'ellipse', points: [{ x: 10, y: 10 }, { x: 50, y: 30 }] }] }))
      .toBeCloseTo(10000 - Math.PI * 20 * 10);
  });
  it('area measurement uses net area', () => {
    const scale = { factor: 1 / 72, unit: 'ft' as const, label: '' };
    const m = measure({ type: 'area', points: sq(0, 0, 720), scale, cutouts: [{ kind: 'polygon', points: sq(0, 0, 360) }] });
    expect(m!.area).toBeCloseTo(75);
  });
});

describe('viewports', async () => {
  const { scaleAt, viewportAt, customScale } = await import('../src/model/measure');
  const page = customScale(0.25, 'in', 1, 'ft-in');
  const detail = customScale(1, 'in', 1, 'ft-in');
  const vps = [
    { id: 'a', name: 'A', rect: [{ x: 100, y: 100 }, { x: 0, y: 0 }] as [Pt, Pt], scale: detail },
    { id: 'b', name: 'B', rect: [{ x: 50, y: 50 }, { x: 200, y: 200 }] as [Pt, Pt], scale: page },
  ];
  it('uses the viewport containing the first point, else the page scale', () => {
    expect(scaleAt(page, vps, { x: 10, y: 10 })).toBe(detail);
    expect(scaleAt(page, vps, { x: 300, y: 300 })).toBe(page);
    expect(scaleAt(null, vps, { x: 300, y: 300 })).toBeNull();
    expect(scaleAt(null, vps, { x: 10, y: 10 })).toBe(detail);
  });
  it('the later viewport wins where they overlap (PDF /VP order)', () => {
    expect(viewportAt(vps, { x: 75, y: 75 })?.id).toBe('b');
  });
});

describe('separate X/Y scales', async () => {
  const { withYScale, stripY, yOf, customScale } = await import('../src/model/measure');
  const x = customScale(1, 'in', 10, 'ft'); // 1 in = 10 ft
  const y = customScale(1, 'in', 20, 'ft'); // 1 in = 20 ft
  const s = withYScale(x, y);
  it('keeps both factors and labels', () => {
    expect(s.yFactor).toBeCloseTo(20 / 72, 9);
    expect(s.label).toBe('X 1 in = 10 ft, Y 1 in = 20 ft');
    expect(stripY(s).label).toBe('1 in = 10 ft');
    expect(yOf(s).factor).toBeCloseTo(20 / 72, 9);
  });
  it('converts a Y scale in other units', () => {
    const ym = customScale(1, 'in', 3.048, 'm'); // 10 ft
    expect(withYScale(x, ym).yFactor).toBeUndefined(); // same as X -> no separate Y
  });
  it('measures lengths and areas along each axis', () => {
    const h = measure({ type: 'length', points: [{ x: 0, y: 0 }, { x: 72, y: 0 }], scale: s })!;
    const v = measure({ type: 'length', points: [{ x: 0, y: 0 }, { x: 0, y: 72 }], scale: s })!;
    expect(h.length).toBeCloseTo(10, 6);
    expect(v.length).toBeCloseTo(20, 6);
    const a = measure({ type: 'area', points: [{ x: 0, y: 0 }, { x: 72, y: 0 }, { x: 72, y: 72 }, { x: 0, y: 72 }], scale: s })!;
    expect(a.area).toBeCloseTo(200, 6);
  });
});

describe('cutout rules (Revu)', async () => {
  const { applyCutout } = await import('../src/model/cutouts');
  const sq = (x: number, y: number, w: number, h = w): Pt[] => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
  const area = { points: sq(0, 0, 100) };
  it('fuses overlapping polygon cutouts into one', () => {
    const a = applyCutout(area, { kind: 'polygon', points: sq(10, 10, 20) });
    if ('error' in a) throw new Error(a.error);
    const b = applyCutout(a, { kind: 'polygon', points: sq(20, 20, 20) });
    if ('error' in b) throw new Error(b.error);
    expect(b.cutouts).toHaveLength(1);
    expect(polygonArea(b.cutouts[0].points)).toBeCloseTo(400 + 400 - 100, 6);
  });
  it('a polygon cutout across the edge trims the markup instead', () => {
    const r = applyCutout(area, { kind: 'polygon', points: sq(80, 40, 40, 20) });
    if ('error' in r) throw new Error(r.error);
    expect(r.cutouts).toHaveLength(0);
    expect(polygonArea(r.points)).toBeCloseTo(10000 - 20 * 20, 6);
  });
  it('rejects ellipse cutouts that overlap the edge or another cutout', () => {
    expect('error' in applyCutout(area, { kind: 'ellipse', points: [{ x: 90, y: 40 }, { x: 110, y: 60 }] })).toBe(true);
    const a = applyCutout(area, { kind: 'polygon', points: sq(10, 10, 20) });
    if ('error' in a) throw new Error(a.error);
    expect('error' in applyCutout(a, { kind: 'ellipse', points: [{ x: 25, y: 25 }, { x: 45, y: 45 }] })).toBe(true);
    const ok = applyCutout(a, { kind: 'ellipse', points: [{ x: 50, y: 50 }, { x: 70, y: 70 }] });
    expect('cutouts' in ok && ok.cutouts.length).toBe(2);
  });
});

describe('slope, rise/drop and wall area (Revu measurement properties)', async () => {
  const { slopeFactor } = await import('../src/model/measure');
  const scale = { factor: 1 / 72, unit: 'ft' as const, label: '1" = 1\'' };
  const sq = [{ x: 0, y: 0 }, { x: 720, y: 0 }, { x: 720, y: 720 }, { x: 0, y: 720 }]; // 10 x 10 ft
  it('slope factors for pitch, degree and grade', () => {
    expect(slopeFactor({ unit: 'pitch', value: 12 })).toBeCloseTo(Math.SQRT2, 9);
    expect(slopeFactor({ unit: 'degree', value: 45 })).toBeCloseTo(Math.SQRT2, 9);
    expect(slopeFactor({ unit: 'grade', value: 100 })).toBeCloseTo(Math.SQRT2, 9);
    expect(slopeFactor(undefined)).toBe(1);
  });
  it('a 6/12 roof increases area by sqrt(1 + 0.25)', () => {
    expect(measure({ type: 'area', points: sq, scale, slope: { unit: 'pitch', value: 6 } })!.area).toBeCloseTo(100 * Math.sqrt(1.25), 6);
  });
  it('rise/drop adds to length; depth gives wall area', () => {
    const line = [{ x: 0, y: 0 }, { x: 720, y: 0 }];
    expect(measure({ type: 'polylength', points: line, scale, rise: 2.5 })!.length).toBeCloseTo(12.5, 9);
    const wall = measure({ type: 'length', points: line, scale, depth: 9 })!;
    expect(wall.length).toBeCloseTo(10, 9);
    expect(wall.area).toBeCloseTo(90, 9);
  });
});
