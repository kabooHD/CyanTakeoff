import { describe, expect, it } from 'vitest';
import { applyToolProperties, scaledPoints, toolScaleFactor } from '../src/model/toolScale';
import type { Markup } from '../src/model/types';

describe('Tool Chest scale and properties', () => {
  it('keeps a tool its real size across page scales', () => {
    // Tool saved on a 1/4" = 1' sheet (48 units per... 1 ft per 18 pt), placed on a 1/8" sheet (1 ft per 9 pt): half the points.
    expect(toolScaleFactor({ factor: 1 / 18, unit: 'ft', label: '' }, { factor: 1 / 9, unit: 'ft', label: '' })).toBeCloseTo(0.5);
    expect(toolScaleFactor(undefined, { factor: 1, unit: 'ft', label: '' })).toBe(1);
    expect(scaledPoints([{ x: 0, y: 0 }, { x: 100, y: 50 }], 0.5)).toEqual([{ x: 25, y: 12.5 }, { x: 75, y: 37.5 }]);
  });
  it('applies appearance and, per Comment Persistence, the comment', () => {
    const m = { type: 'rectangle', style: { color: '#000', width: 1, opacity: 1 }, comment: 'old' } as unknown as Markup;
    const t = { style: { color: '#f00', width: 2, opacity: 1 } as Markup['style'], subject: 'Wall', markup: { comment: 'Fire rated' } };
    expect(applyToolProperties(m, t, 'none')).toEqual({ style: { color: '#f00', width: 2, opacity: 1 } });
    expect(applyToolProperties(m, t, 'excludeText').comment).toBe('Fire rated');
    expect(applyToolProperties({ ...m, type: 'textbox' } as Markup, t, 'excludeText').comment).toBeUndefined();
    expect(applyToolProperties({ ...m, type: 'textbox' } as Markup, t, 'all').comment).toBe('Fire rated');
  });
});
