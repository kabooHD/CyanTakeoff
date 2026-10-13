import { describe, expect, it } from 'vitest';
import { legendKey, legendLayout, legendRows } from '../src/model/legend';
import type { Markup } from '../src/model/types';

const style = { color: '#0066ff', fill: '#0066ff', opacity: 1, fillOpacity: 0.25, width: 1, lineStyle: 'solid' as const, fontSize: 10 };
const scale = { factor: 1 / 18, unit: 'ft-in' as const, label: '1/4" = 1\'-0"' };
const mk = (type: Markup['type'], points: Markup['points'], page = 0, subject = 'Flooring'): Markup => ({
  id: crypto.randomUUID(), type, page, points, style, subject, label: '', comment: '', author: '', created: '', modified: '', status: 'None', scale,
});
const sq = (x: number) => [{ x, y: 0 }, { x: x + 180, y: 0 }, { x: x + 180, y: 180 }, { x, y: 180 }]; // 10 x 10 ft

describe('Legends', () => {
  const ms = [mk('area', sq(0)), mk('area', sq(400)), mk('area', sq(0), 1), mk('count', [{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }], 0, 'Doors')];
  const def = { title: 'Legend', keys: [legendKey(ms[0]), legendKey(ms[3])], source: 'page' as const, showQuantity: true, showMeasurement: true };
  it('totals quantity and measurement per markup kind on the page', () => {
    const rows = legendRows(def, ms, 0);
    expect(rows.map((r) => [r.description, r.quantity, r.measurement])).toEqual([['Flooring', 2, '200 sf'], ['Doors', 3, '']]);
  });
  it('can count all pages', () => {
    expect(legendRows({ ...def, source: 'all' }, ms, 0)[0]).toMatchObject({ quantity: 3, measurement: '300 sf' });
  });
  it('lays out a column per shown field', () => {
    const L = legendLayout(def, legendRows(def, ms, 0), 10);
    expect(L.cols.map((c) => c.id)).toEqual(['symbol', 'description', 'quantity', 'measurement']);
    expect(L.h).toBeCloseTo(L.title + L.row * 3, 9);
  });
});
