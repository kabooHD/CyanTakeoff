// Incremental updates (ISO 32000 7.5.6): append only the objects that
// changed to the original file, with a new cross-reference section that
// points back to the previous one. Earlier revisions stay byte-for-byte
// intact, which keeps digital signatures valid.
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRef, PDFStream, type PDFObject, type PDFPage } from 'pdf-lib';

const enc = new TextEncoder();

function bytesOf(o: PDFObject): Uint8Array {
  const b = new Uint8Array(o.sizeInBytes());
  o.copyBytesInto(b, 0);
  return b;
}

function same(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Byte offset of the last cross-reference section (the number after the last `startxref`). */
export function lastXrefOffset(bytes: Uint8Array): number {
  const tail = new TextDecoder('latin1').decode(bytes.subarray(Math.max(0, bytes.length - 2048)));
  const m = /startxref\s+(\d+)\s*%%EOF\s*$/.exec(tail) ?? [...tail.matchAll(/startxref\s+(\d+)/g)].pop();
  if (!m) throw new Error('No startxref found');
  return Number(m[1]);
}

/**
 * Stop pdf-lib from wrapping the page's content streams in q/Q when an
 * annotation or field is added: that rewrites the page's /Contents, which
 * signature validators flag as a suspicious change after signing.
 */
export function keepPageContents(page: PDFPage) {
  (page.node as unknown as { autoNormalizeCTM: boolean }).autoNormalizeCTM = false;
}

/** /Size of the last cross-reference section: object numbers below it are taken. */
export function xrefSize(bytes: Uint8Array): number {
  const off = lastXrefOffset(bytes);
  const text = new TextDecoder('latin1').decode(bytes.subarray(off, Math.min(bytes.length, off + 1_000_000)));
  // A classic table's trailer, or the cross-reference stream's dictionary.
  const m = /\/Size\s+(\d+)/.exec(text);
  return m ? Number(m[1]) : 0;
}

/**
 * Load a PDF for editing and saving as an incremental update: new objects
 * get numbers above every number the file already uses (including its
 * cross-reference streams, which pdf-lib does not keep).
 */
export async function loadForUpdate(bytes: Uint8Array): Promise<PDFDocument> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  try {
    doc.context.largestObjectNumber = Math.max(doc.context.largestObjectNumber, xrefSize(bytes) - 1);
  } catch { /* no usable xref: numbering as pdf-lib sees it */ }
  return doc;
}

/** True when the previous section is a cross-reference stream (PDF 1.5+), not a classic table. */
function usesXrefStream(bytes: Uint8Array, off: number) {
  let i = off;
  while (i < bytes.length && /\s/.test(String.fromCharCode(bytes[i]))) i++;
  return String.fromCharCode(...bytes.subarray(i, i + 4)) !== 'xref';
}

/** Whether the document has signed signature fields. */
export function hasSignatures(doc: PDFDocument): boolean {
  const acro = doc.catalog.lookup(PDFName.of('AcroForm'));
  if (!(acro instanceof PDFDict)) return false;
  const walk = (arr: unknown, depth: number, ft?: string): boolean => {
    if (!(arr instanceof PDFArray) || depth > 20) return false;
    return arr.asArray().some((r) => {
      const f = doc.context.lookup(r);
      if (!(f instanceof PDFDict)) return false;
      const type = String(f.get(PDFName.of('FT')) ?? ft ?? '');
      if (type === '/Sig' && f.get(PDFName.of('V'))) return true;
      return walk(f.lookup(PDFName.of('Kids')), depth + 1, type || undefined);
    });
  };
  return walk(acro.lookup(PDFName.of('Fields')), 0);
}

/**
 * Serialise `doc` (loaded from `original` and then edited) as an incremental
 * update of `original`: objects whose bytes differ from the original's, or
 * that are new, are appended. Returns `original` itself when nothing changed.
 */
