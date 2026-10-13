import { describe, expect, it } from 'vitest';
import { findMatches, rotate90, trim, type Mask } from '../src/model/visualSearch';

const blank = (w: number, h: number): Mask => ({ w, h, data: new Uint8Array(w * h) });
const set = (m: Mask, x: number, y: number) => { if (x >= 0 && y >= 0 && x < m.w && y < m.h) m.data[y * m.w + x] = 1; };
/** A door symbol: a quarter circle with its leaf, at (x, y), radius r. */
function door(m: Mask, x: number, y: number, r: number) {
  for (let i = 0; i <= r; i++) set(m, x, y + i);
  for (let a = 0; a <= 90; a += 1) set(m, Math.round(x + r * Math.sin((a * Math.PI) / 180)), Math.round(y + r - r * Math.cos((a * Math.PI) / 180) + 0));
}
function box(m: Mask, x: number, y: number, s: number) {
  for (let i = 0; i <= s; i++) { set(m, x + i, y); set(m, x + i, y + s); set(m, x, y + i); set(m, x + s, y + i); }
}

describe('VisualSearch', () => {
  it('finds every copy of a symbol and not other shapes', () => {
    const page = blank(400, 300);
    door(page, 20, 20, 24); door(page, 200, 40, 24); door(page, 320, 200, 24);
    box(page, 100, 150, 24); box(page, 250, 120, 30);
    const t = blank(400, 300); door(t, 20, 20, 24);
    const tmpl = trim({ ...t, data: t.data.slice() })!.mask;
    const ms = findMatches(page, tmpl, 0.8);
    expect(ms).toHaveLength(3);
    expect(ms.map((m) => `${m.x},${m.y}`).sort()).toEqual(['20,20', '200,40', '320,200']);
  });

  it('finds rotated copies with a rotated template', () => {
    const page = blank(200, 200);
    const sym = blank(30, 30); door(sym, 2, 2, 24);
    const t = trim(sym)!.mask;
    const r = rotate90(t, 1);
    for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) if (r.data[y * r.w + x]) set(page, 100 + x, 50 + y);
    expect(findMatches(page, t, 0.8)).toHaveLength(0);
    expect(findMatches(page, rotate90(t, 1), 0.8)).toHaveLength(1);
  });
});
