import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { compressStreams, imagePlacements, oversizedJpegs, removeExtras, removeUnused } from '../src/pdf/reduce';

describe('Reduce File Size', () => {
  it('removes unused objects, compresses plain streams, drops thumbnails', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 200]);
    const ctx = doc.context;
    ctx.register(ctx.obj({ Orphan: true }));
    const plain = ctx.register(PDFRawStream.of(ctx.obj({}), new TextEncoder().encode('0 0 m 100 100 l S\n'.repeat(50))));
    page.node.set(PDFName.of('Contents'), plain);
    page.node.set(PDFName.of('Thumb'), ctx.register(ctx.stream('x')));
    expect(removeExtras(doc, { removeMetadata: false, removeThumbnails: true, removePrivateData: true })).toBe(1);
    expect(removeUnused(doc)).toBeGreaterThanOrEqual(2); // the orphan and the thumbnail
    expect(compressStreams(doc)).toBe(1);
    const s = ctx.lookup(plain) as PDFRawStream;
    expect(String(s.dict.get(PDFName.of('Filter')))).toBe('/FlateDecode');
    expect(s.contents.length).toBeLessThan(100);
    const again = await PDFDocument.load(await doc.save());
    expect(again.getPageCount()).toBe(1);
  });

  it('finds how large each JPEG is drawn and which are oversampled', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const ctx = doc.context;
    const img = ctx.register(PDFRawStream.of(ctx.obj({ Type: 'XObject', Subtype: 'Image', Width: 3000, Height: 1500, ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Filter: 'DCTDecode' }), new Uint8Array(10)));
    page.node.set(PDFName.of('Resources'), ctx.obj({ XObject: { Im1: img } }));
    // Drawn 2 in × 1 in (144 × 72 pt) once, and smaller once.
    page.node.set(PDFName.of('Contents'), ctx.register(ctx.stream('q 144 0 0 72 50 50 cm /Im1 Do Q q 2 0 0 2 0 0 cm q 10 0 0 5 0 0 cm /Im1 Do Q Q')));
    const p = imagePlacements(doc).get(img.tag)!;
    expect(p.w).toBeCloseTo(144); expect(p.h).toBeCloseTo(72);
    const big = oversizedJpegs(doc, 150);
    expect(big).toHaveLength(1);
    expect(big[0].targetW).toBe(300); expect(big[0].targetH).toBe(150);
    expect(oversizedJpegs(doc, 2000)).toHaveLength(0);
  });
});
