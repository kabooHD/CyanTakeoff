import { describe, expect, it } from 'vitest';
import { estimateSkew, rotationAbout } from '../src/model/deskew';

/** Lines of "text" (dashes) tilted by `deg`, y down. */
function page(deg: number, w = 600, h = 400) {
  const img = new Uint8Array(w * h);
  const t = Math.tan((deg * Math.PI) / 180);
  for (let row = 40; row < h - 40; row += 24) {
    for (let x = 30; x < w - 30; x++) {
      if (x % 9 > 6) continue; // gaps between "letters"
      for (let th = 0; th < 3; th++) {
        const y = Math.round(row + th + (x - w / 2) * t);
        if (y >= 0 && y < h) img[y * w + x] = 1;
      }
    }
  }
  return img;
}

describe('deskew', () => {
  for (const deg of [0, 1.5, -2.3, 4]) {
    it(`finds a ${deg}° tilt`, () => expect(Math.abs(estimateSkew(page(deg), 600, 400) - deg)).toBeLessThan(0.15));
  }
  it('is within 0.1° on a gentle tilt', () => expect(Math.abs(estimateSkew(page(0.7), 600, 400) - 0.7)).toBeLessThan(0.1));
  it('returns 0 for an empty page', () => expect(estimateSkew(new Uint8Array(100), 10, 10)).toBe(0));
  it('rotates about the centre', () => {
    const [a, b, c, d, e, f] = rotationAbout(90, 100, 50);
    // The centre stays put; (200, 50) goes to (100, 150).
    expect(a * 100 + c * 50 + e).toBeCloseTo(100);
    expect(b * 100 + d * 50 + f).toBeCloseTo(50);
    expect(a * 200 + c * 50 + e).toBeCloseTo(100);
    expect(b * 200 + d * 50 + f).toBeCloseTo(150);
  });
});