export async function incrementalUpdate(original: Uint8Array, doc: PDFDocument): Promise<Uint8Array> {
  await doc.flush();
  const base = await PDFDocument.load(original, { updateMetadata: false });
  if (doc.context.trailerInfo.Encrypt) throw new Error('Encrypted PDFs cannot be updated incrementally.');
  // Only objects the document still uses (pdf-lib may have created unused ones, e.g. a font).
  const live = new Set<PDFRef>();
  const visit = (o: unknown) => {
    const stack = [o];
    while (stack.length) {
      let x = stack.pop();
      if (x instanceof PDFRef) {
        if (live.has(x)) continue;
        live.add(x);
        x = doc.context.lookup(x);
      }
      if (x instanceof PDFStream) x = x.dict;
      if (x instanceof PDFDict) for (const [, v] of x.entries()) stack.push(v);
      else if (x instanceof PDFArray) stack.push(...x.asArray());
    }
  };
  visit(doc.context.trailerInfo.Root);
  visit(doc.context.trailerInfo.Info);
  const changed: [PDFRef, Uint8Array][] = [];
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (!live.has(ref)) continue;
    const b = bytesOf(obj);
    const old = base.context.lookup(ref);
    if (old && same(bytesOf(old), b)) continue;
    changed.push([ref, b]);
  }
  if (!changed.length) return original;
  changed.sort((a, b) => a[0].objectNumber - b[0].objectNumber);

  const prev = lastXrefOffset(original);
  const parts: Uint8Array[] = [original];
  let offset = original.length;
  const push = (b: Uint8Array) => { parts.push(b); offset += b.length; };
  if (original[original.length - 1] !== 0x0a) push(enc.encode('\n'));
  const entries: { num: number; gen: number; off: number }[] = [];
  for (const [ref, b] of changed) {
    entries.push({ num: ref.objectNumber, gen: ref.generationNumber, off: offset });
    push(enc.encode(`${ref.objectNumber} ${ref.generationNumber} obj\n`));
    push(b);
    push(enc.encode('\nendobj\n'));
  }
  const t = doc.context.trailerInfo;
  const extra = [
    t.Root ? `/Root ${t.Root}` : '',
    t.Info ? `/Info ${t.Info}` : '',
    t.ID ? `/ID ${t.ID}` : '',
    `/Prev ${prev}`,
  ].filter(Boolean).join(' ');
  let size = Math.max(doc.context.largestObjectNumber + 1, xrefSize(original));
  const clash = changed.find(([ref]) => !base.context.lookup(ref) && ref.objectNumber < xrefSize(original));
  if (clash) throw new Error(`Object ${clash[0].objectNumber} is already used in the file; load it with loadForUpdate().`);

  if (!usesXrefStream(original, prev)) {
    const xrefAt = offset;
    let s = 'xref\n';
    for (let i = 0; i < entries.length;) {
      let j = i;
      while (j + 1 < entries.length && entries[j + 1].num === entries[j].num + 1) j++;
      s += `${entries[i].num} ${j - i + 1}\n`;
      for (let k = i; k <= j; k++) s += `${String(entries[k].off).padStart(10, '0')} ${String(entries[k].gen).padStart(5, '0')} n\r\n`;
      i = j + 1;
    }
    s += `trailer\n<< /Size ${size} ${extra} >>\nstartxref\n${xrefAt}\n%%EOF\n`;
    push(enc.encode(s));
  } else {
    // The previous section is a stream, so this one is too: /W [1 4 2], uncompressed.
    const xn = size++;
    const xrefAt = offset;
    entries.push({ num: xn, gen: 0, off: xrefAt });
    const index: number[] = [];
    for (let i = 0; i < entries.length;) {
      let j = i;
      while (j + 1 < entries.length && entries[j + 1].num === entries[j].num + 1) j++;
      index.push(entries[i].num, j - i + 1);
      i = j + 1;
    }
    const data = new Uint8Array(entries.length * 7);
    entries.forEach((e, i) => {
      const o = i * 7;
      data[o] = 1;
      data[o + 1] = (e.off >>> 24) & 255; data[o + 2] = (e.off >>> 16) & 255; data[o + 3] = (e.off >>> 8) & 255; data[o + 4] = e.off & 255;
      data[o + 5] = (e.gen >>> 8) & 255; data[o + 6] = e.gen & 255;
    });
    push(enc.encode(`${xn} 0 obj\n<< /Type /XRef /Size ${size} /W [1 4 2] /Index [${index.join(' ')}] ${extra} /Length ${data.length} >>\nstream\n`));
    push(data);
    push(enc.encode(`\nendstream\nendobj\nstartxref\n${xrefAt}\n%%EOF\n`));
  }
  const out = new Uint8Array(offset);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
