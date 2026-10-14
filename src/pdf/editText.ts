// Edit Text and Erase Content (Tools > Content). Edit Text replaces a run of
// the PDF's own text: the old glyphs are removed from the content stream
// (as redaction does, without a box) and the new text is drawn in the same
// place, size, spacing and colour. It keeps the run's own font when every
// new character already appears in the run (so even subset fonts work);
// otherwise it uses a standard font of the same family. Erase Content
// removes everything under a rectangle.
import { PDFArray, PDFDict, PDFName, StandardFonts, type PDFDocument } from 'pdf-lib';
import { redactPage, type Rect, type TextProbe } from './redactContent';

const N = PDFName.of;
const f = (v: number) => String(Math.round(v * 10000) / 10000);

/** Standard font closest to a pdf.js font family / name. */
export function standardFontFor(family: string): StandardFonts {
  const s = family.toLowerCase();
  const bold = /bold|black|heavy|semibold/.test(s), italic = /italic|oblique/.test(s);
  if (/mono|courier|consol/.test(s)) return bold ? (italic ? StandardFonts.CourierBoldOblique : StandardFonts.CourierBold) : italic ? StandardFonts.CourierOblique : StandardFonts.Courier;
  if (/serif|times|roman|georgia|garamond|cambria|book/.test(s) && !/sans/.test(s)) return bold ? (italic ? StandardFonts.TimesRomanBoldItalic : StandardFonts.TimesRomanBold) : italic ? StandardFonts.TimesRomanItalic : StandardFonts.TimesRoman;
  return bold ? (italic ? StandardFonts.HelveticaBoldOblique : StandardFonts.HelveticaBold) : italic ? StandardFonts.HelveticaOblique : StandardFonts.Helvetica;
}

/** Glyph codes for `text` from what the old run used, or null when a character is missing. */
export function reuseCodes(oldText: string, codes: number[], text: string): number[] | null {
  const chars = [...oldText];
  let map: Map<string, number> | null = null;
  if (chars.length === codes.length) map = new Map(chars.map((c, i) => [c, codes[i]]));
  else {
    // pdf.js may add spaces where the PDF only moves the pen: match without them.
    const bare = chars.filter((c) => c !== ' ');
    if (bare.length === codes.length) map = new Map(bare.map((c, i) => [c, codes[i]]));
  }
  if (!map) return null;
  const out: number[] = [];
  for (const c of text) { const code = map.get(c); if (code === undefined) return null; out.push(code); }
  return out;
}

function appendContent(doc: PDFDocument, pageIdx: number, ops: string) {
  const page = doc.getPage(pageIdx), ctx = doc.context;
  const cur = page.node.get(N('Contents'));
  const list = cur instanceof PDFArray ? cur.asArray() : cur ? [cur] : [];
  page.node.set(N('Contents'), ctx.obj([...list, ctx.register(ctx.stream(ops))]));
}

function addFont(doc: PDFDocument, pageIdx: number, ref: unknown): string {
  const page = doc.getPage(pageIdx);
  page.node.normalize();
  const res = page.node.Resources()!;
  let fonts = res.lookup(N('Font'));
  if (!(fonts instanceof PDFDict)) { fonts = doc.context.obj({}); res.set(N('Font'), fonts); }
  let i = 1;
  while ((fonts as PDFDict).has(N(`CTEdit${i}`))) i++;
  (fonts as PDFDict).set(N(`CTEdit${i}`), ref as never);
  return `CTEdit${i}`;
}

export interface EditResult { reusedFont: boolean; found: boolean }

/**
 * Replace the text run inside `rect` (PDF space) on a page. `oldText` is the
 * run as read (to reuse its glyph codes); `family` names the font family to
 * fall back on.
 */
export async function editText(doc: PDFDocument, pageIdx: number, rect: Rect, oldText: string, text: string, family = 'Helvetica'): Promise<EditResult> {
  let probe: TextProbe | null = null;
  await redactPage(doc, pageIdx, { rects: [rect], onText: (t) => { if (!probe) probe = { ...t, codes: [...t.codes] }; else probe.codes.push(...t.codes); } }, null);
  const p = probe as TextProbe | null;
  if (!p) return { reusedFont: false, found: false };
  if (!text) return { reusedFont: true, found: true };
  const codes = p.inPage && p.fontName ? reuseCodes(oldText, p.codes, text) : null;
  let fontOp: string, show: string;
  if (codes) {
    fontOp = `/${p.fontName} ${f(p.size)} Tf`;
    show = `<${codes.map((c) => c.toString(16).padStart(p.bpc * 2, '0')).join('')}> Tj`;
  } else {
    const font = await doc.embedFont(standardFontFor(family));
    const name = addFont(doc, pageIdx, font.ref);
    const safe = [...text].map((ch) => { try { font.encodeText(ch); return ch; } catch { return '?'; } }).join('');
    fontOp = `/${name} ${f(p.size)} Tf`;
    show = `${font.encodeText(safe).toString()} Tj`;
  }
  const m = (x: number[]) => x.map(f).join(' ');
  appendContent(doc, pageIdx, [
    'q', `${m(p.ctm)} cm`, p.fill, 'BT', fontOp, `${f(p.th * 100)} Tz`, `${f(p.tc)} Tc`, `${f(p.tw)} Tw`, `${m(p.tm)} Tm`, show, 'ET', 'Q',
  ].join('\n'));
  return { reusedFont: !!codes, found: true };
}

/** Remove all content under a rectangle (PDF space). Returns whether anything was removed. */
export async function eraseContent(doc: PDFDocument, pageIdx: number, rect: Rect): Promise<boolean> {
  const st = await redactPage(doc, pageIdx, { rects: [rect] }, null);
  return st.glyphs + st.paths + st.images + st.forms > 0;
}

