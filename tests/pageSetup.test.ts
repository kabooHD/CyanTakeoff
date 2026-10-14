import { describe, expect, it } from 'vitest';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName } from 'pdf-lib';
import { labelsFromBookmarks, numberPages, numeral } from '../src/model/pageLabels';
import { pageSetup, pageSetupTransform } from '../src/pdf/docTools';
import { readMeasure } from '../src/pdf/pdfutil';

describe('page labels', () => {
  it('numerals in every style', () => {
    expect([1, 4, 9, 14, 27].map((n) => numeral('roman-upper', n))).toEqual(['I', 'IV', 'IX', 'XIV', 'XXVII']);
    expect([1, 26, 27, 28].map((n) => numeral('alpha-upper', n))).toEqual(['A', 'Z', 'AA', 'BB']);
    expect(numeral('alpha-lower', 2)).toBe('b');
    expect(numeral('none', 5)).toBe('');
  });
  it('renumbers a range with a prefix from a start', () => {
    expect(numberPages(['a', 'b', 'c', 'd'], [1, 2], 'decimal', 'P-', 10)).toEqual(['a', 'P-10', 'P-11', 'd']);
    expect(numberPages(['a', 'b'], [0], 'none', '', 1)).toEqual(['', 'b']);
  });
  it('labels from bookmarks take the first bookmark of each page', () => {
    const bm = [{ id: '1', title: 'Cover', page: 0, open: false, kids: [{ id: '2', title: 'Plan', page: 1, open: false, kids: [] }] }, { id: '3', title: 'Plan again', page: 1, open: false, kids: [] }];
    expect(labelsFromBookmarks(['1', '2', '3'], bm, [0, 1, 2])).toEqual(['Cover', 'Plan', '3']);
    expect(labelsFromBookmarks(['1', '2', '3'], bm, [1])).toEqual(['1', 'Plan', '3']);
  });
});

describe('Page Setup', () => {
  const opts = { width: 400, height: 200, autoScale: true, scale: 1, align: 'center' as const, valign: 'middle' as const, offset: [0, 0] as [number, number] };
  it('fits and centres the crop box on the new media', () => {
    expect(pageSetupTransform([0, 0, 200, 100], opts)).toEqual({ s: 2, tx: 0, ty: 0 });
    expect(pageSetupTransform([0, 0, 100, 100], opts)).toEqual({ s: 2, tx: 100, ty: 0 });
    expect(pageSetupTransform([10, 10, 110, 110], { ...opts, align: 'left', valign: 'bottom', offset: [36, 0] })).toEqual({ s: 2, tx: 36 - 20, ty: -20 });
    expect(pageSetupTransform([0, 0, 100, 100], { ...opts, autoScale: false, scale: 0.5 }).s).toBe(0.5);
  });
  it('scales content, annotations, CTData and measurement scales', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 100]);
    page.drawRectangle({ x: 10, y: 10, width: 50, height: 30 });
    const ctx = doc.context;
    const measure = ctx.obj({ Type: 'Measure', Subtype: 'RL', R: PDFHexString.fromText('1 in = 1 ft'), X: [{ Type: 'NumberFormat', U: PDFHexString.fromText('ft'), C: 1 / 72, D: 100 }], D: [{ Type: 'NumberFormat', U: PDFHexString.fromText('ft'), C: 1, D: 100 }], A: [{ Type: 'NumberFormat', U: PDFHexString.fromText('sq ft'), C: 1, D: 100 }] });
    const annot = ctx.obj({ Type: 'Annot', Subtype: 'Square', Rect: [10, 10, 60, 40], CTData: PDFHexString.fromText(JSON.stringify({ v: 1, type: 'area', cutouts: [{ kind: 'polygon', points: [20, 20, 30, 20, 30, 30] }] })), Measure: measure }) as PDFDict;
    page.node.set(PDFName.of('Annots'), ctx.obj([ctx.register(annot)]));
    const before = readMeasure(doc, measure)!;
    expect(pageSetup(doc, [0], opts)).toBe(1);
    const again = await PDFDocument.load(await doc.save());
    const p = again.getPage(0);
    expect([p.getWidth(), p.getHeight()]).toEqual([400, 200]);
    const a = again.context.lookup(p.node.lookup(PDFName.of('Annots'), PDFArray).get(0), PDFDict);
    expect(a.lookup(PDFName.of('Rect'), PDFArray).asArray().map((x) => Number(x.toString()))).toEqual([20, 20, 120, 80]);
    const ct = JSON.parse((a.lookup(PDFName.of('CTData')) as PDFHexString).decodeText());
    expect(ct.cutouts[0].points).toEqual([40, 40, 60, 40, 60, 60]);
    const after = readMeasure(again, a.lookup(PDFName.of('Measure'), PDFDict))!;
    expect(after.factor).toBeCloseTo(before.factor / 2);
    const content = p.node.lookup(PDFName.of('Contents'), PDFArray);
    expect(content.size()).toBe(3);
  });
});
