import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts, rgb, type PDFStream } from 'pdf-lib';
import { redactPage, segmentOutside, streamBytes, type Rect } from '../src/pdf/redactContent';
import { latin1, parseContent } from '../src/pdf/content';

async function textOf(bytes: Uint8Array) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await pdfjs.getDocument({ data: bytes.slice(), standardFontDataUrl: 'node_modules/pdfjs-dist/standard_fonts/' }).promise;
  const tc = await (await pdf.getPage(1)).getTextContent();
  return (tc.items as { str: string; transform: number[] }[]).filter((i) => i.str.trim()).map((i) => ({ str: i.str, x: i.transform[4], y: i.transform[5] }));
}

// A tiny 2x2 PNG.
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGP4z8DAwMDAwMAAAA0XAQGaJb+3AAAAAElFTkSuQmCC'), (c) => c.charCodeAt(0));

async function sample() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([600, 400]);
  page.drawText('AB SECRET CD', { x: 50, y: 300, size: 20, font });
  page.drawText('PUBLIC', { x: 50, y: 100, size: 20, font });
  page.drawLine({ start: { x: 0, y: 200 }, end: { x: 600, y: 200 }, thickness: 1 });
  page.drawRectangle({ x: 300, y: 150, width: 200, height: 100, color: rgb(0.5, 0.5, 0.5) });
  const img = await doc.embedPng(PNG);
  page.drawImage(img, { x: 420, y: 300, width: 40, height: 40 });
  page.drawImage(img, { x: 520, y: 20, width: 40, height: 40 });
  // A nested drawing (form XObject) with its own secret.
  const inner = await PDFDocument.create();
  const ifont = await inner.embedFont(StandardFonts.Helvetica);
  inner.addPage([200, 100]).drawText('INNER SECRET', { x: 10, y: 40, size: 12, font: ifont });
  const [emb] = await doc.embedPdf(await inner.save(), [0]);
  page.drawPage(emb, { x: 50, y: 20 });
  const w = (s: string) => font.widthOfTextAtSize(s, 20);
  const secret: Rect = [50 + w('AB ') + 0.5, 295, 50 + w('AB SECRET') - 0.5, 320];
  return { doc, secret, w };
}

describe('segment clipping', () => {
  it('keeps the parts outside the rectangles', () => {
    expect(segmentOutside([0, 0], [10, 0], [[2, -1, 4, 1], [6, -1, 7, 1]])).toEqual([[[0, 0], [2, 0]], [[4, 0], [6, 0]], [[7, 0], [10, 0]]]);
    expect(segmentOutside([0, 5], [10, 5], [[2, -1, 4, 1]])).toEqual([[[0, 5], [10, 5]]]);
    expect(segmentOutside([3, 0], [3.5, 0], [[2, -1, 4, 1]])).toEqual([]);
  });
});

describe('true redaction', () => {
  it('removes glyphs, cuts lines and fills, removes images under the marks, and keeps the rest in place', async () => {
    const { doc, secret } = await sample();
    const before = await textOf(await doc.save());
    const cut: Rect = [250, 190, 350, 260];
    const imgRect: Rect = [430, 310, 440, 320];
    const innerRect: Rect = [100, 55, 140, 75]; // over "SECRET" inside the nested drawing (drawn at 50,20)
    const stats = await redactPage(doc, 0, { rects: [secret, cut, imgRect, innerRect] });
    expect(stats.glyphs).toBe(6 + 6);
    expect(stats.images).toBe(1);
    expect(stats.forms).toBe(1);
    expect(stats.paths).toBeGreaterThanOrEqual(2);
    const bytes = await doc.save();
    const after = await textOf(bytes);
    const all = after.map((t) => t.str).join('|');
    expect(all).not.toMatch(/SECRET|S\s*E\s*C\s*R\s*E\s*T/);
    expect(all).toContain('PUBLIC');
    expect(all).toContain('INNER');
    // Text around the removed glyphs stays exactly where it was.
    const xOf = (list: typeof before, s: string) => list.find((t) => t.str.includes(s));
    expect(xOf(after, 'AB')!.x).toBeCloseTo(xOf(before, 'AB')!.x, 3);
    const cdBefore = before.find((t) => t.str.includes('CD'))!;
    const cdAfter = after.find((t) => t.str.trim().endsWith('CD'))!;
    expect(cdAfter.y).toBeCloseTo(cdBefore.y, 3);

    // The line is cut at the rectangle: one piece ends at x=250, the next starts at x=350.
    const ops = parseContent(latin1(streamBytes(doc.getPage(0).node.Contents() as PDFStream)));
    const at = (op: string, x: number, y: number) => ops.some((o) => o.op === op && Math.abs((o.args[0] as { v: number }).v - x) < 1e-3 && Math.abs((o.args[1] as { v: number }).v - y) < 1e-3);
    expect(at('l', 250, 200) && at('m', 350, 200)).toBe(true);
    // Running the redaction again finds nothing left under the marks except the black boxes themselves.
    const again = await PDFDocument.load(bytes);
    const second = await redactPage(again, 0, { rects: [secret, cut, imgRect, innerRect] });
    expect(second).toEqual({ glyphs: 0, paths: 1, images: 0, forms: 0 });
  });

  it('leaves a page untouched where nothing is under the marks', async () => {
    const { doc } = await sample();
    const stats = await redactPage(doc, 0, { rects: [[5, 380, 20, 395]] });
    expect(stats).toEqual({ glyphs: 0, paths: 0, images: 0, forms: 0 });
    expect((await textOf(await doc.save())).map((t) => t.str).join('')).toContain('SECRET');
  });
});
