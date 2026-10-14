import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { exportXfdf, importXfdf, parseXml } from '../src/pdf/xfdf';
import { importAnnotations } from '../src/pdf/importAnnots';

const load = () => PDFDocument.load(readFileSync('tests/fixtures/revu/measure.pdf'), { updateMetadata: false });
const stripAnnots = (doc: PDFDocument) => doc.getPages().forEach((p) => p.node.delete(PDFName.of('Annots')));

describe('XFDF', () => {
  it('Revu measurements survive export and import into a clean copy', async () => {
    const src = await load();
    const xml = exportXfdf(src, 'measure.pdf');
    expect(parseXml(xml).children.find((c) => c.name === 'xfdf')).toBeTruthy();
    expect(xml).toContain('<polygon ');
    const before = importAnnotations(src).raws.map((r) => r.displayed).sort();
    const clean = await load();
    stripAnnots(clean);
    expect(importAnnotations(clean).raws).toHaveLength(0);
    const n = importXfdf(clean, xml);
    expect(n).toBeGreaterThan(5);
    const again = await PDFDocument.load(await clean.save());
    const after = importAnnotations(again).raws.map((r) => r.displayed).sort();
    expect(after).toEqual(before);
  });

  it('imports XFDF written by other apps, replacing markups with the same name', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([600, 400]);
    const xml = `<?xml version="1.0"?><xfdf xmlns="http://ns.adobe.com/xfdf/" xml:space="preserve"><annots>
      <square page="0" rect="100,100,200,180" color="#FF0000" width="2" name="sq-1" title="Ana" subject="Rectangle" date="D:20260101120000Z"><contents>Check &amp; verify</contents></square>
      <text page="0" rect="300,300,320,320" name="n-1" inreplyto="sq-1" replyType="reply"><contents>Done</contents></text>
    </annots></xfdf>`;
    expect(importXfdf(doc, xml)).toBe(2);
    expect(importXfdf(doc, xml)).toBe(2); // again: replaced, not doubled
    const annots = doc.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray);
    expect(annots.size()).toBe(2);
    const raws = importAnnotations(await PDFDocument.load(await doc.save())).raws;
    const sq = raws.find((r) => r.markup.type === 'rectangle')!;
    expect(sq.markup).toMatchObject({ author: 'Ana', comment: 'Check & verify' });
    expect(sq.markup.style.color.toLowerCase()).toBe('#ff0000');
  });

  it('stamps carry their appearance (nested image XObject) through export and import', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([600, 400]);
    const ctx = doc.context;
    const img = ctx.register(PDFRawStream.of(ctx.obj({ Type: 'XObject', Subtype: 'Image', Width: 2, Height: 1, ColorSpace: 'DeviceRGB', BitsPerComponent: 8 }) as PDFDict, new Uint8Array([255, 0, 0, 0, 0, 255])));
    const form = ctx.register(PDFRawStream.of(ctx.obj({ Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 100, 50.5], Matrix: [1, 0, 0, 1, 0, 0], Resources: { XObject: { Im0: img } } }) as PDFDict, new TextEncoder().encode('q 100 0 0 50.5 0 0 cm /Im0 Do Q')));
    const annot = ctx.obj({ Type: 'Annot', Subtype: 'Stamp', Rect: [10, 10, 110, 60.5], NM: 'st-1', F: 4, AP: { N: form } }) as PDFDict;
    page.node.set(PDFName.of('Annots'), ctx.obj([ctx.register(annot)]));
    const xml = exportXfdf(doc, 'x.pdf');
    expect(xml).toMatch(/<stamp [^>]*><appearance>[A-Za-z0-9+/=]+<\/appearance>/);
    const inner = Buffer.from(/<appearance>([^<]+)</.exec(xml)![1], 'base64').toString();
    expect(inner).toContain('<DICT KEY="AP"><STREAM KEY="N">');
    expect(inner).toContain('<ARRAY KEY="BBox"><INT VAL="0"/><INT VAL="0"/><INT VAL="100"/><FIXED VAL="50.5"/></ARRAY>');
    expect(inner).toContain('<STREAM KEY="Im0">');
    expect(inner).toContain('<DATA ENCODING="HEX">ff00000000ff</DATA>');
    const clean = await PDFDocument.create();
    clean.addPage([600, 400]);
    expect(importXfdf(clean, xml)).toBe(1);
    const again = await PDFDocument.load(await clean.save());
    const a = again.context.lookup(again.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray).get(0), PDFDict);
    const n = again.context.lookup(a.lookup(PDFName.of('AP'), PDFDict).get(PDFName.of('N'))) as PDFRawStream;
    expect(new TextDecoder().decode(n.contents)).toBe('q 100 0 0 50.5 0 0 cm /Im0 Do Q');
    expect(n.dict.lookup(PDFName.of('BBox'), PDFArray).asArray().map((x) => Number(x.toString()))).toEqual([0, 0, 100, 50.5]);
    const im = again.context.lookup(n.dict.lookup(PDFName.of('Resources'), PDFDict).lookup(PDFName.of('XObject'), PDFDict).get(PDFName.of('Im0'))) as PDFRawStream;
    expect([...im.contents]).toEqual([255, 0, 0, 0, 0, 255]);
    expect(String(im.dict.get(PDFName.of('Subtype')))).toBe('/Image');
  });

  it('reads an appearance written by another app (lower-case tags, ASCII data, no Length)', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([600, 400]);
    const ap = Buffer.from('<dict KEY="AP"><stream KEY="N"><name KEY="Subtype" VAL="Form"/><array KEY="BBox"><int VAL="0"/><int VAL="0"/><int VAL="10"/><int VAL="10"/></array><int KEY="Length" VAL="99"/><data ENCODING="ASCII">0 0 10 10 re f</data></stream></dict>').toString('base64');
    const xml = `<?xml version="1.0"?><xfdf xmlns="http://ns.adobe.com/xfdf/"><annots><stamp page="0" rect="0,0,10,10" name="s"><appearance>${ap}</appearance></stamp></annots></xfdf>`;
    expect(importXfdf(doc, xml)).toBe(1);
    const a = doc.context.lookup(doc.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray).get(0), PDFDict);
    const n = doc.context.lookup(a.lookup(PDFName.of('AP'), PDFDict).get(PDFName.of('N'))) as PDFRawStream;
    expect(new TextDecoder().decode(n.contents)).toBe('0 0 10 10 re f');
    expect(n.dict.has(PDFName.of('Length'))).toBe(false);
  });
});
