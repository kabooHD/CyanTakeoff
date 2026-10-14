import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFS, rgbaOf, wheelZoomFactor, withDefaults } from '../src/model/prefs';

describe('preferences', () => {
  it('fills defaults into an older saved object', () => {
    expect(withDefaults(undefined)).toEqual(DEFAULT_PREFS);
    expect(withDefaults({ wheelSensitivity: 9 }).wheelSensitivity).toBe(9);
    expect(withDefaults({ wheelSensitivity: 9 }).snapshotDpi).toBe(216);
  });
  it('wheel: zoom or scroll by view mode, Ctrl forces zoom, Shift forces scroll, reverse and sensitivity apply', () => {
    const p = { ...DEFAULT_PREFS };
    const ev = { deltaY: 100, ctrlKey: false, shiftKey: false };
    expect(wheelZoomFactor(p, false, ev)).toBeCloseTo(Math.exp(-0.15), 6);
    expect(wheelZoomFactor(p, false, { ...ev, shiftKey: true })).toBeNull();
    expect(wheelZoomFactor({ ...p, wheelSingle: 'scroll' }, false, ev)).toBeNull();
    expect(wheelZoomFactor({ ...p, wheelSingle: 'scroll' }, true, ev)).not.toBeNull(); // continuous mode still zooms
    expect(wheelZoomFactor({ ...p, wheelContinuous: 'scroll' }, true, { ...ev, ctrlKey: true })).not.toBeNull();
    expect(wheelZoomFactor({ ...p, reverseWheel: true }, false, ev)).toBeCloseTo(Math.exp(0.15), 6);
    expect(wheelZoomFactor({ ...p, wheelSensitivity: 10 }, false, ev)).toBeCloseTo(Math.exp(-0.3), 6);
    expect(wheelZoomFactor({ ...p, wheelSensitivity: 99 }, false, ev)).toBeCloseTo(Math.exp(-0.3), 6); // clamped
  });
  it('turns a hex colour and opacity into rgba', () => {
    expect(rgbaOf('#ff8000', 50)).toBe('rgba(255, 128, 0, 0.5)');
    expect(rgbaOf('bad', 120)).toBe('rgba(204, 224, 255, 1)');
  });
});
