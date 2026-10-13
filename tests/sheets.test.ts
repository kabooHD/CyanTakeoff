import { describe, expect, it } from 'vitest';
import { findSheetNumber, sheetReferences } from '../src/model/sheets';

const box = (str: string, x0: number, y0: number, w: number, h: number) => ({ str, x0, y0, x1: x0 + w, y1: y0 + h });

describe('sheet numbers', () => {
  it('takes the big sheet number in the title block', () => {
    const boxes = [box('SEE A-501', 100, 100, 60, 10), box('A-101', 2400, 1650, 80, 36), box('FLOOR PLAN', 2300, 1600, 90, 18)];
    expect(findSheetNumber(boxes, 2592, 1728)).toBe('A-101');
  });
  it('finds references to other sheets', () => {
    const refs = sheetReferences([box('SEE DETAIL 3/A-501', 0, 0, 180, 10), box('S2.01', 0, 20, 50, 10), box('NOTES', 0, 40, 50, 10)], ['A-501', 'S2.01', 'A-101']);
    expect(refs.map((r) => r.label)).toEqual(['A-501', 'S2.01']);
    expect(refs[0].box.x0).toBeGreaterThan(100);
  });
});
