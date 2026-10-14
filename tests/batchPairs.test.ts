import { describe, expect, it } from 'vitest';
import { batchReportCsv, matchKey, pairSheets, type SheetRef } from '../src/model/batchPairs';

const sheet = (docId: string, docName: string, page: number, label: string): SheetRef => ({ docId, docName, page, label });

describe('batch page pairing', () => {
  const cur = [sheet('a', 'Plan Rev A.pdf', 0, 'A-101'), sheet('a', 'Plan Rev A.pdf', 1, 'A-102'), sheet('m', 'Mech.pdf', 0, 'M-1')];
  const rev = [sheet('b', 'plan rev a.PDF', 0, 'A-101'), sheet('b', 'plan rev a.PDF', 1, 'A-102 (rev 2)'), sheet('e', 'Elec.pdf', 0, 'E-1')];

  it('pairs by file name (case and extension ignored) and page index', () => {
    const p = pairSheets(cur, rev, 'name-index');
    expect(p.map((x) => [x.a.page, x.b.docId, x.b.page])).toEqual([[0, 'b', 0], [1, 'b', 1]]);
  });
  it('pairs by page label, and a match filter picks the sheet number out of a longer label', () => {
    expect(pairSheets(cur, rev, 'label').map((x) => x.a.label)).toEqual(['A-101']);
    expect(pairSheets(cur, rev, 'label', '?-###').map((x) => [x.a.label, x.b.label])).toEqual([['A-101', 'A-101'], ['A-102', 'A-102 (rev 2)']]);
  });
  it('match filter wildcards: * non-numeric, # numbers, ? a letter, ; alternatives', () => {
    expect(matchKey('Sheet A-101 rev 2', '?-###')).toBe('a-101');
    expect(matchKey('M12', '?##;?-###')).toBe('m12');
    expect(matchKey('no number', '#')).toBe('');
    expect(matchKey('  Mixed Case ', '')).toBe('mixed case');
  });
  it('never pairs a sheet with itself and uses each revised sheet once', () => {
    const same = [sheet('a', 'x.pdf', 0, '1')];
    expect(pairSheets(same, same, 'label')).toEqual([]);
    const twice = [sheet('a', 'x.pdf', 0, '1'), sheet('c', 'y.pdf', 0, '1')];
    expect(pairSheets(twice, [sheet('b', 'z.pdf', 0, '1')], 'label')).toHaveLength(1);
  });
  it('writes the CSV report with quoted cells', () => {
    expect(batchReportCsv([{ current: 'a "1"', revised: 'b', result: '3' }], 'Differences')).toBe('Current,Revised,Differences\r\n"a ""1""","b","3"');
  });
});
