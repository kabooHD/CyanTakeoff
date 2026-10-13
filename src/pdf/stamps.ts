// Header & Footer, Bates numbering and Watermark (Document menu). They are
// written into the page content as real text so every viewer and printer
// shows them, inside marked content tagged as pagination artifacts
// (/Artifact <</Type /Pagination /Subtype /Header|/Watermark>>, the way
// PDF editors mark them) plus our /CTKind, so Remove can take them out
// again without touching the drawing.
import { PDFArray, PDFDict, PDFName, PDFRef, PDFStream, StandardFonts, type PDFDocument, type PDFFont, type PDFPage } from 'pdf-lib';
import { latin1, parseContent, writeContent } from './content';
import { streamBytes } from './redactContent';

export type Slot = 'hl' | 'hc' | 'hr' | 'fl' | 'fc' | 'fr';
export const FONTS = { Helvetica: StandardFonts.Helvetica, 'Times Roman': StandardFonts.TimesRoman, Courier: StandardFonts.Courier } as const;
export type FontName = keyof typeof FONTS;

export interface Bates { prefix: string; suffix: string; start: number; digits: number }
export interface HeaderFooterOptions {
  texts: Partial<Record<Slot, string>>;
  font: FontName; size: number; color: [number, number, number];
  /** Margins in points: distance from the page edges to the text. */
  margins: { top: number; bottom: number; left: number; right: number };
  pages: number[];
  bates: Bates;
  fileName: string;
  date: Date;
}
export interface WatermarkOptions {
  text: string; font: FontName; size: number; color: [number, number, number];
  opacity: number; angle: number; behind: boolean; pages: number[];
}

export const TOKENS = ['<<Page>>', '<<Pages>>', '<<Page Label>>', '<<Date>>', '<<Time>>', '<<File Name>>', '<<Bates>>'] as const;

export const batesText = (b: Bates, n: number) => `${b.prefix}${String(n).padStart(Math.max(1, b.digits), '0')}${b.suffix}`;

/** Replace the tokens for one page (0-based index, position in the range for Bates). */
export function expandTokens(t: string, c: { page: number; pages: number; label: string; date: Date; file: string; bates: string }): string {
  return t
    .replace(/<<Page>>/g, String(c.page + 1)).replace(/<<Pages>>/g, String(c.pages))
    .replace(/<<Page Label>>/g, c.label).replace(/<<Date>>/g, c.date.toLocaleDateString())
    .replace(/<<Time>>/g, c.date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))
    .replace(/<<File Name>>/g, c.file).replace(/<<Bates>>/g, c.bates);
}

/**
 * A point in page space (as displayed: y down, page rotation applied) to PDF
 * user space, for a page box (x, y, w, h) shown rotated `rot` degrees clockwise.
 */
export function pageToPdf(u: number, v: number, box: { x: number; y: number; w: number; h: number }, rot: number): [number, number] {
  switch (((rot % 360) + 360) % 360) {
    case 90: return [box.x + v, box.y + u];
    case 180: return [box.x + box.w - u, box.y + v];
    case 270: return [box.x + box.w - v, box.y + box.h - u];
    default: return [box.x + u, box.y + box.h - v];
  }
}

const f = (n: number) => String(Math.round(n * 1000) / 1000);

function pageGeometry(page: PDFPage) {
  const b = page.getCropBox();
  const rot = page.getRotation().angle;
  const turned = ((rot % 180) + 180) % 180 === 90;
  return { box: { x: b.x, y: b.y, w: b.width, h: b.height }, rot, W: turned ? b.height : b.width, H: turned ? b.width : b.height };
}

/** Text encoded for a standard font; characters it lacks become '?'. */
function encode(font: PDFFont, s: string): { hex: string; text: string } {
  const text = [...s].map((ch) => { try { font.encodeText(ch); return ch; } catch { return '?'; } }).join('');
  return { hex: font.encodeText(text).toString(), text };
}

/** Add a resource (font or graphics state) to a page under a fresh name. */
function addResource(doc: PDFDocument, page: PDFPage, kind: 'Font' | 'ExtGState', value: PDFRef | PDFDict, prefix: string): string {
  page.node.normalize();
  const res = page.node.Resources()!;
  let dict = res.lookup(PDFName.of(kind));
  if (!(dict instanceof PDFDict)) { dict = doc.context.obj({}); res.set(PDFName.of(kind), dict); }
  const d = dict as PDFDict;
  let i = 1;
  while (d.has(PDFName.of(`${prefix}${i}`))) i++;
  d.set(PDFName.of(`${prefix}${i}`), value);
  return `${prefix}${i}`;
}

/** Put a content stream before or after the page's own content (which is wrapped in q/Q when ours comes after). */
function addContent(doc: PDFDocument, page: PDFPage, ops: string, before: boolean) {
  const ctx = doc.context;
  const mine = ctx.register(ctx.stream(ops));
  const cur = page.node.get(PDFName.of('Contents'));
  const list = cur instanceof PDFArray ? cur.asArray() : cur ? [cur] : [];
  if (before) { page.node.set(PDFName.of('Contents'), ctx.obj([mine, ...list])); return; }
  const q = ctx.register(ctx.stream('q')), Q = ctx.register(ctx.stream('Q'));
  page.node.set(PDFName.of('Contents'), ctx.obj(list.length ? [q, ...list, Q, mine] : [mine]));
}

const artifact = (kind: 'Header' | 'Watermark') =>
  `/Artifact <</Type /Pagination /Subtype /${kind === 'Header' ? 'Header' : 'Watermark'} /CTKind /${kind}>> BDC`;

