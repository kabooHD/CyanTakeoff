import { writeLayers, type LayerSet } from './layers';
import { writeBookmarks, type Bookmark } from './bookmarks';
import { captionText, displayText } from '../model/measureDisplay';
import { HATCH_TYPES, fillOutline, hatchLineWidth, hatchTileWH, isSimpleStyle, lineDash, lineStyleOf, strokeOutline, styledStroke, type HatchDef } from '../model/lineStyles';
import { flattenPath, hasCurves, pdfPath, segments } from '../model/curves';
import { hasSignatures, incrementalUpdate, loadForUpdate } from './incremental';
import {
  PDFArray, PDFDict, PDFDocument, PDFHexString, PDFRef, PDFString, StandardFonts,
  type PDFFont, type PDFObject,
} from 'pdf-lib';
import type { CustomColumn, Cutout, Markup, Pt, Scale, Space, Viewport } from '../model/types';
import { spaceTree, type SpaceNode } from '../model/spaces';
import { LEGEND_HEADERS, legendLayout, legendRows, type LegendRow } from '../model/legend';
import { arcPoints, arcThrough, bounds, centroid, cloudSegments, measure, rectCorners, rectPairs } from '../model/measure';
import { refKey, removeAnnots, type CTData, type PageInfo } from './document';
import { COLUMNS_KEY, isRulerViewport } from './importAnnots';
import { writeFields, type FieldValue } from './forms';
import { N, hexToRgb, pdfDate, writeMeasure } from './pdfutil';

const f = (n: number) => String(+n.toFixed(3));
const CT_KEY = 'CTData';

/** Circle of a radius ([center, edge]) or diameter ([end, end]) measurement. */
function circleOf(type: Markup['type'], P: Pt[]) {
  const d = Math.hypot(P[1].x - P[0].x, P[1].y - P[0].y);
  return type === 'radius'
    ? { x: P[0].x, y: P[0].y, r: d }
    : { x: (P[0].x + P[1].x) / 2, y: (P[0].y + P[1].y) / 2, r: d / 2 };
}

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

/**
 * Reading direction of a page shown with /Rotate `rot`: text drawn along
 * `right` (with `up` as its up) reads upright on screen.
 */
export function textFrame(rot = 0) {
  const a = ((((rot % 360) + 360) % 360) * Math.PI) / 180;
  const c = Math.round(Math.cos(a)), s = Math.round(Math.sin(a));
  return { right: { x: c, y: s }, up: { x: -s, y: c } };
}
type Frame = ReturnType<typeof textFrame>;
const at = (fr: Frame, u: number, v: number): Pt => ({ x: u * fr.right.x + v * fr.up.x, y: u * fr.right.y + v * fr.up.y });
/** Coordinates of PDF point `p` along the frame's axes. */
const proj = (fr: Frame, p: Pt) => ({ u: p.x * fr.right.x + p.y * fr.right.y, v: p.x * fr.up.x + p.y * fr.up.y });

/** Draw text with its baseline origin at frame coordinates (u, v). */
function textAt(o: Ops, font: PDFFont, s: string, size: number, u: number, v: number, rgb: string, fr: Frame = textFrame(0)) {
  const t = safeText(font, s);
  const w = font.widthOfTextAtSize(t, size);
  for (const [du, dv] of [[0, -size * 0.25], [w, -size * 0.25], [0, size], [w, size]]) o.grow(at(fr, u + du, v + dv));
  const p = at(fr, u, v);
  const m = `${fr.right.x} ${fr.right.y} ${fr.up.x} ${fr.up.y} ${f(p.x)} ${f(p.y)}`;
  o.add(`BT ${rgb} rg /Helv ${f(size)} Tf ${m} Tm ${font.encodeText(t).toString()} Tj ET`);
  return w;
}

/** Wrapped lines of text laid out from the top of box (a, c), in the page's reading direction. */
function textInBox(o: Ops, font: PDFFont, text: string, size: number, a: Pt, c: Pt, rgb: string, fr: Frame, align: 'left' | 'center' = 'left') {
  const cs = [a, c].map((q) => proj(fr, q));
  const u0 = Math.min(cs[0].u, cs[1].u), u1 = Math.max(cs[0].u, cs[1].u);
  const v0 = Math.min(cs[0].v, cs[1].v), v1 = Math.max(cs[0].v, cs[1].v);
  let v = v1 - size - 2;
  for (const line of wrap(font, text, size, u1 - u0 - 6)) {
    if (v < v0 - size * 0.3) break;
    const w = font.widthOfTextAtSize(safeText(font, line), size);
    textAt(o, font, line, size, align === 'center' ? (u0 + u1 - w) / 2 : u0 + 3, v, rgb, fr);
    v -= size * 1.2;
  }
}

/** A path with curved segments (m, l, c; closed with h). */
function curvedPath(o: Ops, P: Pt[], h: Markup['handles'], closed: boolean) {
  if (!P.length) return;
  o.moveTo(P[0]);
  for (const [, c1, c2, b] of segments(P, h, closed)) { if (c1 && c2) o.curveTo(c1, c2, b); else o.lineTo(b); }
  if (closed) o.add('h');
}

/** Handles (offsets) converted to PDF space along with their vertices. */
function pdfHandles(m: Markup, page: PageInfo): Markup['handles'] {
  if (!hasCurves(m.handles)) return undefined;
  return m.points.map((p, i) => {
    const h = m.handles?.[i];
    if (!h) return null;
    const v = toPdfPt(p, page);
    const at = (d: Pt) => { const q = toPdfPt({ x: p.x + d.x, y: p.y + d.y }, page); return { x: q.x - v.x, y: q.y - v.y }; };
    return { in: at(h.in), out: at(h.out) };
  });
}

