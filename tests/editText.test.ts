import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { editText, eraseContent, reuseCodes, standardFontFor } from '../src/pdf/editText';

async function textOf(bytes: Uint8Array) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  const tc = await (await pdf.getPage(1)).getTextContent();
  return tc.items.map((i) => ('str' in i ? i.str : '')).join('|');
}

async function sheet() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([400, 200]);
  page.drawText('Revision A', { x: 50, y: 100, size: 12, font, color: rgb(0, 0, 1) });
  page.drawText('Keep me', { x: 50, y: 50, size: 12, font });
  return PDFDocument.load(await doc.save()); // as opened from a file (fonts written)
}
// The first run's box (PDF space): baseline 100, 12 pt Helvetica, about 60 pt wide.
const RUN: [number, number, number, number] = [49, 97, 112, 110];

describe('Edit Text', () => {
  it('maps characters to the run\'s own glyph codes when it can', () => {
    expect(reuseCodes('AB C', [1, 2, 3, 4], 'CAB')).toEqual([4, 1, 2]);
    expect(reuseCodes('AB C', [1, 2, 4], 'CA')).toEqual([4, 1]); // spaces pdf.js added
    expect(reuseCodes('AB', [1, 2], 'AZ')).toBeNull();
    expect(standardFontFor('Times-BoldItalic')).toBe(StandardFonts.TimesRomanBoldItalic);
    expect(standardFontFor('sans-serif')).toBe(StandardFonts.Helvetica);
  });

  it('rewrites a run in its own font and colour, leaving other text', async () => {
    const doc = await sheet();
    const r = await editText(doc, 0, RUN, 'Revision A', 'Revision AA');
    expect(r).toEqual({ reusedFont: true, found: true });
    const bytes = await doc.save();
    const t = await textOf(bytes);
    expect(t).toContain('Revision AA');
    expect(t).toContain('Keep me');
    expect(t.match(/Revision/g)).toHaveLength(1);
  });

  it('falls back to a standard font for new characters', async () => {
    const doc = await sheet();
    const r = await editText(doc, 0, RUN, 'Revision A', 'Revision B (2026)');
    expect(r.reusedFont).toBe(false);
    expect(await textOf(await doc.save())).toContain('Revision B (2026)');
  });

  it('Erase Content removes what is under the rectangle', async () => {
    const doc = await sheet();
    expect(await eraseContent(doc, 0, RUN)).toBe(true);
    const t = await textOf(await doc.save());
    expect(t).not.toContain('Revision');
    expect(t).toContain('Keep me');
  });
});
