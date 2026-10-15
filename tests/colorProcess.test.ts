import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFRawStream, PDFStream } from 'pdf-lib';
import { latin1, parseContent, writeContent } from '../src/pdf/content';
import { processContent, processPagesVector, transformRgb } from '../src/pdf/colorProcess';
import { streamBytes } from '../src/pdf/redactContent';
import { archivePdfA, srgbIccProfile } from '../src/pdf/pdfa';
import { repairPdf } from '../src/pdf/repair';

describe('Color Processing', () => {
  it('transforms colours per mode', () => {
    expect(transformRgb([1, 0, 0], { mode: 'grayscale', processImages: false }).map((v) => +v.toFixed(3))).toEqual([0.299, 0.299, 0.299]);
    expect(transformRgb([0.5, 0.5, 0.5], { mode: 'bw', processImages: false })).toEqual([0, 0, 0]);
    expect(transformRgb([1, 1, 1], { mode: 'bw', processImages: false })).toEqual([1, 1, 1]);
    expect(transformRgb([0.2, 0.2, 0.2], { mode: 'colorize', processImages: false, from: [0, 0, 1] })).toEqual([0, 0, 1]);
    const scaled = transformRgb([1, 1, 1], { mode: 'colorize', processImages: false, from: [0, 0, 0], to: [1, 0, 0], scale: true });
    expect(scaled.map((v) => +v.toFixed(2))).toEqual([1, 0, 0]);
    expect(transformRgb([1, 0, 0], { mode: 'modify', processImages: false, pairs: [{ from: [0.9, 0.1, 0.1], to: [0, 1, 0], tolerance: 0.2 }] })).toEqual([0, 1, 0]);
    expect(transformRgb([0, 0, 1], { mode: 'modify', processImages: false, pairs: [{ from: [0.9, 0.1, 0.1], to: [0, 1, 0], tolerance: 0.2 }] })).toEqual([0, 0, 1]);
    const hue = transformRgb([1, 0, 0], { mode: 'lsh', processImages: false, h: 120 });
    expect(hue.map((v) => +v.toFixed(2))).toEqual([0, 1, 0]);
  });
  it('rewrites colour operators, following the colour space for sc/scn', () => {
    const ops = parseContent('1 0 0 rg 0 0 1 RG 0.5 g 0 0 0 1 k /DeviceGray cs 0.2 sc /Pattern cs /P1 scn 10 10 m 20 20 l S');
    const r = processContent(ops, { mode: 'grayscale', processImages: false });
    expect(r.changed).toBe(5);
    const out = writeContent(r.ops);
    expect(out).toContain('0.299 0.299 0.299 rg');
    expect(out).toContain('0.114 0.114 0.114 RG');
    expect(out).toContain('0.2 0.2 0.2 rg');
    expect(out).toContain('/P1 scn'); // pattern left alone
    expect(out).toContain('20 20 l');
  });
  it('processes page content and forms in the PDF', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([100, 100]);
    const ctx = doc.context;
    const form = ctx.register(ctx.stream('0 1 0 rg 0 0 10 10 re f', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 10, 10] }));
    page.node.set(PDFName.of('Resources'), ctx.obj({ XObject: { F1: form } }));
    page.node.set(PDFName.of('Contents'), ctx.register(ctx.stream('1 0 0 rg 0 0 50 50 re f /F1 Do')));
    expect(processPagesVector(doc, [0], { mode: 'bw', processImages: false })).toBe(2);
    const again = await PDFDocument.load(await doc.save());
    const p = again.getPage(0);
    const c = again.context.lookup(p.node.get(PDFName.of('Contents'))) as PDFStream;
    expect(latin1(streamBytes(c))).toContain('0 0 0 rg');
    const f = again.context.lookup(p.node.Resources()!.lookup(PDFName.of('XObject'), (await import('pdf-lib')).PDFDict).get(PDFName.of('F1'))) as PDFRawStream;
    expect(latin1(streamBytes(f))).toContain('0 0 0 rg');
    expect(String(f.dict.get(PDFName.of('BBox')))).toContain('10');
  });
});

describe('Archive as PDF/A', () => {
  it('builds a well-formed ICC profile', () => {
    const icc = srgbIccProfile();
    const size = (icc[0] << 24) | (icc[1] << 16) | (icc[2] << 8) | icc[3];
    expect(size).toBe(icc.length);
    expect(String.fromCharCode(...icc.subarray(36, 40))).toBe('acsp');
    expect(String.fromCharCode(...icc.subarray(16, 20))).toBe('RGB ');
    const tags = (icc[128] << 24) | (icc[129] << 16) | (icc[130] << 8) | icc[131];
    expect(tags).toBe(9);
  });
  it('adds the PDF/A identification, output intent and reports unembedded fonts', async () => {
    const src = await PDFDocument.create();
    src.addPage([100, 100]);
    const font = await src.embedFont('Helvetica');
    src.getPage(0).drawText('x', { font, x: 10, y: 10 });
    const doc = await PDFDocument.load(await src.save()); // fonts are written on save
    const rep = archivePdfA(doc, 'Plans');
    expect(rep.fontsNotEmbedded).toEqual(['Helvetica']);
    const again = await PDFDocument.load(await doc.save());
    const meta = again.context.lookup(again.catalog.get(PDFName.of('Metadata'))) as PDFStream;
    expect(latin1(streamBytes(meta))).toContain('<pdfaid:part>1</pdfaid:part>');
    expect(String(again.catalog.get(PDFName.of('OutputIntents')))).toContain('GTS_PDFA1');
    expect(again.getTitle()).toBe('Plans');
  });
});

describe('Repair PDF', () => {
  it('drops broken annotation entries and closes open graphics states', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([100, 100]);
    const ctx = doc.context;
    const good = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Square', Rect: [0, 0, 10, 10] }));
    page.node.set(PDFName.of('Annots'), ctx.obj([good, ctx.obj(5), good]));
    page.node.set(PDFName.of('Contents'), ctx.register(ctx.stream('q q 1 0 0 rg 0 0 10 10 re f Q')));
    const st = repairPdf(doc);
    expect(st).toEqual({ annotsDropped: 2, contentsDropped: 0, statesClosed: 1, pages: 1 });
    const again = await PDFDocument.load(await doc.save({ useObjectStreams: false }));
    expect(again.getPage(0).node.Annots()!.size()).toBe(1);
    expect(again.getPage(0).node.Contents()!.toString()).toContain('[');
  });
});
