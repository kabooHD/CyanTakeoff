// Places (Revu Links panel): the PDF's named destinations (ISO 32000 12.3.2.3),
// from the /Names /Dests name tree and the older catalog /Dests dictionary.
// Writing replaces both with one flat, sorted name tree.
import { PDFArray, PDFDict, PDFHexString, PDFName, PDFNull, PDFNumber, PDFRef, PDFString, type PDFDocument, type PDFObject } from 'pdf-lib';

export interface Place {
  name: string;
  /** Target page (0-based), or null when the page is not in the file. */
  page: number | null;
  /** Fit type (XYZ, Fit, FitH, FitR...) and its numbers in PDF space. */
  fit: string;
  args: (number | null)[];
}

const N = PDFName.of;
const refStr = (r: PDFRef) => `${r.objectNumber} ${r.generationNumber}`;
const text = (o: PDFObject | undefined) => (o instanceof PDFString || o instanceof PDFHexString ? o.decodeText() : o instanceof PDFName ? o.decodeText() : '');

function treeEntries(doc: PDFDocument, node: PDFObject | undefined, out: [string, PDFObject][], depth = 0) {
  const n = node instanceof PDFRef ? doc.context.lookup(node) : node;
  if (!(n instanceof PDFDict) || depth > 32) return;
  const names = n.lookup(N('Names'));
  if (names instanceof PDFArray) for (let i = 0; i + 1 < names.size(); i += 2) out.push([text(names.lookup(i)), names.get(i + 1)]);
  const kids = n.lookup(N('Kids'));
  if (kids instanceof PDFArray) for (const k of kids.asArray()) treeEntries(doc, k, out, depth + 1);
}

export function readPlaces(doc: PDFDocument): Place[] {
  const pageIndex = new Map(doc.getPages().map((p, i) => [refStr(p.ref), i]));
  const entries: [string, PDFObject][] = [];
  const old = doc.catalog.lookup(N('Dests'));
  if (old instanceof PDFDict) for (const [k, v] of old.entries()) entries.push([k.decodeText(), v]);
  const names = doc.catalog.lookup(N('Names'));
  if (names instanceof PDFDict) treeEntries(doc, names.get(N('Dests')), entries);
  const seen = new Set<string>();
  const out: Place[] = [];
  for (const [name, raw] of entries) {
    if (!name || seen.has(name)) continue;
    seen.add(name);
    let v = raw instanceof PDFRef ? doc.context.lookup(raw) : raw;
    if (v instanceof PDFDict) v = v.lookup(N('D'));
    if (!(v instanceof PDFArray)) continue;
    const p0 = v.get(0);
    out.push({
      name,
      page: p0 instanceof PDFRef ? pageIndex.get(refStr(p0)) ?? null : p0 instanceof PDFNumber ? p0.asNumber() : null,
      fit: String(v.get(1) ?? '/Fit').replace('/', ''),
      args: v.asArray().slice(2).map((x) => (x instanceof PDFNumber ? x.asNumber() : null)),
    });
  }
  return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/**
 * Replace the named destinations with `places`. Links in older files name
 * their target in the catalog /Dests dictionary; when the file has one it is
 * kept in step, so those links still resolve.
 */
export function writePlaces(doc: PDFDocument, places: Place[]) {
  const pages = doc.getPages();
  const destOf = (p: Place) => doc.context.obj([pages[p.page!].ref, N(p.fit), ...p.args.map((a) => (a === null ? PDFNull : PDFNumber.of(a)))]);
  if (doc.catalog.lookup(N('Dests')) instanceof PDFDict) {
    const d = doc.context.obj({}) as PDFDict;
    for (const p of places) if (p.page !== null && pages[p.page]) d.set(N(p.name), destOf(p));
    doc.catalog.set(N('Dests'), doc.context.register(d));
  }
  let names = doc.catalog.lookup(N('Names'));
  if (!(names instanceof PDFDict)) {
    if (!places.length) return;
    names = doc.context.obj({});
    doc.catalog.set(N('Names'), doc.context.register(names as PDFDict));
  }
  const nd = names as PDFDict;
  if (!places.length) { nd.delete(N('Dests')); return; }
  const arr: PDFObject[] = [];
  // Name trees are sorted by key in byte order.
  for (const p of [...places].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    if (p.page === null || !pages[p.page]) continue;
    const dest = destOf(p);
    arr.push(/^[\x20-\x7e]*$/.test(p.name) && !/[()\\]/.test(p.name) ? PDFString.of(p.name) : PDFHexString.fromText(p.name), dest);
  }
  nd.set(N('Dests'), doc.context.register(doc.context.obj({ Names: doc.context.obj(arr) as PDFArray })));
}
