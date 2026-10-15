import { describe, expect, it } from 'vitest';
import { slipPlan, slipReportRows, supersededIndex } from '../src/model/slipSheet';

describe('slip sheet plan', () => {
  it('pairs revised pages with current ones by label, with a wildcard filter, or by index', () => {
    const cur = ['A-101', 'A-102', 'C-101'];
    expect(slipPlan(cur, ['A-102', 'A-101', 'E-1'], 'label')).toEqual({ matched: [{ src: 0, at: 1 }, { src: 1, at: 0 }], extra: [2] });
    expect(slipPlan(cur, ['A-101 R2', 'C-101 R2'], 'label', '?-###')).toEqual({ matched: [{ src: 0, at: 0 }, { src: 1, at: 2 }], extra: [] });
    expect(slipPlan(cur, ['x', 'y', 'z', 'w'], 'index')).toEqual({ matched: [{ src: 0, at: 0 }, { src: 1, at: 1 }, { src: 2, at: 2 }], extra: [3] });
    expect(slipPlan(['A-101', 'A-101'], ['A-101'], 'label').matched).toEqual([{ src: 0, at: 0 }]); // each current page used once
  });
  it('finds where a superseded page lands after the insertions', () => {
    const matched = [{ src: 0, at: 0 }, { src: 1, at: 2 }];
    expect(supersededIndex(0, matched)).toBe(1);
    expect(supersededIndex(2, matched)).toBe(4);
  });
  it('writes report rows', () => {
    const plan = slipPlan(['A-101'], ['A-101', 'B-1'], 'label');
    expect(slipReportRows(['A-101'], ['A-101', 'B-1'], plan, 'insert')).toEqual([
      { current: 'A-101', revised: 'A-101', result: 'inserted before' }, { current: '', revised: 'B-1', result: 'no match' },
    ]);
  });
});
