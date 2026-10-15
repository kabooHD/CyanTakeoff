import { describe, expect, it } from 'vitest';
import { sessionFiles } from '../src/model/session';

describe('Reopen Files from Last Session', () => {
  const h = {} as FileSystemFileHandle;
  const recent = [{ name: 'A-101.pdf', size: 1, opened: '2026-01-01', handle: h }, { name: 'no-access.pdf', size: 1, opened: '2026-01-01' }];
  it('keeps the session order, reopens files with a handle and the sample, lists the rest', () => {
    const r = sessionFiles(['no-access.pdf', 'Sample.pdf', 'A-101.pdf', 'gone.pdf'], recent, 'Sample.pdf');
    expect(r.files.map((f) => f.name)).toEqual(['Sample.pdf', 'A-101.pdf']);
    expect(r.missing).toEqual(['no-access.pdf', 'gone.pdf']);
  });
});
