import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PDFArray, PDFDocument, PDFName } from 'pdf-lib';
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
});
