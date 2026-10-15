// Color Processing (Revu Document > Color Processing): recolour the vector
// content of pages (and, optionally, their JPEG images). Grayscale, Black
// and White, Colorize (one colour, or a dark-to-light scale), Luminosity /
// Saturation / Hue, and Modify Colors (replace colours within a tolerance).
// Colour operators in the content streams (g, rg, k, sc/scn and their
// stroking forms) are rewritten as RGB; forms are processed in place.
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef, PDFStream } from 'pdf-lib';
import { bytesOfLatin1, latin1, mkOp, num, parseContent, writeContent, type Op } from './content';
import { streamBytes } from './redactContent';

const N = PDFName.of;
export type RGB = [number, number, number]; // 0..1
export type ColorMode = 'grayscale' | 'bw' | 'colorize' | 'lsh' | 'modify';
export interface ColorOptions {
  mode: ColorMode;
  processImages: boolean;
  /** Colorize: the colour of the darkest tones (and, with `scale`, `to` for the lightest). */
  from?: RGB; to?: RGB; scale?: boolean;
  /** Luminosity / saturation / hue changes: -1..1 for l and s, degrees for h. */
  l?: number; s?: number; h?: number;
  /** Modify Colors: replacements, tolerance 0..1 of the colour distance. */
  pairs?: { from: RGB; to: RGB; tolerance: number }[];
}

export const luma = (c: RGB) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
const clamp = (v: number) => Math.max(0, Math.min(1, v));
export const cmykToRgb = (c: number, m: number, y: number, k: number): RGB => [(1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k)];
export const hexToRgb01 = (hex: string): RGB => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as RGB;

function rgbToHsl([r, g, b]: RGB): [number, number, number] {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
function hslToRgb([h, s, l]: [number, number, number]): RGB {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t: number) => { t = ((t % 360) + 360) % 360 / 360; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; };
  return [f(h + 120), f(h), f(h - 120)];
}

/** The colour a drawn colour becomes. */
export function transformRgb(c: RGB, o: ColorOptions): RGB {
  const y = luma(c);
  switch (o.mode) {
    case 'grayscale': return [y, y, y];
    case 'bw': return y >= 0.95 ? [1, 1, 1] : [0, 0, 0];
    case 'colorize': {
      const from = o.from ?? [0, 0, 0], to = o.to ?? [1, 1, 1];
      if (!o.scale) return y >= 0.95 ? [1, 1, 1] : from;
      return [0, 1, 2].map((i) => clamp(from[i] + (to[i] - from[i]) * y)) as RGB;
    }
    case 'lsh': {
      const [h, s, l] = rgbToHsl(c);
      return hslToRgb([h + (o.h ?? 0), clamp(s * (1 + (o.s ?? 0))), clamp(l * (1 + (o.l ?? 0)))]).map(clamp) as RGB;
    }
    case 'modify': {
      for (const p of o.pairs ?? []) {
        const d = Math.hypot(c[0] - p.from[0], c[1] - p.from[1], c[2] - p.from[2]) / Math.sqrt(3);
        if (d <= p.tolerance + 1e-9) return p.to;
      }
      return c;
    }
  }
}

const nums = (op: Op) => (op.args.every((a) => a.t === 'num') ? op.args.map((a) => (a as { v: number }).v) : null);
const DEVICE: Record<string, number> = { DeviceGray: 1, G: 1, DeviceRGB: 3, RGB: 3, DeviceCMYK: 4, CMYK: 4 };

/** Rewrite the colour operators of a content stream; returns the ops and how many changed. */
export function processContent(ops: Op[], o: ColorOptions): { ops: Op[]; changed: number } {
  let changed = 0;
  let fillCs: number | null = 3, strokeCs: number | null = 3; // components of the current colour space, null = unknown
  const emit = (rgb: RGB, stroke: boolean) => { changed++; const c = transformRgb(rgb, o); return mkOp(stroke ? 'RG' : 'rg', num(+c[0].toFixed(4)), num(+c[1].toFixed(4)), num(+c[2].toFixed(4))); };
  const out = ops.map((op) => {
    const v = nums(op);
    switch (op.op) {
      case 'cs': case 'CS': {
        const n = op.args[0]?.t === 'name' ? DEVICE[op.args[0].v] ?? null : null;
        if (op.op === 'cs') fillCs = n; else strokeCs = n;
        return op;
      }
      case 'g': case 'G': return v?.length === 1 ? emit([v[0], v[0], v[0]], op.op === 'G') : op;
      case 'rg': case 'RG': return v?.length === 3 ? emit([v[0], v[1], v[2]], op.op === 'RG') : op;
      case 'k': case 'K': return v?.length === 4 ? emit(cmykToRgb(v[0], v[1], v[2], v[3]), op.op === 'K') : op;
      case 'sc': case 'scn': case 'SC': case 'SCN': {
        const stroke = op.op === 'SC' || op.op === 'SCN', cs = stroke ? strokeCs : fillCs;
        if (!v || cs === null || v.length !== cs) return op;
        return cs === 1 ? emit([v[0], v[0], v[0]], stroke) : cs === 3 ? emit([v[0], v[1], v[2]], stroke) : emit(cmykToRgb(v[0], v[1], v[2], v[3]), stroke);
      }
      default: return op;
    }
  });
  return { ops: out, changed };
}

