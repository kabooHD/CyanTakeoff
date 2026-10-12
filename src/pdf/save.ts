import {
  PDFArray, PDFDict, PDFDocument, PDFHexString, PDFString, StandardFonts,
  type PDFFont, type PDFRef,
} from 'pdf-lib';
import type { Markup, Pt, Scale } from '../model/types';
import { centroid, cloudSegments, measure } from '../model/measure';
import { refKey, removeAnnots, type CTData, type PageInfo } from './document';
import { N, hexToRgb, pdfDate, writeMeasure } from './pdfutil';

const f = (n: number) => String(+n.toFixed(3));
const CT_KEY = 'CTData';

/** Point on the callout box (corners a, c) where the leader line attaches. */
export function calloutAttach(tip: Pt, a: Pt, c: Pt): Pt {
  const x0 = Math.min(a.x, c.x), x1 = Math.max(a.x, c.x);
  const y0 = Math.min(a.y, c.y), y1 = Math.max(a.y, c.y);
  if (tip.x < x0 || tip.x > x1) return { x: tip.x < x0 ? x0 : x1, y: Math.max(y0, Math.min(y1, tip.y)) };
  return { x: tip.x, y: tip.y < y0 ? y0 : y1 };
}

/** Collects content-stream operators and the bounding box of what is drawn. */
class Ops {
  out: string[] = [];
  minX = Infinity; minY = Infinity; maxX = -Infinity; maxY = -Infinity;
  add(s: string) { this.out.push(s); }
  grow(p: Pt, pad = 0) {
    this.minX = Math.min(this.minX, p.x - pad); this.minY = Math.min(this.minY, p.y - pad);
    this.maxX = Math.max(this.maxX, p.x + pad); this.maxY = Math.max(this.maxY, p.y + pad);
  }
  moveTo(p: Pt) { this.grow(p); this.add(`${f(p.x)} ${f(p.y)} m`); }
  lineTo(p: Pt) { this.grow(p); this.add(`${f(p.x)} ${f(p.y)} l`); }
  curveTo(a: Pt, b: Pt, c: Pt) {
    this.grow(a); this.grow(b); this.grow(c);
    this.add(`${f(a.x)} ${f(a.y)} ${f(b.x)} ${f(b.y)} ${f(c.x)} ${f(c.y)} c`);
  }
  poly(pts: Pt[], close: boolean) {
    pts.forEach((p, i) => (i ? this.lineTo(p) : this.moveTo(p)));
    if (close) this.add('h');
  }
  ellipse(a: Pt, b: Pt) {
    const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    const rx = Math.abs(b.x - a.x) / 2, ry = Math.abs(b.y - a.y) / 2;
    const k = 0.5523;
    this.moveTo({ x: cx + rx, y: cy });
    this.curveTo({ x: cx + rx, y: cy + ry * k }, { x: cx + rx * k, y: cy + ry }, { x: cx, y: cy + ry });
    this.curveTo({ x: cx - rx * k, y: cy + ry }, { x: cx - rx, y: cy + ry * k }, { x: cx - rx, y: cy });
    this.curveTo({ x: cx - rx, y: cy - ry * k }, { x: cx - rx * k, y: cy - ry }, { x: cx, y: cy - ry });
    this.curveTo({ x: cx + rx * k, y: cy - ry }, { x: cx + rx, y: cy - ry * k }, { x: cx + rx, y: cy });
    this.add('h');
  }
}

function arrowHead(o: Ops, from: Pt, to: Pt, size: number) {
  const ang = Math.atan2(to.y - from.y, to.x - from.x);
  const s = 0.45;
  const a = { x: to.x - size * Math.cos(ang - s), y: to.y - size * Math.sin(ang - s) };
  const b = { x: to.x - size * Math.cos(ang + s), y: to.y - size * Math.sin(ang + s) };
  o.moveTo(a); o.lineTo(to); o.lineTo(b); o.add('S');
}

function wrap(font: PDFFont, text: string, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    let line = '';
    for (const word of para.split(' ')) {
      const next = line ? `${line} ${word}` : word;
      if (line && font.widthOfTextAtSize(next, size) > width) { lines.push(line); line = word; }
      else line = next;
    }
    lines.push(line);
  }
  return lines;
}

