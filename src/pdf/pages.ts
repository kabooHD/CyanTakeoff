// Page operations on a pdf-lib document (Revu's Document menu): insert,
// delete, extract, rotate, replace, move, combine, split and flatten.
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRef, PDFStream, degrees, type PDFPage } from 'pdf-lib';

const N = (s: string) => PDFName.of(s);

export function insertBlankPage(doc: PDFDocument, at: number, size?: [number, number]) {
  const ref = doc.getPage(Math.min(at, doc.getPageCount() - 1));
  const s = size ?? [ref.getWidth(), ref.getHeight()];
  doc.insertPage(Math.max(0, Math.min(at, doc.getPageCount())), s);
}

/** Insert pages of `src` (all, or the given indexes) before index `at`. Their annotations come along. */
export async function insertPages(doc: PDFDocument, src: PDFDocument, at: number, indexes?: number[]) {
  const pages = await doc.copyPages(src, indexes ?? src.getPageIndices());
  pages.forEach((p, i) => doc.insertPage(at + i, p));
}

export function deletePages(doc: PDFDocument, indexes: number[]) {
  if (indexes.length >= doc.getPageCount()) throw new Error('A document must keep at least one page.');
  [...new Set(indexes)].sort((a, b) => b - a).forEach((i) => doc.removePage(i));
}

/** A new document with copies of the given pages (markups included). */
export async function extractPages(doc: PDFDocument, indexes: number[]): Promise<PDFDocument> {
  const out = await PDFDocument.create();
  (await out.copyPages(doc, indexes)).forEach((p) => out.addPage(p));
  return out;
}

export function rotatePages(doc: PDFDocument, indexes: number[], delta: 90 | -90 | 180) {
  for (const i of indexes) {
    const p = doc.getPage(i);
    p.setRotation(degrees((((p.getRotation().angle + delta) % 360) + 360) % 360));
  }
}

/** Move page `from` so it ends up at index `to`. */
export function movePage(doc: PDFDocument, from: number, to: number) {
  if (from === to) return;
  const page = doc.getPage(from);
  doc.removePage(from);
  doc.insertPage(Math.max(0, Math.min(to, doc.getPageCount())), page);
}

/**
 * Replace page `at` with page `srcIndex` of `src`, keeping the markups that
 * were on the old page (Revu's Replace Pages, the basis of slip sheeting).
 */
export async function replacePage(doc: PDFDocument, at: number, src: PDFDocument, srcIndex: number, keepMarkups = true) {
  const old = doc.getPage(at);
  const [fresh] = await doc.copyPages(src, [srcIndex]);
  // The new sheet's own annotations are dropped in favour of the old page's markups.
  if (keepMarkups) {
    const annots = old.node.lookup(N('Annots'));
    fresh.node.delete(N('Annots'));
    if (annots instanceof PDFArray) {
      fresh.node.set(N('Annots'), annots);
      for (const r of annots.asArray()) {
        const a = doc.context.lookup(r);
        if (a instanceof PDFDict) a.set(N('P'), fresh.ref);
      }
    }
    // Page scale, viewports and Spaces belong to the sheet position too.
    for (const key of ['VP', 'BSISpaces']) {
      const v = old.node.get(N(key));
      if (v) fresh.node.set(N(key), v);
    }
  }
  doc.insertPage(at, fresh);
  doc.removePage(at + 1);
}

/** Split into documents of `every` pages. */
export async function splitDocument(doc: PDFDocument, every: number): Promise<PDFDocument[]> {
  const out: PDFDocument[] = [];
  for (let i = 0; i < doc.getPageCount(); i += every) {
    out.push(await extractPages(doc, doc.getPageIndices().slice(i, i + every)));
  }
  return out;
}

const nums = (doc: PDFDocument, a: unknown): number[] => {
  const arr = a instanceof PDFRef ? doc.context.lookup(a) : a;
  return arr instanceof PDFArray ? arr.asArray().map((x) => { const v = x instanceof PDFRef ? doc.context.lookup(x) : x; return v instanceof PDFNumber ? v.asNumber() : 0; }) : [];
};

/**
 * Flatten markups into the page content: each annotation's normal
 * appearance is drawn where the annotation is (ISO 32000 12.5.5), then the
 * annotation is removed. `keep(dict)` can exclude annotations (links, forms...).
 */
export function flattenPage(doc: PDFDocument, page: PDFPage, keep: (a: PDFDict) => boolean = () => false): number {
  const annots = page.node.lookup(N('Annots'));
  if (!(annots instanceof PDFArray)) return 0;
  const remaining: PDFRef[] = [];
  let n = 0;
  let wrapped = false;
  for (const r of annots.asArray()) {
    const a = doc.context.lookup(r);
    if (!(a instanceof PDFDict) || !(r instanceof PDFRef)) continue;
    const ap = a.lookup(N('AP'));
    const nRef = ap instanceof PDFDict ? ap.get(N('N')) : undefined;
    const stream = nRef instanceof PDFRef ? doc.context.lookup(nRef) : undefined;
    const sub = String(a.get(N('Subtype')) ?? '');
    const hidden = ((a.lookup(N('F')) as PDFNumber | undefined)?.asNumber?.() ?? 0) & 2;
    if (keep(a) || sub === '/Link' || sub === '/Widget' || sub === '/Popup' || !(stream instanceof PDFStream) || !(nRef instanceof PDFRef)) {
      remaining.push(r);
      continue;
    }
    if (!hidden) {
      const rect = nums(doc, a.get(N('Rect')));
      const bbox = nums(doc, stream.dict.get(N('BBox')));
      const m = nums(doc, stream.dict.get(N('Matrix')));
      const [ma, mb, mc, md, me, mf] = m.length === 6 ? m : [1, 0, 0, 1, 0, 0];
      // Transformed appearance box, then the matrix that maps it onto the annotation rectangle.
      const pts = [[bbox[0], bbox[1]], [bbox[2], bbox[1]], [bbox[0], bbox[3]], [bbox[2], bbox[3]]].map(([x, y]) => [ma * x + mc * y + me, mb * x + md * y + mf]);
      const x0 = Math.min(...pts.map((p) => p[0])), x1 = Math.max(...pts.map((p) => p[0]));
      const y0 = Math.min(...pts.map((p) => p[1])), y1 = Math.max(...pts.map((p) => p[1]));
      if (rect.length === 4 && x1 > x0 && y1 > y0) {
        const sx = (rect[2] - rect[0]) / (x1 - x0), sy = (rect[3] - rect[1]) / (y1 - y0);
        if (!wrapped) {
          // Isolate the existing content's graphics state before drawing on top of it.
          page.node.wrapContentStreams(doc.context.register(doc.context.stream('q')), doc.context.register(doc.context.stream('Q')));
          wrapped = true;
        }
        const name = page.node.newXObject('Flat', nRef);
        const ops = `q ${sx} 0 0 ${sy} ${rect[0] - x0 * sx} ${rect[1] - y0 * sy} cm /${name.asString().slice(1)} Do Q`;
        const content = doc.context.flateStream(ops);
        page.node.addContentStream(doc.context.register(content));
        n++;
      }
    }
  }
  page.node.set(N('Annots'), doc.context.obj(remaining));
  return n;
}
