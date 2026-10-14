import { describe, expect, it } from 'vitest';
import { alignTransform, applyMat, diffBoxes, diffMask, invertMat, overlayImage, vectorDiff, vectorMask } from '../src/model/compare';

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

describe('vector compare', () => {
  const seg = (...v: number[]) => new Float32Array(v);
  const text = (str: string, x: number, y: number) => ({ str, x0: x, y0: y, x1: x + 30, y1: y + 8 });

  it('finds added and removed lines and text, ignoring how lines are split', () => {
    const a = { segments: seg(0, 0, 100, 0, 0, 50, 100, 50), texts: [text('DOOR', 10, 10), text('A-101', 200, 200)] };
    const b = { segments: seg(0, 0, 50, 0, 50, 0, 100, 0, 0, 100, 100, 100), texts: [text('DOOR', 10.4, 10), text('A-102', 200, 200)] };
    const d = vectorDiff(a, b, null);
    expect(d.removed.length).toBeGreaterThan(0);
    expect(d.removed.every((p) => p.y === 50)).toBe(true);
    expect(d.added.every((p) => p.y === 100)).toBe(true);
    expect(d.removedText.length).toBe(1);
    expect(d.addedText.length).toBe(1);
    const boxes = diffBoxes(vectorMask(d, 240, 220, 1), 240, 220, 8, 2, 1);
    expect(boxes.map((x) => x.kind).sort()).toEqual(['added', 'changed', 'removed']);
  });

  it('uses the alignment transform', () => {
    const a = { segments: seg(0, 0, 100, 0, 0, 0, 0, 80), texts: [text('NOTE', 20, 20)] };
    // The revised sheet is the same drawing shifted by (15, 25) and scaled 2x.
    const b = { segments: seg(15, 25, 215, 25, 15, 25, 15, 185), texts: [{ str: 'NOTE', x0: 55, y0: 65, x1: 115, y1: 81 }] };
    expect(vectorDiff(a, b, null).added.length).toBeGreaterThan(0);
    const m = alignTransform({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 15, y: 25 }, { x: 215, y: 25 });
    const d = vectorDiff(a, b, m);
    expect(d.added.length + d.removed.length + d.addedText.length + d.removedText.length).toBe(0);
    expect(applyMat(invertMat(m), applyMat(m, { x: 3, y: 7 }))).toEqual({ x: expect.closeTo(3), y: expect.closeTo(7) });
  });
});

describe('vector compare: colour and line weight', () => {
  const seg = new Float32Array([0, 0, 100, 0, 0, 50, 100, 50]);
  const page = (c2: number, w2: number, styled = true) => ({ segments: seg, texts: [], styles: styled ? new Float32Array([0, 1, c2, w2]) : undefined });
  it('flags a line that only changed colour or weight', async () => {
    const { vectorDiff } = await import('../src/model/compare');
    const red = vectorDiff(page(0, 1), page(0xff0000, 1), null);
    expect(red.removed).toHaveLength(0);
    expect(red.added).toHaveLength(0);
    expect(red.restyled.length).toBeGreaterThan(40);
    expect(red.restyled.every((p) => p.y === 50)).toBe(true);
    expect(vectorDiff(page(0, 1), page(0, 2), null).restyled.length).toBeGreaterThan(40);
  });
  it('ignores small width differences, and pages without styles', async () => {
    const { vectorDiff } = await import('../src/model/compare');
    expect(vectorDiff(page(0, 1), page(0, 1.1), null).restyled).toHaveLength(0);
    expect(vectorDiff(page(0, 1, false), page(0xff0000, 3), null).restyled).toHaveLength(0);
    expect(vectorDiff(page(0, 1), page(0xff0000, 1), null, 1, 2, false).restyled).toHaveLength(0);
  });
});
