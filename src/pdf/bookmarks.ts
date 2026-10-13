// Bookmarks (PDF outline, /Outlines). Read into a tree we can edit, and
// written back only when the user changed them. Each item keeps its
// original object (`src`), so unchanged items keep their ref and any keys or
// actions we do not edit (links to other files, web links, structure).
import { PDFArray, PDFDict, PDFHexString, PDFName, PDFNull, PDFNumber, PDFRef, PDFString, type PDFDocument, type PDFObject } from 'pdf-lib';

export interface Bookmark {
  id: string;
  title: string;
  /** "objectNumber generation" of the item this came from. */
  src?: string;
  /** Target page (0-based), or null when the action is not a jump within this file. */
  page: number | null;
  /** Destination fit type and its numbers (PDF space), e.g. XYZ [left, top, zoom]. */
  fit?: string;
  args?: (number | null)[];
  /** The destination was set here (new bookmark or Set to Current View). */
  destEdited?: boolean;
  /** The bookmark jumps to a page that is not in the file (Audit Bookmarks). */
  broken?: boolean;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  open: boolean;
  kids: Bookmark[];
}

const N = PDFName.of;
const refStr = (r: PDFRef) => `${r.objectNumber} ${r.generationNumber}`;

function text(o: PDFObject | undefined): string {
  if (o instanceof PDFString || o instanceof PDFHexString) return o.decodeText();
  return '';
}

/** Look up `key` in a name tree (/Names /Dests). */
function nameTreeGet(doc: PDFDocument, node: PDFObject | undefined, key: string, depth = 0): PDFObject | undefined {
  const n = node instanceof PDFRef ? doc.context.lookup(node) : node;
  if (!(n instanceof PDFDict) || depth > 32) return undefined;
  const names = n.lookup(N('Names'));
  if (names instanceof PDFArray) {
    for (let i = 0; i + 1 < names.size(); i += 2) if (text(names.lookup(i)) === key) return names.get(i + 1);
  }
  const kids = n.lookup(N('Kids'));
  if (kids instanceof PDFArray) {
    for (const k of kids.asArray()) {
      const kd = doc.context.lookup(k);
      const limits = kd instanceof PDFDict ? kd.lookup(N('Limits')) : undefined;
      if (limits instanceof PDFArray && (key < text(limits.lookup(0)) || key > text(limits.lookup(1)))) continue;
      const v = nameTreeGet(doc, k, key, depth + 1);
      if (v) return v;
    }
  }
  return undefined;
}

/** Resolve a destination (array, name or string) to its array. */
function resolveDest(doc: PDFDocument, d: PDFObject | undefined): PDFArray | undefined {
  const v = d instanceof PDFRef ? doc.context.lookup(d) : d;
  if (v instanceof PDFArray) return v;
  let found: PDFObject | undefined;
  if (v instanceof PDFName) {
    const dests = doc.catalog.lookup(N('Dests'));
    if (dests instanceof PDFDict) found = dests.get(N(v.decodeText()));
  } else if (v instanceof PDFString || v instanceof PDFHexString) {
    const names = doc.catalog.lookup(N('Names'));
    if (names instanceof PDFDict) found = nameTreeGet(doc, names.get(N('Dests')), v.decodeText());
  }
  const f = found instanceof PDFRef ? doc.context.lookup(found) : found;
  if (f instanceof PDFDict) { const dd = f.lookup(N('D')); return dd instanceof PDFArray ? dd : undefined; }
  return f instanceof PDFArray ? f : undefined;
}

const hex = (c: number[]) => '#' + c.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('');

export function readBookmarks(doc: PDFDocument): Bookmark[] {
  const pageIndex = new Map(doc.getPages().map((p, i) => [refStr(p.ref), i]));
  const outlines = doc.catalog.lookup(N('Outlines'));
  if (!(outlines instanceof PDFDict)) return [];
  const seen = new Set<string>();
  const list = (first: PDFObject | undefined, depth: number): Bookmark[] => {
    const out: Bookmark[] = [];
    let r = first;
    while (r instanceof PDFRef && !seen.has(refStr(r)) && depth < 64) {
      seen.add(refStr(r));
      const it = doc.context.lookup(r);
      if (!(it instanceof PDFDict)) break;
      const b: Bookmark = { id: refStr(r), src: refStr(r), title: text(it.lookup(N('Title'))), page: null, open: false, kids: [] };
      let dest: PDFObject | undefined = it.get(N('Dest'));
      let goTo = dest !== undefined;
      const a = it.lookup(N('A'));
      if (!dest && a instanceof PDFDict && String(a.get(N('S'))) === '/GoTo') { dest = a.get(N('D')); goTo = true; }
      const arr = resolveDest(doc, dest);
      if (arr) {
        const p0 = arr.get(0);
        const idx = p0 instanceof PDFRef ? pageIndex.get(refStr(p0)) : undefined;
        b.page = idx ?? null;
        b.fit = String(arr.get(1) ?? '/Fit').replace('/', '');
        b.args = arr.asArray().slice(2).map((x) => (x instanceof PDFNumber ? x.asNumber() : null));
      }
      b.broken = goTo && b.page === null;
      const c = it.lookup(N('C'));
      if (c instanceof PDFArray && c.size() === 3) {
        const v = c.asArray().map((x) => (x instanceof PDFNumber ? x.asNumber() : 0));
        if (v.some((x) => x > 0)) b.color = hex(v);
      }
      const f = it.lookup(N('F'));
      if (f instanceof PDFNumber) { b.italic = !!(f.asNumber() & 1); b.bold = !!(f.asNumber() & 2); }
      const count = it.lookup(N('Count'));
      b.kids = list(it.get(N('First')), depth + 1);
      b.open = count instanceof PDFNumber ? count.asNumber() > 0 : false;
      out.push(b);
      r = it.get(N('Next'));
    }
    return out;
  };
  return list(outlines.get(N('First')), 0);
}