function buildAppearance(m: Markup, P: Pt[], font: PDFFont, cutouts?: Cutout[], rot = 0, rows: LegendRow[] = []) {
  const fr = textFrame(rot);
  const o = new Ops();
  const st = m.style;
  const [r, g, b] = hexToRgb(st.color).map(f);
  const rgb = `${r} ${g} ${b}`;
  const fillRgb = st.fill ? hexToRgb(st.fill).map(f).join(' ') : null;
  o.add('q /GS0 gs');
  o.add(`${rgb} RG ${f(st.width)} w 1 J 1 j`);
  if (fillRgb) o.add(`${fillRgb} rg`);
  // Line style: a dash pattern, or (parallel lines, text) drawn along the outline after the shape.
  const def = lineStyleOf(st);
  const styled = !isSimpleStyle(def) && st.width > 0 ? strokeOutline({ ...m, points: P }) : null;
  const dash = lineDash(def, st.width);
  if (dash) o.add(`[${dash.map(f).join(' ')}] 0 d`);
  // Hatch: the inside painted with a tiling pattern (resource /HP0) instead of a solid fill.
  const hatchArea = st.hatch && HATCH_TYPES.has(m.type) ? fillOutline({ ...m, points: P }) : null;
  if (hatchArea) {
    o.add('q /Pattern cs /HP0 scn');
    o.poly(hatchArea, true);
    for (const c of cutouts ?? []) { if (c.kind === 'polygon') { if (hasCurves(c.handles)) curvedPath(o, c.points, c.handles, true); else o.poly(c.points, true); } else o.ellipse(c.points[0], c.points[1]); }
    o.add('f* Q');
  }
  const fills = !!fillRgb && !hatchArea, strokes = st.width > 0 && !styled;
  const paint = fills && strokes ? 'B' : fills ? 'f' : strokes ? 'S' : 'n';
  /** Paint for a shape's main open line (not drawn here when its style is drawn along it). */
  const lineOp = styled ? 'n' : 'S';
  const pad = st.width;
  const meas = measure(m);

  switch (m.type) {
    case 'dimension': {
      const size = Math.max(7, st.width * 5);
      o.moveTo(P[0]); o.lineTo(P[1]); o.add('S');
      arrowHead(o, P[1], P[0], size); arrowHead(o, P[0], P[1], size);
      const ang = Math.atan2(P[1].y - P[0].y, P[1].x - P[0].x) + Math.PI / 2;
      for (const p of [P[0], P[1]]) {
        o.moveTo({ x: p.x + Math.cos(ang) * 8, y: p.y + Math.sin(ang) * 8 });
        o.lineTo({ x: p.x - Math.cos(ang) * 8, y: p.y - Math.sin(ang) * 8 }); o.add('S');
      }
      break;
    }
    case 'arc':
      o.poly(P.length > 2 ? arcThrough(P[0], P[1], P[2]) : P, false); o.add(lineOp);
      break;
    case 'typewriter':
      o.grow(P[0]); o.grow(P[1]);
      textInBox(o, font, m.text ?? '', st.fontSize, P[0], P[1], rgb, fr);
      break;
    case 'cloudplus': {
      const cloud = rectCorners(P[0], P[1]);
      const segs = cloudSegments(cloud, Math.max(14, st.width * 8));
      segs.forEach(([p0, c1, c2, p1], i) => { if (!i) o.moveTo(p0); o.curveTo(c1, c2, p1); });
      o.add('h S');
      if (P.length >= 4) {
        const b = bounds([P[2], P[3]]), cb = bounds(cloud);
        const target = { x: b.minX + b.w / 2, y: b.minY + b.h / 2 };
        const from = { x: Math.max(cb.minX, Math.min(cb.maxX, target.x)), y: Math.max(cb.minY, Math.min(cb.maxY, target.y)) };
        o.moveTo(from); o.lineTo(calloutAttach(from, P[2], P[3])); o.add('S');
        o.poly(rectCorners(P[2], P[3]), true); o.add(paint);
        textInBox(o, font, m.text ?? '', st.fontSize, P[2], P[3], rgb, fr);
      }
      break;
    }
    case 'flag': {
      const p = P[0];
      o.add('0 0 0 RG 1.2 w'); o.moveTo(p); o.lineTo({ x: p.x, y: p.y - 20 }); o.add('S');
      o.add(`${rgb} RG ${fillRgb ?? rgb} rg 0.75 w`);
      o.poly([p, { x: p.x + 14, y: p.y - 4 }, { x: p.x, y: p.y - 9 }], true); o.add('B');
      break;
    }
    case 'attachment': {
      const p = P[0];
      o.add('1 1 1 rg 0.75 w');
      o.poly([p, { x: p.x + 18, y: p.y }, { x: p.x + 18, y: p.y - 18 }, { x: p.x, y: p.y - 18 }], true); o.add('B');
      o.moveTo({ x: p.x + 11, y: p.y - 5 }); o.lineTo({ x: p.x + 11, y: p.y - 13 });
      o.curveTo({ x: p.x + 11, y: p.y - 16 }, { x: p.x + 6, y: p.y - 16 }, { x: p.x + 6, y: p.y - 13 });
      o.lineTo({ x: p.x + 6, y: p.y - 4 });
      o.curveTo({ x: p.x + 6, y: p.y - 2 }, { x: p.x + 9.2, y: p.y - 2 }, { x: p.x + 9.2, y: p.y - 4 });
      o.lineTo({ x: p.x + 9.2, y: p.y - 12 }); o.add('S');
      break;
    }
    case 'stamp': {
      const b = bounds(P);
      o.poly(rectCorners({ x: b.minX, y: b.minY }, { x: b.maxX, y: b.maxY }), true); o.add('S');
      const text = m.text ?? '';
      const size = Math.min(b.h * 0.42, (b.w * 1.6) / Math.max(4, text.length));
      const c = { x: b.minX + b.w / 2, y: b.minY + b.h / 2 };
      const q = proj(fr, c);
      const t = safeText(font, text);
      const w = font.widthOfTextAtSize(t, size);
      textAt(o, font, t, size, q.u - w / 2, q.v - size * 0.3 + b.h * 0.08, rgb, fr);
      const sub = safeText(font, m.subtitle ?? `${m.author} ${new Date(m.created).toLocaleDateString()}`);
      const s2 = Math.max(5, size * 0.38);
      textAt(o, font, sub, s2, q.u - font.widthOfTextAtSize(sub, s2) / 2, q.v - b.h * 0.36, rgb, fr);
      break;
    }
    case 'legend': {
      if (!m.legend) break;
      // The table, drawn in the page's reading direction from the top-left corner.
      const L = legendLayout(m.legend, rows, st.fontSize);
      const cs = P.map((q) => proj(fr, q));
      const u0 = Math.min(...cs.map((c) => c.u)), v0 = Math.max(...cs.map((c) => c.v));
      const pt = (u: number, v: number) => at(fr, u0 + u, v0 - v);
      const box = [pt(0, 0), pt(L.w, 0), pt(L.w, L.h), pt(0, L.h)];
      o.add(`${fillRgb ?? '1 1 1'} rg`); o.poly(box, true); o.add('f');
      o.add(`${rgb} RG 0.8 w`); o.poly(box, true); o.add('S');
      o.add('0.4 w');
      for (let k = 0; k <= rows.length; k++) { o.moveTo(pt(0, L.title + L.row * k)); o.lineTo(pt(L.w, L.title + L.row * k)); o.add('S'); }
      const fs = st.fontSize;
      const put = (t: string, u: number, v: number, align: 'start' | 'end' | 'middle') => {
        const s2 = safeText(font, t);
        const w = font.widthOfTextAtSize(s2, fs);
        const du = align === 'end' ? -w : align === 'middle' ? -w / 2 : 0;
        textAt(o, font, s2, fs, u0 + u + du, v0 - v - fs * 0.35, rgb, fr);
      };
      put(m.legend.title, L.w / 2, L.title / 2, 'middle');
      let cx = 0;
      L.cols.forEach((c) => {
        if (c.id !== 'symbol') put(LEGEND_HEADERS[c.id], c.id === 'description' ? cx + 5 : cx + c.w - 5, L.title + L.row / 2, c.id === 'description' ? 'start' : 'end');
        rows.forEach((r, k) => {
          const cy = L.title + L.row * (k + 1.5);
          if (c.id === 'symbol') {
            const [rr, gg, bb] = hexToRgb(r.style.color).map(f);
            const fillC = (r.style.fill ? hexToRgb(r.style.fill) : hexToRgb(r.style.color)).map(f).join(' ');
            o.add(`q ${rr} ${gg} ${bb} RG ${fillC} rg 1 w`);
            if (['area', 'volume', 'polygon', 'rectangle', 'highlight', 'cloud', 'ellipse', 'count'].includes(r.type)) {
              o.poly([pt(cx + c.w * 0.15, cy - L.row * 0.3), pt(cx + c.w * 0.85, cy - L.row * 0.3), pt(cx + c.w * 0.85, cy + L.row * 0.3), pt(cx + c.w * 0.15, cy + L.row * 0.3)], true);
              o.add(r.style.fill || r.type === 'count' ? 'B' : 'S');
            } else { o.moveTo(pt(cx + c.w * 0.1, cy)); o.lineTo(pt(cx + c.w * 0.9, cy)); o.add('S'); }
            o.add('Q');
          } else if (c.id === 'description') put(r.description, cx + 5, cy, 'start');
          else put(c.id === 'quantity' ? String(r.quantity) : r.measurement, cx + c.w - 5, cy, 'end');
        });
        cx += c.w;
      });
      break;
    }
    case 'image': {
      const b = bounds(P);
      o.grow({ x: b.minX, y: b.minY }); o.grow({ x: b.maxX, y: b.maxY });
      o.add(`q ${f(b.w)} 0 0 ${f(b.h)} ${f(b.minX)} ${f(b.minY)} cm /Im0 Do Q`);
      break;
    }
    case 'link':
      o.grow(P[0]); o.grow(P[1]);
      break;
    case 'redaction':
      for (const [a, c] of rectPairs(P)) { o.poly(rectCorners(a, c), true); o.add(fillRgb && st.width > 0 ? 'B' : fillRgb ? 'f' : 'S'); }
      break;
    case 'caret': {
      const r = bounds(P);
      o.poly([{ x: r.minX, y: r.minY }, { x: r.minX + r.w / 2, y: r.maxY }, { x: r.maxX, y: r.minY }], false);
      o.add('S');
      break;
    }
    case 'strikeout': case 'underline': case 'squiggly':
      for (const [a, c] of rectPairs(P)) {
        const r = bounds([a, c]);
        o.grow({ x: r.minX, y: r.minY }); o.grow({ x: r.maxX, y: r.maxY });
        if (m.type === 'strikeout') { o.moveTo({ x: r.minX, y: r.minY + r.h / 2 }); o.lineTo({ x: r.maxX, y: r.minY + r.h / 2 }); }
        else if (m.type === 'underline') { o.moveTo({ x: r.minX, y: r.minY + r.h * 0.08 }); o.lineTo({ x: r.maxX, y: r.minY + r.h * 0.08 }); }
        else {
          const amp = Math.max(1, r.h * 0.08), step = Math.max(2, r.h * 0.2);
          o.moveTo({ x: r.minX, y: r.minY + amp });
          for (let x = r.minX, k = 0; x < r.maxX; x += step, k++) o.lineTo({ x: Math.min(x + step, r.maxX), y: r.minY + amp + (k % 2 ? amp : -amp) });
        }
        o.add('S');
      }
      break;
    case 'line': case 'arrow': case 'length':
      o.moveTo(P[0]); o.lineTo(P[1]); o.add(lineOp);
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
    case 'polyline': case 'polylength': case 'perimeter': case 'pen': case 'angle':
      if (hasCurves(m.handles)) curvedPath(o, P, m.handles, false); else o.poly(P, false);
      o.add(m.type === 'angle' ? 'S' : lineOp);
      break;
    case 'radius':
      if (P.length > 2) {
        // Partial arc: radius line, then the arc counterclockwise (PDF space) to the end direction.
        o.poly([P[0], ...arcPoints(P[0], P[1], P[2], 1)], false); o.add('S');
        break;
      }
    // falls through
    case 'diameter': {
      const c = circleOf(m.type, P);
      o.ellipse({ x: c.x - c.r, y: c.y - c.r }, { x: c.x + c.r, y: c.y + c.r }); o.add('S');
      o.moveTo(P[0]); o.lineTo(P[1]); o.add('S');
      break;
    }
    case 'polygon': case 'area': case 'volume':
      if (hasCurves(m.handles)) curvedPath(o, P, m.handles, true); else o.poly(P, true);
      if (cutouts?.length) {
        // Holes: extra subpaths painted with the even-odd rule.
        for (const c of cutouts) {
          if (c.kind === 'polygon') { if (hasCurves(c.handles)) curvedPath(o, c.points, c.handles, true); else o.poly(c.points, true); }
          else o.ellipse(c.points[0], c.points[1]);
        }
        o.add(paint === 'S' || paint === 'n' ? paint : paint + '*');
      } else o.add(paint);
      break;
    case 'cloud': {
      const segs = cloudSegments(P, Math.max(14, st.width * 8));
      segs.forEach(([p0, c1, c2, p1], i) => { if (!i) o.moveTo(p0); o.curveTo(c1, c2, p1); });
      o.add('h ' + paint);
      break;
    }
    case 'rectangle': case 'highlight': {
      if (m.type === 'highlight' && P.length > 2) {
        for (const [a, c] of rectPairs(P)) { o.poly([a, { x: c.x, y: a.y }, c, { x: a.x, y: c.y }], true); o.add('f'); }
        break;
      }
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
      // Lay the text out in the page's reading direction (rotated pages).
      const cs = [{ x: x0, y: y0 }, { x: x1, y: y1 }].map((q) => proj(fr, q));
      const u0 = Math.min(cs[0].u, cs[1].u), u1 = Math.max(cs[0].u, cs[1].u);
      const v0 = Math.min(cs[0].v, cs[1].v), v1 = Math.max(cs[0].v, cs[1].v);
      const size = st.fontSize;
      let v = v1 - size - 2;
      for (const line of wrap(font, m.text ?? '', size, u1 - u0 - 6)) {
        if (v < v0) break;
        textAt(o, font, line, size, u0 + 3, v, rgb, fr);
        v -= size * 1.2;
      }
      break;
    }
  }

  if (styled) {
    const { lines, texts } = styledStroke(styled.pts, styled.closed, def, st.width);
    for (const l of lines) {
      o.add(l.dash ? `[${l.dash.map(f).join(' ')}] 0 d` : '[] 0 d');
      o.poly(l.pts, l.closed);
      o.add('S');
    }
    for (const t of texts) {
      const txt = safeText(font, t.text);
      const w = font.widthOfTextAtSize(txt, t.size);
      const a = (t.angle * Math.PI) / 180, cs = Math.cos(a), sn = Math.sin(a);
      // Centred on the line: back half the width along it, down a third of the size across it.
      const x = t.at.x - (w / 2) * cs + (t.size * 0.35) * sn, y = t.at.y - (w / 2) * sn - (t.size * 0.35) * cs;
      o.grow(t.at, w);
      o.add(`BT /Helv ${f(t.size)} Tf ${rgb} rg ${f(cs)} ${f(sn)} ${f(-sn)} ${f(cs)} ${f(x)} ${f(y)} Tm ${font.encodeText(txt).toString()} Tj ET`);
    }
  }

  // Sequence value on a shape (text markups carry it in their text).
  if (m.seq && m.label && !['textbox', 'callout', 'typewriter', 'cloudplus'].includes(m.type) && P.length) {
    const bb = bounds(P);
    const t = safeText(font, m.label);
    const w = font.widthOfTextAtSize(t, st.fontSize);
    const q = proj(fr, { x: bb.minX + bb.w / 2, y: bb.minY + bb.h / 2 });
    textAt(o, font, t, st.fontSize, q.u - w / 2, q.v - st.fontSize * 0.35, rgb, fr);
  }

  if (meas && m.type !== 'count') {
    const pos = m.type === 'length' || m.type === 'polylength' || m.type === 'radius' || m.type === 'diameter' || m.type === 'dimension'
      ? { x: (P[0].x + P[1].x) / 2, y: (P[0].y + P[1].y) / 2 }
      : m.type === 'angle' ? P[1]
        : centroid(P);
    const size = st.fontSize;
    const t = safeText(font, captionText(m, meas) ?? '');
    const w = font.widthOfTextAtSize(t, size);
    const q = proj(fr, pos);
    const lift = m.type === 'angle' ? 8 : m.type === 'length' || m.type === 'polylength' || m.type === 'radius' || m.type === 'diameter' || m.type === 'dimension' ? 3 : 0;
    textAt(o, font, t, size, q.u - w / 2 + (m.type === 'angle' ? 8 + w / 2 : 0), q.v + lift, rgb, fr);
  }
  o.add('Q');
  return { ops: o.out.join('\n'), bbox: [o.minX - pad - 2, o.minY - pad - 2, o.maxX + pad + 2, o.maxY + pad + 2], hatch: hatchArea ? st.hatch : undefined };
}

