import { describe, expect, it } from 'vitest';
import { alignTransform, diffBoxes, diffMask, overlayImage } from '../src/model/compare';

const W = 100, H = 60;
const sheet = (draw: (set: (x: number, y: number) => void) => void) => {
  const ink = new Uint8Array(W * H);
  draw((x, y) => { ink[y * W + x] = 255; });
  return ink;
};
const line = (set: (x: number, y: number) => void, y: number, x0: number, x1: number) => { for (let x = x0; x <= x1; x++) set(x, y); };

describe('compare drawings', () => {
  const a = sheet((s) => { line(s, 10, 5, 90); line(s, 40, 5, 30); });
  it('finds nothing when only anti-aliasing shifts by a pixel', () => {
    const b = sheet((s) => { line(s, 11, 5, 90); line(s, 40, 5, 30); });
    expect(diffBoxes(diffMask(a, b, W, H), W, H)).toEqual([]);
  });
  it('boxes an added wall and a removed one separately', () => {
    const b = sheet((s) => { line(s, 10, 5, 90); line(s, 50, 70, 95); });
    const boxes = diffBoxes(diffMask(a, b, W, H), W, H);
    expect(boxes.map((x) => x.kind).sort()).toEqual(['added', 'removed']);
    const added = boxes.find((x) => x.kind === 'added')!;
    expect(added.x0).toBeLessThanOrEqual(70);
    expect(added.x1).toBeGreaterThanOrEqual(95);
  });
  it('colours ink only in A, only in B, and in both', () => {
    const out = new Uint8ClampedArray(3 * 4);
    overlayImage(new Uint8Array([255, 0, 255]), new Uint8Array([0, 255, 255]), out, [255, 0, 0], [0, 128, 0]);
    expect([...out.slice(0, 3)]).toEqual([255, 0, 0]);
    expect([...out.slice(4, 7)]).toEqual([0, 128, 0]);
    expect(out[8]).toBeLessThan(40);
  });
  it('aligns two point pairs with a similarity transform', () => {
    const [a1, b1, c1, d1, e1, f1] = alignTransform({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 5 }, { x: 5, y: 25 });
    const map = (x: number, y: number) => [a1 * x + c1 * y + e1, b1 * x + d1 * y + f1];
    expect(map(0, 0).map((v) => +v.toFixed(9))).toEqual([5, 5]);
    expect(map(10, 0).map((v) => +v.toFixed(9))).toEqual([5, 25]);
  });
});
