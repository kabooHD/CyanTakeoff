import { describe, expect, it } from 'vitest';
import { oneGroup, scaledStyle, selectionCorners } from '../src/model/scale';
import { pasteLayers } from '../src/model/pasteLayers';
import { popupLayout, wrapWords } from '../src/model/print';

describe('scaling a multi-selection', () => {
  it('puts the purple handles around every selected markup', () => {
    const c = selectionCorners([{ points: [{ x: 10, y: 10 }, { x: 30, y: 20 }] }, { points: [{ x: 50, y: 5 }, { x: 60, y: 40 }] }], 2);
    expect(c).toEqual([{ x: 8, y: 3 }, { x: 62, y: 3 }, { x: 62, y: 42 }, { x: 8, y: 42 }]);
  });
  it('knows a Group from a plain multi-selection', () => {
    expect(oneGroup([{ groupId: 'g' }, { groupId: 'g' }])).toBe(true);
    expect(oneGroup([{ groupId: 'g' }, { groupId: 'h' }])).toBe(false);
    expect(oneGroup([{}, {}])).toBe(false);
    expect(oneGroup([{ groupId: 'g' }])).toBe(false);
  });
  it('scales line width and font size with the factor (Scale Appearance Properties for Grouped Markups)', () => {
    expect(scaledStyle({ width: 2, fontSize: 12, color: '#f00' }, 1.5)).toEqual({ width: 3, fontSize: 18, color: '#f00' });
    expect(scaledStyle({ width: 1, fontSize: 10 }, 0.05).fontSize).toBe(1); // never below 1 pt
  });
});

describe('Retain Layer information when copying Markups', () => {
  const names = { '12R': 'Plan', '13R': 'Notes' };
  const ms = [{ id: 'a', layer: '12R' }, { id: 'b', layer: '13R' }, { id: 'c' }, { id: 'd', layer: '99R' }];
  it('creates missing layers once, reuses one with the same name, drops unknown ones', () => {
    const target = { layers: { '7R': { id: '7R', name: 'Notes', on: true, locked: false, print: true } }, order: [{ id: '7R', kids: [] }], configs: [] };
    let n = 0;
    const r = pasteLayers(ms, names, target, true, () => `new:${++n}`);
    expect(r.added).toEqual(['new:1']);
    expect(r.layers!.layers['new:1'].name).toBe('Plan');
    expect(r.layers!.order.map((o) => o.id)).toEqual(['7R', 'new:1']);
    expect(r.markups.map((m) => m.layer)).toEqual(['new:1', '7R', undefined, undefined]);
  });
  it('keeps layers the target already has', () => {
    const target = { layers: { '12R': { id: '12R', name: 'Plan', on: true, locked: false, print: true } }, order: [{ id: '12R', kids: [] }], configs: [] };
    const r = pasteLayers(ms.slice(0, 1), names, target, true, () => 'x');
    expect(r.added).toEqual([]);
    expect(r.markups[0].layer).toBe('12R');
    expect(r.layers).toBe(target);
  });
  it('drops the layer when the preference is off', () => {
    const r = pasteLayers(ms, names, null, false, () => 'x');
    expect(r.markups.every((m) => !m.layer)).toBe(true);
    expect(r.layers).toBeNull();
  });
});

describe('Print Pop-Ups layout', () => {
  it('wraps words and keeps paragraphs', () => {
    expect(wrapWords('Check the door swing here', 12)).toEqual(['Check the', 'door swing', 'here']);
    expect(wrapWords('a\nb', 10)).toEqual(['a', 'b']);
  });
  it('sits right of the note, or left of it near the page edge, inside the page', () => {
    const b = popupLayout({ x: 100, y: 100 }, 'Fix this', { w: 612, h: 792 });
    expect(b).toMatchObject({ x: 122, y: 100, w: 180, h: 13 * 2 + 8, lines: ['Fix this'] });
    expect(popupLayout({ x: 600, y: 100 }, 'Fix this', { w: 612, h: 792 }).x).toBe(600 - 4 - 180);
    const low = popupLayout({ x: 100, y: 780 }, 'Fix this', { w: 612, h: 792 });
    expect(low.y + low.h).toBeLessThanOrEqual(792);
  });
});
