import { describe, expect, it } from 'vitest';
import { cellAnchor, inSourcePages, legendCell, legendHeader, legendKey, legendLayout, legendRows, legendSizes } from '../src/model/legend';
import type { CustomColumn, Markup } from '../src/model/types';

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
  it('can count all pages or a custom page range', () => {
    expect(legendRows({ ...def, source: 'all' }, ms, 0)[0]).toMatchObject({ quantity: 3, measurement: '300 sf' });
    expect(legendRows({ ...def, source: 'custom', pages: '2' }, ms, 0, { pageCount: 2 })[0]).toMatchObject({ quantity: 1, measurement: '100 sf' });
    expect(inSourcePages({ ...def, source: 'custom', pages: '1-2, 5' }, 0, 4, 6)).toBe(true);
    expect(inSourcePages({ ...def, source: 'custom', pages: '1-2' }, 0, 2, 6)).toBe(false);
    expect(inSourcePages(def, 3, 3)).toBe(true);
  });
  it('lays out a column per shown field', () => {
    const L = legendLayout(def, legendRows(def, ms, 0), 10);
    expect(L.cols.map((c) => c.id)).toEqual(['symbol', 'description', 'quantity', 'measurement']);
    expect(L.h).toBeCloseTo(L.title + L.header + L.row * 2, 9);
    expect(L.title).toBeGreaterThan(0);
    expect(L.header).toBe(L.row);
  });
  it('drops the title bar and headers when hidden, and scales the symbol column', () => {
    const rows = legendRows(def, ms, 0);
    const L = legendLayout({ ...def, showTitle: false, showHeaders: false }, rows, 10);
    expect(L.title).toBe(0);
    expect(L.header).toBe(0);
    expect(L.h).toBeCloseTo(L.row * 2, 9);
    const big = legendLayout({ ...def, symbolSize: 200 }, rows, 10);
    expect(big.cols[0].w).toBeCloseTo(L.cols[0].w * 2, 6);
    expect(legendSizes({ ...def, titleSize: 14, margin: 2 }, 10)).toMatchObject({ title: 14, header: 10, margin: 2, symbol: 1, showTitle: true, align: 'left' });
  });
  it('shows other Markups List fields and custom columns as extra columns', () => {
    const cols: CustomColumn[] = [{ id: 'c1', name: 'Cost', type: 'number', format: 'currency', currency: '$', decimals: 2 }, { id: 'c2', name: 'Note', type: 'text' }];
    const withValues = ms.map((m, i) => ({ ...m, label: i < 2 ? 'L1' : 'L2', status: i === 0 ? 'Accepted' as const : m.status, custom: { c1: 10.5, c2: i === 0 ? 'a' : 'b' } }));
    const d = { ...def, source: 'all' as const, columns: ['label', 'status', 'pages', 'custom:c1', 'custom:c2'] };
    const rows = legendRows(d, withValues, 0, { pageCount: 2, columns: cols, pageLabels: ['A-1', 'A-2'] });
    expect(rows[0].cells).toEqual({ label: 'L1, L2', status: 'Accepted', pages: 'A-1, A-2', 'custom:c1': '$31.50', 'custom:c2': 'a, b' });
    expect(legendCell('color', withValues, {})).toBe('#0066FF');
    expect(legendHeader('custom:c1', cols)).toBe('Cost');
    expect(legendHeader('pages')).toBe('Pages');
    expect(cellAnchor('custom:c1', 'left', cols)).toBe('end');
    expect(cellAnchor('custom:c2', 'center', cols)).toBe('middle');
    expect(cellAnchor('quantity', 'left')).toBe('end');
    const L = legendLayout(d, rows, 10, cols);
    expect(L.cols.map((c) => c.id)).toEqual(['symbol', 'description', 'quantity', 'measurement', 'label', 'status', 'pages', 'custom:c1', 'custom:c2']);
  });
});
