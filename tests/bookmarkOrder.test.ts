import { describe, expect, it } from 'vitest';
import { isPageOrdered, reorderByPage } from '../src/model/bookmarkOrder';

describe('Automatically Reorder Bookmarks', () => {
  it('sorts page jumps by page and keeps the others in place', () => {
    const list = [{ t: 'Plans', page: 2 }, { t: 'Web', page: null }, { t: 'Cover', page: 0 }, { t: 'Details', page: 1 }];
    expect(reorderByPage(list).map((b) => b.t)).toEqual(['Cover', 'Web', 'Details', 'Plans']);
    expect(isPageOrdered(list)).toBe(false);
    expect(isPageOrdered(reorderByPage(list))).toBe(true);
  });
  it('is stable for bookmarks on the same page', () => {
    const list = [{ t: 'B', page: 1 }, { t: 'A', page: 0 }, { t: 'C', page: 1 }];
    expect(reorderByPage(list).map((b) => b.t)).toEqual(['A', 'B', 'C']);
  });
});
