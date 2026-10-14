import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { bookmarkLines, buildBookmarksPdf } from '../src/pdf/bookmarksReport';

const sections = [
  { name: 'plans.pdf', rows: [{ depth: 0, title: 'Floor Plan', page: 'A-101' }, { depth: 1, title: 'Detail', page: 'A-102' }, { depth: 0, title: 'Web', page: '' }] },
  { name: 'specs.pdf', rows: [{ depth: 0, title: 'Division 1', page: '1' }] },
];

describe('Export Bookmarks (PDF)', () => {
  it('lists each file with its bookmarks indented by level', () => {
    expect(bookmarkLines(sections)).toEqual(['plans.pdf', 'Floor Plan\tA-101', '  Detail\tA-102', 'Web\t', 'specs.pdf', 'Division 1\t1']);
  });
  it('builds a titled PDF with the list, adding pages as needed', async () => {
    const doc = await PDFDocument.load(await buildBookmarksPdf(sections));
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getTitle()).toBe('Bookmarks');
    const many = [{ name: 'big.pdf', rows: Array.from({ length: 120 }, (_, i) => ({ depth: i % 3, title: `Sheet ${i + 1}`, page: String(i + 1) })) }];
    expect((await PDFDocument.load(await buildBookmarksPdf(many))).getPageCount()).toBeGreaterThan(1);
  });
});