export async function addHeaderFooter(doc: PDFDocument, o: HeaderFooterOptions, labels: string[]) {
  const font = await doc.embedFont(FONTS[o.font]);
  const pages = doc.getPages();
  const rgb = o.color.map(f).join(' ');
  o.pages.forEach((pi, k) => {
    const page = pages[pi];
    if (!page) return;
    const { box, rot, W, H } = pageGeometry(page);
    const fname = addResource(doc, page, 'Font', font.ref, 'CTHF');
    const ctx = { page: pi, pages: pages.length, label: labels[pi] ?? String(pi + 1), date: o.date, file: o.fileName, bates: batesText(o.bates, o.bates.start + k) };
    const out: string[] = [artifact('Header'), 'q', `${rgb} rg`];
    for (const slot of ['hl', 'hc', 'hr', 'fl', 'fc', 'fr'] as Slot[]) {
      const raw = o.texts[slot];
      if (!raw?.trim()) continue;
      o.texts[slot]!.split('\n').forEach((line, li, all) => {
        const { hex, text } = encode(font, expandTokens(line, ctx));
        const w = font.widthOfTextAtSize(text, o.size);
        const u = slot[1] === 'l' ? o.margins.left : slot[1] === 'c' ? (W - w) / 2 : W - o.margins.right - w;
        // Baselines: header lines down from the top margin, footer lines up from the bottom one.
        const v = slot[0] === 'h' ? o.margins.top + o.size * (0.8 + li * 1.2) : H - o.margins.bottom - o.size * (0.2 + (all.length - 1 - li) * 1.2);
        const [x, y] = pageToPdf(u, v, box, rot);
        const a = (rot * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
        out.push(`BT /${fname} ${f(o.size)} Tf ${f(c)} ${f(s)} ${f(-s)} ${f(c)} ${f(x)} ${f(y)} Tm ${hex} Tj ET`);
      });
    }
    out.push('Q', 'EMC');
    addContent(doc, page, out.join('\n'), false);
  });
}

export async function addWatermark(doc: PDFDocument, o: WatermarkOptions) {
  const font = await doc.embedFont(FONTS[o.font]);
  const pages = doc.getPages();
  const rgb = o.color.map(f).join(' ');
  for (const pi of o.pages) {
    const page = pages[pi];
    if (!page) continue;
    const { box, rot, W, H } = pageGeometry(page);
    const fname = addResource(doc, page, 'Font', font.ref, 'CTWM');
    const gs = addResource(doc, page, 'ExtGState', doc.context.obj({ ca: o.opacity, CA: o.opacity }), 'CTGS');
    const lines = o.text.split('\n');
    const out: string[] = [artifact('Watermark'), 'q', `/${gs} gs ${rgb} rg`];
    // Centre of the page; the text turns `angle` degrees counterclockwise as seen.
    const a = (o.angle * Math.PI) / 180;
    const dir = { x: Math.cos(a), y: -Math.sin(a) }, down = { x: Math.sin(a), y: Math.cos(a) };
    lines.forEach((line, li) => {
      const { hex, text } = encode(font, line);
      const w = font.widthOfTextAtSize(text, o.size);
      const off = (li - (lines.length - 1) / 2) * o.size * 1.2 + o.size * 0.35;
      const u = W / 2 - dir.x * (w / 2) + down.x * off, v = H / 2 - dir.y * (w / 2) + down.y * off;
      const [x, y] = pageToPdf(u, v, box, rot);
      const t = ((rot + o.angle) * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
      out.push(`BT /${fname} ${f(o.size)} Tf ${f(c)} ${f(s)} ${f(-s)} ${f(c)} ${f(x)} ${f(y)} Tm ${hex} Tj ET`);
    });
    out.push('Q', 'EMC');
    addContent(doc, page, out.join('\n'), o.behind);
  }
}

/** Remove headers/footers (and Bates) or watermarks we added; returns how many were removed. */
export function removeArtifacts(doc: PDFDocument, kind: 'Header' | 'Watermark', pages?: number[]): number {
  let n = 0;
  doc.getPages().forEach((page, pi) => {
    if (pages && !pages.includes(pi)) return;
    const cur = page.node.get(PDFName.of('Contents'));
    const refs = cur instanceof PDFArray ? cur.asArray() : cur ? [cur] : [];
    for (const r of refs) {
      const st = doc.context.lookup(r);
      if (!(st instanceof PDFStream)) continue;
      const src = latin1(streamBytes(st));
      if (!src.includes(`/CTKind /${kind}`)) continue;
      const ops = parseContent(src);
      const keep: typeof ops = [];
      for (let i = 0; i < ops.length; i++) {
        const op = ops[i];
        if (op.op === 'BDC' && op.args[1]?.raw.includes(`/CTKind /${kind}`)) {
          let depth = 1;
          while (depth && ++i < ops.length) { if (ops[i].op === 'BDC' || ops[i].op === 'BMC') depth++; else if (ops[i].op === 'EMC') depth--; }
          n++;
          continue;
        }
        keep.push(op);
      }
      if (r instanceof PDFRef) doc.context.assign(r, doc.context.stream(writeContent(keep)));
    }
  });
  return n;
}

/** Pages that carry a header/footer or watermark of ours. */
export function hasArtifacts(doc: PDFDocument, kind: 'Header' | 'Watermark'): boolean {
  return doc.getPages().some((page) => {
    const cur = page.node.get(PDFName.of('Contents'));
    const refs = cur instanceof PDFArray ? cur.asArray() : cur ? [cur] : [];
    return refs.some((r) => { const st = doc.context.lookup(r); return st instanceof PDFStream && latin1(streamBytes(st)).includes(`/CTKind /${kind}`); });
  });
}
