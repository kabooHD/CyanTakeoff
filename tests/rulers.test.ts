import { describe, expect, it } from 'vitest';
import { ViewHistory, rulerTicks } from '../src/model/rulers';

describe('rulers', () => {
  it('labels major ticks from the page edge in the chosen unit', () => {
    // 1 px per pt: an inch is 72 px, so majors every inch (>= 60 px).
    const t = rulerTicks(100, 400, 1, 'in');
    const majors = t.filter((x) => x.major);
    expect(majors.map((x) => x.label)).toEqual(['-1', '0', '1', '2', '3', '4']);
    expect(majors[2].px).toBeCloseTo(172);
    // Ticks before the page edge count negative.
    expect(rulerTicks(200, 300, 1, 'in').filter((x) => x.major)[0].label).toBe('-2');
  });
  it('picks a coarser step when zoomed out', () => {
    const majors = rulerTicks(0, 600, 0.05, 'in').filter((x) => x.major);
    expect(majors[1].label).toBe('20'); // 3.6 px/in -> 20 in = 72 px
    expect(rulerTicks(0, 600, 1, 'mm').filter((x) => x.major)[1].label).toBe('50');
  });
});

describe('Previous / Next View', () => {
  const v = (page: number, zoom = 1, cx = 0) => ({ docId: 'a', page, zoom, cx, cy: 0 });
  it('steps back and forward; recording after going back drops the forward views', () => {
    const h = new ViewHistory();
    h.record(v(0)); h.record(v(1)); h.record(v(1, 2)); h.record(v(1, 2, 50));
    expect(h.entries).toHaveLength(3); // same page and zoom: position updated
    expect(h.back()).toEqual(v(1));
    expect(h.back()).toEqual(v(0));
    expect(h.back()).toBeUndefined();
    expect(h.forward()).toEqual(v(1));
    h.record(v(5));
    expect(h.canForward).toBe(false);
    expect(h.entries.map((e) => e.page)).toEqual([0, 1, 5]);
  });
  it('forgets a closed document', () => {
    const h = new ViewHistory();
    h.record(v(0)); h.record({ ...v(0), docId: 'b' }); h.record(v(2));
    h.drop('b');
    expect(h.entries.map((e) => e.page)).toEqual([0, 2]);
    expect(h.index).toBe(1);
  });
});
