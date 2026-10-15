import { describe, expect, it } from 'vitest';
import { pruneRecent } from '../src/model/recent';
import { wrapPage } from '../src/model/presentation';

describe('File Access preferences', () => {
  const r = (name: string, opened: string, pinned?: boolean) => ({ name, size: 1, opened, pinned });
  const list = [r('old.pdf', '2026-01-01T00:00:00Z'), r('a.pdf', '2026-10-10T00:00:00Z'), r('b.pdf', '2026-10-12T00:00:00Z'), r('p.pdf', '2025-01-01T00:00:00Z', true)];
  it('keeps the newest files up to the limit, drops old ones, always keeps pinned', () => {
    const now = new Date('2026-10-15T00:00:00Z');
    expect(pruneRecent(list, 1, 90, now).map((x) => x.name)).toEqual(['p.pdf', 'b.pdf']);
    expect(pruneRecent(list, 10, 90, now).map((x) => x.name)).toEqual(['p.pdf', 'b.pdf', 'a.pdf']);
    expect(pruneRecent(list, 10, 0, now).map((x) => x.name)).toEqual(['p.pdf', 'b.pdf', 'a.pdf', 'old.pdf']);
  });
});

describe('Presentation: Loop after last page', () => {
  it('wraps around only when looping', () => {
    expect(wrapPage(5, 5, true)).toBe(0);
    expect(wrapPage(-1, 5, true)).toBe(4);
    expect(wrapPage(5, 5, false)).toBe(4);
    expect(wrapPage(-1, 5, false)).toBe(0);
    expect(wrapPage(2, 0, true)).toBe(0);
  });
});
