import { describe, expect, it } from 'vitest';
import { group, removeFromGroup } from '../src/model/arrange';
import { autosizedBox, withBox } from '../src/model/textBox';
import { parsePdfDate } from '../src/model/pdfDate';
import type { Markup } from '../src/model/types';

const mk = (id: string, type: Markup['type'] = 'rectangle', points = [{ x: 0, y: 0 }, { x: 10, y: 10 }], text?: string): Markup => ({
  id, type, page: 0, points, text,
  style: { color: '#000000', fill: null, opacity: 1, fillOpacity: 1, width: 1, lineStyle: 'solid', fontSize: 10 },
  subject: '', label: '', comment: '', author: '', created: '', modified: '', status: 'None',
});
// 0.5 pt per character at size 10.
const w = (t: string, size: number) => t.length * size * 0.05;

describe('Remove Selected from Group', () => {
  it('takes the selection out and keeps the rest grouped', () => {
    const g = group([mk('a'), mk('b'), mk('c')], ['a', 'b', 'c']);
    const r = removeFromGroup(g, ['a']);
    expect(r[0].groupId).toBeUndefined();
    expect(r[1].groupId).toBeDefined();
    expect(r[1].groupId).toBe(r[2].groupId);
  });
  it('dissolves a group left with one member', () => {
    const g = group([mk('a'), mk('b'), mk('c')], ['a', 'b']);
    const r = removeFromGroup(g, ['a']);
    expect(r.every((m) => !m.groupId)).toBe(true);
  });
});

describe('Autosize Text Box', () => {
  it('fits a text box to its longest line and line count, keeping the top-left corner', () => {
    const m = mk('t', 'textbox', [{ x: 100, y: 50 }, { x: 20, y: 300 }], 'abcd\nabcdefghij');
    const [a, b] = autosizedBox(m, w)!;
    expect(a).toEqual({ x: 20, y: 50 });
    // width: max(10, 5) + 6 padding + 2 border + 2 = 20
    expect(b.x - a.x).toBeCloseTo(20);
    // height: 2 lines × 11.5 + 4 + 2 + 2 = 31
    expect(b.y - a.y).toBeCloseTo(31);
  });
  it('resizes a callout box and keeps its arrow point', () => {
    const tip = { x: 0, y: 0 };
    const m = mk('c', 'callout', [tip, { x: 50, y: 50 }, { x: 400, y: 400 }], 'x'.repeat(40));
    const box = autosizedBox(m, w)!;
    expect(box[1].x - box[0].x).toBeCloseTo(30);
    expect(withBox(m, box)[0]).toBe(tip);
  });
  it('ignores other markups', () => expect(autosizedBox(mk('r'), w)).toBeNull());
});

describe('PDF dates', () => {
  it('parses full dates with an offset', () => {
    expect(parsePdfDate("D:20240305143000+02'00'")!.toISOString()).toBe('2024-03-05T12:30:00.000Z');
    expect(parsePdfDate('D:20240305143000Z')!.toISOString()).toBe('2024-03-05T14:30:00.000Z');
  });
  it('parses partial dates and rejects junk', () => {
    expect(parsePdfDate('D:2024')!.toISOString()).toBe('2024-01-01T00:00:00.000Z');
    expect(parsePdfDate('yesterday')).toBeNull();
    expect(parsePdfDate(undefined)).toBeNull();
  });
});

import { selectText } from '../src/model/textSelect';
describe('Select Text', () => {
  const runs = [
    { x0: 60, y0: 10, x1: 90, y1: 20, str: 'WORLD' },
    { x0: 10, y0: 10, x1: 50, y1: 20, str: 'HELLO' },
    { x0: 10, y0: 30, x1: 40, y1: 40, str: 'NEXT' },
    { x0: 300, y0: 30, x1: 340, y1: 40, str: 'FAR' },
  ];
  it('reads lines top to bottom, left to right, with spaces at gaps', () => {
    expect(selectText(runs).text).toBe('HELLO WORLD\nNEXT FAR');
  });
  it('keeps only runs touching the rectangle', () => {
    const r = selectText(runs, { x: 0, y: 0 }, { x: 55, y: 45 });
    expect(r.text).toBe('HELLO\nNEXT');
    expect(r.rects).toHaveLength(2);
  });
  it('splits a highlight across a wide gap', () => {
    expect(selectText(runs).rects).toHaveLength(3);
  });
});
