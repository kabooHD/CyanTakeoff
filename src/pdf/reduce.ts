// Reduce File Size (File menu): drop what a drawing set does not need and
// pack the rest tighter. Options: remove unused objects, compress
// uncompressed streams, remove metadata / page thumbnails / private
// application data, pack objects into object streams, and downsample JPEG
// images that are stored at a higher resolution than they are shown.
import { PDFArray, PDFDict, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFStream, type PDFDocument, type PDFObject } from 'pdf-lib';
import { zlibSync } from 'fflate';
import { latin1, parseContent } from './content';
import { mul, streamBytes } from './redactContent';

const N = PDFName.of;
type M = [number, number, number, number, number, number];

export interface ReduceOptions {
  removeUnused: boolean;
  compress: boolean;
  removeMetadata: boolean;
  removeThumbnails: boolean;
  removePrivateData: boolean;
  /** JPEG images above this resolution (dpi as placed) are resampled to it; 0 = keep. */
  imageDpi: number;
  /** JPEG quality for resampled images (0..1). */
  quality: number;
}

export const DEFAULT_REDUCE: ReduceOptions = { removeUnused: true, compress: true, removeMetadata: false, removeThumbnails: true, removePrivateData: true, imageDpi: 0, quality: 0.75 };

/** Delete objects nothing refers to (from the trailer). Returns how many. */
export function removeUnused(doc: PDFDocument): number {
  const ctx = doc.context;
  const seen = new Set<string>();
  const visit = (o: PDFObject | undefined) => {
    if (!o) return;
    if (o instanceof PDFRef) {
      if (seen.has(o.tag)) return;
      seen.add(o.tag);
      visit(ctx.lookup(o));
    } else if (o instanceof PDFDict) for (const [, v] of o.entries()) visit(v);
    else if (o instanceof PDFArray) for (const v of o.asArray()) visit(v);
    else if (o instanceof PDFStream) visit(o.dict);
  };
  const t = ctx.trailerInfo;
  [t.Root, t.Info, t.Encrypt, t.ID].forEach((x) => visit(x as PDFObject | undefined));
  let n = 0;
  for (const [ref] of ctx.enumerateIndirectObjects()) if (!seen.has(ref.tag)) { ctx.delete(ref); n++; }
  return n;
}

/** Flate-compress streams stored without a filter. Returns how many. */
export function compressStreams(doc: PDFDocument): number {
  let n = 0;
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream) || obj.dict.has(N('Filter'))) continue;
    const type = String(obj.dict.get(N('Type')) ?? '');
    if (type === '/XRef' || type === '/Metadata') continue; // XMP stays readable, as recommended
    if (obj.contents.length < 64) continue;
    const z = zlibSync(obj.contents, { level: 9 });
    if (z.length >= obj.contents.length) continue;
    obj.dict.set(N('Filter'), N('FlateDecode'));
    obj.dict.delete(N('DecodeParms'));
    doc.context.assign(ref, PDFRawStream.of(obj.dict, z));
    n++;
  }
  return n;
}

export function removeExtras(doc: PDFDocument, o: Pick<ReduceOptions, 'removeMetadata' | 'removeThumbnails' | 'removePrivateData'>): number {
  let n = 0;
  const del = (d: PDFDict, k: string) => { if (d.has(N(k))) { d.delete(N(k)); n++; } };
  if (o.removeMetadata) del(doc.catalog, 'Metadata');
  if (o.removePrivateData) del(doc.catalog, 'PieceInfo');
  for (const p of doc.getPages()) {
    if (o.removeThumbnails) del(p.node, 'Thumb');
    if (o.removePrivateData) del(p.node, 'PieceInfo');
    if (o.removeMetadata) del(p.node, 'Metadata');
  }
  return n;
}

/**
 * Largest size (points, width × height) each image XObject is drawn at, over
 * all pages, following the CTM and form XObjects.
 */
