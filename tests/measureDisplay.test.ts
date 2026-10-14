import { describe, expect, it } from 'vitest';
import { captionText, convertLength, displayText, segmentValues } from '../src/model/measureDisplay';
import type { Markup } from '../src/model/types';

const scale = { factor: 1 / 18, unit: 'ft' as const, label: '1/4" = 1\'' }; // 18 pt per foot
const base = { id: 'a', page: 0, style: { color: '#000', width: 1, opacity: 1, fontSize: 10 } as Markup['style'], subject: '', label: '', comment: '', author: '', created: '', modified: '', status: 'None' as const, scale };

describe('measurement display', () => {
  it('converts lengths, areas and volumes between units', () => {
    expect(convertLength(1, 'ft', 'in')).toBe(12);
    expect(convertLength(1, 'm', 'mm')).toBeCloseTo(1000);
    expect(convertLength(1, 'ft', 'in', 2)).toBe(144);
    expect(convertLength(1, 'yd', 'ft', 3)).toBeCloseTo(27);
  });
  it('shows the value in the markup\'s own unit and honours the caption mode', () => {
    const m: Markup = { ...base, type: 'length', points: [{ x: 0, y: 0 }, { x: 180, y: 0 }] }; // 10 ft
    expect(displayText(m)).toMatch(/10/);
    expect(displayText({ ...m, display: { lengthUnit: 'in' } })).toMatch(/^120/);
    expect(displayText({ ...m, display: { lengthUnit: 'm' } })).toMatch(/^3\.05/);
    expect(captionText({ ...m, display: { caption: 'none' } })).toBeNull();
    expect(captionText({ ...m, label: 'Wall', display: { caption: 'label' } })).toBe('Wall');
    expect(captionText({ ...m, label: 'Wall', display: { caption: 'both' } })).toMatch(/^Wall: /);
    const a: Markup = { ...base, type: 'area', points: [{ x: 0, y: 0 }, { x: 180, y: 0 }, { x: 180, y: 180 }, { x: 0, y: 180 }] }; // 100 sq ft
    expect(displayText({ ...a, display: { areaUnit: 'yd' } })).toMatch(/^11\.11/);
  });
  it('gives one value per segment, placed to the chosen side', () => {
    const sq: Markup = { ...base, type: 'area', points: [{ x: 0, y: 0 }, { x: 180, y: 0 }, { x: 180, y: 180 }, { x: 0, y: 180 }], display: { segments: true } };
    const c = segmentValues(sq);
    expect(c).toHaveLength(4);
    expect(c[0].at).toEqual({ x: 90, y: 0 });
    expect(c[0].text).toMatch(/10/);
    const inside = segmentValues({ ...sq, display: { segments: true, segmentAlign: 'inside' } });
    expect(inside[0].at.y).toBeGreaterThan(0); // below the top edge: inside the square
    const outside = segmentValues({ ...sq, display: { segments: true, segmentAlign: 'outside' } });
    expect(outside[0].at.y).toBeLessThan(0);
    const pl: Markup = { ...base, type: 'polylength', points: [{ x: 0, y: 0 }, { x: 90, y: 0 }, { x: 90, y: 90 }], display: { segments: true } };
    expect(segmentValues(pl)).toHaveLength(2);
  });
});
