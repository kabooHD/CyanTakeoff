import { describe, expect, it } from 'vitest';
import { clampNumber, numericValue, parseChoiceCsv } from '../src/model/columns';
import type { CustomColumn, Markup } from '../src/model/types';

const mk = (custom: Record<string, string | number | boolean>): Markup => ({
  id: 'a', type: 'rectangle', page: 0, points: [{ x: 0, y: 0 }, { x: 10, y: 10 }], subject: 'R', label: '', comment: '', author: 'A', created: '', modified: '', status: 'None',
  style: { color: '#000', fill: null, opacity: 1, fillOpacity: 1, width: 1, lineStyle: 'solid', fontSize: 10 }, custom,
} as Markup);

describe('custom column extras', () => {
  const size: CustomColumn = { id: 's', name: 'Size', type: 'choice', options: ['Small', 'Large', '7'], choiceMeta: { Small: { value: 1, subject: 'Door' }, Large: { value: 2.5 } } };
  it('uses a choice item\'s assigned numeric value, else the text as a number', () => {
    expect(numericValue(mk({ s: 'Large' }), size, [size])).toBe(2.5);
    expect(numericValue(mk({ s: '7' }), size, [size])).toBe(7);
    expect(numericValue(mk({ s: 'Other' }), size, [size])).toBeUndefined();
  });
  it('keeps numbers within Min/Max', () => {
    const n: CustomColumn = { id: 'n', name: 'Qty', type: 'number', min: 0, max: 10 };
    expect(clampNumber(n, -3)).toBe(0);
    expect(clampNumber(n, 12)).toBe(10);
    expect(clampNumber({ ...n, max: undefined }, 12)).toBe(12);
  });
  it('imports choice items from CSV (item, subject, value)', () => {
    const r = parseChoiceCsv('Small,Door,1\r\nLarge,,2.5\n"Huge"\nSmall,dup,9\n');
    expect(r.options).toEqual(['Small', 'Large', 'Huge']);
    expect(r.choiceMeta).toEqual({ Small: { subject: 'Door', value: 1 }, Large: { value: 2.5 } });
  });
});