function safeText(font: PDFFont, s: string) {
  // Standard 14 fonts are WinAnsi; replace what they cannot encode.
  return [...s].map((ch) => { try { font.encodeText(ch); return ch; } catch { return '?'; } }).join('');
}

function textAt(o: Ops, font: PDFFont, s: string, size: number, x: number, y: number, rgb: string) {
  const t = safeText(font, s);
  const w = font.widthOfTextAtSize(t, size);
  o.grow({ x, y: y - size * 0.25 }); o.grow({ x: x + w, y: y + size });
  o.add(`BT ${rgb} rg /Helv ${f(size)} Tf ${f(x)} ${f(y)} Td ${font.encodeText(t).toString()} Tj ET`);
  return w;
}

function buildAppearance(m: Markup, P: Pt[], font: PDFFont) {
  const o = new Ops();
  const st = m.style;
  const [r, g, b] = hexToRgb(st.color).map(f);
  const rgb = `${r} ${g} ${b}`;
  const fillRgb = st.fill ? hexToRgb(st.fill).map(f).join(' ') : null;
  o.add('q /GS0 gs');
  o.add(`${rgb} RG ${f(st.width)} w 1 J 1 j`);
  if (fillRgb) o.add(`${fillRgb} rg`);
  if (st.lineStyle === 'dashed') o.add(`[${f(st.width * 4)} ${f(st.width * 3)}] 0 d`);
  if (st.lineStyle === 'dotted') o.add(`[${f(st.width)} ${f(st.width * 2)}] 0 d`);
  const paint = fillRgb && st.width > 0 ? 'B' : fillRgb ? 'f' : 'S';
  const pad = st.width;
  const meas = measure(m);

  switch (m.type) {
    case 'line': case 'arrow': case 'length':
      o.moveTo(P[0]); o.lineTo(P[1]); o.add('S');
      if (m.type === 'arrow') arrowHead(o, P[0], P[1], Math.max(8, st.width * 5));
      if (m.type === 'length') {
        // end ticks
        const ang = Math.atan2(P[1].y - P[0].y, P[1].x - P[0].x) + Math.PI / 2;
        for (const p of P) {
          o.moveTo({ x: p.x + Math.cos(ang) * 5, y: p.y + Math.sin(ang) * 5 });
          o.lineTo({ x: p.x - Math.cos(ang) * 5, y: p.y - Math.sin(ang) * 5 });
          o.add('S');
        }
      }
      break;
    case 'polyline': case 'polylength': case 'perimeter': case 'pen':
      o.poly(P, false); o.add('S');
      break;
    case 'polygon': case 'area': case 'volume':
      o.poly(P, true); o.add(paint);
      break;
    case 'cloud': {
      const segs = cloudSegments(P, Math.max(14, st.width * 8));
      segs.forEach(([p0, c1, c2, p1], i) => { if (!i) o.moveTo(p0); o.curveTo(c1, c2, p1); });
      o.add('h ' + paint);
      break;
    }
    case 'rectangle': case 'highlight': {
      const [a, c] = P;
      o.poly([a, { x: c.x, y: a.y }, c, { x: a.x, y: c.y }], true);
      o.add(m.type === 'highlight' ? 'f' : paint);
      break;
    }
    case 'ellipse':
      o.ellipse(P[0], P[1]); o.add(paint);
      break;
    case 'count':
      for (const p of P) { o.ellipse({ x: p.x - 5, y: p.y - 5 }, { x: p.x + 5, y: p.y + 5 }); o.add(paint); }
      break;
    case 'note': {
      const p = P[0];
      o.add(`${fillRgb ?? '1 0.83 0'} rg 0 0 0 RG 0.75 w`);
      o.poly([p, { x: p.x + 18, y: p.y }, { x: p.x + 18, y: p.y - 18 }, { x: p.x, y: p.y - 18 }], true);
      o.add('B');
      for (const dy of [5, 9, 13]) { o.moveTo({ x: p.x + 4, y: p.y - dy }); o.lineTo({ x: p.x + 14, y: p.y - dy }); o.add('S'); }
      break;
    }
    case 'textbox': case 'callout': {
      const [a, c] = m.type === 'callout' ? [P[1], P[2]] : [P[0], P[1]];
      const x0 = Math.min(a.x, c.x), x1 = Math.max(a.x, c.x);
      const y0 = Math.min(a.y, c.y), y1 = Math.max(a.y, c.y);
      if (m.type === 'callout') {
        const tip = P[0];
        const attach = calloutAttach(tip, a, c);
        o.moveTo(tip); o.lineTo(attach); o.add('S');
        arrowHead(o, attach, tip, Math.max(8, st.width * 5));
      }
      o.poly([{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }], true);
      o.add(paint);
      const size = st.fontSize;
      let y = y1 - size - 2;
      for (const line of wrap(font, m.text ?? '', size, x1 - x0 - 6)) {
        if (y < y0) break;
        textAt(o, font, line, size, x0 + 3, y, rgb);
        y -= size * 1.2;
      }
      break;
    }
  }

  if (meas && m.type !== 'count') {
    const at = m.type === 'length' || m.type === 'polylength'
      ? { x: (P[0].x + P[1].x) / 2, y: (P[0].y + P[1].y) / 2 + 3 }
      : centroid(P);
    const size = st.fontSize;
    const t = safeText(font, meas.text);
    const w = font.widthOfTextAtSize(t, size);
    textAt(o, font, t, size, at.x - w / 2, at.y, rgb);
  }
  o.add('Q');
  return { ops: o.out.join('\n'), bbox: [o.minX - pad - 2, o.minY - pad - 2, o.maxX + pad + 2, o.maxY + pad + 2] };
}

