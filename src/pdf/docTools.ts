// Document tools that change pages: Crop Pages, Deskew (apply a rotation to
// a page's content), Page Setup (new media size, content scaled and placed),
// and new PDFs (blank pages, or one page per image).
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFString, PDFHexString, type PDFPage } from 'pdf-lib';
import { rotationAbout } from '../model/deskew';
import { readMeasure, writeMeasure } from './pdfutil';

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

export type Align = 'left' | 'center' | 'right';
export type VAlign = 'top' | 'middle' | 'bottom';
export interface PageSetupOptions {
  /** New media size in points. */
  width: number; height: number;
  /** Scale the drawing to fit the new media (else `scale`). */
  autoScale: boolean;
  scale: number;
  /** Placement inside the media when centred/aligned; `offset` (points) is added. */
  align: Align; valign: VAlign;
  offset: [number, number];
}

/** Scale (s) and translation (tx, ty) in PDF space that puts a page's crop box onto new media. */
export function pageSetupTransform(crop: Rect, o: PageSetupOptions): { s: number; tx: number; ty: number } {
  const w = crop[2] - crop[0], h = crop[3] - crop[1];
  const s = o.autoScale ? Math.min(o.width / w, o.height / h) : Math.max(0.01, o.scale);
  const ox = o.align === 'left' ? 0 : o.align === 'right' ? o.width - s * w : (o.width - s * w) / 2;
  const oy = o.valign === 'bottom' ? 0 : o.valign === 'top' ? o.height - s * h : (o.height - s * h) / 2;
  return { s, tx: ox + o.offset[0] - s * crop[0], ty: oy + o.offset[1] - s * crop[1] };
}

/** Apply x' = s·x + tx, y' = s·y + ty to the numbers of a coordinate array (x, y pairs). */
function mapNums(arr: PDFArray, s: number, tx: number, ty: number, ctx: PDFDocument['context']) {
  const v = arr.asArray().map((x) => (x instanceof PDFNumber ? x.asNumber() : 0));
  arr.asArray().forEach((_, i) => arr.set(i, PDFNumber.of(i % 2 ? v[i] * s + ty : v[i] * s + tx)));
  void ctx;
}

/**
 * Page Setup (Revu Document > Page Setup): each page gets the new media size;
 * its content (and annotations, measurement scales, viewports) are scaled
 * and placed per the options. Returns how many pages changed.
 */
export function pageSetup(doc: PDFDocument, pages: number[], o: PageSetupOptions): number {
  const ctx = doc.context;
  let n = 0;
  for (const i of pages) {
    const p = doc.getPage(i);
    const { s, tx, ty } = pageSetupTransform(cropOf(p), o);
    // Content.
    const cm = [s, 0, 0, s, tx, ty].map((v) => +v.toFixed(6)).join(' ');
    const pre = ctx.register(PDFRawStream.of(ctx.obj({}), new TextEncoder().encode(`q ${cm} cm\n`)));
    const post = ctx.register(PDFRawStream.of(ctx.obj({}), new TextEncoder().encode('\nQ\n')));
    const raw = p.node.get(N('Contents'));
    const looked = raw ? ctx.lookup(raw) : undefined;
    const parts = looked instanceof PDFArray ? looked.asArray() : raw ? [raw] : [];
    p.node.set(N('Contents'), ctx.obj([pre, ...parts, post]));
    p.setMediaBox(0, 0, o.width, o.height);
    for (const k of ['CropBox', 'ArtBox', 'BleedBox', 'TrimBox']) p.node.delete(N(k));
    const rescale = (holder: PDFDict, key: string) => {
      const m = holder.lookup(N(key));
      if (!(m instanceof PDFDict)) return;
      const sc = readMeasure(doc, m);
      if (sc) holder.set(N(key), writeMeasure(doc, { ...sc, factor: sc.factor / s, ...(sc.yFactor ? { yFactor: sc.yFactor / s } : {}) }));
    };
    // Annotations: geometry keys, our CTData coordinates, measurement scales.
    const annots = p.node.lookup(N('Annots'));
    if (annots instanceof PDFArray) {
      for (const r of annots.asArray()) {
        const a = ctx.lookup(r);
        if (!(a instanceof PDFDict)) continue;
        for (const k of ['Rect', 'QuadPoints', 'Vertices', 'L', 'CL']) { const v = a.lookup(N(k)); if (v instanceof PDFArray) mapNums(v, s, tx, ty, ctx); }
        const ink = a.lookup(N('InkList'));
        if (ink instanceof PDFArray) for (const g of ink.asArray()) { const v = ctx.lookup(g); if (v instanceof PDFArray) mapNums(v, s, tx, ty, ctx); }
        rescale(a, 'Measure'); rescale(a, 'BBMeasure');
        const ct = a.lookup(N('CTData'));
        if (ct instanceof PDFString || ct instanceof PDFHexString) {
          try {
            const d = JSON.parse(ct.decodeText()) as { points?: number[]; cutouts?: { points: number[]; handles?: (number[] | null)[] }[]; handles?: (number[] | null)[] };
            const pts = (v: number[]) => v.map((x, k) => (k % 2 ? x * s + ty : x * s + tx));
            const hs = (h?: (number[] | null)[]) => h?.map((x) => (x ? x.map((v) => v * s) : x));
            if (d.points) d.points = pts(d.points);
            if (d.handles) d.handles = hs(d.handles);
            if (d.cutouts) d.cutouts = d.cutouts.map((c) => ({ ...c, points: pts(c.points), handles: hs(c.handles) }));
            a.set(N('CTData'), PDFHexString.fromText(JSON.stringify(d)));
          } catch { /* not ours */ }
        }
      }
    }
    // Viewports (page scale and regions).
    const vp = p.node.lookup(N('VP'));
    if (vp instanceof PDFArray) {
      for (const r of vp.asArray()) {
        const v = ctx.lookup(r);
        if (!(v instanceof PDFDict)) continue;
        const b = v.lookup(N('BBox')); if (b instanceof PDFArray) mapNums(b, s, tx, ty, ctx);
        rescale(v, 'Measure');
      }
    }
    n++;
  }
  return n;
}
