import { describe, expect, it } from 'vitest';
import { DEFAULT_PRINT, layoutSheets, printOrder, renderScale } from '../src/model/print';

const ARCH_D = { w: 36 * 72, h: 24 * 72 }; // landscape drawing
const LETTER = { w: 8.5 * 72, h: 11 * 72 };

describe('print layout', () => {
  it('copies, collate and reverse order', () => {
    expect(printOrder([0, 1, 2], { copies: 2, collate: true, reverse: false })).toEqual([0, 1, 2, 0, 1, 2]);
    expect(printOrder([0, 1, 2], { copies: 2, collate: false, reverse: false })).toEqual([0, 0, 1, 1, 2, 2]);
    expect(printOrder([0, 1, 2], { copies: 1, collate: true, reverse: true })).toEqual([2, 1, 0]);
  });

  it('paper Auto prints each page at its own size', () => {
    const s = layoutSheets([ARCH_D, LETTER], [0, 1], DEFAULT_PRINT);
    expect(s.map((x) => [x.w, x.h])).toEqual([[ARCH_D.w, ARCH_D.h], [LETTER.w, LETTER.h]]);
    expect(s[0].items[0]).toMatchObject({ x: 0, y: 0, scale: 1, rotate: 0 });
  });

  it('fit to paper auto-rotates a landscape sheet onto portrait Tabloid', () => {
    const [sheet] = layoutSheets([ARCH_D], [0], { ...DEFAULT_PRINT, paper: 'Tabloid (11×17)' });
    const it0 = sheet.items[0];
    expect(it0.rotate).toBe(90);
    // 24×36 in rotated fits 11×17: limited by 11/24.
    expect(it0.scale).toBeCloseTo(11 / 24);
    expect(it0.w).toBeCloseTo(11 * 72);
    expect(it0.y).toBeCloseTo((17 * 72 - 36 * 72 * (11 / 24)) / 2);
  });

  it('reduce never enlarges; none keeps full scale; custom uses the percentage', () => {
    const big = { ...DEFAULT_PRINT, paper: 'ARCH E (36×48)' };
    expect(layoutSheets([LETTER], [0], { ...big, scaling: 'reduce' })[0].items[0].scale).toBe(1);
    expect(layoutSheets([LETTER], [0], { ...big, scaling: 'fit' })[0].items[0].scale).toBeGreaterThan(1);
    expect(layoutSheets([ARCH_D], [0], { ...DEFAULT_PRINT, paper: 'Letter', scaling: 'none' })[0].items[0].scale).toBe(1);
    expect(layoutSheets([LETTER], [0], { ...big, scaling: 'custom', customScale: 50 })[0].items[0].scale).toBe(0.5);
  });

  it('pages per sheet make a grid of cells', () => {
    const s = layoutSheets([LETTER, LETTER, LETTER, LETTER, LETTER], [0, 1, 2, 3, 4], { ...DEFAULT_PRINT, paper: 'Letter', perSheet: 4 });
    expect(s).toHaveLength(2);
    const [a, b, c] = s[0].items;
    expect(a.scale).toBeCloseTo(0.5);
    expect(b.x).toBeCloseTo(LETTER.w / 2);
    expect(c.y).toBeCloseTo(LETTER.h / 2);
    expect(s[1].items).toHaveLength(1);
  });

  it('caps the render resolution for huge sheets', () => {
    expect(renderScale(612, 792, 1, 150)).toBeCloseTo(150 / 72);
    const s = renderScale(ARCH_D.w, ARCH_D.h, 1, 300);
    expect(ARCH_D.w * ARCH_D.h * s * s).toBeLessThanOrEqual(16_777_216 + 1);
  });
});
