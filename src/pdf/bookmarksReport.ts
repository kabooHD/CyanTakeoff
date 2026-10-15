// Export Bookmarks as PDF (Revu: Bookmarks menu > Export Bookmarks): the
// bookmark tree of one or more files as an indented list with page labels,
// one section per file.
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export interface BookmarkReportRow { depth: number; title: string; page: string }
export interface BookmarkReportSection { name: string; rows: BookmarkReportRow[] }

/** The report as text lines (two spaces per level, page label after a tab), for tests and the CSV. */
export function bookmarkLines(sections: BookmarkReportSection[]): string[] {
  const out: string[] = [];
  for (const s of sections) {
    out.push(s.name);
    for (const r of s.rows) out.push(`${'  '.repeat(r.depth)}${r.title}\t${r.page}`);
  }
  return out;
}

const clean = (s: string) => s.replace(/[^\x20-\x7e -ÿ]/g, '?');

export async function buildBookmarksPdf(sections: BookmarkReportSection[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle('Bookmarks');
  doc.setProducer('CyanTakeoff');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 612, H = 792, M = 54, size = 10, line = 15;
  let page = doc.addPage([W, H]), y = H - M;
  const newPage = () => { page = doc.addPage([W, H]); y = H - M; };
  const fit = (s: string, w: number) => {
    if (font.widthOfTextAtSize(s, size) <= w) return s;
    let t = s;
    while (t.length > 1 && font.widthOfTextAtSize(t + '...', size) > w) t = t.slice(0, -1);
    return t + '...';
  };
  for (const s of sections) {
    if (y < M + line * 3) newPage();
    page.drawText(clean(s.name), { x: M, y, size: 12, font: bold });
    y -= line * 1.4;
    for (const r of s.rows) {
      if (y < M) newPage();
      const x = M + 14 * r.depth;
      page.drawText(clean(fit(r.title, W - M - 80 - x)), { x, y, size, font });
      if (r.page) page.drawText(clean(r.page), { x: W - M - font.widthOfTextAtSize(clean(r.page), size), y, size, font, color: rgb(0.3, 0.3, 0.3) });
      y -= line;
    }
    y -= line;
  }
  doc.getPages().forEach((p, i, all) => p.drawText(`Page ${i + 1} of ${all.length}`, { x: W - M - 60, y: M - 24, size: 8, font, color: rgb(0.35, 0.35, 0.35) }));
  return doc.save();
}