const SUBTYPE: Record<Markup['type'], string> = {
  line: 'Line', arrow: 'Line', length: 'Line',
  polyline: 'PolyLine', polylength: 'PolyLine', perimeter: 'PolyLine', pen: 'Ink',
  polygon: 'Polygon', area: 'Polygon', volume: 'Polygon', cloud: 'Polygon', count: 'Polygon',
  rectangle: 'Square', ellipse: 'Circle', highlight: 'Highlight',
  textbox: 'FreeText', callout: 'FreeText', note: 'Text',
};

/** Measurement intents, as Revu writes them. */
const INTENT: Partial<Record<Markup['type'], string>> = {
  length: 'LineDimension', polylength: 'PolyLineDimension', perimeter: 'PolyLineDimension',
  area: 'PolygonDimension', volume: 'PolygonVolume', count: 'PolygonCount',
};

const toPdf = (m: Markup, page: PageInfo) => m.points.map((p) => {
  const [x, y] = page.viewport.convertToPdfPoint(p.x, p.y);
  return { x, y };
});

function ctData(m: Markup, P: Pt[]): CTData {
  return {
    v: 1, type: m.type, label: m.label || undefined, status: m.status !== 'None' ? m.status : undefined,
    depth: m.depth, fillOpacity: m.style.fillOpacity, lineStyle: m.style.lineStyle,
    points: m.type === 'count' ? P.flatMap((p) => [p.x, p.y]) : undefined,
    comment: measure(m) && m.comment ? m.comment : undefined,
  };
}

/**
 * A count is written the way Revu writes one: a small /Polygon per item with
 * /IT /PolygonCount, the items grouped under the first via /IRT + /RT /Group.
 */