export function imagePlacements(doc: PDFDocument): Map<string, { ref: PDFRef; w: number; h: number }> {
  const out = new Map<string, { ref: PDFRef; w: number; h: number }>();
  const ctx = doc.context;
  const walk = (content: string, res: PDFDict | undefined, ctm: M, depth: number) => {
    if (depth > 8) return;
    const xo = res?.lookup(N('XObject'));
    const stack: M[] = [];
    let m = ctm;
    for (const op of parseContent(content)) {
      if (op.op === 'q') stack.push(m);
      else if (op.op === 'Q') m = stack.pop() ?? ctm;
      else if (op.op === 'cm' && op.args.length === 6) m = mul(op.args.map((a) => (a.t === 'num' ? a.v : 0)) as M, m);
      else if (op.op === 'Do' && xo instanceof PDFDict && op.args[0]?.t === 'name') {
        const r = xo.get(N(op.args[0].v));
        const x = r instanceof PDFRef ? ctx.lookup(r) : undefined;
        if (!(r instanceof PDFRef) || !(x instanceof PDFStream)) continue;
        const sub = String(x.dict.get(N('Subtype')));
        if (sub === '/Image') {
          // The unit square drawn by the CTM: its side lengths.
          const w = Math.hypot(m[0], m[1]), h = Math.hypot(m[2], m[3]);
          const cur = out.get(r.tag);
          if (!cur || w * h > cur.w * cur.h) out.set(r.tag, { ref: r, w, h });
        } else if (sub === '/Form') {
          const fm = x.dict.lookup(N('Matrix'));
          const mm = fm instanceof PDFArray ? (fm.asArray().map((v) => (v instanceof PDFNumber ? v.asNumber() : 0)) as M) : ([1, 0, 0, 1, 0, 0] as M);
          const fr = x.dict.lookup(N('Resources'));
          walk(latin1(streamBytes(x)), fr instanceof PDFDict ? fr : res, mul(mm, m), depth + 1);
        }
      }
    }
  };
  for (const p of doc.getPages()) {
    const cs = p.node.Contents();
    const parts = cs instanceof PDFArray ? cs.asArray().map((r) => ctx.lookup(r)) : [cs];
    const content = parts.filter((s): s is PDFStream => s instanceof PDFStream).map((s) => latin1(streamBytes(s))).join('\n');
    walk(content, p.node.Resources(), [1, 0, 0, 1, 0, 0], 0);
  }
  return out;
}

/** JPEG images worth resampling: drawn at more than `dpi` (with 25% slack). */
export function oversizedJpegs(doc: PDFDocument, dpi: number): { ref: PDFRef; stream: PDFRawStream; width: number; height: number; targetW: number; targetH: number }[] {
  const out = [];
  for (const { ref, w, h } of imagePlacements(doc).values()) {
    const s = doc.context.lookup(ref);
    if (!(s instanceof PDFRawStream) || String(s.dict.get(N('Filter'))) !== '/DCTDecode') continue;
    if (s.dict.has(N('SMask')) || s.dict.has(N('Mask'))) continue;
    if (String(s.dict.get(N('ColorSpace'))) === '/DeviceCMYK') continue; // browsers decode CMYK JPEGs unreliably
    const pw = (s.dict.lookup(N('Width')) as PDFNumber | undefined)?.asNumber() ?? 0;
    const ph = (s.dict.lookup(N('Height')) as PDFNumber | undefined)?.asNumber() ?? 0;
    const tw = Math.ceil((w / 72) * dpi), th = Math.ceil((h / 72) * dpi);
    if (pw > tw * 1.25 && ph > th * 1.25 && tw > 0 && th > 0) out.push({ ref, stream: s, width: pw, height: ph, targetW: tw, targetH: th });
  }
  return out;
}

/** Put a new JPEG in place of an image (same object, so every use follows). */
export function replaceJpeg(doc: PDFDocument, ref: PDFRef, old: PDFRawStream, jpeg: Uint8Array, w: number, h: number) {
  const d = old.dict;
  d.set(N('Width'), PDFNumber.of(w));
  d.set(N('Height'), PDFNumber.of(h));
  d.set(N('BitsPerComponent'), PDFNumber.of(8));
  d.set(N('ColorSpace'), N('DeviceRGB'));
  d.delete(N('Decode'));
  d.delete(N('DecodeParms'));
  doc.context.assign(ref, PDFRawStream.of(d, jpeg));
}
