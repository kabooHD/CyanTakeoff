import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { buildSummaryPdf } from '../src/pdf/summary';

describe('PDF summary', () => {
  it('paginates rows onto landscape pages', async () => {
    const rows = Array.from({ length: 80 }, (_, i) => [`Markup ${i}`, i, `${i} sf`]);
    const bytes = await buildSummaryPdf({ title: 'Markups Summary: test.pdf', subtitle: 'x', header: ['Subject', 'Count', 'Measurement'], rows, totals: ['Total', 3160, ''], numeric: [false, true, false] });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(3);
    expect(doc.getPage(0).getSize()).toEqual({ width: 792, height: 612 });
  });
});
