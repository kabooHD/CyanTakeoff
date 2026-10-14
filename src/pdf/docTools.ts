// Document tools that change pages: Crop Pages, Deskew (apply a rotation to
// a page's content), and new PDFs (blank pages, or one page per image).
import { PDFArray, PDFDocument, PDFName, PDFRawStream, type PDFPage } from 'pdf-lib';
import { rotationAbout } from '../model/deskew';

const N = PDFName.of;
type Rect = [number, number, number, number]; // PDF space: x0, y0, x1, y1

/** Current crop box of a page (falls back to the media box). */
export function cropOf(p: PDFPage): Rect {
  const b = p.getCropBox();
  return [b.x, b.y, b.x + b.width, b.y + b.height];
}

/**
 * Crop pages to `rect` (PDF space), or shrink each page's current crop by
 * `margins` (left, bottom, right, top in points); `null` removes the crop.
 * The crop is kept inside the media box. Returns how many pages changed.
 */
export function cropPages(doc: PDFDocument, pages: number[], how: { rect: Rect } | { margins: [number, number, number, number] } | null): number {
  let n = 0;
  for (const i of pages) {
    const p = doc.getPage(i);
    if (!how) {
      if (p.node.has(N('CropBox'))) { p.node.delete(N('CropBox')); n++; }
      continue;
    }
    const m = p.getMediaBox();
    let [x0, y0, x1, y1] = 'rect' in how ? how.rect : cropOf(p);
    if ('margins' in how) { x0 += how.margins[0]; y0 += how.margins[1]; x1 -= how.margins[2]; y1 -= how.margins[3]; }
    x0 = Math.max(m.x, Math.min(x0, x1)); y0 = Math.max(m.y, Math.min(y0, y1));
    x1 = Math.min(m.x + m.width, Math.max(x0, x1)); y1 = Math.min(m.y + m.height, Math.max(y0, y1));
    if (x1 - x0 < 1 || y1 - y0 < 1) continue;
    p.setCropBox(x0, y0, x1 - x0, y1 - y0);
    n++;
  }
  return n;
}

/** Rotate a page's content by `deg` (counterclockwise on screen) about the page centre. */
export function rotateContent(doc: PDFDocument, index: number, deg: number) {
  const p = doc.getPage(index);
  const m = p.getMediaBox();
  const cm = rotationAbout(deg, m.x + m.width / 2, m.y + m.height / 2).map((v) => +v.toFixed(6)).join(' ');
  const pre = doc.context.register(PDFRawStream.of(doc.context.obj({}), new TextEncoder().encode(`q ${cm} cm\n`)));
  const post = doc.context.register(PDFRawStream.of(doc.context.obj({}), new TextEncoder().encode('\nQ\n')));
  const raw = p.node.get(N('Contents'));
  const looked = raw ? doc.context.lookup(raw) : undefined;
  const parts = looked instanceof PDFArray ? looked.asArray() : raw ? [raw] : [];
  p.node.set(N('Contents'), doc.context.obj([pre, ...parts, post]));
}

export const PAPER: Record<string, [number, number]> = {
  'Letter (8.5×11)': [612, 792], 'Legal (8.5×14)': [612, 1008], 'Tabloid (11×17)': [792, 1224],
  'ARCH C (18×24)': [1296, 1728], 'ARCH D (24×36)': [1728, 2592], 'ARCH E (36×48)': [2592, 3456],
  'A4': [595.28, 841.89], 'A3': [841.89, 1190.55], 'A1': [1683.78, 2383.94],
};

export async function blankPdf(count: number, w: number, h: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < Math.max(1, count); i++) doc.addPage([w, h]);
  return doc.save();
}

/** One page per image, sized to the image at `dpi`. Images are JPEG or PNG bytes. */
export async function imagesToPdf(images: { bytes: Uint8Array; type: 'jpg' | 'png'; w: number; h: number }[], dpi: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const im of images) {
    const img = im.type === 'jpg' ? await doc.embedJpg(im.bytes) : await doc.embedPng(im.bytes);
    const w = (im.w * 72) / dpi, h = (im.h * 72) / dpi;
    doc.addPage([w, h]).drawImage(img, { x: 0, y: 0, width: w, height: h });
  }
  return doc.save();
}
