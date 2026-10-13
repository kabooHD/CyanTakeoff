// Compatibility tests against PDFs authored in Bluebeam Revu. Each Revu
// measurement stores the value Revu displayed in /Contents, which is used here
// as an independent answer key for CyanTakeoff's own calculations.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PDFArray, PDFDict, PDFDocument, PDFName } from 'pdf-lib';

const N = (s: string) => PDFName.of(s);
import { importAnnotations } from '../src/pdf/importAnnots';
import { measure } from '../src/model/measure';

const load = async (name: string) =>
  importAnnotations(await PDFDocument.load(readFileSync(`tests/fixtures/revu/${name}`), { updateMetadata: false }));

describe('Revu 20 measure.pdf', async () => {
  const { raws, pageScales, imported } = await load('measure.pdf');
  const byType = (t: string) => raws.filter((r) => r.markup.type === t);

  it('reads the page scale from the /VP viewport', () => {
    expect(pageScales[0]?.unit).toBe('ft-in');
    expect(pageScales[0]!.factor * 72).toBeCloseTo(4, 4); // 1/4" = 1'-0" -> 4 ft per paper inch
  });

  it('imports the measurement types CyanTakeoff edits', () => {
    expect(byType('length')).toHaveLength(1);
    expect(byType('area')).toHaveLength(1);
    expect(byType('polylength')).toHaveLength(1);
    expect(byType('perimeter')).toHaveLength(1);
    expect(byType('volume')).toHaveLength(1);
    expect(byType('count')).toHaveLength(1);
  });

  it('imports angle, diameter and the full-circle radius; keeps the partial-arc radius as-is', () => {
    expect(byType('angle')).toHaveLength(1);
    expect(byType('diameter')).toHaveLength(1);
    expect(byType('radius')).toHaveLength(1);
    expect(imported[0].size).toBe(9); // of 10: one radius drawn as a partial arc is preserved untouched
  });

  for (const type of ['length', 'area', 'polylength', 'perimeter', 'volume', 'angle', 'radius', 'diameter']) {
    it(`computes the same ${type} value Revu displayed`, () => {
      for (const r of byType(type)) {
        const m = measure({ ...r.markup, points: r.pdfPoints });
        expect(m?.text, `${r.markup.subject}`).toBe(r.displayed);
      }
    });
  }

  it('matches the count', () => {
    const c = byType('count')[0];
    expect(String(c.pdfPoints.length)).toBe(c.displayed);
  });
});

describe('Revu 20 count groups', async () => {
  it('markup-space.pdf: 15 grouped count items become one count of 15', async () => {
    const { raws } = await load('markup-space.pdf');
    const counts = raws.filter((r) => r.markup.type === 'count');
    const total = counts.reduce((n, r) => n + r.pdfPoints.length, 0);
    expect(counts.find((r) => r.pdfPoints.length === 15)?.displayed).toBe('15');
    for (const r of counts) expect(String(r.pdfPoints.length)).toBe(r.displayed);
    expect(total).toBeGreaterThanOrEqual(15);
  });

  it('markup-deep-spaces.pdf: counts on two pages', async () => {
    const { raws } = await load('markup-deep-spaces.pdf');
    for (const r of raws.filter((x) => x.markup.type === 'count')) expect(String(r.pdfPoints.length)).toBe(r.displayed);
    expect(new Set(raws.map((r) => r.markup.page))).toEqual(new Set([0, 1]));
  });
});

describe('round trip: Revu file -> CyanTakeoff save -> reopen', () => {
  it('rewritten measurements keep Revu values; unsupported ones are preserved', async () => {
    const { savePdf } = await import('../src/pdf/save');
    const bytes = readFileSync('tests/fixtures/revu/measure.pdf');
    const src = await PDFDocument.load(bytes, { updateMetadata: false });
    const first = importAnnotations(src);
    // Identity "viewport": the test keeps geometry in PDF space.
    const identity = { convertToPdfPoint: (x: number, y: number) => [x, y] };
    const pages = src.getPages().map((_, index) => ({ index, label: '', width: 0, height: 0, viewport: identity })) as never;
    const markups = first.raws.map((r) => ({
      ...r.markup, points: r.pdfPoints, source: { ...r.markup.source!, dirty: true }, // force rewrite
    }));
    const out = await savePdf({
      original: bytes, pages, markups,
      importedRefs: new Set(first.imported.flatMap((s) => [...s])),
      calibrations: first.pageScales, dirtyCalibrations: new Set(),
    });
    const again = await PDFDocument.load(out, { updateMetadata: false });
    const second = importAnnotations(again);
    const values = (r: typeof second.raws) => r.map((x) => `${x.markup.type}:${x.displayed}`).sort();
    expect(values(second.raws)).toEqual(values(first.raws));
    // the partial-arc radius is preserved; the rest are rewritten with Revu's intents
    const intents = again.getPage(0).node.lookup(N('Annots'), PDFArray).asArray()
      .map((r) => (again.context.lookup(r) as PDFDict).get(N('IT'))?.toString());
    expect(intents.filter((i) => i === '/PolygonRadius')).toHaveLength(2);
    expect(intents).toContain('/CircleDimension');
    expect(intents).toContain('/PolyLineAngle');
  });
});

describe('viewports (regions with their own scale)', () => {
  it('Revu page scale (whole page, no /Name) is not a viewport', async () => {
    const { pageScales, pageViewports } = await load('measure.pdf');
    expect(pageScales[0]).not.toBeNull();
    expect(pageViewports[0]).toEqual([]);
  });

  it('saves page scale and named viewports in /VP, and reads them back', async () => {
    const { savePdf } = await import('../src/pdf/save');
    const { customScale } = await import('../src/model/measure');
    const bytes = readFileSync('tests/fixtures/revu/measure.pdf');
    const first = importAnnotations(await PDFDocument.load(bytes, { updateMetadata: false }));
    const identity = { convertToPdfPoint: (x: number, y: number) => [x, y] };
    const pages = [{ index: 0, label: '', width: 0, height: 0, viewport: identity }] as never;
    const detail = customScale(1, 'in', 2, 'ft-in'); // 1 in = 2 ft
    const out = await savePdf({
      original: bytes, pages, markups: first.raws.map((r) => ({ ...r.markup, points: r.pdfPoints })),
      importedRefs: new Set(first.imported.flatMap((s) => [...s])),
      calibrations: first.pageScales,
      viewports: [[{ id: 'ABCDEFGHIJKLMNOP', name: 'Detail 3', rect: [{ x: 300, y: 100 }, { x: 100, y: 50 }], scale: detail }]],
      dirtyCalibrations: new Set([0]),
    });
    const again = await PDFDocument.load(out, { updateMetadata: false });
    const vp = again.getPage(0).node.lookup(N('VP'), PDFArray);
    expect(vp.size()).toBe(2);
    const second = importAnnotations(again);
    expect(second.pageScales[0]!.factor).toBeCloseTo(first.pageScales[0]!.factor, 6);
    expect(second.pageViewports[0]).toHaveLength(1);
    const v = second.pageViewports[0][0];
    expect(v).toMatchObject({ id: 'ABCDEFGHIJKLMNOP', name: 'Detail 3', bbox: [100, 50, 300, 100] });
    expect(v.scale.factor).toBeCloseTo(detail.factor, 6);
    expect(v.scale.unit).toBe('ft-in');
    // Existing annotations were not touched.
    expect(second.raws.map((r) => r.displayed).sort()).toEqual(first.raws.map((r) => r.displayed).sort());
  });
});