const SUBTYPE: Record<Markup['type'], string> = {
  line: 'Line', arrow: 'Line', length: 'Line',
  polyline: 'PolyLine', polylength: 'PolyLine', perimeter: 'PolyLine', pen: 'Ink',
  polygon: 'Polygon', area: 'Polygon', volume: 'Polygon', cloud: 'Polygon', count: 'Polygon',
  rectangle: 'Square', ellipse: 'Circle', highlight: 'Highlight',
  textbox: 'FreeText', callout: 'FreeText', note: 'Text',
  angle: 'PolyLine', radius: 'Polygon', diameter: 'Circle',
  dimension: 'Line', typewriter: 'FreeText', cloudplus: 'Polygon', arc: 'PolyLine', flag: 'Text', stamp: 'Stamp',
  strikeout: 'StrikeOut', underline: 'Underline', squiggly: 'Squiggly', caret: 'Caret', image: 'Stamp', link: 'Link', attachment: 'FileAttachment',
  legend: 'Stamp', redaction: 'Redact',
};

/** Measurement intents, as Revu writes them. */
const INTENT: Partial<Record<Markup['type'], string>> = {
  length: 'LineDimension', polylength: 'PolyLineDimension', perimeter: 'PolyLineDimension',
  area: 'PolygonDimension', volume: 'PolygonVolume', count: 'PolygonCount',
  angle: 'PolyLineAngle', radius: 'PolygonRadius', diameter: 'CircleDimension',
  dimension: 'LineDimension', typewriter: 'FreeTextTypeWriter', cloudplus: 'PolygonCloud',
};

