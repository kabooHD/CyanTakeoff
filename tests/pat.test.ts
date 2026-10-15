import { describe, expect, it } from 'vitest';
import { guessPatUnits, parsePat, patToHatch } from '../src/model/pat';

const ACAD = `;; sample of acad.pat
*ANSI31, ANSI Iron, Brick, Stone masonry
45, 0,0, 0,.125
*ANSI37, ANSI Lead, Zinc, Magnesium, Sound/Heat/Elec Insulation
45, 0,0, 0,.125
135, 0,0, 0,.125
*BRICK, Brick or masonry
0, 0,0, 0,.25
90, 0,0, 0,.5, .25,-.25
*DOTS, A series of dots
0, 0,0, .03125,.0625, 0,-.0625
`;

describe('AutoCAD .pat hatch import', () => {
  it('parses patterns, families and dashes', () => {
    const p = parsePat(ACAD);
    expect(p.map((x) => x.name)).toEqual(['ANSI31', 'ANSI37', 'BRICK', 'DOTS']);
    expect(p[0].description).toBe('ANSI Iron, Brick, Stone masonry');
    expect(p[2].families[1]).toEqual({ angle: 90, x: 0, y: 0, dx: 0, dy: 0.5, dashes: [0.25, -0.25] });
    expect(guessPatUnits(p[0])).toBe('in');
    expect(guessPatUnits({ name: 'x', description: '', families: [{ angle: 45, x: 0, y: 0, dx: 0, dy: 3.175, dashes: [] }] })).toBe('mm');
  });

  it('ANSI31 becomes a square tile with one diagonal', () => {
    const h = patToHatch(parsePat(ACAD)[0], 72);
    // 45° lines 0.125 in apart repeat every 0.125·√2 in.
    expect(h.size).toBeCloseTo(0.125 * Math.SQRT2 * 72, 2);
    expect(h.aspect).toBeCloseTo(1);
    expect(h.lines).toHaveLength(1);
    const [x1, y1, x2, y2] = h.lines[0];
    expect(Math.abs(x2 - x1)).toBeCloseTo(1);
    expect(Math.abs(y2 - y1)).toBeCloseTo(1);
    expect(h.id).toBe('pat-ansi31');
    expect(h.name).toBe('ANSI31 (ANSI Iron, Brick, Stone masonry)');
  });

  it('crossed families share the tile; brick keeps its dashed verticals', () => {
    const [, ansi37, brick] = parsePat(ACAD).map((p) => patToHatch(p, 72));
    expect(ansi37.lines).toHaveLength(2);
    // Brick: horizontals every 0.25, verticals every 0.5 with 0.25 dash / 0.25 gap, staggered: tile 0.5 × 0.5 (or a multiple).
    expect(brick.size / 72 % 0.5).toBeCloseTo(0, 5);
    const horizontals = brick.lines.filter(([, y1, , y2]) => Math.abs(y1 - y2) < 1e-6);
    const verticals = brick.lines.filter(([x1, , x2]) => Math.abs(x1 - x2) < 1e-6);
    expect(horizontals.length).toBeGreaterThanOrEqual(2);
    expect(verticals.length).toBeGreaterThanOrEqual(1);
    for (const [, y1, , y2] of verticals) expect(Math.abs(y2 - y1)).toBeLessThan(0.75); // dashed, not full height
  });

  it('a dot-only family becomes dots', () => {
    const dots = patToHatch(parsePat(ACAD)[3], 72);
    expect(dots.lines).toHaveLength(0);
    expect(dots.dots.length).toBeGreaterThan(0);
    for (const [x, y] of dots.dots) { expect(x).toBeGreaterThanOrEqual(-1e-6); expect(x).toBeLessThanOrEqual(1 + 1e-6); expect(y).toBeGreaterThanOrEqual(-1e-6); expect(y).toBeLessThanOrEqual(1 + 1e-6); }
  });

  it('ignores junk and comment lines', () => {
    expect(parsePat(';; nothing\n*EMPTY\nnot numbers\n')).toEqual([]);
  });
});
