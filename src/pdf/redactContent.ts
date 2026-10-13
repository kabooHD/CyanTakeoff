// True redaction (Revu: Apply Redactions): remove what lies under the
// redaction rectangles from the page content itself, keeping everything
// else as vectors and text.
//  - text: glyphs touching a rectangle are removed; the text around them
//    keeps its position (TJ spacing replaces the removed glyphs);
//  - lines are cut where they cross a rectangle, fills have the rectangle
//    subtracted;
//  - images touching a rectangle are passed to `redactImage` (which blacks
//    out the pixels) or removed; inline images and shadings are removed;
//  - form XObjects are redacted recursively (as new copies);
//  - /ActualText and /Alt in marked content of a redacted stream are dropped.
// Rectangles are in default user space of the page (PDF points).
import { PDFArray, PDFDict, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFStream, decodePDFRawStream, type PDFContext, type PDFDocument } from 'pdf-lib';
import { Encodings, Font, type IFontNames } from '@pdf-lib/standard-fonts';
import polygonClipping, { type MultiPolygon, type Polygon } from 'polygon-clipping';
import { arr, bytesOfLatin1, hexStr, latin1, mkOp, name as nameOp, num, parseContent, writeContent, type Op, type Operand } from './content';

export type Rect = [number, number, number, number];
export type M = [number, number, number, number, number, number];
type P = [number, number];

