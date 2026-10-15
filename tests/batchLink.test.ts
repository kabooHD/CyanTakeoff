import { describe, expect, it } from 'vitest';
import { batchLinkReportCsv, linkTargets } from '../src/model/batchLink';

describe('batch link', () => {
  const docs = [{ id: 'a', name: 'A-101.pdf', labels: ['A-101', '2'] }, { id: 'b', name: 'specs.pdf', labels: ['1', 'S-1'] }];
  it('takes terms from page labels (not plain numbers) or from file names', () => {
    expect(linkTargets(docs, 'label')).toEqual([{ docId: 'a', docName: 'A-101.pdf', page: 0, label: 'A-101' }, { docId: 'b', docName: 'specs.pdf', page: 1, label: 'S-1' }]);
    expect(linkTargets(docs, 'filename')).toEqual([{ docId: 'a', docName: 'A-101.pdf', page: 0, label: 'A-101' }, { docId: 'b', docName: 'specs.pdf', page: 0, label: 'specs' }]);
  });
  it('writes the summary report with totals', () => {
    const csv = batchLinkReportCsv([{ document: 'A-101.pdf', page: 'A-101', created: 2, replaced: 1, note: '' }, { document: 'scan.pdf', page: '1', created: 0, replaced: 0, note: 'no searchable text' }]);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('Document,Page,Links created,Links replaced,Note');
    expect(lines[1]).toBe('A-101.pdf,A-101,2,1,');
    expect(lines[3]).toBe('Total,,2,1,1 page(s) skipped');
  });
});