function buildCount(doc: PDFDocument, m: Markup, page: PageInfo): PDFRef[] {
  const ctx = doc.context;
  const P = toPdf(m, page);
  const st = m.style;
  const r = 6;
  const refs: PDFRef[] = [];
  P.forEach((p, i) => {
    const o = new Ops();
    o.add('q /GS0 gs');
    o.add(`${hexToRgb(st.fill ?? st.color).map(f).join(' ')} rg ${hexToRgb(st.color).map(f).join(' ')} RG 0.75 w`);
    o.ellipse({ x: p.x - r, y: p.y - r }, { x: p.x + r, y: p.y + r });
    o.add('B Q');
    const bbox = [p.x - r - 1, p.y - r - 1, p.x + r + 1, p.y + r + 1];
    const gs = ctx.obj({ CA: st.opacity, ca: st.fillOpacity });
    const ap = ctx.stream(o.out.join('\n'), { Type: 'XObject', Subtype: 'Form', BBox: bbox, Resources: { ExtGState: { GS0: gs } } });
    const verts: number[] = [];
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      verts.push(p.x + r * Math.cos(a), p.y + r * Math.sin(a));
    }
    const entries: Record<string, unknown> = {
      Type: 'Annot', Subtype: 'Polygon', IT: 'PolygonCount', Rect: bbox, Vertices: verts,
      NM: PDFString.of(i ? `${m.id}-${i}` : m.id),
      T: PDFHexString.fromText(m.author), Subj: PDFHexString.fromText(m.subject),
      Label: PDFHexString.fromText(m.label),
      Contents: PDFHexString.fromText(m.label ? `${m.label}\r${P.length}` : String(P.length)),
      M: PDFString.of(pdfDate(new Date(m.modified))), CreationDate: PDFString.of(pdfDate(new Date(m.created))),
      F: 4, C: hexToRgb(st.color), IC: hexToRgb(st.fill ?? st.color), CA: st.opacity,
      BS: { Type: 'Border', W: 0, S: 'S' }, CountStyle: 'Circle', NumCounts: P.length, MeasurementTypes: 128,
      AP: { N: ctx.register(ap) },
    };
    if (m.scale) entries.BBMeasure = writeMeasure(doc, m.scale);
    if (i === 0) entries[CT_KEY] = PDFHexString.fromText(JSON.stringify(ctData(m, P)));
    else { entries.IRT = refs[0]; entries.RT = 'Group'; }
    refs.push(ctx.register(ctx.obj(entries as never)));
  });
  return refs;
}

function buildAnnot(doc: PDFDocument, font: PDFFont, m: Markup, page: PageInfo): PDFRef[] {
  if (m.type === 'count') return buildCount(doc, m, page);
  const ctx = doc.context;
  const P = toPdf(m, page);
  const { ops, bbox } = buildAppearance(m, P, font);
  const st = m.style;
  const gs = ctx.obj({
    CA: st.opacity,
    ca: m.type === 'textbox' || m.type === 'callout' || m.type === 'note' ? st.opacity : st.fillOpacity,
    ...(m.type === 'highlight' ? { BM: 'Multiply' } : {}),
  });
  const ap = ctx.stream(ops, {
    Type: 'XObject', Subtype: 'Form', BBox: bbox,
    Resources: { Font: { Helv: font.ref }, ExtGState: { GS0: gs } },
  });
  const flat = (pts: Pt[]) => pts.flatMap((p) => [p.x, p.y]);
  const ct = ctData(m, P);
  const meas = measure(m);
  const now = pdfDate(new Date(m.modified));
  const entries: Record<string, unknown> = {
    Type: 'Annot',
    Subtype: SUBTYPE[m.type],
    Rect: bbox,
    NM: PDFString.of(m.id),
    T: PDFHexString.fromText(m.author),
    Subj: PDFHexString.fromText(m.subject),
    // Like Revu, a measurement's /Contents is its displayed value.
    Contents: PDFHexString.fromText(m.type === 'textbox' || m.type === 'callout' ? m.text ?? '' : meas ? meas.text : m.comment),
    Label: PDFHexString.fromText(m.label),
    FillOpacity: st.fillOpacity,
    M: PDFString.of(now),
    CreationDate: PDFString.of(pdfDate(new Date(m.created))),
    F: 4, // print
    C: hexToRgb(st.color),
    CA: st.opacity,
    BS: { Type: 'Border', W: st.width, S: st.lineStyle === 'solid' ? 'S' : 'D' },
    AP: { N: ctx.register(ap) },
    [CT_KEY]: PDFHexString.fromText(JSON.stringify(ct)),
  };
  if (st.fill && m.type !== 'highlight') entries.IC = hexToRgb(st.fill);
  const scale = m.scale;
  switch (SUBTYPE[m.type]) {
    case 'Line':
      entries.L = flat(P);
      entries.LE = [N('None'), N(m.type === 'arrow' ? 'OpenArrow' : 'None')];
      break;
    case 'PolyLine':
      entries.Vertices = flat(P);
      break;
    case 'Polygon':
      entries.Vertices = flat(P);
      if (m.type === 'cloud') entries.BE = { S: 'C', I: 1 };
      break;
    case 'Ink':
      entries.InkList = [flat(P)];
      break;
    case 'Highlight': {
      const xs = P.map((p) => p.x), ys = P.map((p) => p.y);
      const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
      entries.QuadPoints = [x0, y1, x1, y1, x0, y0, x1, y0];
      entries.C = hexToRgb(st.fill ?? st.color);
      break;
    }
    case 'FreeText': {
      const [r, g, b] = hexToRgb(st.color);
      entries.DA = PDFString.of(`${f(r)} ${f(g)} ${f(b)} rg /Helv ${f(st.fontSize)} Tf`);
      if (m.type === 'callout') {
        entries.IT = 'FreeTextCallout';
        entries.CL = flat([P[0], calloutAttach(P[0], P[1], P[2])]);
        entries.LE = N('OpenArrow');
      }
      const box = m.type === 'callout' ? [P[1], P[2]] : [P[0], P[1]];
      const bx = [Math.min(box[0].x, box[1].x), Math.min(box[0].y, box[1].y), Math.max(box[0].x, box[1].x), Math.max(box[0].y, box[1].y)];
      entries.RD = [bx[0] - bbox[0], bx[1] - bbox[1], bbox[2] - bx[2], bbox[3] - bx[3]];
      break;
    }
    case 'Square': case 'Circle': {
      const xs = P.map((p) => p.x), ys = P.map((p) => p.y);
      entries.RD = [
        Math.min(...xs) - bbox[0], Math.min(...ys) - bbox[1],
        bbox[2] - Math.max(...xs), bbox[3] - Math.max(...ys),
      ];
      break;
    }
    case 'Text':
      entries.Name = 'Comment';
      entries.Rect = [P[0].x, P[0].y - 18, P[0].x + 18, P[0].y];
      break;
  }
  if (INTENT[m.type]) entries.IT = INTENT[m.type];
  if (scale && meas) entries.Measure = writeMeasure(doc, scale);
  return [ctx.register(ctx.obj(entries as never))];
}

