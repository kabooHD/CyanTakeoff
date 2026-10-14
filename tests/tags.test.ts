import { describe, expect, it } from 'vitest';
import { autoTags, compareSheetNumbers, disciplineOf, drawingLogCsv, drawingLogRows, logTitle, sheetTypeOf, type LogSheet } from '../src/model/tags';

describe('Set tags', () => {
  it('derives Discipline and Sheet Type from the sheet number', () => {
    expect(disciplineOf('A-101')).toBe('Architectural');
    expect(disciplineOf('FP2.01')).toBe('Fire Protection');
    expect(disciplineOf('m 301')).toBe('Mechanical');
    expect(disciplineOf('101')).toBe('');
    expect(sheetTypeOf('A-101')).toBe('Plans');
    expect(sheetTypeOf('S-501')).toBe('Details');
    expect(sheetTypeOf('E-901')).toBe('3D Representations');
  });
  it('fills empty derived tags only', () => {
    const tags = [{ name: 'Sheet Number', type: 'text' as const }, { name: 'Discipline', type: 'text' as const }, { name: 'Sheet Type', type: 'text' as const }];
    expect(autoTags({ 'Sheet Number': 'C-101' }, tags)).toEqual({ 'Sheet Number': 'C-101', Discipline: 'Civil', 'Sheet Type': 'Plans' });
    expect(autoTags({ 'Sheet Number': 'C-101', Discipline: 'Site' }, tags).Discipline).toBe('Site');
    expect(autoTags({ 'Sheet Name': 'x' }, tags)).toEqual({ 'Sheet Name': 'x' });
  });
  it('sorts sheet numbers naturally', () => {
    expect(['A-10', 'A-2', 'S-1', 'A-2.1', 'a-1'].sort(compareSheetNumbers)).toEqual(['a-1', 'A-2', 'A-2.1', 'A-10', 'S-1']);
  });
  it('builds the drawing log in the chosen element order, sorted by sheet number, and as CSV', () => {
    const sheets: LogSheet[] = [
      { docName: 'set.pdf', page: 1, label: 'C-101', values: { 'Sheet Number': 'C-101', 'Sheet Name': 'Site, Plan' } },
      { docName: 'set.pdf', page: 0, label: 'A-101', values: { 'Sheet Number': 'A-101', 'Sheet Name': 'Floor Plan' } },
    ];
    const rows = drawingLogRows(sheets, ['Sheet Number', 'Sheet Name', 'Page Index', 'File Name']);
    expect(rows).toEqual([['A-101', 'Floor Plan', '1', 'set.pdf'], ['C-101', 'Site, Plan', '2', 'set.pdf']]);
    expect(drawingLogCsv(['Sheet Number', 'Sheet Name'], [['C-101', 'Site, Plan']])).toBe('Sheet Number,Sheet Name\r\nC-101,"Site, Plan"');
  });
  it('titles the log with the set name and date', () => {
    expect(logTitle('Drawing Log', 'Tower', true, true, new Date(2026, 9, 14))).toBe('Tower Drawing Log 2026-10-14');
    expect(logTitle('Drawing Log', 'Tower', false, false)).toBe('Drawing Log');
  });
});
