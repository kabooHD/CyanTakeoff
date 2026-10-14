import { describe, expect, it } from 'vitest';
import { STAMP_ANCHORS, stampPlacement } from '../src/model/batchStamp';

describe('Apply Stamp placement', () => {
  it('puts the stamp centre inside the margin at each anchor', () => {
    expect(stampPlacement(1000, 500, 160, 40, 'top-left', 36)).toEqual({ x: 116, y: 56 });
    expect(stampPlacement(1000, 500, 160, 40, 'bottom-right', 36)).toEqual({ x: 884, y: 444 });
    expect(stampPlacement(1000, 500, 160, 40, 'center', 36)).toEqual({ x: 500, y: 250 });
    expect(stampPlacement(1000, 500, 160, 40, 'top-center', 0)).toEqual({ x: 500, y: 20 });
    expect(STAMP_ANCHORS).toHaveLength(9);
  });
});