const N = (s: string) => PDFName.of(s);
const ID: M = [1, 0, 0, 1, 0, 0];
export const mul = (m: M, n: M): M => [
  m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5],
];
export const apply = (m: M, x: number, y: number): P => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
export function invert(m: M): M {
  const d = m[0] * m[3] - m[1] * m[2] || 1e-12;
  return [m[3] / d, -m[1] / d, -m[2] / d, m[0] / d, (m[2] * m[5] - m[3] * m[4]) / d, (m[1] * m[4] - m[0] * m[5]) / d];
}
const bboxOf = (pts: P[]): Rect => [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
const overlaps = (a: Rect, b: Rect) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
const hits = (b: Rect, rects: Rect[]) => rects.some((r) => overlaps(b, r));

/** Parts of segment p→q outside every rectangle (Liang–Barsky per rectangle, intervals merged). */
export function segmentOutside(p: P, q: P, rects: Rect[]): [P, P][] {
  const dx = q[0] - p[0], dy = q[1] - p[1];
  const inside: [number, number][] = [];
  for (const r of rects) {
    let t0 = 0, t1 = 1, ok = true;
    for (const [pp, qq] of [[-dx, p[0] - r[0]], [dx, r[2] - p[0]], [-dy, p[1] - r[1]], [dy, r[3] - p[1]]]) {
      if (pp === 0) { if (qq < 0) { ok = false; break; } continue; }
      const t = qq / pp;
      if (pp < 0) { if (t > t1) { ok = false; break; } if (t > t0) t0 = t; }
      else { if (t < t0) { ok = false; break; } if (t < t1) t1 = t; }
    }
    if (ok && t1 > t0) inside.push([t0, t1]);
  }
  if (!inside.length) return [[p, q]];
  inside.sort((a, b) => a[0] - b[0]);
  const out: [P, P][] = [];
  let t = 0;
  const at = (s: number): P => [p[0] + dx * s, p[1] + dy * s];
  for (const [a, b] of inside) {
    if (a > t + 1e-9) out.push([at(t), at(a)]);
    t = Math.max(t, b);
  }
  if (t < 1 - 1e-9) out.push([at(t), q]);
  return out;
}

// ---------------- fonts: glyph widths ----------------

interface FontInfo {
  /** Bytes per character code (2 for Identity-H/V Type0 fonts). */
  bpc: 1 | 2;
  /** Advance width of a code, in text space units (1 = font size). */
  width: (code: number) => number;
  /** False when widths are guessed: removal is then conservative. */
  known: boolean;
}

const STD = new Set(['Courier', 'Courier-Bold', 'Courier-Oblique', 'Courier-BoldOblique', 'Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique',
  'Helvetica-BoldOblique', 'Times-Roman', 'Times-Bold', 'Times-Italic', 'Times-BoldItalic', 'Symbol', 'ZapfDingbats']);
const STD_ALIAS: Record<string, string> = { Arial: 'Helvetica', 'Arial,Bold': 'Helvetica-Bold', 'Arial-BoldMT': 'Helvetica-Bold', ArialMT: 'Helvetica', TimesNewRoman: 'Times-Roman', 'TimesNewRomanPSMT': 'Times-Roman', CourierNew: 'Courier' };
let winAnsiNames: Map<number, string> | null = null;
function winAnsi(code: number) {
  if (!winAnsiNames) {
    winAnsiNames = new Map();
    const enc = Encodings.WinAnsi;
    for (const cp of enc.supportedCodePoints) { const e = enc.encodeUnicodeCodePoint(cp); winAnsiNames.set(e.code, e.name); }
  }
  return winAnsiNames.get(code);
}

const numArr = (ctx: PDFContext, o: unknown): number[] => {
  const a = o instanceof PDFRef ? ctx.lookup(o) : o;
  return a instanceof PDFArray ? a.asArray().map((x) => { const v = x instanceof PDFRef ? ctx.lookup(x) : x; return v instanceof PDFNumber ? v.asNumber() : 0; }) : [];
};

function fontInfo(ctx: PDFContext, font: PDFDict | undefined): FontInfo {
  const guess: FontInfo = { bpc: 1, width: () => 1, known: false };
  if (!font) return guess;
  const sub = String(font.get(N('Subtype')) ?? '');
  if (sub === '/Type0') {
    const enc = String(font.get(N('Encoding')) ?? '');
    const desc = font.lookup(N('DescendantFonts'));
    const cid = desc instanceof PDFArray ? ctx.lookup(desc.get(0)) : undefined;
    if (!/Identity-[HV]/.test(enc) || !(cid instanceof PDFDict)) return { ...guess, bpc: 2 };
    const dw = (cid.lookup(N('DW')) as PDFNumber | undefined)?.asNumber() ?? 1000;
    const widths = new Map<number, number>();
    const w = cid.lookup(N('W'));
    if (w instanceof PDFArray) {
      const a = w.asArray().map((x) => (x instanceof PDFRef ? ctx.lookup(x) : x));
      for (let i = 0; i < a.length;) {
        const first = (a[i] as PDFNumber).asNumber();
        const next = a[i + 1];
        if (next instanceof PDFArray) {
          numArr(ctx, next).forEach((v, k) => widths.set(first + k, v));
          i += 2;
        } else {
          const last = (next as PDFNumber).asNumber(), v = (a[i + 2] as PDFNumber).asNumber();
          for (let c = first; c <= last && c - first < 65536; c++) widths.set(c, v);
          i += 3;
        }
      }
    }
    return { bpc: 2, width: (c) => (widths.get(c) ?? dw) / 1000, known: true };
  }
  const first = (font.lookup(N('FirstChar')) as PDFNumber | undefined)?.asNumber() ?? 0;
  const widths = numArr(ctx, font.get(N('Widths')));
  const scale = sub === '/Type3' ? (numArr(ctx, font.get(N('FontMatrix')))[0] ?? 0.001) : 0.001;
  const desc = font.lookup(N('FontDescriptor'));
  const missing = desc instanceof PDFDict ? (desc.lookup(N('MissingWidth')) as PDFNumber | undefined)?.asNumber() ?? 0 : 0;
  if (widths.length) return { bpc: 1, width: (c) => (widths[c - first] ?? missing) * scale, known: true };
  // Standard 14 fonts may omit /Widths: use their AFM metrics.
  const base = String(font.get(N('BaseFont')) ?? '').slice(1).replace(/^[A-Z]{6}\+/, '');
  const std = STD.has(base) ? base : STD_ALIAS[base];
  if (std) {
    const f = Font.load(std as IFontNames);
    return { bpc: 1, width: (c) => { const n = std === 'Symbol' || std === 'ZapfDingbats' ? undefined : winAnsi(c); const w = n ? f.getWidthOfGlyph(n) : undefined; return (w ?? 600) / 1000; }, known: true };
  }
  return guess;
}

// ---------------- the redactor ----------------

export interface RedactOptions {
  rects: Rect[];
  /**
   * Black out an image XObject under the rectangles; `ctm` maps the image's
   * unit square to page space. Return the replacement image, or null to
   * remove the image.
   */
  redactImage?: (ref: PDFRef, ctm: M) => Promise<PDFRef | null>;
}

export interface RedactStats { glyphs: number; paths: number; images: number; forms: number }

interface GState { ctm: M; font?: FontInfo; size: number; tc: number; tw: number; th: number; tl: number; ts: number; clip: Rect | null }

const PAINT = new Set(['S', 's', 'f', 'F', 'f*', 'B', 'B*', 'b', 'b*', 'n']);

type Sub = { start: P; pts: { k: 'l' | 'c'; p: P; c1?: P; c2?: P }[]; closed: boolean };

/** Flatten a subpath into device-space points (curves as 12 chords). */
function flatten(sub: Sub, ctm: M): P[] {
  const out: P[] = [apply(ctm, ...sub.start)];
  let cur = sub.start;
  for (const s of sub.pts) {
    if (s.k === 'l') out.push(apply(ctm, ...s.p));
    else {
      for (let k = 1; k <= 12; k++) {
        const t = k / 12, u = 1 - t;
        const x = u * u * u * cur[0] + 3 * u * u * t * s.c1![0] + 3 * u * t * t * s.c2![0] + t * t * t * s.p[0];
        const y = u * u * u * cur[1] + 3 * u * u * t * s.c1![1] + 3 * u * t * t * s.c2![1] + t * t * t * s.p[1];
        out.push(apply(ctm, x, y));
      }
    }
    cur = s.p;
  }
  return out;
}

class Redactor {
  stats: RedactStats = { glyphs: 0, paths: 0, images: 0, forms: 0 };
  private fonts = new Map<PDFDict, FontInfo>();
  constructor(private doc: PDFDocument, private opts: RedactOptions) {}
  private get ctx() { return this.doc.context; }

  private fontFor(res: PDFDict | undefined, name: string): FontInfo | undefined {
    const fonts = res?.lookup(N('Font'));
    const f = fonts instanceof PDFDict ? fonts.lookup(N(name)) : undefined;
    if (!(f instanceof PDFDict)) return undefined;
    if (!this.fonts.has(f)) this.fonts.set(f, fontInfo(this.ctx, f));
    return this.fonts.get(f);
  }

  /** Redact one content stream. Returns the new content and resources (copied when changed), or null if untouched. */
  async stream(content: string, res: PDFDict | undefined, ctm0: M): Promise<{ content: string; res: PDFDict | undefined } | null> {
    const rects = this.opts.rects;
    const ops = parseContent(content);
    const out: Op[] = [];
    let changed = false;
    let newRes: PDFDict | undefined;
    const ownRes = () => {
      if (!newRes) newRes = res ? res.clone(this.ctx) : this.ctx.obj({}) as PDFDict;
      return newRes;
    };
    const addXObject = (ref: PDFRef) => {
      const r = ownRes();
      let xo = r.lookup(N('XObject'));
      xo = xo instanceof PDFDict ? xo.clone(this.ctx) : this.ctx.obj({});
      r.set(N('XObject'), xo as PDFDict);
      let i = 1;
      while ((xo as PDFDict).has(N(`CTRedacted${i}`))) i++;
      (xo as PDFDict).set(N(`CTRedacted${i}`), ref);
      return `CTRedacted${i}`;
    };
    const stack: GState[] = [];
    let g: GState = { ctm: ctm0, size: 0, tc: 0, tw: 0, th: 1, tl: 0, ts: 0, clip: null };
    let tm: M = ID, tlm: M = ID;
    let path: Sub[] = [];
    let pathOps: Op[] = [];
    let clipOp: Op | null = null;
    const pathBox = () => {
      const pts: P[] = [];
      for (const s of path) {
        pts.push(apply(g.ctm, ...s.start));
        for (const p of s.pts) { pts.push(apply(g.ctm, ...p.p)); if (p.c1) pts.push(apply(g.ctm, ...p.c1), apply(g.ctm, ...p.c2!)); }
      }
      return pts.length ? bboxOf(pts) : null;
    };
    const n = (o: Operand | undefined) => (o?.t === 'num' ? o.v : 0);

    // Show text; returns replacement ops when glyphs were removed.
    const show = (items: Operand[], op: Op): Op[] | null => {
      const font = g.font ?? { bpc: 1 as const, width: () => 1, known: false };
      const fs = g.size, th = g.th;
      const trmBase = () => mul([fs * th, 0, 0, fs, 0, g.ts], mul(tm, g.ctm));
      const outItems: Operand[] = [];
      let removed = 0;
      let pendingAdj = 0;
      let run: number[] = [];
      const flushRun = () => {
        if (run.length) {
          const b = new Uint8Array(run.length * font.bpc);
          run.forEach((c, i) => { if (font.bpc === 2) { b[i * 2] = c >> 8; b[i * 2 + 1] = c & 255; } else b[i] = c; });
          outItems.push(hexStr(b)); run = [];
        }
      };
      const flushAdj = () => { if (pendingAdj) { outItems.push(num(pendingAdj)); pendingAdj = 0; } };
      for (const it of items) {
        if (it.t === 'num') {
          tm = mul([1, 0, 0, 1, (-it.v / 1000) * fs * th, 0], tm);
          flushRun(); pendingAdj += it.v;
          continue;
        }
        if (it.t !== 'str') continue;
        const bytes = it.v;
        for (let i = 0; i + font.bpc <= bytes.length; i += font.bpc) {
          const code = font.bpc === 2 ? (bytes[i] << 8) | bytes[i + 1] : bytes[i];
          const w0 = font.width(code);
          const wBox = font.known ? w0 : Math.max(w0, 1);
          const trm = trmBase();
          const box = bboxOf([apply(trm, 0, -0.3), apply(trm, wBox, -0.3), apply(trm, 0, 1.05), apply(trm, wBox, 1.05)]);
          const space = font.bpc === 1 && code === 32 ? g.tw : 0;
          const adv = (w0 * fs + g.tc + space) * th;
          if (hits(box, rects)) {
            removed++;
            flushRun();
            // Keep the following glyphs in place: a TJ adjustment as wide as the removed glyph.
            pendingAdj += fs ? (-adv / (fs * th)) * 1000 : 0;
          } else {
            flushAdj();
            run.push(code);
          }
          tm = mul([1, 0, 0, 1, adv, 0], tm);
        }
      }
      if (!removed) return null;
      flushRun(); flushAdj();
      this.stats.glyphs += removed;
      const res: Op[] = [];
      if (op.op === '"') res.push(mkOp('Tw', op.args[0]), mkOp('Tc', op.args[1]));
      if (op.op === "'" || op.op === '"') res.push(mkOp('T*'));
      res.push(mkOp('TJ', arr(outItems)));
      return res;
    };

    for (const op of ops) {
      const a = op.args;
      switch (op.op) {
        case 'q': stack.push({ ...g }); out.push(op); continue;
        case 'Q': g = stack.pop() ?? g; out.push(op); continue;
        case 'cm': g = { ...g, ctm: mul([n(a[0]), n(a[1]), n(a[2]), n(a[3]), n(a[4]), n(a[5])], g.ctm) }; out.push(op); continue;
        case 'BT': tm = ID; tlm = ID; out.push(op); continue;
        case 'Tf': g = { ...g, font: a[0]?.t === 'name' ? this.fontFor(res, a[0].v) : undefined, size: n(a[1]) }; out.push(op); continue;
        case 'Tc': g = { ...g, tc: n(a[0]) }; out.push(op); continue;
        case 'Tw': g = { ...g, tw: n(a[0]) }; out.push(op); continue;
        case 'Tz': g = { ...g, th: n(a[0]) / 100 }; out.push(op); continue;
        case 'TL': g = { ...g, tl: n(a[0]) }; out.push(op); continue;
        case 'Ts': g = { ...g, ts: n(a[0]) }; out.push(op); continue;
        case 'Td': tlm = mul([1, 0, 0, 1, n(a[0]), n(a[1])], tlm); tm = tlm; out.push(op); continue;
        case 'TD': g = { ...g, tl: -n(a[1]) }; tlm = mul([1, 0, 0, 1, n(a[0]), n(a[1])], tlm); tm = tlm; out.push(op); continue;
        case 'Tm': tlm = [n(a[0]), n(a[1]), n(a[2]), n(a[3]), n(a[4]), n(a[5])]; tm = tlm; out.push(op); continue;
        case 'T*': tlm = mul([1, 0, 0, 1, 0, -g.tl], tlm); tm = tlm; out.push(op); continue;
        case 'Tj': case 'TJ': case "'": case '"': {
          if (op.op === "'" || op.op === '"') {
            if (op.op === '"') g = { ...g, tw: n(a[0]), tc: n(a[1]) };
            tlm = mul([1, 0, 0, 1, 0, -g.tl], tlm); tm = tlm;
          }
          const items = op.op === 'TJ' ? (a[0]?.t === 'arr' ? a[0].v : []) : [a[a.length - 1]].filter(Boolean) as Operand[];
          const rep = show(items, op);
          if (rep) { out.push(...rep); changed = true; } else out.push(op);
          continue;
        }
        // ----- paths -----
        case 'm': path.push({ start: [n(a[0]), n(a[1])], pts: [], closed: false }); pathOps.push(op); continue;
        case 'l': case 'c': case 'v': case 'y': {
          let cur = path[path.length - 1];
          if (!cur) { cur = { start: [0, 0], pts: [], closed: false }; path.push(cur); }
          const last = cur.pts.length ? cur.pts[cur.pts.length - 1].p : cur.start;
          if (op.op === 'l') cur.pts.push({ k: 'l', p: [n(a[0]), n(a[1])] });
          else if (op.op === 'c') cur.pts.push({ k: 'c', c1: [n(a[0]), n(a[1])], c2: [n(a[2]), n(a[3])], p: [n(a[4]), n(a[5])] });
          else if (op.op === 'v') cur.pts.push({ k: 'c', c1: last, c2: [n(a[0]), n(a[1])], p: [n(a[2]), n(a[3])] });
          else cur.pts.push({ k: 'c', c1: [n(a[0]), n(a[1])], c2: [n(a[2]), n(a[3])], p: [n(a[2]), n(a[3])] });
          pathOps.push(op);
          continue;
        }
        case 'h': { const cur = path[path.length - 1]; if (cur) cur.closed = true; pathOps.push(op); continue; }
        case 're': {
          const [x, y, w, h] = [n(a[0]), n(a[1]), n(a[2]), n(a[3])];
          path.push({ start: [x, y], pts: [{ k: 'l', p: [x + w, y] }, { k: 'l', p: [x + w, y + h] }, { k: 'l', p: [x, y + h] }], closed: true });
          pathOps.push(op);
          continue;
        }
        case 'W': case 'W*': clipOp = op; continue;
        default: break;
      }
      if (PAINT.has(op.op)) {
        const box = pathBox();
        if (clipOp && box) g = { ...g, clip: g.clip ? [Math.max(g.clip[0], box[0]), Math.max(g.clip[1], box[1]), Math.min(g.clip[2], box[2]), Math.min(g.clip[3], box[3])] : box };
        const keepAsIs = () => { out.push(...pathOps); if (clipOp) out.push(clipOp); out.push(op); };
        if (!box || op.op === 'n' || !hits(box, rects)) keepAsIs();
        else {
          const inv = invert(g.ctm);
          const user = (p: P) => apply(inv, p[0], p[1]);
          const fill = ['f', 'F', 'f*', 'B', 'B*', 'b', 'b*'].includes(op.op);
          const stroke = ['S', 's', 'B', 'B*', 'b', 'b*'].includes(op.op);
          const closeAll = ['s', 'b', 'b*'].includes(op.op);
          const rectPolys = rects.map((r): Polygon => [[[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]], [r[0], r[1]]]]);
          const area = (mp: MultiPolygon) => mp.reduce((t, poly) => t + poly.reduce((u, ring, k) => {
            let a2 = 0;
            for (let i = 1; i < ring.length; i++) a2 += ring[i - 1][0] * ring[i][1] - ring[i][0] * ring[i - 1][1];
            return u + (k ? -1 : 1) * Math.abs(a2 / 2);
          }, 0), 0);
          let fillOps: Op[] | null = null, fillCut = false;
          if (fill) {
            const polys: Polygon[] = path.map((s) => [flatten(s, g.ctm)]).filter((p) => p[0].length >= 3);
            fillOps = [];
            try {
              const subject: MultiPolygon = polys.length ? (op.op.endsWith('*') ? polygonClipping.xor(polys[0], ...polys.slice(1)) : polygonClipping.union(polys[0], ...polys.slice(1))) : [];
              fillCut = area(polygonClipping.intersection(subject, polygonClipping.union(rectPolys[0], ...rectPolys.slice(1)))) > 1e-6;
              if (fillCut) {
                for (const poly of polygonClipping.difference(subject, ...rectPolys)) for (const ring of poly) {
                  ring.forEach((p, i) => { const [x, y] = user(p as P); fillOps!.push(mkOp(i ? 'l' : 'm', num(x), num(y))); });
                  fillOps.push(mkOp('h'));
                }
                if (fillOps.length) fillOps.push(mkOp('f*'));
              }
            } catch { fillCut = true; fillOps = []; /* degenerate geometry: drop the fill */ }
          }
          let strokeOps: Op[] | null = null, strokeCut = false;
          if (stroke) {
            strokeOps = [];
            for (const s of path) {
              const pts = flatten(s, g.ctm);
              if (s.closed || closeAll) pts.push(pts[0]);
              for (let i = 1; i < pts.length; i++) {
                const kept = segmentOutside(pts[i - 1], pts[i], rects);
                if (kept.length !== 1 || kept[0][0] !== pts[i - 1] || kept[0][1] !== pts[i]) strokeCut = true;
                for (const [p, q] of kept) {
                  const [x0, y0] = user(p), [x1, y1] = user(q);
                  strokeOps.push(mkOp('m', num(x0), num(y0)), mkOp('l', num(x1), num(y1)));
                }
              }
            }
            if (strokeOps.length) strokeOps.push(mkOp('S'));
          }
          if (!fillCut && !strokeCut) keepAsIs();
          else {
            changed = true;
            this.stats.paths++;
            // A clipping path keeps its original shape.
            if (clipOp) out.push(...pathOps, clipOp, mkOp('n'));
            // Unchanged parts are painted from the original path.
            if (fill) out.push(...(fillCut ? fillOps! : [...pathOps, mkOp(op.op.endsWith('*') ? 'f*' : 'f')]));
            if (stroke) out.push(...(strokeCut ? strokeOps! : [...pathOps, mkOp(closeAll ? 's' : 'S')]));
          }
        }
        path = []; pathOps = []; clipOp = null;
        continue;
      }
      // ----- images, forms, shadings, marked content -----
      if (op.op === 'Do' && a[0]?.t === 'name') {
        const xobjs = res?.lookup(N('XObject'));
        const ref = xobjs instanceof PDFDict ? xobjs.get(N(a[0].v)) : undefined;
        const xo = ref instanceof PDFRef ? this.ctx.lookup(ref) : ref;
        if (!(xo instanceof PDFStream)) { out.push(op); continue; }
        const sub = String(xo.dict.get(N('Subtype')) ?? '');
        if (sub === '/Image') {
          const box = bboxOf([apply(g.ctm, 0, 0), apply(g.ctm, 1, 0), apply(g.ctm, 0, 1), apply(g.ctm, 1, 1)]);
          if (!hits(box, rects)) { out.push(op); continue; }
          changed = true;
          this.stats.images++;
          const repl = ref instanceof PDFRef && this.opts.redactImage ? await this.opts.redactImage(ref, g.ctm) : null;
          if (repl) out.push(mkOp('Do', nameOp(addXObject(repl))));
          continue;
        }
        if (sub === '/Form') {
          const fm = numArr(this.ctx, xo.dict.get(N('Matrix')));
          const fctm = mul(fm.length === 6 ? fm as M : ID, g.ctm);
          const bb = numArr(this.ctx, xo.dict.get(N('BBox')));
          const box = bb.length === 4 ? bboxOf([apply(fctm, bb[0], bb[1]), apply(fctm, bb[2], bb[1]), apply(fctm, bb[0], bb[3]), apply(fctm, bb[2], bb[3])]) : null;
          if (box && !hits(box, rects)) { out.push(op); continue; }
          const fres = xo.dict.lookup(N('Resources'));
          const inner = await this.stream(latin1(streamBytes(xo)), fres instanceof PDFDict ? fres : res, fctm);
          if (!inner) { out.push(op); continue; }
          changed = true;
          this.stats.forms++;
          const dict = xo.dict.clone(this.ctx);
          for (const k of ['Filter', 'DecodeParms', 'Length']) dict.delete(N(k));
          if (inner.res) dict.set(N('Resources'), inner.res);
          const copy = this.ctx.flateStream(bytesOfLatin1(inner.content), {});
          for (const [k, v] of dict.entries()) copy.dict.set(k, v);
          out.push(mkOp('Do', nameOp(addXObject(this.ctx.register(copy)))));
          continue;
        }
        out.push(op);
        continue;
      }
      if (op.op === 'BI') {
        // Inline image: the unit square under the CTM.
        const box = bboxOf([apply(g.ctm, 0, 0), apply(g.ctm, 1, 0), apply(g.ctm, 0, 1), apply(g.ctm, 1, 1)]);
        if (hits(box, rects)) { changed = true; this.stats.images++; continue; }
        out.push(op); continue;
      }
      if (op.op === 'sh') {
        const area = g.clip ?? [-1e9, -1e9, 1e9, 1e9];
        if (hits(area as Rect, rects)) { changed = true; continue; }
        out.push(op); continue;
      }
      out.push(op);
    }
    if (!changed) return null;
    // Replacement text of removed glyphs must not survive in marked content.
    const final = out.map((o) => (o.op === 'BDC' && /\/(ActualText|Alt|E)\b/.test(o.raw) && o.args[0]?.t === 'name' ? mkOp('BMC', o.args[0]) : o));
    return { content: writeContent(final), res: newRes ?? res };
  }
}

