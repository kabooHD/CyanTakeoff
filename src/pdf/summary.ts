// Markups Summary as a PDF report (Revu: Summary > PDF): the rows and
// columns shown in the Markups List, with totals, on landscape pages.
// Sections (Insert Page Break per …) start a new page with a heading;
// rows can carry a thumbnail and a link to the markup's page when the
// report is appended to the document itself.
import { PDFDocument, PDFName, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

export interface SummarySection { title?: string; rows: (string | number)[][]; thumbs?: (Uint8Array | null)[]; targets?: (number | null)[]; replies?: string[][] }
export interface SummaryTable {
  title: string; subtitle: string; header: string[]; rows: (string | number)[][]; totals?: (string | number)[]; numeric: boolean[];
  /** When given, the rows are drawn per section (each starts on a new page); `rows` is then ignored. */
  sections?: SummarySection[];
  /** Thumbnail height in points (0 = none). */
  thumb?: number;
  /** Replies under each row (one line per reply), aligned with `rows`. */
  replies?: string[][];
}

const fit = (font: PDFFont, s: string, size: number, w: number) => {
  if (font.widthOfTextAtSize(s, size) <= w) return s;
  let t = s;
  while (t.length > 1 && font.widthOfTextAtSize(t + '…', size) > w) t = t.slice(0, -1);
  return t + '…';
};
const clean = (s: string) => s.replace(/[^\x20-\x7e -ÿ]/g, (c) => (c === '✓' ? 'x' : c === '…' ? '...' : '?'));

/**
 * Draw the report's pages into `doc` (at the end) and return how many
 * were added. `targetPage(i)` gives the page of a row's markup for a link.
 */
export async function drawSummary(doc: PDFDocument, t: SummaryTable): Promise<number> {
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 792, H = 612, M = 36, size = 8;
  const thumbH = t.thumb ?? 0;
  const rowH = Math.max(14, thumbH + 4);
  const text = (r: (string | number)[]) => r.map((v) => clean(String(v ?? '')));
  const sections = t.sections ?? [{ rows: t.rows, replies: t.replies }];
  const allRows = sections.flatMap((s) => s.rows).map(text);
  // Column widths from content, scaled to the page (less the thumbnail column).
  const thumbW = thumbH ? thumbH * 1.4 + 6 : 0;
  const natural = t.header.map((h, c) => Math.max(bold.widthOfTextAtSize(clean(h), size), ...allRows.slice(0, 200).map((r) => font.widthOfTextAtSize(r[c] ?? '', size))) + 8);
  const k = Math.min(1, (W - 2 * M - thumbW) / natural.reduce((a, b) => a + b, 0));
  const widths = natural.map((w) => w * k);
  const tableW = thumbW + widths.reduce((a, b) => a + b, 0);
  const pageRefs = doc.getPages().map((p) => p.ref);
  // Thumbnails are embedded up front (embedding is asynchronous).
  const images = new Map<Uint8Array, Awaited<ReturnType<PDFDocument['embedPng']>>>();
  for (const sec of sections) for (const th of sec.thumbs ?? []) if (th && !images.has(th)) { try { images.set(th, th[0] === 0xff && th[1] === 0xd8 ? await doc.embedJpg(th) : await doc.embedPng(th)); } catch { /* a bad thumbnail is skipped */ } }
  let page: PDFPage | null = null, y = 0, pageNo = 0;
  const pagesMade: PDFPage[] = [];
  const newPage = (heading?: string) => {
    page = doc.addPage([W, H]);
    pagesMade.push(page);
    pageNo++;
    page.drawText(clean(t.title), { x: M, y: H - M - 12, size: 14, font: bold });
    page.drawText(clean(t.subtitle), { x: M, y: H - M - 28, size: 9, font, color: rgb(0.35, 0.35, 0.35) });
    y = H - M - 50;
    if (heading) { page.drawText(clean(heading), { x: M, y, size: 10, font: bold }); y -= 16; }
    drawRow(text(t.header), bold, true);
  };
  const drawRow = (cells: string[], f: PDFFont, shade?: boolean, thumb?: Uint8Array | null, target?: number | null, h = rowH) => {
    const pg = page!;
    if (shade) pg.drawRectangle({ x: M, y: y - 4 - (h - rowH), width: tableW, height: h, color: rgb(0.93, 0.95, 0.98) });
    let x = M;
    if (thumbW) {
      const im = thumb && images.get(thumb);
      if (im) { const sc = Math.min((thumbW - 6) / im.width, thumbH / im.height); pg.drawImage(im, { x: x + 3, y: y - (h - rowH) - 2 + (thumbH - im.height * sc) / 2 - thumbH + 6, width: im.width * sc, height: im.height * sc }); }
      x += thumbW;
    }
    cells.forEach((cell, c) => {
      const s = fit(f, cell, size, widths[c] - 6);
      const tw = f.widthOfTextAtSize(s, size);
      pg.drawText(s, { x: t.numeric[c] ? x + widths[c] - 3 - tw : x + 3, y: y - (h - rowH) / 2, size, font: f });
      x += widths[c];
    });
    pg.drawLine({ start: { x: M, y: y - 4 - (h - rowH) }, end: { x: M + tableW, y: y - 4 - (h - rowH) }, thickness: 0.3, color: rgb(0.75, 0.75, 0.75) });
    if (target !== null && target !== undefined && pageRefs[target]) {
      // Append and Hyperlink to Current PDF: the row jumps to the markup's page.
      const link = doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [M, y - 4 - (h - rowH), M + tableW, y - 4 + rowH - 4], Border: [0, 0, 0], Dest: [pageRefs[target], PDFName.of('Fit')] });
      const annots = pg.node.lookup(PDFName.of('Annots'));
      if (annots) (annots as unknown as { push: (r: unknown) => void }).push(doc.context.register(link));
      else pg.node.set(PDFName.of('Annots'), doc.context.obj([doc.context.register(link)]));
    }
    y -= h;
  };
  for (const sec of sections) {
    newPage(sec.title);
    sec.rows.forEach((r, i) => {
      const rp = sec.replies?.[i] ?? [];
      const need = rowH + rp.length * 11;
      if (y - need < M + 12) newPage(sec.title ? `${sec.title} (continued)` : undefined);
      drawRow(text(r), font, false, sec.thumbs?.[i], sec.targets?.[i]);
      for (const line of rp) {
        page!.drawText(fit(font, clean(`↳ ${line}`.replace('↳', '>')), 7.5, tableW - 20), { x: M + 14, y: y + 2, size: 7.5, font, color: rgb(0.3, 0.3, 0.3) });
        y -= 11;
      }
    });
  }
  if (t.totals) {
    if (y - rowH < M + 12) newPage();
    drawRow(text(t.totals), bold, true);
  }
  pagesMade.forEach((pg, i) => pg.drawText(`Page ${i + 1} of ${pagesMade.length}`, { x: W - M - 60, y: M - 18, size: 8, font, color: rgb(0.35, 0.35, 0.35) }));
  return pagesMade.length;
}

export async function buildSummaryPdf(t: SummaryTable): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(t.title);
  doc.setProducer('CyanTakeoff');
  await drawSummary(doc, t);
  return doc.save();
}
