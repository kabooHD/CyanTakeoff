// Text formatting of Text Box, Callout, Typewriter and Cloud+ markups
// (Revu: font, size, bold/italic/underline/strikethrough, alignment, line
// spacing, margin, text colour, box shape). The style travels in the
// annotation's /DS (a CSS-like string) and /RC (XHTML), as Revu writes
// them: "font: Helvetica 12pt; text-align:center; line-height:13.8pt;
// color:#FF0000". Our extras (vertical alignment, margin, auto size, box
// shape) go into CTData.
import type { MarkupStyle, Pt } from './types';

export type TextFont = 'Helvetica' | 'Times' | 'Courier';
export type TextAlign = 'left' | 'center' | 'right';
export type TextVAlign = 'top' | 'middle' | 'bottom';
export type BoxShape = 'rectangle' | 'circle' | 'triangle' | 'hexagon';

export const TEXT_FONTS: TextFont[] = ['Helvetica', 'Times', 'Courier'];
export const DEFAULT_LINE_HEIGHT = 1.15;
export const DEFAULT_MARGIN = 3;

/** The text-related part of a style, with defaults filled in. */
export function textStyleOf(st: MarkupStyle) {
  return {
    font: st.font ?? 'Helvetica', bold: !!st.bold, italic: !!st.italic, underline: !!st.underline, strike: !!st.strike,
    align: st.align ?? 'left', valign: st.valign ?? 'top', lineHeight: st.lineHeight ?? DEFAULT_LINE_HEIGHT, margin: st.margin ?? DEFAULT_MARGIN,
    textColor: st.textColor ?? st.color, autoSize: !!st.autoSize, shape: st.shape ?? 'rectangle',
  };
}

/** CSS font-family for a font. */
export const cssFamily = (font: TextFont) => font === 'Times' ? '"Times New Roman", Times, serif' : font === 'Courier' ? '"Courier New", Courier, monospace' : 'Helvetica, Arial, sans-serif';

const round1 = (v: number) => Math.round(v * 10) / 10;

/** The /DS default style string. */
export function toDS(st: MarkupStyle): string {
  const t = textStyleOf(st);
  const parts = [`font: ${t.font} ${round1(st.fontSize)}pt`, `text-align:${t.align}`, `line-height:${round1(st.fontSize * t.lineHeight)}pt`, `color:${t.textColor.toUpperCase()}`];
  if (t.bold) parts.push('font-weight:bold');
  if (t.italic) parts.push('font-style:italic');
  const deco = [t.underline ? 'underline' : '', t.strike ? 'line-through' : ''].filter(Boolean).join(' ');
  if (deco) parts.push(`text-decoration:${deco}`);
  return parts.join('; ');
}

/** Parse a /DS string (ours, Revu's or Acrobat's); missing parts are left undefined. */
export function parseDS(ds: string): Partial<MarkupStyle> {
  const out: Partial<MarkupStyle> = {};
  const get = (k: string) => new RegExp(`(?:^|;)\\s*${k}\\s*:\\s*([^;]+)`, 'i').exec(ds)?.[1].trim();
  const font = get('font') ?? '';
  const fam = (get('font-family') ?? font.replace(/[\d.]+\s*pt.*$/, '')).replace(/['"]/g, '').trim().toLowerCase();
  if (fam) out.font = /courier|mono/.test(fam) ? 'Courier' : /times|serif|georgia/.test(fam) && !/sans/.test(fam) ? 'Times' : 'Helvetica';
  const size = Number((get('font-size') ?? font).match(/([\d.]+)\s*pt/)?.[1]);
  if (size) out.fontSize = size;
  const align = get('text-align');
  if (align === 'left' || align === 'center' || align === 'right') out.align = align;
  const lh = Number(get('line-height')?.match(/([\d.]+)\s*pt/)?.[1]);
  if (lh && (out.fontSize ?? size)) out.lineHeight = Math.round((lh / (out.fontSize ?? size)) * 100) / 100;
  const color = get('color')?.match(/#[0-9a-f]{6}/i)?.[0];
  if (color) out.textColor = color.toLowerCase();
  if (/bold/i.test(get('font-weight') ?? '') || /\bbold\b/i.test(font)) out.bold = true;
  if (/italic|oblique/i.test(get('font-style') ?? '') || /\bitalic\b/i.test(font)) out.italic = true;
  const deco = get('text-decoration') ?? '';
  if (/underline/i.test(deco)) out.underline = true;
  if (/line-through/i.test(deco)) out.strike = true;
  return out;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The /RC rich text: one paragraph per line, the style on the body (as Revu writes it). */
export function toRC(text: string, st: MarkupStyle): string {
  const body = text.split(/\r?\n/).map((l) => `<p>${esc(l)}</p>`).join('');
  return `<?xml version="1.0"?><body xmlns:xfa="http://www.xfa.org/schema/xfa-data/1.0/" xfa:contentType="text/html" xfa:APIVersion="CyanTakeoff:1" xfa:spec="2.2.0" style="${esc(toDS(st))}" xmlns="http://www.w3.org/1999/xhtml">${body}</body>`;
}

/** The plain text of an /RC string: paragraphs and <br/> become lines, tags are dropped. */
export function parseRC(rc: string): string {
  const inner = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(rc)?.[1] ?? rc;
  const lines = inner.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>\s*<p[^>]*>/gi, '\n').replace(/<[^>]+>/g, '');
  return lines.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&').replace(/\n$/, '');
}

/** PDF /Q quadding for an alignment. */
export const quadding = (align: TextAlign) => (align === 'center' ? 1 : align === 'right' ? 2 : 0);
export const alignOfQuadding = (q: number | undefined): TextAlign | undefined => (q === 1 ? 'center' : q === 2 ? 'right' : q === 0 ? 'left' : undefined);

/**
 * Auto font size: the largest size (1..144, in 0.5 steps) at which every
 * line fits the box width and all lines fit its height.
 */
export function fitFontSize(lines: string[], boxW: number, boxH: number, lineHeight: number, margin: number, width: (text: string, size: number) => number): number {
  const w = boxW - 2 * margin, h = boxH - 2 * margin;
  if (w <= 0 || h <= 0 || !lines.length) return 1;
  const fits = (s: number) => lines.length * s * lineHeight <= h + 0.01 && lines.every((l) => width(l, s) <= w + 0.01);
  let lo = 1, hi = 144;
  if (!fits(lo)) return 1;
  while (hi - lo > 0.5) { const mid = Math.floor((lo + hi)) / 2; if (fits(mid)) lo = mid; else hi = mid; }
  return lo;
}

/** The outline of a text box drawn as a shape (page space, y down). */
export function shapeOutline(shape: BoxShape, b: { minX: number; minY: number; maxX: number; maxY: number }): Pt[] | null {
  const cx = (b.minX + b.maxX) / 2;
  if (shape === 'triangle') return [{ x: cx, y: b.minY }, { x: b.maxX, y: b.maxY }, { x: b.minX, y: b.maxY }];
  if (shape === 'hexagon') {
    const d = Math.min((b.maxX - b.minX) / 4, (b.maxY - b.minY) / 2), cy = (b.minY + b.maxY) / 2;
    return [{ x: b.minX + d, y: b.minY }, { x: b.maxX - d, y: b.minY }, { x: b.maxX, y: cy }, { x: b.maxX - d, y: b.maxY }, { x: b.minX + d, y: b.maxY }, { x: b.minX, y: cy }];
  }
  return null; // rectangle and circle are drawn as such
}
