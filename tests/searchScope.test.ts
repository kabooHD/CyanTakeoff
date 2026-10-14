import { describe, expect, it } from 'vitest';
import { countPointsByPage, queryRegExp, searchFields, searchMarkups, searchProperties } from '../src/model/searchScope';
import type { Markup } from '../src/model/types';

const mk = (id: string, page: number, extra: Partial<Markup>): Markup => ({
  id, type: 'rectangle', page, points: [{ x: 10, y: 10 }, { x: 30, y: 20 }], subject: 'Rectangle', label: '', comment: '', author: 'A', created: '', modified: '', status: 'None',
  style: { color: '#f00', fill: null, width: 1, opacity: 1, fillOpacity: 1, lineStyle: 'solid', fontSize: 10 }, ...extra,
} as Markup);
const bounds = (m: Markup) => ({ minX: m.points[0].x, minY: m.points[0].y, maxX: m.points[1].x, maxY: m.points[1].y });

describe('search scopes', () => {
  it('builds the query expression like the text search (case, whole words)', () => {
    expect(queryRegExp('door', false, false).test('DOOR')).toBe(true);
    expect(queryRegExp('door', true, false).test('DOOR')).toBe(false);
    expect(queryRegExp('door', false, true).test('doors')).toBe(false);
    expect(queryRegExp('a.b', false, false).test('axb')).toBe(false);
  });
  it('finds markups by subject, label or comment with context, skipping hidden ones', () => {
    const ms = [mk('a', 0, { comment: 'Replace the fire door here' }), mk('b', 1, { label: 'DOOR 12' }), mk('c', 1, { comment: 'door', hidden: true }), mk('d', 2, { comment: 'window' })];
    const hits = searchMarkups(ms, queryRegExp('door', false, false), bounds);
    expect(hits.map((h) => h.markupId)).toEqual(['a', 'b']);
    expect(hits[0].context).toContain('fire door');
    expect(hits[0].rect).toEqual([{ x: 10, y: 10 }, { x: 30, y: 20 }]);
  });
  it('finds form fields by name or value (edited values win) and document properties', () => {
    const fields = [{ name: 'Inspector', value: 'Sam', widgets: [{ page: 0, rect: [1, 2, 3, 4] as [number, number, number, number] }] }, { name: 'Notes', value: 'x', widgets: [{ page: 1, rect: [0, 0, 1, 1] as [number, number, number, number] }] }];
    expect(searchFields(fields, { Notes: 'see Sam' }, queryRegExp('sam', false, false)).map((h) => h.page)).toEqual([0, 1]);
    expect(searchFields(fields, {}, queryRegExp('sam', false, false))).toHaveLength(1);
    const props = searchProperties({ Title: 'Tower plans', Author: 'Sam', Producer: 7 }, queryRegExp('sam', false, false));
    expect(props).toHaveLength(1);
    expect(props[0]).toMatchObject({ kind: 'property', page: -1, context: 'Author: Sam' });
  });
  it('groups count points by page at the centre of each hit', () => {
    const pts = countPointsByPage([{ page: 0, rect: [{ x: 0, y: 0 }, { x: 10, y: 4 }] }, { page: 0, rect: [{ x: 20, y: 0 }, { x: 30, y: 4 }] }, { page: 2, rect: [{ x: 1, y: 1 }, { x: 3, y: 3 }] }, { page: -1, rect: [{ x: 0, y: 0 }, { x: 0, y: 0 }] }]);
    expect(pts.get(0)).toEqual([{ x: 5, y: 2 }, { x: 25, y: 2 }]);
    expect(pts.get(2)).toEqual([{ x: 2, y: 2 }]);
    expect(pts.size).toBe(2);
  });
});
