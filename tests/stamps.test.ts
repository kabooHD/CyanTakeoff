import { describe, expect, it } from 'vitest';
import { PDFArray, PDFDocument, PDFName, degrees, type PDFStream } from 'pdf-lib';
import { addHeaderFooter, addWatermark, batesText, expandTokens, pageToPdf, removeArtifacts } from '../src/pdf/stamps';
import { streamBytes } from '../src/pdf/redactContent';
import { latin1 } from '../src/pdf/content';

const all = (doc: PDFDocument, i: number) => (doc.getPage(i).node.lookup(PDFName.of('Contents'), PDFArray)).asArray()
  .map((r) => latin1(streamBytes(doc.context.lookup(r) as PDFStream))).join('\n');
const hexOf = (s: string) => Array.from(s, (c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('').toUpperCase();

describe('header, footer, Bates, watermark', () => {
  it('maps displayed page points to PDF space for each page rotation', () => {
    const box = { x: 0, y: 0, w: 600, h: 400 };
    expect(pageToPdf(10, 20, box, 0)).toEqual([10, 380]);
    expect(pageToPdf(10, 20, box, 90)).toEqual([20, 10]);
    expect(pageToPdf(10, 20, box, 180)).toEqual([590, 20]);
    expect(pageToPdf(10, 20, box, 270)).toEqual([580, 390]);
  });

  it('expands tokens and Bates numbers', () => {
    expect(batesText({ prefix: 'ABC', suffix: '', start: 7, digits: 6 }, 7)).toBe('ABC000007');
    const t = expandTokens('Sheet <<Page Label>> (<<Page>> of <<Pages>>) <<File Name>> <<Bates>>', { page: 1, pages: 3, label: 'A-102', date: new Date(), file: 'Set.pdf', bates: 'X01' });
    expect(t).toBe('Sheet A-102 (2 of 3) Set.pdf X01');
  });

  it('writes them as removable pagination artifacts', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([600, 400]); doc.addPage([600, 400]).setRotation(degrees(90));
    await addHeaderFooter(doc, {
      texts: { hc: 'PROJECT X', fr: '<<Bates>>' }, font: 'Helvetica', size: 10, color: [0, 0, 0],
      margins: { top: 18, bottom: 18, left: 18, right: 18 }, pages: [0, 1], bates: { prefix: 'B', suffix: '', start: 1, digits: 4 }, fileName: 'a.pdf', date: new Date(),
    }, ['1', '2']);
    await addWatermark(doc, { text: 'DRAFT', font: 'Helvetica', size: 60, color: [1, 0, 0], opacity: 0.3, angle: 45, behind: true, pages: [0] });
    const again = await PDFDocument.load(await doc.save());
    const c0 = all(again, 0), c1 = all(again, 1);
    expect(c0).toContain('/Artifact <</Type /Pagination /Subtype /Header /CTKind /Header>> BDC');
    expect(c0).toContain(hexOf('B0001'));
    expect(c1).toContain(hexOf('B0002'));
    // The watermark is drawn first (behind the page content).
    const first = latin1(streamBytes(again.context.lookup(again.getPage(0).node.lookup(PDFName.of('Contents'), PDFArray).get(0)) as PDFStream));
    expect(first).toContain('/CTKind /Watermark');
    expect(removeArtifacts(again, 'Watermark')).toBe(1);
    expect(all(again, 0)).not.toContain('Watermark');
    expect(all(again, 0)).toContain('/CTKind /Header');
    expect(removeArtifacts(again, 'Header')).toBe(2);
    expect(all(again, 1)).not.toContain(hexOf('B0002'));
  });
});
