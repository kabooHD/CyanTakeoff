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

  it('imports angle, diameter and both radius measurements (full circle and partial arc)', () => {
    expect(byType('angle')).toHaveLength(1);
    expect(byType('diameter')).toHaveLength(1);
    expect(imported[0].size).toBe(10);
    const radii = byType('radius').map((r) => r.pdfPoints);
    expect(radii).toHaveLength(2);
    // Revu stores [arc start, center, arc end]; the center is the second vertex.
    const full = radii.find((p) => p.length === 2)!;
    expect(full[0].x).toBeCloseTo(230.0505, 3);
    const arc = radii.find((p) => p.length === 3)!;
    expect(arc[0]).toMatchObject({ x: 394.8127, y: 419.5397 });
  });

  it("draws the partial arc counterclockwise from the start, like Revu's appearance", async () => {
    const { arcPoints, distToSegment } = await import('../src/model/measure');
    const [c, start, end] = byType('radius').find((r) => r.pdfPoints.length === 3)!.pdfPoints;
    const pts = arcPoints(c, start, end, 1);
    // Revu's own path passes near (352.8, 418.1) just after the start, and (436.7, 423.2) mid-way.
    const near = (q: { x: number; y: number }) => Math.min(...pts.slice(1).map((p, i) => distToSegment(q, pts[i], p)));
    expect(near({ x: 352.7883, y: 418.0503 })).toBeLessThan(1.5);
    expect(near({ x: 436.7042, y: 423.1963 })).toBeLessThan(1.5);
    // ends in the direction of the third vertex
    const last = pts[pts.length - 1];
    expect(Math.atan2(last.y - c.y, last.x - c.x)).toBeCloseTo(Math.atan2(end.y - c.y, end.x - c.x), 6);
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
    // every measurement is rewritten with Revu's intents
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

describe('/Measure with a separate Y scale', () => {
  it('writes /Y and reads both factors back', async () => {
    const { writeMeasure, readMeasure } = await import('../src/pdf/pdfutil');
    const { withYScale, customScale } = await import('../src/model/measure');
    const doc = await PDFDocument.create();
    const s = withYScale(customScale(1, 'in', 10, 'ft-in'), customScale(1, 'in', 20, 'ft-in'));
    const back = readMeasure(doc, writeMeasure(doc, s))!;
    expect(back.factor).toBeCloseTo(s.factor, 9);
    expect(back.yFactor).toBeCloseTo(s.yFactor!, 9);
    expect(back.unit).toBe('ft-in');
    expect(back.yLabel).toBe(s.yLabel);
  });
});

describe('text on rotated pages', () => {
  it('saved text boxes read upright on a page with /Rotate 90', async () => {
    const { savePdf, textFrame } = await import('../src/pdf/save');
    const { decodePDFRawStream } = await import('pdf-lib');
    const bytes = readFileSync('tests/fixtures/revu/markup-deep-spaces.pdf');
    const identity = { convertToPdfPoint: (x: number, y: number) => [x, y], rotation: 90 };
    const pages = [0, 1].map((index) => ({ index, label: '', width: 0, height: 0, viewport: identity })) as never;
    const m = {
      id: 't', type: 'textbox', page: 0, points: [{ x: 100, y: 100 }, { x: 200, y: 300 }], text: 'Hello',
      style: { color: '#000000', fill: null, width: 1, opacity: 1, fillOpacity: 1, fontSize: 12, lineStyle: 'solid' },
      subject: 'Text Box', label: '', comment: '', author: 'a', created: new Date().toISOString(), modified: new Date().toISOString(), status: 'None',
    } as never;
    const out = await savePdf({ original: bytes, pages, markups: [m], importedRefs: new Set(), calibrations: [null, null], dirtyCalibrations: new Set() });
    const doc = await PDFDocument.load(out);
    const annots = doc.getPage(0).node.lookup(N('Annots'), PDFArray).asArray().map((r) => doc.context.lookup(r) as PDFDict);
    const ft = annots.find((d) => d.get(N('Subtype'))?.toString() === '/FreeText' && d.get(N('CTData')))!;
    const ap = (ft.lookup(N('AP')) as PDFDict).lookup(N('N')) as never;
    const ops = new TextDecoder().decode(decodePDFRawStream(ap).decode());
    expect(ops).toMatch(/0 1 -1 0 [\d.]+ [\d.]+ Tm \S+ Tj/);
    expect(textFrame(90).right).toEqual({ x: 0, y: 1 });
    expect(textFrame(0).right).toEqual({ x: 1, y: 0 });
  });
});

describe('Revu Spaces (/BSISpaces)', () => {
  const tree = async (file: string, page: number) => {
    const { spaceTree } = await import('../src/model/spaces');
    const { pageSpaces } = await load(file);
    const spaces = pageSpaces[page].map((s, i) => ({ id: String(i), title: s.title, points: s.path, color: s.color, opacity: s.opacity }));
    const names = (ns: ReturnType<typeof spaceTree>): Record<string, unknown> => Object.fromEntries(ns.map((n) => [n.space.title, names(n.kids)]));
    return names(spaceTree(spaces)) as Record<string, Record<string, Record<string, unknown>>>;
  };
  // Expected hierarchy as listed by pymkup's tests for the same files.
  it('markup-space.pdf: Level 1 > Area A/B > rooms', async () => {
    const t = await tree('markup-space.pdf', 0);
    expect(Object.keys(t)).toEqual(['Level 1']);
    expect(Object.keys(t['Level 1']).sort()).toEqual(['Area A', 'Area B']);
    expect(Object.keys(t['Level 1']['Area A']).sort()).toEqual(['Room 101', 'Room 102']);
    expect(Object.keys(t['Level 1']['Area B']).sort()).toEqual(['Room 151', 'Room 152']);
  });
  it('markup-deep-spaces.pdf: four levels deep on page 1, Level 4 on page 2', async () => {
    const t = await tree('markup-deep-spaces.pdf', 0);
    const b = t['Level 3']['Area B'] as Record<string, Record<string, unknown>>;
    for (const r of ['Room 302', 'Room 303', 'Room 304', 'Room 305', 'Hallway 330', 'Room 106']) expect(b).toHaveProperty([r]);
    expect(b['Room 302']).toHaveProperty(['Sub Room']);
    expect(b['Room 305']).toHaveProperty(['Sub Room 2']);
    const t2 = await tree('markup-deep-spaces.pdf', 1);
    expect(Object.keys(t2['Level 4']['Area A']).sort()).toEqual(['Hallway 2', 'Room 401']);
  });
  it('saves Spaces nested with /Kids and /Parent, and reads them back', async () => {
    const { savePdf } = await import('../src/pdf/save');
    const bytes = readFileSync('tests/fixtures/revu/markup-space.pdf');
    const first = await load('markup-space.pdf');
    const identity = { convertToPdfPoint: (x: number, y: number) => [x, y] };
    const pages = [{ index: 0, label: '', width: 0, height: 0, viewport: identity }] as never;
    const spaces = [first.pageSpaces[0].map((s, i) => ({ id: String(i), title: s.title, points: s.path, color: s.color, opacity: s.opacity }))];
    spaces[0].push({ id: 'new', title: 'Room 103', points: [{ x: 70, y: 450 }, { x: 140, y: 450 }, { x: 140, y: 400 }, { x: 70, y: 400 }], color: '#ff0000', opacity: 0.2 });
    const out = await savePdf({
      original: bytes, pages, markups: [], importedRefs: new Set(), calibrations: [null], dirtyCalibrations: new Set(),
      spaces, dirtySpaces: new Set([0]),
    });
    const again = importAnnotations(await PDFDocument.load(out));
    expect(again.pageSpaces[0].map((s) => s.title).sort()).toEqual([...first.pageSpaces[0].map((s) => s.title), 'Room 103'].sort());
    const kids = (await PDFDocument.load(out)).getPage(0).node.lookup(N('BSISpaces'), PDFArray);
    expect(kids.size()).toBe(1); // one root: Level 1
  });
});

describe('replies', () => {
  it('are saved as /Text annotations with /IRT and read back onto their markup', async () => {
    const { savePdf } = await import('../src/pdf/save');
    const bytes = readFileSync('tests/fixtures/revu/measure.pdf');
    const first = importAnnotations(await PDFDocument.load(bytes, { updateMetadata: false }));
    const identity = { convertToPdfPoint: (x: number, y: number) => [x, y] };
    const pages = [{ index: 0, label: '', width: 0, height: 0, viewport: identity }] as never;
    const markups = first.raws.map((r, i) => ({
      ...r.markup, points: r.pdfPoints,
      ...(i === 0 ? { replies: [{ id: 'r1', author: 'Sam', date: '2026-10-13T10:00:00.000Z', text: 'Checked on site' }], source: { ...r.markup.source!, dirty: true } } : {}),
    }));
    const out = await savePdf({ original: bytes, pages, markups, importedRefs: new Set(first.imported.flatMap((s) => [...s])), calibrations: first.pageScales, dirtyCalibrations: new Set() });
    const again = importAnnotations(await PDFDocument.load(out));
    const withReply = again.raws.find((r) => r.markup.replies?.length);
    expect(withReply?.markup.replies?.[0]).toMatchObject({ author: 'Sam', text: 'Checked on site' });
    expect(again.raws).toHaveLength(first.raws.length); // the reply is not a separate markup
  });
});
