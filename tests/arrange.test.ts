import { describe, expect, it } from 'vitest';
import { align, expandGroups, flip, group, reorder, ungroup } from '../src/model/arrange';
import { bounds } from '../src/model/measure';
import { eraseStroke } from '../src/model/markup';
import type { Markup } from '../src/model/types';

const mk = (id: string, x: number, y: number, page = 0): Markup => ({
  id, type: 'rectangle', page, points: [{ x, y }, { x: x + 10, y: y + 10 }],
  style: { color: '#000000', fill: null, opacity: 1, fillOpacity: 1, width: 1, lineStyle: 'solid', fontSize: 10 },
  subject: '', label: '', comment: '', author: '', created: '', modified: '', status: 'None',
});
const box = (m: Markup) => bounds(m.points);

describe('arrange', () => {
  const ms = [mk('a', 0, 0), mk('b', 50, 20), mk('c', 100, 40), mk('x', 0, 0, 1)];
  it('groups and expands selection to the whole group; ungroups', () => {
    const g = group(ms, ['a', 'c']);
    expect(expandGroups(g, ['a']).sort()).toEqual(['a', 'c']);
    expect(expandGroups(ungroup(g, ['a', 'c']), ['a'])).toEqual(['a']);
  });
  it('changes drawing order within the page only', () => {
    expect(reorder(ms, ['a'], 'front').map((m) => m.id)).toEqual(['b', 'c', 'a', 'x']);
    expect(reorder(ms, ['c'], 'back').map((m) => m.id)).toEqual(['c', 'a', 'b', 'x']);
    expect(reorder(ms, ['a'], 'forward').map((m) => m.id)).toEqual(['b', 'a', 'c', 'x']);
    expect(reorder(ms, ['c'], 'backward').map((m) => m.id)).toEqual(['a', 'c', 'b', 'x']);
  });
  it('aligns to the selection edges', () => {
    const r = align(ms, ['a', 'b', 'c'], 'right', box);
    expect(r.slice(0, 3).map((m) => box(m).maxX)).toEqual([110, 110, 110]);
    const t = align(ms, ['a', 'b', 'c'], 'middle', box);
    expect(t.slice(0, 3).map((m) => box(m).minY + 5)).toEqual([25, 25, 25]);
  });
  it('flips around the selection centre', () => {
    const f = flip(ms, ['a', 'c'], 'horizontal');
    expect(box(f[0]).minX).toBe(100);
    expect(box(f[2]).minX).toBe(0);
  });
  it('locked markups are not moved', () => {
    const locked = ms.map((m) => (m.id === 'b' ? { ...m, locked: true } : m));
    expect(align(locked, ['a', 'b', 'c'], 'left', box)[1]).toBe(locked[1]);
  });
});

describe('eraser', () => {
  it('splits a stroke where the eraser passes', () => {
    const stroke = Array.from({ length: 11 }, (_, i) => ({ x: i * 10, y: 0 }));
    const pieces = eraseStroke(stroke, { x: 50, y: 0 }, 6);
    expect(pieces.map((p) => p.length)).toEqual([5, 5]);
    expect(eraseStroke(stroke, { x: 50, y: 100 }, 6)).toEqual([stroke]);
  });
});