/** Replace a stream's bytes, keeping its dictionary (minus the old filter). */
function rewriteStream(doc: PDFDocument, ref: PDFRef, old: PDFStream, bytes: Uint8Array) {
  const s = doc.context.flateStream(bytes);
  for (const [k, v] of old.dict.entries()) if (!['Length', 'Filter', 'DecodeParms'].includes(k.decodeText())) s.dict.set(k, v);
  doc.context.assign(ref, s);
}

/** Recolour the vector content of `pages` (forms reached from them too). Returns the number of colour operators changed. */
export function processPagesVector(doc: PDFDocument, pages: number[], o: ColorOptions): number {
  const ctx = doc.context;
  let changed = 0;
  const doneForms = new Set<string>();
  const forms = (res: PDFDict | undefined, depth: number) => {
    const xo = res?.lookup(N('XObject'));
    if (!(xo instanceof PDFDict) || depth > 8) return;
    for (const [, r] of xo.entries()) {
      if (!(r instanceof PDFRef) || doneForms.has(r.tag)) continue;
      const x = ctx.lookup(r);
      if (!(x instanceof PDFStream) || String(x.dict.get(N('Subtype'))) !== '/Form') continue;
      doneForms.add(r.tag);
      const rr = processContent(parseContent(latin1(streamBytes(x))), o);
      if (rr.changed) { changed += rr.changed; rewriteStream(doc, r, x, bytesOfLatin1(writeContent(rr.ops))); }
      const fr = x.dict.lookup(N('Resources'));
      forms(fr instanceof PDFDict ? fr : undefined, depth + 1);
    }
  };
  for (const i of pages) {
    const p = doc.getPage(i);
    const raw = p.node.get(N('Contents'));
    const looked = raw ? ctx.lookup(raw) : undefined;
    const parts = looked instanceof PDFArray ? looked.asArray().map((r) => ctx.lookup(r)) : [looked];
    const content = parts.filter((s): s is PDFStream => s instanceof PDFStream).map((s) => latin1(streamBytes(s))).join('\n');
    const rr = processContent(parseContent(content), o);
    if (rr.changed) {
      changed += rr.changed;
      p.node.set(N('Contents'), ctx.register(ctx.flateStream(bytesOfLatin1(writeContent(rr.ops)))));
    }
    forms(p.node.Resources(), 0);
  }
  return changed;
}

/** JPEG images used by `pages` (through their resources), for Process Images. */
export function pageJpegs(doc: PDFDocument, pages: number[]): { ref: PDFRef; stream: PDFRawStream }[] {
  const ctx = doc.context;
  const out: { ref: PDFRef; stream: PDFRawStream }[] = [];
  const seen = new Set<string>();
  const walk = (res: PDFDict | undefined, depth: number) => {
    const xo = res?.lookup(N('XObject'));
    if (!(xo instanceof PDFDict) || depth > 8) return;
    for (const [, r] of xo.entries()) {
      if (!(r instanceof PDFRef) || seen.has(r.tag)) continue;
      seen.add(r.tag);
      const x = ctx.lookup(r);
      if (!(x instanceof PDFStream)) continue;
      const sub = String(x.dict.get(N('Subtype')));
      if (sub === '/Image' && x instanceof PDFRawStream && String(x.dict.get(N('Filter'))) === '/DCTDecode' && String(x.dict.get(N('ColorSpace'))) !== '/DeviceCMYK') out.push({ ref: r, stream: x });
      else if (sub === '/Form') { const fr = x.dict.lookup(N('Resources')); walk(fr instanceof PDFDict ? fr : undefined, depth + 1); }
    }
  };
  for (const i of pages) walk(doc.getPage(i).node.Resources(), 0);
  return out;
}

/** Apply the colour transform to RGBA pixels in place. */
export function transformPixels(px: Uint8ClampedArray, o: ColorOptions) {
  const cache = new Map<number, RGB>();
  for (let i = 0; i < px.length; i += 4) {
    const key = (px[i] << 16) | (px[i + 1] << 8) | px[i + 2];
    let c = cache.get(key);
    if (!c) { c = transformRgb([px[i] / 255, px[i + 1] / 255, px[i + 2] / 255], o); cache.set(key, c); }
    px[i] = Math.round(c[0] * 255); px[i + 1] = Math.round(c[1] * 255); px[i + 2] = Math.round(c[2] * 255);
  }
}
