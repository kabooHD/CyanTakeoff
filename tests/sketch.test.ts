import { describe, expect, it } from 'vitest';
import { nextPoint, parseLengthInput, sketchEllipse, sketchPt, sketchRectangle } from '../src/model/sketch';
import type { Scale } from '../src/model/types';

const ftScale: Scale = { factor: 1 / 18, unit: 'ft-in', label: '' }; // 18 pt per foot

describe('Sketch to Scale', () => {
  it('parses lengths: numbers, feet-inches, fractions', () => {
    expect(parseLengthInput('12.5', 'm')).toBe(12.5);
    expect(parseLengthInput("12'6\"", 'ft-in')).toBe(12.5);
    expect(parseLengthInput("3' 4 1/2\"", 'ft')).toBeCloseTo(3.375);
    expect(parseLengthInput('10-6', 'ft-in')).toBe(10.5);
    expect(parseLengthInput("12'", 'ft')).toBe(12);
    expect(parseLengthInput('abc', 'm')).toBeNull();
    expect(parseLengthInput('', 'm')).toBeNull();
  });
  it('converts to page points with the scale, or inches without one', () => {
    expect(sketchPt(10, ftScale)).toBeCloseTo(180);
    expect(sketchPt(2, null)).toBe(144);
    expect(sketchPt(10, { ...ftScale, yFactor: 1 / 36 }, true)).toBeCloseTo(360);
  });
  it('angles go counter-clockwise from the x axis (page y is down)', () => {
    expect(nextPoint({ x: 0, y: 0 }, 10, 0)).toEqual({ x: 10, y: 0 });
    const up = nextPoint({ x: 0, y: 0 }, 10, 90);
    expect(up.x).toBeCloseTo(0); expect(up.y).toBeCloseTo(-10);
  });
  it('rectangle from its top-left corner, optionally turned about it', () => {
    expect(sketchRectangle({ x: 10, y: 10 }, 100, 50)).toEqual([{ x: 10, y: 10 }, { x: 110, y: 10 }, { x: 110, y: 60 }, { x: 10, y: 60 }]);
    const r = sketchRectangle({ x: 10, y: 10 }, 100, 50, 90);
    expect(r[0]).toEqual({ x: 10, y: 10 });
    expect(r[1].x).toBeCloseTo(10); expect(r[1].y).toBeCloseTo(-90);
  });
  it('ellipse outline fits its box', () => {
    const e = sketchEllipse({ x: 0, y: 0 }, 100, 50);
    expect(Math.max(...e.map((p) => p.x))).toBeCloseTo(100); expect(Math.min(...e.map((p) => p.y))).toBeCloseTo(0);
    expect(Math.max(...e.map((p) => p.y))).toBeCloseTo(50);
  });
});
