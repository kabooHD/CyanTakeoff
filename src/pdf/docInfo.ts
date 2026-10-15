// Document-level properties for the Properties panel (Revu, nothing
// selected): custom entries of the Info dictionary and the files attached
// to the document (catalog /Names /EmbeddedFiles), besides the standard
// metadata pdf-lib already exposes.
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFStream, PDFString, type PDFObject } from 'pdf-lib';

const STANDARD = new Set(['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer', 'CreationDate', 'ModDate', 'Trapped']);
const N = (s: string) => PDFName.of(s);
const text = (o: PDFObject | undefined) => (o instanceof PDFString || o instanceof PDFHexString ? o.decodeText() : o instanceof PDFName ? o.decodeText() : '');
const encode = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? PDFString.of(s) : PDFHexString.fromText(s));

function infoDict(doc: PDFDocument, create: boolean): PDFDict | null {
  const ref = doc.context.trailerInfo.Info;
  const d = ref ? doc.context.lookup(ref) : undefined;
  if (d instanceof PDFDict) return d;
  if (!create) return null;
  const nd = doc.context.obj({}) as PDFDict;
  doc.context.trailerInfo.Info = doc.context.register(nd);
  return nd;
}

/** Custom (non-standard) Info entries, as text. */
export function readCustomProps(doc: PDFDocument): Record<string, string> {
  const d = infoDict(doc, false);
  const out: Record<string, string> = {};
  if (!d) return out;
  for (const [k, v] of d.entries()) {
    const key = k.decodeText();
    if (!STANDARD.has(key)) out[key] = text(v);
  }
  return out;
}

/** Replace the custom Info entries with `props` (standard ones are kept). */
export function writeCustomProps(doc: PDFDocument, props: Record<string, string>) {
  const d = infoDict(doc, true)!;
  for (const [k] of d.entries()) if (!STANDARD.has(k.decodeText())) d.delete(k);
  for (const [k, v] of Object.entries(props)) if (k.trim()) d.set(N(k.trim()), encode(v));
}

export interface EmbeddedFile { name: string; size: number }

/** The /EmbeddedFiles name tree's names array (one level of Kids is flattened), or null. */
function embeddedNames(doc: PDFDocument): PDFArray | null {
  const names = doc.catalog.lookup(N('Names'));
  const ef = names instanceof PDFDict ? names.lookup(N('EmbeddedFiles')) : undefined;
  if (!(ef instanceof PDFDict)) return null;
  const direct = ef.lookup(N('Names'));
  if (direct instanceof PDFArray) return direct;
  const kids = ef.lookup(N('Kids'));
  if (kids instanceof PDFArray) {
    // Flatten the kids into one array on the root (keeps order).
    const all = doc.context.obj([]) as PDFArray;
    for (const k of kids.asArray()) {
      const kd = doc.context.lookup(k);
      const kn = kd instanceof PDFDict ? kd.lookup(N('Names')) : undefined;
      if (kn instanceof PDFArray) for (const x of kn.asArray()) all.push(x);
    }
    ef.set(N('Names'), all); ef.delete(N('Kids'));
    return all;
  }
  return null;
}

/** Files attached to the document (not the File Attachment markups). */
export function listEmbeddedFiles(doc: PDFDocument): EmbeddedFile[] {
  const arr = embeddedNames(doc);
  if (!arr) return [];
  const out: EmbeddedFile[] = [];
  const items = arr.asArray();
  for (let i = 0; i + 1 < items.length; i += 2) {
    const fs = doc.context.lookup(items[i + 1]);
    if (!(fs instanceof PDFDict)) continue;
    const ef = fs.lookup(N('EF'));
    const stream = ef instanceof PDFDict ? doc.context.lookup(ef.get(N('F'))) : undefined;
    const params = stream instanceof PDFStream ? stream.dict.lookup(N('Params')) : undefined;
    const sizeObj = params instanceof PDFDict ? params.lookup(N('Size')) : undefined;
    const size = sizeObj instanceof PDFNumber ? sizeObj.asNumber() : 0;
    out.push({ name: text(fs.get(N('UF'))) || text(fs.get(N('F'))) || text(doc.context.lookup(items[i])) || 'attachment', size });
  }
  return out;
}

/** Attach a file to the document. */
export async function attachFile(doc: PDFDocument, name: string, bytes: Uint8Array, mimeType = 'application/octet-stream') {
  await doc.attach(bytes, name, { mimeType, description: name });
}

/** Remove the attachment called `name`; returns whether one was removed. */
export function removeEmbeddedFile(doc: PDFDocument, name: string): boolean {
  const arr = embeddedNames(doc);
  if (!arr) return false;
  const items = arr.asArray();
  for (let i = 0; i + 1 < items.length; i += 2) {
    const fs = doc.context.lookup(items[i + 1]);
    const n = fs instanceof PDFDict ? text(fs.get(N('UF'))) || text(fs.get(N('F'))) || text(doc.context.lookup(items[i])) : text(doc.context.lookup(items[i]));
    if (n !== name) continue;
    const rest = items.filter((_, k) => k !== i && k !== i + 1);
    const next = doc.context.obj(rest) as PDFArray;
    const names = doc.catalog.lookup(N('Names')) as PDFDict;
    const ef = names.lookup(N('EmbeddedFiles')) as PDFDict;
    if (rest.length) ef.set(N('Names'), next); else names.delete(N('EmbeddedFiles'));
    return true;
  }
  return false;
}
