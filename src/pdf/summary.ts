// Markups Summary as a PDF report (Revu: Summary > PDF): the rows and
// columns shown in the Markups List, with totals, on landscape pages.
import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib';

export interface SummaryTable { title: string; subtitle: string; header: string[]; rows: (string | number)[][]; totals?: (string | number)[]; numeric: boolean[] }

const fit = (font: PDFFont, s: string, size: number, w: number) => {
  if (font.widthOfTextAtSize(s, size) <= w) return s;
  let t = s;
  while (t.length > 1 && font.widthOfTextAtSize(t + '…', size) > w) t = t.slice(0, -1);
  return t + '…';
};
const clean = (s: string) => s.replace(/[^\x20-\x7e -ÿ]/g, (c) => (c === '✓' ? 'x' : c === '…' ? '...' : '?'));

export async function buildSummaryPdf(t: SummaryTable): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(t.title);
  doc.setProducer('CyanTakeoff');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 792, H = 612, M = 36, size = 8, rowH = 14;
  const text = (r: (string | number)[]) => r.map((v) => clean(String(v ?? '')));
  const body = t.rows.map(text);
  // Column widths from content, scaled to the page.
  const natural = t.header.map((h, c) => Math.max(bold.widthOfTextAtSize(clean(h), size), ...body.slice(0, 200).map((r) => font.widthOfTextAtSize(r[c] ?? '', size))) + 8);
  const k = Math.min(1, (W - 2 * M) / natural.reduce((a, b) => a + b, 0));
  const widths = natural.map((w) => w * k);
  const perPage = Math.floor((H - 2 * M - 48) / rowH) - 1;
  const pages = Math.max(1, Math.ceil((body.length + (t.totals ? 1 : 0)) / perPage));
  for (let p = 0; p < pages; p++) {
    const page = doc.addPage([W, H]);
    page.drawText(clean(t.title), { x: M, y: H - M - 12, size: 14, font: bold });
    page.drawText(clean(t.subtitle), { x: M, y: H - M - 28, size: 9, font, color: rgb(0.35, 0.35, 0.35) });
    page.drawText(`Page ${p + 1} of ${pages}`, { x: W - M - 60, y: M - 18, size: 8, font, color: rgb(0.35, 0.35, 0.35) });
    let y = H - M - 50;
    const drawRow = (cells: string[], f: PDFFont, shade?: boolean) => {
      if (shade) page.drawRectangle({ x: M, y: y - 4, width: widths.reduce((a, b) => a + b, 0), height: rowH, color: rgb(0.93, 0.95, 0.98) });
      let x = M;
      cells.forEach((cell, c) => {
        const s = fit(f, cell, size, widths[c] - 6);
        const tw = f.widthOfTextAtSize(s, size);
        page.drawText(s, { x: t.numeric[c] ? x + widths[c] - 3 - tw : x + 3, y, size, font: f });
        x += widths[c];
      });
      page.drawLine({ start: { x: M, y: y - 4 }, end: { x: M + widths.reduce((a, b) => a + b, 0), y: y - 4 }, thickness: 0.3, color: rgb(0.75, 0.75, 0.75) });
      y -= rowH;
    };
    drawRow(text(t.header), bold, true);
    const slice = body.slice(p * perPage, (p + 1) * perPage);
    slice.forEach((r) => drawRow(r, font));
    if (p === pages - 1 && t.totals) drawRow(text(t.totals), bold, true);
  }
  return doc.save();
}
