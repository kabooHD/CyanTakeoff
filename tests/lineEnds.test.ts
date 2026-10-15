import { describe, expect, it } from 'vitest';
import { calloutTips, defaultEnds, endsOf, leName, lineEndOfName, lineEndShape } from '../src/model/lineEnds';

describe('line ends', () => {
  it('maps to PDF /LE names and back', () => {
    expect(leName('closedArrow')).toBe('ClosedArrow');
    expect(lineEndOfName('/ROpenArrow')).toBe('rOpenArrow');
    expect(lineEndOfName('Bogus')).toBeUndefined();
  });
  it('has Revu defaults per type and honours the style', () => {
    expect(defaultEnds('arrow')).toEqual({ start: 'none', end: 'openArrow' });
    expect(defaultEnds('callout').end).toBe('openArrow');
    expect(defaultEnds('line')).toEqual({ start: 'none', end: 'none' });
    expect(endsOf('line', { width: 1 })).toEqual({ start: 'none', end: 'none', size: 8 });
    expect(endsOf('line', { width: 2, lineEnd: 'circle', lineEndSize: 2 })).toEqual({ start: 'none', end: 'circle', size: 20 });
  });
  it('draws arrowheads at the end, reverse ones backwards, and shapes', () => {
    const from = { x: 0, y: 0 }, to = { x: 100, y: 0 };
    const open = lineEndShape('openArrow', from, to, 10);
    expect(open.fill).toBeNull();
    expect(open.strokes[0][1]).toEqual(to);
    expect(open.strokes[0][0].x).toBeLessThan(100);
    const rev = lineEndShape('rClosedArrow', from, to, 10);
    expect(rev.fill![0].x).toBeGreaterThan(100);
    expect(lineEndShape('square', from, to, 10).fill).toHaveLength(4);
    expect(lineEndShape('circle', from, to, 10).circle).toEqual({ c: to, r: 4 });
    expect(lineEndShape('butt', from, to, 10).strokes[0].map((p) => Math.round(p.x))).toEqual([100, 100]);
    expect(lineEndShape('none', from, to, 10)).toEqual({ fill: null, strokes: [] });
  });
  it('lists a callout\'s leader tips', () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 50, y: 30 }, { x: 70, y: 5 }];
    expect(calloutTips(pts)).toEqual([pts[0], pts[3]]);
  });
});
