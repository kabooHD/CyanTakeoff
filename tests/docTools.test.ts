import { describe, expect, it } from 'vitest';
import { PDFArray, PDFDocument, PDFName } from 'pdf-lib';
import { blankPdf, cropOf, cropPages, rotateContent } from '../src/pdf/docTools';
import { streamBytes } from '../src/pdf/redactContent';

describe('Crop Pages', () => {
  it('crops to a rectangle, by margins, and removes the crop', async () => {
    const doc = await PDFDocument.load(await blankPdf(3, 600, 400));
    expect(cropPages(doc, [0, 1], { rect: [100, 50, 500, 350] })).toBe(2);
    expect(cropOf(doc.getPage(1))).toEqual([100, 50, 500, 350]);
    cropPages(doc, [1], { margins: [10, 20, 30, 40] });
    expect(cropOf(doc.getPage(1))).toEqual([110, 70, 470, 310]);
    // Kept inside the media box.
    cropPages(doc, [2], { rect: [-50, -50, 700, 300] });
    expect(cropOf(doc.getPage(2))).toEqual([0, 0, 600, 300]);
    cropPages(doc, [0, 1, 2], null);
    expect(cropOf(doc.getPage(0))).toEqual([0, 0, 600, 400]);
    const again = await PDFDocument.load(await doc.save());
    expect(again.getPage(0).node.has(PDFName.of('CropBox'))).toBe(false);
  });
});

describe('Deskew content rotation', () => {
  it('wraps the page content in a rotation about the centre', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([600, 400]).drawRectangle({ x: 10, y: 10, width: 20, height: 20 });
    rotateContent(doc, 0, 2);
    const again = await PDFDocument.load(await doc.save());
    const cs = again.getPage(0).node.lookup(PDFName.of('Contents'), PDFArray);
    const text = cs.asArray().map((r) => new TextDecoder().decode(streamBytes(again.context.lookup(r) as never))).join('|');
    expect(text.startsWith('q 0.999391 0.034899 -0.034899 0.999391')).toBe(true);
    expect(text.split('|')).toHaveLength(3); // before, the original content, after
    expect(text.trim().endsWith('Q')).toBe(true);
  });
});
