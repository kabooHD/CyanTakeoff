// Repair PDF (Revu Document > Repair PDF): fixes that cure common display
// problems: the file structure is rebuilt (cross-reference table, no object
// streams), broken entries are dropped from page annotation arrays and
// content arrays, and unbalanced graphics state (more q than Q) is closed.
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRef, PDFStream } from 'pdf-lib';
import { latin1, parseContent } from './content';
import { streamBytes } from './redactContent';

const N = PDFName.of;
export interface RepairStats { annotsDropped: number; contentsDropped: number; statesClosed: number; pages: number }

export function repairPdf(doc: PDFDocument, pages?: number[]): RepairStats {
  const ctx = doc.context;
  const st: RepairStats = { annotsDropped: 0, contentsDropped: 0, statesClosed: 0, pages: 0 };
  const list = pages ?? doc.getPages().map((_, i) => i);
  for (const i of list) {
    const p = doc.getPage(i);
    st.pages++;
    // Annotations: keep references to dictionaries only, once each.
    const annots = p.node.lookup(N('Annots'));
    if (annots instanceof PDFArray) {
      const seen = new Set<string>();
      const keep = annots.asArray().filter((r) => {
        const a = r instanceof PDFRef ? ctx.lookup(r) : r;
        const ok = a instanceof PDFDict && !(r instanceof PDFRef && seen.has(r.tag));
        if (r instanceof PDFRef) seen.add(r.tag);
        return ok;
      });
      if (keep.length !== annots.size()) { st.annotsDropped += annots.size() - keep.length; p.node.set(N('Annots'), ctx.obj(keep)); }
    }
    // Contents: streams only; close graphics states left open.
    const raw = p.node.get(N('Contents'));
    const looked = raw ? ctx.lookup(raw) : undefined;
    const parts = looked instanceof PDFArray ? looked.asArray() : raw ? [raw] : [];
    const streams = parts.filter((r) => (r instanceof PDFRef ? ctx.lookup(r) : r) instanceof PDFStream);
    if (streams.length !== parts.length) { st.contentsDropped += parts.length - streams.length; p.node.set(N('Contents'), ctx.obj(streams)); }
    let depth = 0;
    for (const r of streams) {
      const s = (r instanceof PDFRef ? ctx.lookup(r) : r) as PDFStream;
      for (const op of parseContent(latin1(streamBytes(s)))) { if (op.op === 'q') depth++; else if (op.op === 'Q' && depth > 0) depth--; }
    }
    if (depth > 0) {
      st.statesClosed += depth;
      const close = ctx.register(ctx.stream('\n' + 'Q\n'.repeat(depth)));
      p.node.set(N('Contents'), ctx.obj([...streams, close]));
    }
  }
  return st;
}
