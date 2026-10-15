import { describe, expect, it } from 'vitest';
import { angleAbout, canRotate, drawnPoints, normDeg, rotateHandle, rotatePt, rotated, snapRotation, unrotatePt, withRotation } from '../src/model/rotate';
import type { Markup } from '../src/model/types';

const style = { color: '#ff0000', fill: null, opacity: 1, fillOpacity: 1, width: 1, lineStyle: 'solid' as const, fontSize: 10 };
const mk = (type: Markup['type'], points: Markup['points'], extra: Partial<Markup> = {}): Markup => ({
  id: 'm', type, page: 0, points, style, subject: '', label: '', comment: '', author: '', created: '', modified: '', status: 'None', ...extra,
});
const near = (p: { x: number; y: number }, x: number, y: number) => { expect(p.x).toBeCloseTo(x, 6); expect(p.y).toBeCloseTo(y, 6); };

describe('markup rotation', () => {
  it('snaps to 15° steps unless free, and normalises angles', () => {
    expect(snapRotation(22, false)).toBe(15);
    expect(snapRotation(23, false)).toBe(30);
    expect(snapRotation(22.4, true)).toBe(22);
    expect(normDeg(190)).toBe(-170);
    expect(normDeg(-180)).toBe(180);
    expect(normDeg(360)).toBe(0);
  });
  it('turns points counter-clockwise about a centre (page space, y down)', () => {
    near(rotatePt({ x: 10, y: 0 }, { x: 0, y: 0 }, 90), 0, -10);
    near(rotatePt({ x: 10, y: 0 }, { x: 0, y: 0 }, -90), 0, 10);
    expect(angleAbout({ x: 0, y: 0 }, { x: 0, y: -5 })).toBeCloseTo(90, 6);
  });
  it('rotates point shapes by their points and box shapes by a rotation field', () => {
    const poly = mk('polygon', [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]);
    const r = rotated(poly, 90);
    near(r.points![0], 0, 10); near(r.points![1], 0, 0);
    expect(r.rotation).toBeUndefined();
    const box = mk('rectangle', [{ x: 0, y: 0 }, { x: 20, y: 10 }]);
    expect(rotated(box, 30)).toEqual({ rotation: 30 });
    expect(rotated({ ...box, rotation: 350 }, 30)).toEqual({ rotation: 20 });
    expect(rotated({ ...box, rotation: 30 }, -30)).toEqual({ rotation: undefined });
    expect(withRotation(box, 45)).toEqual({ rotation: 45 });
    expect(rotated(box, 0)).toEqual({});
  });
  it('tells which markups can turn', () => {
    expect(canRotate(mk('line', [{ x: 0, y: 0 }, { x: 1, y: 1 }]))).toBe(false);
    expect(canRotate(mk('textbox', [{ x: 0, y: 0 }, { x: 1, y: 1 }]))).toBe(true);
    expect(canRotate(mk('textbox', [{ x: 0, y: 0 }, { x: 1, y: 1 }], { locked: true }))).toBe(false);
    expect(canRotate(mk('area', [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]))).toBe(true);
  });
  it('gives the drawn corners of a turned box, maps pointers back, and places the handle above it', () => {
    const box = mk('rectangle', [{ x: 0, y: 0 }, { x: 20, y: 10 }], { rotation: 90 });
    const d = drawnPoints(box);
    near(d[0], 5, 15); near(d[1], 15, -5);
    near(unrotatePt(box, d[1]), 20, 10);
    const h = rotateHandle(box, 4);
    near(h.from, 5, 5); near(h.at, 1, 5);
    const flat = rotateHandle(mk('rectangle', [{ x: 0, y: 0 }, { x: 20, y: 10 }]), 4);
    near(flat.at, 10, -4);
  });
});