const toPdfPt = (p: Pt, page: PageInfo) => {
  const [x, y] = page.viewport.convertToPdfPoint(p.x, p.y);
  return { x, y };
};
const toPdf = (m: Markup, page: PageInfo) => m.points.map((p) => toPdfPt(p, page));

function ctData(m: Markup, P: Pt[]): CTData {
  return {
    v: 1, type: m.type, label: m.label || undefined, status: m.status !== 'None' ? m.status : undefined,
    statusModel: m.statusModel, statusBy: m.statusBy, statusDate: m.statusDate,
    depth: m.depth, fillOpacity: m.style.fillOpacity, lineStyle: m.style.lineStyle,
    seq: m.seq,
    display: m.display,
    lineDef: m.style.lineDef, hatch: m.style.hatch, hatchScale: m.style.hatch ? m.style.hatchScale : undefined,
    points: m.type === 'count' || m.type === 'arc' || m.type === 'cloudplus' ? P.flatMap((p) => [p.x, p.y]) : undefined,
    comment: measure(m) || m.type === 'cloudplus' || m.type === 'stamp' ? m.comment || undefined : undefined,
    text: m.type === 'stamp' || m.type === 'cloudplus' ? m.text : undefined,
    subtitle: m.type === 'stamp' ? m.subtitle : undefined,
    groupId: m.groupId,
    slope: m.slope,
    rise: m.rise,
    custom: m.custom && Object.keys(m.custom).length ? m.custom : undefined,
    legend: m.legend,
    checked: m.checked || undefined,
    handles: hasCurves(m.handles) ? m.handles!.map((h) => (h ? [h.in.x, h.in.y, h.out.x, h.out.y] : null)) : undefined,
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

/** A hatch as a PDF tiling pattern (tile drawn y-up, so it matches the screen). */
function hatchPattern(doc: PDFDocument, h: HatchDef, scale: number | undefined, color: string): PDFRef {
  const [t, th] = hatchTileWH(h, scale);
  const rgb = hexToRgb(color).map(f).join(' ');
  const ops = [`${rgb} RG ${rgb} rg ${f(hatchLineWidth(t))} w 2 J`];
  for (const [x1, y1, x2, y2] of h.lines) ops.push(`${f(x1 * t)} ${f((1 - y1) * th)} m ${f(x2 * t)} ${f((1 - y2) * th)} l S`);
  for (const [x, y, r0] of h.dots) {
    const r = Math.max(0.3, r0 * t), cx = x * t, cy = (1 - y) * th, k = r * 0.5523;
    ops.push(`${f(cx + r)} ${f(cy)} m ${f(cx + r)} ${f(cy + k)} ${f(cx + k)} ${f(cy + r)} ${f(cx)} ${f(cy + r)} c ${f(cx - k)} ${f(cy + r)} ${f(cx - r)} ${f(cy + k)} ${f(cx - r)} ${f(cy)} c `
      + `${f(cx - r)} ${f(cy - k)} ${f(cx - k)} ${f(cy - r)} ${f(cx)} ${f(cy - r)} c ${f(cx + k)} ${f(cy - r)} ${f(cx + r)} ${f(cy - k)} ${f(cx + r)} ${f(cy)} c f`);
  }
  return doc.context.register(doc.context.stream(ops.join('\n'), {
    Type: 'Pattern', PatternType: 1, PaintType: 1, TilingType: 1, BBox: [0, 0, t, th], XStep: t, YStep: th, Resources: {},
  }));
}

/** /QuadPoints for rectangles given as point pairs (PDF space). */
function quads(P: Pt[]): number[] {
  return rectPairs(P).flatMap(([a, c]) => {
    const r = bounds([a, c]);
    return [r.minX, r.maxY, r.maxX, r.maxY, r.minX, r.minY, r.maxX, r.minY];
  });
}

const base64ToBytes = (b64: string) => Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));

