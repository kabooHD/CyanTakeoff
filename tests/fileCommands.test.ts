import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import { cropRect } from '../src/model/cropImage';
import { describeUndo } from '../src/ui/UndoHistory';
import { signPdf, verifySignatures } from '../src/pdf/sign';

describe('Crop Image', () => {
  it('maps the dragged area to source pixels and clips it to the image', () => {
    const pts = [{ x: 100, y: 100 }, { x: 300, y: 200 }]; // 200 × 100 pt showing a 400 × 200 px picture
    const c = cropRect(pts, 400, 200, { x: 150, y: 120 }, { x: 250, y: 180 })!;
    expect(c.box).toEqual([{ x: 150, y: 120 }, { x: 250, y: 180 }]);
    expect([c.sx, c.sy, c.sw, c.sh]).toEqual([100, 40, 200, 120]);
    const clipped = cropRect(pts, 400, 200, { x: 0, y: 0 }, { x: 200, y: 150 })!;
    expect(clipped.box[0]).toEqual({ x: 100, y: 100 });
    expect(cropRect(pts, 400, 200, { x: 500, y: 500 }, { x: 600, y: 600 })).toBeNull();
  });
});

describe('Undo History', () => {
  it('describes the kinds of undo steps', () => {
    expect(describeUndo([])).toBe('Markups');
    expect(describeUndo({ markups: [], calibrations: [], viewports: [] })).toBe('Scale and viewports');
    expect(describeUndo({ doc: {} as never })).toBe('Pages / document');
  });
});

describe('Certify Document', () => {
  const p12 = new Uint8Array(readFileSync('tests/fixtures/test-cert.p12'));
  it('writes a DocMDP certification and reports it on verification', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([300, 200]);
    const orig = await doc.save({ useObjectStreams: false });
    const signed = await signPdf(orig, { p12, password: 'test', certify: 2, date: new Date('2026-01-01T00:00:00Z') });
    const again = await PDFDocument.load(signed);
    const perms = again.catalog.lookup(PDFName.of('Perms'), PDFDict);
    const sig = again.context.lookup(perms.get(PDFName.of('DocMDP')), PDFDict);
    expect(sig.lookup(PDFName.of('Reference'))?.toString()).toContain('/DocMDP');
    const infos = await verifySignatures(signed);
    expect(infos).toHaveLength(1);
    expect(infos[0].certified).toBe(2);
    await expect(signPdf(signed, { p12, password: 'test', certify: 1 })).rejects.toThrow(/first signature/);
  });
});
