import { describe, expect, it } from 'vitest';
import { MOVABLE_CAPTION, captionAnchor, captionPosition, snapCaptionAngle } from '../src/model/measureDisplay';

describe('measurement captions', () => {
  const sq = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  it('anchors at the segment middle, the angle vertex or the centroid', () => {
    expect(captionAnchor('length', [{ x: 0, y: 0 }, { x: 10, y: 20 }])).toEqual({ x: 5, y: 7 });
    expect(captionAnchor('angle', [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 0 }])).toEqual({ x: 18, y: 2 });
    expect(captionAnchor('area', sq)).toEqual({ x: 5, y: 5 });
  });
  it('moves by the dragged offset', () => {
    expect(captionPosition({ type: 'area' }, sq)).toEqual({ x: 5, y: 5 });
    expect(captionPosition({ type: 'area', display: { captionOffset: { x: 3, y: -4 } } }, sq)).toEqual({ x: 8, y: 1 });
  });
  it('snaps the rotation to 15° (1° with Shift) and keeps it in 0..360', () => {
    expect(snapCaptionAngle(22, false)).toBe(15);
    expect(snapCaptionAngle(22.4, true)).toBe(22);
    expect(snapCaptionAngle(-10, false)).toBe(345);
    expect(MOVABLE_CAPTION.has('radius')).toBe(false);
    expect(MOVABLE_CAPTION.has('area')).toBe(true);
  });
});