function buildAnnot(doc: PDFDocument, font: PDFFont, m: Markup, page: PageInfo, image?: PDFRef, pageRefs: PDFRef[] = [], rows: LegendRow[] = []): PDFRef[] {
  if (m.type === 'count') return buildCount(doc, m, page);
  const ctx = doc.context;
  const P = toPdf(m, page);
  const handles = pdfHandles(m, page);
  if (handles) m = { ...m, handles };
  const ct = ctData(m, P);
  const cutouts = m.cutouts?.map((c) => ({ ...c, points: c.points.map((q) => toPdfPt(q, page)), handles: hasCurves(c.handles) ? pdfHandles({ ...m, points: c.points, handles: c.handles }, page) : undefined }));
  const { ops, bbox, hatch } = buildAppearance(m, P, font, cutouts, (page.viewport as { rotation?: number }).rotation ?? 0, rows);
  if (cutouts?.length) ct.cutouts = cutouts.map((c) => ({ kind: c.kind, points: c.points.flatMap((q) => [q.x, q.y]), handles: c.handles?.map((h) => (h ? [h.in.x, h.in.y, h.out.x, h.out.y] : null)) }));
  const st = m.style;
  const gs = ctx.obj({
    CA: st.opacity,
    ca: m.type === 'textbox' || m.type === 'callout' || m.type === 'note' ? st.opacity : st.fillOpacity,
    ...(m.type === 'highlight' ? { BM: 'Multiply' } : {}),
  });
  const ap = ctx.stream(ops, {
    Type: 'XObject', Subtype: 'Form', BBox: bbox,
    Resources: {
      Font: { Helv: font.ref }, ExtGState: { GS0: gs }, ...(image ? { XObject: { Im0: image } } : {}),
      ...(hatch ? { Pattern: { HP0: hatchPattern(doc, hatch, m.style.hatchScale, m.style.fill ?? m.style.color) } } : {}),
    },
  });
  const flat = (pts: Pt[]) => pts.flatMap((p) => [p.x, p.y]);
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
    Contents: PDFHexString.fromText(m.type === 'textbox' || m.type === 'callout' || m.type === 'typewriter' || m.type === 'cloudplus' ? m.text ?? '' : meas ? displayText(m, meas) : m.comment),
    Label: PDFHexString.fromText(m.label),
    FillOpacity: st.fillOpacity,
    M: PDFString.of(now),
    CreationDate: PDFString.of(pdfDate(new Date(m.created))),
    F: 4 | (m.locked ? 128 : 0) | (m.hidden ? 2 : 0), // print (+ locked, hidden)
    C: hexToRgb(st.color),
    CA: st.opacity,
    BS: { Type: 'Border', W: st.width, ...(lineDash(lineStyleOf(st), st.width) ? { S: 'D', D: lineDash(lineStyleOf(st), st.width) } : { S: 'S' }) },
    AP: { N: ctx.register(ap) },
    [CT_KEY]: PDFHexString.fromText(JSON.stringify(ct)),
  };
  if (st.fill && m.type !== 'highlight') entries.IC = hexToRgb(st.fill);
  const scale = m.scale;
  switch (SUBTYPE[m.type]) {
    case 'Line':
      entries.L = flat(P);
      entries.LE = m.type === 'dimension' ? [N('OpenArrow'), N('OpenArrow')] : [N('None'), N(m.type === 'arrow' ? 'OpenArrow' : 'None')];
      break;
    case 'PolyLine':
      // An arc is written as its curve; the three picked points stay in CTData.
      entries.Vertices = flat(m.type === 'arc' && P.length > 2 ? arcThrough(P[0], P[1], P[2]) : flattenPath(P, m.handles, false, 16));
      // Curves: PDF 2.0 /Path; /Vertices keeps a flattened copy for readers without it.
      if (hasCurves(m.handles)) entries.Path = pdfPath(P, m.handles, false, (p) => [p.x, p.y]);
      break;
    case 'Polygon':
      // Revu writes a radius as [arc start, center, arc end]; a full circle ends at its start.
      entries.Vertices = flat(m.type === 'radius' ? [P[1], P[0], P[2] ?? P[1]] : m.type === 'cloudplus' ? rectCorners(P[0], P[1]) : flattenPath(P, m.handles, true, 16));
      if (hasCurves(m.handles)) entries.Path = pdfPath(P, m.handles, true, (p) => [p.x, p.y]);
      if (m.type === 'cloud' || m.type === 'cloudplus') entries.BE = { S: 'C', I: 1 };
      break;
    case 'StrikeOut': case 'Underline': case 'Squiggly':
      entries.QuadPoints = quads(P);
      break;
    case 'Redact':
      entries.QuadPoints = quads(P);
      entries.IC = [0, 0, 0]; // fill colour once applied
      break;
    case 'Stamp': {
      const b = bounds(P);
      entries.Rect = [b.minX, b.minY, b.maxX, b.maxY];
      entries.Name = N(m.type === 'image' ? 'Image' : m.type === 'legend' ? 'Legend' : (m.text ?? 'Draft').replace(/[^A-Za-z0-9]+/g, ''));
      break;
    }
    case 'Link': {
      const b = bounds(P);
      entries.Rect = [b.minX, b.minY, b.maxX, b.maxY];
      entries.Border = [0, 0, 0];
      break;
    }
    case 'FileAttachment': {
      entries.Rect = [P[0].x, P[0].y - 18, P[0].x + 18, P[0].y];
      entries.Name = N('Paperclip');
      if (m.file) {
        const bytes = base64ToBytes(m.file.data);
        const ef = ctx.register(ctx.flateStream(bytes, { Type: 'EmbeddedFile', Params: { Size: bytes.length } }));
        entries.FS = ctx.obj({ Type: 'Filespec', F: PDFString.of(m.file.name), UF: PDFHexString.fromText(m.file.name), EF: { F: ef } });
      }
      break;
    }
    case 'Ink':
      entries.InkList = [flat(P)];
      break;
    case 'Highlight':
      entries.QuadPoints = quads(P.length > 2 ? P : [P[0], P[1]]);
      entries.C = hexToRgb(st.fill ?? st.color);
      break;
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
      const c = m.type === 'diameter' ? circleOf('diameter', P) : null;
      const box = c ? [{ x: c.x - c.r, y: c.y - c.r }, { x: c.x + c.r, y: c.y + c.r }] : P;
      const xs = box.map((p) => p.x), ys = box.map((p) => p.y);
      entries.RD = [
        Math.min(...xs) - bbox[0], Math.min(...ys) - bbox[1],
        bbox[2] - Math.max(...xs), bbox[3] - Math.max(...ys),
      ];
      break;
    }
    case 'Text':
      entries.Name = m.type === 'flag' ? 'Flag' : 'Comment';
      entries.Rect = [P[0].x, P[0].y - 20, P[0].x + 18, P[0].y];
      break;
  }
  // Hyperlinks, and any markup given an action with Edit Action (Revu).
  if (m.link?.uri) entries.A = { S: 'URI', URI: PDFString.of(m.link.uri) };
  else if (m.link?.file) entries.A = { S: 'GoToR', F: { Type: 'Filespec', F: PDFString.of(m.link.file), UF: PDFHexString.fromText(m.link.file) }, D: [m.link.page ?? 0, N('Fit')], NewWindow: false };
  else if (m.link?.dest) entries.A = { S: 'GoTo', D: /^[\x20-\x7e]*$/.test(m.link.dest) && !/[()\\]/.test(m.link.dest) ? PDFString.of(m.link.dest) : PDFHexString.fromText(m.link.dest) };
  else if (m.link?.page !== undefined && pageRefs[m.link.page]) {
    if (m.type === 'link') entries.Dest = [pageRefs[m.link.page], N('Fit')];
    else entries.A = { S: 'GoTo', D: [pageRefs[m.link.page], N('Fit')] };
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
  viewports?: Viewport[][];
  /** Pages whose scale or viewports changed; their /VP is rewritten. */
  dirtyCalibrations: Set<number>;
  spaces?: Space[][];
  /** Pages whose Spaces changed; their /BSISpaces is rewritten. */
  dirtySpaces?: Set<number>;
  /** Custom column definitions, when changed. */
  columns?: CustomColumn[];
  /** Form field values that changed, by field name. */
  formValues?: Record<string, FieldValue>;
  /** Layers, when the layer list changed. */
  layers?: LayerSet | null;
  /** Bookmarks, when they changed. */
  bookmarks?: Bookmark[];
}

