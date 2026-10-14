import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { addTextLayer } from '../src/ui/ocr';
import { glyphlessTtf, identityToUnicode } from '../src/pdf/glyphless';

async function pageText(bytes: Uint8Array) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await pdfjs.getDocument({ data: bytes.slice(), standardFontDataUrl: 'node_modules/pdfjs-dist/standard_fonts/' }).promise;
  const page = await pdf.getPage(1);
  const tc = await page.getTextContent();
  return tc.items.map((i) => ('str' in i ? { str: i.str, x: i.transform[4], w: i.width } : null)).filter((x) => x && x.str.trim()) as { str: string; x: number; w: number }[];
}

describe('OCR text layer in any script', () => {
  it('writes searchable Cyrillic, Greek, Chinese, Arabic and Latin words where they were found', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([600, 400]);
    const words = [
      { text: 'Привет', x0: 50, y0: 300, x1: 150, y1: 320, confidence: 90 },
      { text: 'Σχέδιο', x0: 200, y0: 300, x1: 280, y1: 320, confidence: 90 },
      { text: '平面图', x0: 50, y0: 200, x1: 110, y1: 220, confidence: 90 },
      { text: 'مخطط', x0: 200, y0: 200, x1: 260, y1: 220, confidence: 90 },
      { text: 'DOOR', x0: 300, y0: 100, x1: 380, y1: 120, confidence: 90 },
    ];
    await addTextLayer(doc, 0, words);
    const runs = await pageText(await doc.save());
    for (const w of words) {
      const r = runs.find((x) => x.str === w.text); // right-to-left words come back in reading order
      expect(r, w.text).toBeTruthy();
      expect(r!.x).toBeCloseTo(w.x0, 0);
      expect(r!.w).toBeCloseTo(w.x1 - w.x0, 0); // stretched to the word's box
    }
  });
  it('builds a well-formed font file and ToUnicode map', () => {
    const ttf = glyphlessTtf();
    const view = new DataView(ttf.buffer);
    expect(view.getUint32(0)).toBe(0x00010000);
    const n = view.getUint16(4);
    // Whole-file checksum is the TrueType magic.
    let sum = 0;
    for (let i = 0; i < ttf.length; i += 4) sum = (sum + view.getUint32(i)) >>> 0;
    expect(sum).toBe(0xb1b0afba);
    const tags = Array.from({ length: n }, (_, i) => String.fromCharCode(...ttf.subarray(12 + i * 16, 16 + i * 16)));
    expect(tags).toEqual([...tags].sort());
    expect(identityToUnicode()).toContain('<0400> <04FF> <0400>');
    expect(identityToUnicode()).not.toContain('<D800>');
  });
});
