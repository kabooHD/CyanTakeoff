import { describe, expect, it } from 'vitest';
import { blendOf, blendOfName, cssBlend, defaultBlend } from '../src/model/blend';

const style = { color: '#ff0000', fill: null, opacity: 1, fillOpacity: 1, width: 1, lineStyle: 'solid' as const, fontSize: 10 };

describe('blend modes', () => {
  it('defaults: highlights multiply, stamps darken, the rest is normal', () => {
    expect(defaultBlend('highlight')).toBe('Multiply');
    expect(defaultBlend('stamp')).toBe('Darken');
    expect(defaultBlend('rectangle')).toBe('Normal');
    expect(blendOf({ type: 'stamp', style })).toBe('Darken');
    expect(blendOf({ type: 'stamp', style: { ...style, blend: 'Normal' } })).toBe('Normal');
  });
  it('maps PDF names to CSS keywords and back', () => {
    expect(cssBlend('Multiply')).toBe('multiply');
    expect(cssBlend('ColorDodge')).toBe('color-dodge');
    expect(cssBlend('HardLight')).toBe('hard-light');
    expect(cssBlend('Normal')).toBe('normal');
    expect(blendOfName('Screen')).toBe('Screen');
    expect(blendOfName('Compatible')).toBe('Normal');
    expect(blendOfName('Bogus')).toBeUndefined();
    expect(blendOfName(undefined)).toBeUndefined();
  });
});