/** A Revu-style /NM: 16 random capital letters. */
const randomNM = () => Array.from({ length: 16 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join('');

/**
 * Keys of an edited annotation that are derived from its geometry, style or
 * measurement and are written afresh; anything else the original carried
 * (Revu's /BSIColumnData custom column values, /GroupNesting,
 * other apps' private keys...) is kept when the markup is rewritten.
 */
const REGENERATED = new Set(['Type', 'Subtype', 'AP', 'AS', 'Rect', 'RD', 'Vertices', 'L', 'LL', 'LLE', 'LLO', 'CL', 'QuadPoints', 'InkList',
  'Path', 'Popup', 'Parent', 'IRT', 'RT', 'P', 'Measure', 'BBMeasure', 'Depth', 'DepthUnit', 'SlopeType', 'PitchRun', 'RiseDrop',
  'NumCounts', 'CountScale', 'CountStyle', 'MeasurementTypes', 'Contents', 'C', 'IC', 'CA', 'ca', 'BS', 'BE', 'Border', 'DS', 'RC', 'LE',
  'IT', 'M', 'Cap', 'CP', 'Q', 'MK', 'F', 'OC', COLUMNS_KEY, 'CTData']);

function carryOver(doc: PDFDocument, from: PDFRef, to: PDFRef) {
  const old = doc.context.lookup(from), fresh = doc.context.lookup(to);
  if (!(old instanceof PDFDict) || !(fresh instanceof PDFDict)) return;
  for (const [k, v] of old.entries()) {
    if (!fresh.has(k) && !REGENERATED.has(k.toString().slice(1))) fresh.set(k, v);
  }
}

export async function savePdf(input: SaveInput): Promise<Uint8Array> {
  const doc = await loadForUpdate(input.original);
  // Legends summarise other markups, so they are always rewritten with current totals.
  const unchanged = (m: Markup): m is Markup & { source: NonNullable<Markup['source']> } => !!m.source && !m.source.dirty && m.type !== 'legend';
  const keep = new Set(
    input.markups.filter(unchanged)
      .flatMap((m) => [m.source!, ...(m.source!.extraRefs ?? [])].map(refKey)),
  );
  const remove = new Set([...input.importedRefs].filter((r) => !keep.has(r)));
  const toWrite = input.markups.filter((m) => !unchanged(m));
  // Nothing edited: hand back the file exactly as it was.
  if (!remove.size && !toWrite.length && !(input.formValues && Object.keys(input.formValues).length) && !input.columns && input.layers === undefined && !input.bookmarks
    && !input.dirtySpaces?.size && !input.dirtyCalibrations.size) return input.original;
  // Signed files are saved as an incremental update so the signatures stay valid.
  const signed = hasSignatures(doc);
  for (let p = 0; p < doc.getPageCount(); p++) removeAnnots(doc, p, remove);

  // Layers first, so markups can point /OC at layers created in this session.
  const layerRefs = input.layers !== undefined ? writeLayers(doc, input.layers ?? { layers: {}, order: [], configs: [] }) : new Map<string, PDFRef>();
  if (input.bookmarks) writeBookmarks(doc, input.bookmarks);
  const layerRef = (id: string) => layerRefs.get(id) ?? (/^(\d+)R(\d*)$/.test(id) ? PDFRef.of(Number(id.split('R')[0]), Number(id.split('R')[1] || 0)) : undefined);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  if (input.formValues && Object.keys(input.formValues).length) writeFields(doc, input.formValues, font);
  const pageRefs = doc.getPages().map((pg) => pg.ref);
  // Groups are written as Revu writes them: members point to the first via /IRT with /RT /Group.
  const groupHead = new Map<string, PDFRef>();
  const pendingMembers: { ref: PDFRef; group: string }[] = [];
  for (const m of input.markups) {
    if (m.groupId && unchanged(m) && !groupHead.has(m.groupId)) {
      groupHead.set(m.groupId, PDFRef.of(m.source.objectNumber, m.source.generation));
    }
  }
  for (const m of toWrite) {
    let image: PDFRef | undefined;
    if (m.type === 'image' && m.image) {
      const [, mime, b64] = /^data:([^;]+);base64,(.*)$/.exec(m.image) ?? [];
      if (b64) {
        const bytes = base64ToBytes(b64);
        image = (mime === 'image/jpeg' ? await doc.embedJpg(bytes) : await doc.embedPng(bytes)).ref;
      }
    }
    const page = doc.getPage(m.page);
    let annots = page.node.lookup(N('Annots'));
    if (!(annots instanceof PDFArray)) {
      annots = doc.context.obj([]);
      page.node.set(N('Annots'), annots);
    }
    const rows = m.type === 'legend' && m.legend ? legendRows(m.legend, input.markups, m.page) : [];
    const built = buildAnnot(doc, font, m, input.pages[m.page], image, pageRefs, rows);
    if (m.source) carryOver(doc, PDFRef.of(m.source.objectNumber, m.source.generation), built[0]);
    const oc = m.layer ? layerRef(m.layer) : undefined;
    if (oc) for (const r of built) (doc.context.lookup(r) as PDFDict).set(N('OC'), oc);
    if (m.groupId) {
      if (!groupHead.has(m.groupId)) groupHead.set(m.groupId, built[0]);
      else pendingMembers.push({ ref: built[0], group: m.groupId });
    }
    // Replies: /Text annotations with /IRT to the markup, as other PDF apps write them.
    const head = doc.context.lookup(built[0]) as PDFDict;
    for (const r of m.replies ?? []) {
      const rect = head.lookup(N('Rect'));
      built.push(doc.context.register(doc.context.obj({
        Type: 'Annot', Subtype: 'Text', IRT: built[0], RT: 'R', Rect: rect ?? [0, 0, 18, 18], F: 4 | 8 | 16, Name: 'Comment',
        NM: PDFString.of(r.id), T: PDFHexString.fromText(r.author), Contents: PDFHexString.fromText(r.text),
        M: PDFString.of(pdfDate(new Date(r.date))), CreationDate: PDFString.of(pdfDate(new Date(r.date))),
        Subj: PDFHexString.fromText('Reply'),
      })));
    }
    for (const ref of built) {
      (annots as PDFArray).push(ref);
      // Markup annotations reference their page.
      (doc.context.lookup(ref) as PDFDict).set(N('P'), page.ref);
    }
  }

  for (const { ref, group } of pendingMembers) {
    const d = doc.context.lookup(ref) as PDFDict;
    d.set(N('IRT'), groupHead.get(group)!);
    d.set(N('RT'), N('Group'));
  }

  if (input.columns) {
    if (input.columns.length) doc.catalog.set(N(COLUMNS_KEY), PDFHexString.fromText(JSON.stringify(input.columns)));
    else doc.catalog.delete(N(COLUMNS_KEY));
  }

  // Spaces, nested the way Revu writes them: /Kids with /Parent back-links.
  for (const p of input.dirtySpaces ?? []) {
    const page = doc.getPage(p);
    const ctx = doc.context;
    const vp = input.pages[p].viewport;
    const build = (n: SpaceNode, parent?: PDFRef): PDFRef => {
      const ref = ctx.nextRef();
      const dict = ctx.obj({
        Type: 'Space',
        Title: /^[\x20-\x7e]*$/.test(n.space.title) ? PDFString.of(n.space.title) : PDFHexString.fromText(n.space.title),
        Path: n.space.points.map((q) => vp.convertToPdfPoint(q.x, q.y).map((v: number) => +v.toFixed(4))),
        C: hexToRgb(n.space.color),
        CA: n.space.opacity,
      }) as PDFDict;
      if (parent) dict.set(N('Parent'), parent);
      if (n.kids.length) dict.set(N('Kids'), ctx.obj(n.kids.map((k) => build(k, ref))));
      ctx.assign(ref, dict);
      return ref;
    };
    const roots = spaceTree(input.spaces?.[p] ?? []);
    if (roots.length) page.node.set(N('BSISpaces'), ctx.obj(roots.map((r) => build(r))));
    else page.node.delete(N('BSISpaces'));
  }

  for (const p of input.dirtyCalibrations) {
    const s = input.calibrations[p];
    const vps = input.viewports?.[p] ?? [];
    const page = doc.getPage(p);
    const ctx = doc.context;
    // Keep viewports we don't edit (e.g. geospatial ones).
    const old = page.node.lookup(N('VP'));
    const others = old instanceof PDFArray
      ? old.asArray().filter((o) => { const v = ctx.lookup(o); return v instanceof PDFDict && !isRulerViewport(doc, v); })
      : [];
    const entries: PDFObject[] = [];
    if (s) {
      // Page scale, as Revu writes it: the whole page, no /Name.
      const { x, y, width, height } = page.getMediaBox();
      entries.push(ctx.obj({ Type: 'Viewport', BBox: [x, y, x + width, y + height], Measure: writeMeasure(doc, s), NM: PDFString.of(randomNM()) }));
    }
    const vp = input.pages[p].viewport;
    for (const v of vps) {
      const [ax, ay] = vp.convertToPdfPoint(v.rect[0].x, v.rect[0].y);
      const [bx, by] = vp.convertToPdfPoint(v.rect[1].x, v.rect[1].y);
      entries.push(ctx.obj({
        Type: 'Viewport',
        BBox: [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)],
        Name: PDFHexString.fromText(v.name),
        Measure: writeMeasure(doc, v.scale),
        NM: PDFString.of(/^[A-Z]{16}$/.test(v.id) ? v.id : randomNM()),
      }));
    }
    entries.push(...others);
    if (entries.length) page.node.set(N('VP'), ctx.obj(entries));
    else page.node.delete(N('VP'));
  }
  return signed ? incrementalUpdate(input.original, doc) : doc.save({ useObjectStreams: false });
}
