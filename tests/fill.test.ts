import { describe, expect, it } from 'vitest';
import { Flood, dilate, drawWall, simplifyClosed, traceRegion, type Grid } from '../src/model/fill';
import { polygonArea, signedArea } from '../src/model/measure';

/** A 40x30 grid with a 1-cell wall rectangle from (5,5) to (25,20) and a doorway. */
function room(door = false): Grid {
  const w = 40, h = 30, data = new Uint8Array(w * h);
  for (let x = 5; x <= 25; x++) { data[5 * w + x] = 1; data[20 * w + x] = 1; }
  for (let y = 5; y <= 20; y++) { data[y * w + 5] = 1; data[y * w + 25] = 1; }
  if (door) for (let y = 10; y <= 12; y++) data[y * w + 25] = 0;
  return { w, h, data };
}

describe('Dynamic Fill', () => {
  it('fills a closed room and traces its inner outline', () => {
    const f = new Flood(room());
    f.seed(10, 10);
    f.step();
    const loops = traceRegion(f.filled, 40, 30);
    expect(loops).toHaveLength(1);
    expect(polygonArea(loops[0])).toBe(19 * 14); // interior cells 6..24 x 6..19
    expect(loops[0]).toHaveLength(4);
    expect(signedArea(loops[0])).toBeGreaterThan(0);
  });

  it('leaks through a doorway unless a temporary boundary closes it', () => {
    const open = new Flood(room(true));
    open.seed(10, 10); open.step();
    expect(open.filled.reduce((t, v) => t + v, 0)).toBeGreaterThan(19 * 14);
    const g = room(true);
    drawWall(g, [{ x: 25, y: 9 }, { x: 25, y: 13 }], 0);
    const closed = new Flood(g);
    closed.seed(10, 10); closed.step();
    expect(closed.filled.reduce((t, v) => t + v, 0)).toBe(19 * 14);
  });

  it('grows incrementally and stops at walls', () => {
    const f = new Flood(room());
    f.seed(10, 10);
    f.step(20);
    expect(f.done).toBe(false);
    while (!f.done) f.step(50);
    expect(f.filled.reduce((t, v) => t + v, 0)).toBe(19 * 14);
  });

  it('traces holes (e.g. a column) with the opposite orientation', () => {
    const g = room();
    for (let y = 10; y < 13; y++) for (let x = 12; x < 15; x++) g.data[y * 40 + x] = 1;
    const f = new Flood(g); f.seed(7, 7); f.step();
    const loops = traceRegion(f.filled, 40, 30);
    expect(loops).toHaveLength(2);
    const hole = loops.find((l) => signedArea(l) < 0)!;
    expect(polygonArea(hole)).toBe(9);
  });

  it('dilation closes a one-cell gap', () => {
    const g = room(true);
    for (let y = 10; y <= 12; y++) g.data[y * 40 + 25] = 0;
    g.data[11 * 40 + 25] = 1; // two 1-cell gaps
    const d = dilate(g, 1);
    const f = new Flood(d); f.seed(10, 10); f.step();
    expect(f.filled.reduce((t, v) => t + v, 0)).toBeLessThan(19 * 14);
  });

  it('simplifies a jagged diagonal into few points', () => {
    const stairs = [];
    for (let i = 0; i < 20; i++) stairs.push({ x: i, y: i }, { x: i + 1, y: i });
    const pts = [...stairs, { x: 20, y: 20 }, { x: 0, y: 20 }];
    expect(simplifyClosed(pts, 1).length).toBeLessThanOrEqual(4);
  });
});
