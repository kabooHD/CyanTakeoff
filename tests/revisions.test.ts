import { describe, expect, it } from 'vitest';
import { DEFAULT_SET_OPTIONS, compareRevisions, displayName, latestRevisions, previousRevisions, sortSheets, splitRevision, stackRevisions, type SetSheet } from '../src/model/revisions';

const auto = { filter: 'auto' as const, pattern: '' };
const sheet = (docName: string, page: number, label: string, extra: Partial<SetSheet> = {}): SetSheet => ({ key: `${docName}#${page}`, docId: docName, docName, page, label, ...extra });

describe('Set revisions', () => {
  it('splits revision suffixes from names (Auto)', () => {
    expect(splitRevision('A-101.pdf', auto)).toEqual({ base: 'A-101', rev: null });
    expect(splitRevision('A-101 R2.pdf', auto)).toEqual({ base: 'A-101', rev: '2' });
    expect(splitRevision('A-101_rev-B', auto)).toEqual({ base: 'A-101', rev: 'B' });
    expect(splitRevision('A-101 B', auto)).toEqual({ base: 'A-101', rev: 'B' });
    expect(splitRevision('A-101_3', auto)).toEqual({ base: 'A-101', rev: '3' });
    expect(splitRevision('Plan (2)', auto)).toEqual({ base: 'Plan', rev: '2' });
    expect(splitRevision('Site Plan', auto)).toEqual({ base: 'Site Plan', rev: null });
    expect(splitRevision('A-101 R2', { filter: 'off', pattern: '' })).toEqual({ base: 'A-101 R2', rev: null });
    expect(splitRevision('A-101-C3', { filter: 'wildcard', pattern: 'C#' })).toEqual({ base: 'A-101', rev: 'C3' });
  });
  it('orders revisions: none, then numbers, then letters', () => {
    expect([ 'B', '2', null, '10', 'A'].sort(compareRevisions)).toEqual([null, '2', '10', 'A', 'B']);
  });
  it('stacks sheets by base name with the latest revision current', () => {
    const sheets = [sheet('A-101.pdf', 0, '1'), sheet('A-101 R2.pdf', 0, '1'), sheet('A-101 R1.pdf', 0, '1'), sheet('A-102.pdf', 0, '1')];
    const stacks = stackRevisions(sheets, DEFAULT_SET_OPTIONS);
    expect(stacks.map((s) => [s.base, s.sheets.length, s.latest.docName])).toEqual([['A-101', 3, 'A-101 R2.pdf'], ['A-102', 1, 'A-102.pdf']]);
    expect([...previousRevisions(stacks)]).toEqual(['A-101.pdf#0', 'A-101 R1.pdf#0']);
    expect([...latestRevisions(stacks)]).toEqual(['A-101 R2.pdf#0', 'A-102.pdf#0']);
    // The pages of one file are sheets of their own, not revisions of each other.
    expect(stackRevisions([sheet('A-1.pdf', 0, '1'), sheet('A-1.pdf', 1, '2'), sheet('A-1 R2.pdf', 1, '2')], DEFAULT_SET_OPTIONS).map((s) => s.sheets.length)).toEqual([1, 2]);
    // The same file opened twice is two sheets, not two revisions.
    expect(stackRevisions([sheet('A-1.pdf', 0, '1'), sheet('A-1.pdf', 0, '1')], DEFAULT_SET_OPTIONS)).toHaveLength(2);
    // By label: revisions come from the page labels instead.
    const byLabel = stackRevisions([sheet('set.pdf', 0, 'A-101'), sheet('set.pdf', 1, 'A-101 R1')], { ...DEFAULT_SET_OPTIONS, sortBy: 'label' });
    expect(byLabel).toHaveLength(1);
    expect(byLabel[0].latest.page).toBe(1);
  });
  it('sorts alphanumerically or alphabetically, ascending or descending, and names sheets', () => {
    const sheets = [sheet('b.pdf', 0, 'A-10'), sheet('a.pdf', 1, 'A-2'), sheet('a.pdf', 0, 'A-10')];
    expect(sortSheets(sheets, { ...DEFAULT_SET_OPTIONS, sortBy: 'label' }).map((s) => s.key)).toEqual(['a.pdf#1', 'a.pdf#0', 'b.pdf#0']);
    expect(sortSheets(sheets, { ...DEFAULT_SET_OPTIONS, sortBy: 'label', order: 'alpha-asc' }).map((s) => s.label)).toEqual(['A-10', 'A-10', 'A-2']);
    expect(sortSheets(sheets, { ...DEFAULT_SET_OPTIONS, sortBy: 'name-index', order: 'alnum-desc' }).map((s) => s.key)).toEqual(['b.pdf#0', 'a.pdf#0', 'a.pdf#1']); // files descending, pages in order
    const s = sheet('plans.pdf', 0, '3', { sheetNumber: 'A-101', sheetName: 'Floor Plan' });
    expect(displayName(s, 'label')).toBe('3');
    expect(displayName(s, 'filename')).toBe('plans');
    expect(displayName(s, 'name-label')).toBe('plans · 3');
    expect(displayName(s, 'sheetNumber')).toBe('A-101');
    expect(displayName(s, 'sheetName')).toBe('A-101 Floor Plan');
  });
});
