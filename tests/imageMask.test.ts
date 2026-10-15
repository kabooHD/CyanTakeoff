import { describe, expect, it } from 'vitest';
import { applyMask, withinMask } from '../src/model/imageMask';

describe('image mask colour', () => {
  it('matches pixels within the tolerance of the mask colour', () => {
    expect(withinMask(255, 255, 255, [255, 255, 255], 0)).toBe(true);
    expect(withinMask(250, 250, 250, [255, 255, 255], 0)).toBe(false);
    expect(withinMask(250, 250, 250, [255, 255, 255], 5)).toBe(true);
    expect(withinMask(0, 0, 0, [255, 255, 255], 99)).toBe(false);
    expect(withinMask(0, 0, 0, [255, 255, 255], 100)).toBe(true);
  });
  it('makes the matching pixels transparent and leaves the rest', () => {
    const px = new Uint8ClampedArray([255, 255, 255, 255, 10, 20, 30, 255, 254, 254, 254, 255, 255, 255, 255, 0]);
    const n = applyMask(px, { color: '#ffffff', tolerance: 2 });
    expect(n).toBe(2); // the already transparent white pixel is not counted
    expect([px[3], px[7], px[11], px[15]]).toEqual([0, 255, 0, 0]);
    expect(applyMask(px, { color: 'bad', tolerance: 0 })).toBe(0); // a bad colour masks pure white only, already done
  });
});