export interface SaveInput {
  original: Uint8Array;
  pages: PageInfo[];
  markups: Markup[];
  /** refKeys of annotations imported at load time. */
  importedRefs: Set<string>;
  calibrations: (Scale | null)[];
  dirtyCalibrations: Set<number>;
}

export async function savePdf(input: SaveInput): Promise<Uint8Array> {
  const doc = await PDFDocument.load(input.original, { updateMetadata: false });
  const keep = new Set(
    input.markups.filter((m) => m.source && !m.source.dirty)
      .flatMap((m) => [m.source!, ...(m.source!.extraRefs ?? [])].map(refKey)),
  );
  const remove = new Set([...input.importedRefs].filter((r) => !keep.has(r)));
  for (let p = 0; p < doc.getPageCount(); p++) removeAnnots(doc, p, remove);

  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const m of input.markups) {
    if (m.source && !m.source.dirty) continue;
    const page = doc.getPage(m.page);
    let annots = page.node.lookup(N('Annots'));
    if (!(annots instanceof PDFArray)) {
      annots = doc.context.obj([]);
      page.node.set(N('Annots'), annots);
    }
    for (const ref of buildAnnot(doc, font, m, input.pages[m.page])) {
      (annots as PDFArray).push(ref);
      // Markup annotations reference their page.
      (doc.context.lookup(ref) as PDFDict).set(N('P'), page.ref);
    }
  }

  for (const p of input.dirtyCalibrations) {
    const s = input.calibrations[p];
    const page = doc.getPage(p);
    if (!s) { page.node.delete(N('VP')); continue; }
    const { x, y, width, height } = page.getMediaBox();
    page.node.set(N('VP'), doc.context.obj([
      doc.context.obj({
        Type: 'Viewport',
        BBox: [x, y, x + width, y + height],
        Name: PDFString.of('CyanTakeoff'),
        Measure: writeMeasure(doc, s),
      }),
    ]));
  }
  return doc.save({ useObjectStreams: false });
}