/** Number of items visible under `b` when it is open. */
const visible = (b: Bookmark): number => b.kids.reduce((n, k) => n + 1 + (k.open ? visible(k) : 0), 0);

/** Replace the document's bookmarks with `list`. */
export function writeBookmarks(doc: PDFDocument, list: Bookmark[]) {
  const ctx = doc.context;
  const pages = doc.getPages();
  // Old items: those not kept are removed.
  const old = new Set<string>();
  const oldRoot = doc.catalog.lookup(N('Outlines'));
  const walk = (r: PDFObject | undefined, depth = 0) => {
    while (r instanceof PDFRef && !old.has(refStr(r)) && depth < 100000) {
      old.add(refStr(r));
      const it = ctx.lookup(r);
      if (!(it instanceof PDFDict)) return;
      walk(it.get(N('First')), depth + 1);
      r = it.get(N('Next'));
      depth++;
    }
  };
  if (oldRoot instanceof PDFDict) walk(oldRoot.get(N('First')));
  const kept = new Set<string>();

  const rootRef = doc.catalog.get(N('Outlines')) instanceof PDFRef ? doc.catalog.get(N('Outlines')) as PDFRef : ctx.nextRef();
  const build = (items: Bookmark[], parent: PDFRef): PDFRef[] => {
    const refs = items.map((b) => {
      if (b.src && old.has(b.src) && !kept.has(b.src)) {
        kept.add(b.src);
        const [n, g] = b.src.split(' ').map(Number);
        return PDFRef.of(n, g);
      }
      return ctx.nextRef();
    });
    items.forEach((b, i) => {
      const ref = refs[i];
      const existing = ctx.lookup(ref);
      const it = existing instanceof PDFDict ? existing : ctx.obj({});
      it.set(N('Title'), PDFHexString.fromText(b.title));
      it.set(N('Parent'), parent);
      for (const k of ['Prev', 'Next', 'First', 'Last', 'Count']) it.delete(N(k));
      if (i > 0) it.set(N('Prev'), refs[i - 1]);
      if (i < refs.length - 1) it.set(N('Next'), refs[i + 1]);
      const kids = build(b.kids, ref);
      if (kids.length) {
        it.set(N('First'), kids[0]);
        it.set(N('Last'), kids[kids.length - 1]);
        it.set(N('Count'), PDFNumber.of(b.open ? visible(b) : -visible(b)));
      }
      if (b.color) it.set(N('C'), ctx.obj([1, 3, 5].map((k) => parseInt(b.color!.slice(k, k + 2), 16) / 255)));
      else it.delete(N('C'));
      const flags = (b.italic ? 1 : 0) | (b.bold ? 2 : 0);
      if (flags) it.set(N('F'), PDFNumber.of(flags)); else it.delete(N('F'));
      if ((b.destEdited || !(existing instanceof PDFDict)) && b.page !== null && pages[b.page]) {
        it.delete(N('A'));
        it.set(N('Dest'), ctx.obj([pages[b.page].ref, N(b.fit ?? 'Fit'), ...(b.args ?? []).map((x) => (x === null ? PDFNull : PDFNumber.of(x)))]));
      }
      ctx.assign(ref, it);
    });
    return refs;
  };

  const drop = (s: string) => { const [n, g] = s.split(' ').map(Number); ctx.delete(PDFRef.of(n, g)); };
  if (!list.length) {
    old.forEach(drop);
    if (doc.catalog.get(N('Outlines')) instanceof PDFRef) ctx.delete(doc.catalog.get(N('Outlines')) as PDFRef);
    doc.catalog.delete(N('Outlines'));
    return;
  }
  const top = build(list, rootRef);
  for (const s of old) if (!kept.has(s)) drop(s);
  const root = oldRoot instanceof PDFDict ? oldRoot : ctx.obj({ Type: 'Outlines' });
  root.set(N('First'), top[0]);
  root.set(N('Last'), top[top.length - 1]);
  root.set(N('Count'), PDFNumber.of(list.reduce((n, b) => n + 1 + (b.open ? visible(b) : 0), 0)));
  ctx.assign(rootRef, root);
  doc.catalog.set(N('Outlines'), rootRef);
}
