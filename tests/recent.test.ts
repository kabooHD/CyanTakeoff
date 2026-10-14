import { describe, expect, it } from 'vitest';
import { addToRecent, sortRecent, type RecentFile } from '../src/model/recent';

const r = (name: string, opened: string, pinned?: boolean): RecentFile => ({ name, size: 1, opened, pinned });

describe('recent files', () => {
  it('puts the newest first and replaces a file with the same name', () => {
    const l = addToRecent([r('a.pdf', '2026-01-01'), r('b.pdf', '2026-01-02')], r('a.pdf', '2026-02-01'));
    expect(l.map((x) => x.name)).toEqual(['a.pdf', 'b.pdf']);
    expect(l).toHaveLength(2);
  });
  it('keeps pinned files on top and beyond the limit', () => {
    let l = [r('p.pdf', '2025-01-01', true)];
    for (let i = 0; i < 5; i++) l = addToRecent(l, r(`f${i}.pdf`, `2026-01-0${i + 1}`), 3);
    expect(l.map((x) => x.name)).toEqual(['p.pdf', 'f4.pdf', 'f3.pdf', 'f2.pdf']);
  });
  it('keeps the pin and handle when a file is reopened without them', () => {
    const h = {} as FileSystemFileHandle;
    const l = addToRecent([{ ...r('a.pdf', '2026-01-01', true), handle: h }], r('a.pdf', '2026-03-01'));
    expect(l[0].pinned).toBe(true);
    expect(l[0].handle).toBe(h);
  });
  it('sorts pinned first, then by date', () => {
    expect(sortRecent([r('a', '1'), r('b', '3'), r('c', '2', true)]).map((x) => x.name)).toEqual(['c', 'b', 'a']);
  });
});
