import { describe, expect, it } from 'vitest';
import { placeColumns } from '../src/model/listColumns';

describe('Markups List position columns', () => {
  it('measures from the lower left of the page in inches, and real sizes at the scale', () => {
    const c = placeColumns([{ x: 72, y: 72 }, { x: 216, y: 144 }], 792, { factor: 1 / 18, unit: 'ft', label: '' });
    expect(c).toEqual({ x: 1, y: 9, xCenter: 2, yCenter: 9.5, docWidth: 2, docHeight: 1, width: 8, height: 4 });
    expect(placeColumns([{ x: 0, y: 0 }, { x: 36, y: 36 }], 792).width).toBeUndefined();
  });
});