/** Decoded bytes of a stream object. */
export function streamBytes(s: PDFStream): Uint8Array {
  if (s instanceof PDFRawStream) return decodePDFRawStream(s).decode();
  // Streams created in this session (pdf-lib content/flate streams): their unencoded bytes.
  const f = s as unknown as { getUnencodedContents?(): Uint8Array; getContents(): Uint8Array };
  return f.getUnencodedContents ? f.getUnencodedContents() : f.getContents();
}

/**
 * Redact a page: rewrite its content (and nested forms) so nothing under
 * `rects` remains, then paint the rectangles black. Returns what was removed.
 */
export async function redactPage(doc: PDFDocument, pageIdx: number, opts: RedactOptions, fill: [number, number, number] = [0, 0, 0]): Promise<RedactStats> {
  const page = doc.getPage(pageIdx);
  const ctx = doc.context;
  const contents = page.node.Contents();
  const streams: PDFStream[] = [];
  if (contents instanceof PDFStream) streams.push(contents);
  else if (contents instanceof PDFArray) for (const r of contents.asArray()) { const s = ctx.lookup(r); if (s instanceof PDFStream) streams.push(s); }
  const text = streams.map((s) => latin1(streamBytes(s))).join('\n');
  const res = page.node.Resources();
  const r = new Redactor(doc, opts);
  const done = await r.stream(text, res, ID);
  const boxes = opts.rects.map((q) => `${q[0]} ${q[1]} ${q[2] - q[0]} ${q[3] - q[1]} re`).join(' ');
  const body = `q\n${done ? done.content : text}\nQ\nq ${fill.join(' ')} rg ${boxes} f Q\n`;
  page.node.set(N('Contents'), ctx.register(ctx.flateStream(bytesOfLatin1(body))));
  if (done?.res) page.node.set(N('Resources'), done.res);
  return r.stats;
}
