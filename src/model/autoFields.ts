// Automatically Create Form Fields (Revu: Tools > Form): form-like
// content on a page becomes fields. Boxes drawn in the content become text
// fields (small squares: check boxes; tall boxes: multiline), circles
// become radio buttons, and a box labelled "Signature" a signature field.
// Fields are named after the text beside or above them.
import type { TextBox } from '../ui/toolActions';

export interface Box { x0: number; y0: number; x1: number; y1: number }
export interface DetectedField {
  type: 'text' | 'checkbox' | 'radio' | 'signature';
  name: string;
  /** Page space (y down). */
  rect: Box;
  multiline?: boolean;
  /** Radio: the value this button sets. */
  option?: string;
}

const EPS = 1.5;
const near = (a: number, b: number, eps = EPS) => Math.abs(a - b) <= eps;

/** Axis-aligned rectangles made of four stroked segments (flattened x1,y1,x2,y2). */
export function findBoxes(segments: ArrayLike<number>): Box[] {
  const hs: [number, number, number, number][] = [], vs: [number, number, number, number][] = [];
  for (let i = 0; i + 3 < segments.length; i += 4) {
    const x1 = segments[i], y1 = segments[i + 1], x2 = segments[i + 2], y2 = segments[i + 3];
    if (near(y1, y2, 0.5) && Math.abs(x2 - x1) >= 4) hs.push([Math.min(x1, x2), y1, Math.max(x1, x2), y1]);
    else if (near(x1, x2, 0.5) && Math.abs(y2 - y1) >= 4) vs.push([x1, Math.min(y1, y2), x1, Math.max(y1, y2)]);
  }
  const out: Box[] = [];
  const seen = new Set<string>();
  for (const top of hs) {
    for (const bottom of hs) {
      if (bottom === top || bottom[1] <= top[1] + 3 || !near(bottom[0], top[0]) || !near(bottom[2], top[2])) continue;
      const left = vs.find((v) => near(v[0], top[0]) && near(v[1], top[1]) && near(v[3], bottom[1]));
      const right = vs.find((v) => near(v[0], top[2]) && near(v[1], top[1]) && near(v[3], bottom[1]));
      if (!left || !right) continue;
      const b = { x0: top[0], y0: top[1], x1: top[2], y1: bottom[1] };
      const k = [b.x0, b.y0, b.x1, b.y1].map((v) => Math.round(v)).join(',');
      if (!seen.has(k)) { seen.add(k); out.push(b); }
    }
  }
  return out;
}

/** Small closed loops of curve chords (flattened x1,y1,x2,y2 in path order) that are round: radio buttons. */
export function findCircles(curves: ArrayLike<number>, maxSize = 30): Box[] {
  const out: Box[] = [];
  let loop: [number, number][] = [];
  const flush = () => {
    if (loop.length >= 8) {
      const xs = loop.map((p) => p[0]), ys = loop.map((p) => p[1]);
      const b = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
      const w = b.x1 - b.x0, h = b.y1 - b.y0;
      if (w >= 5 && w <= maxSize && near(w, h, Math.max(1, w * 0.15))) {
        const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, r = (w + h) / 4;
        if (loop.every((p) => near(Math.hypot(p[0] - cx, p[1] - cy), r, Math.max(1, r * 0.2)))) out.push(b);
      }
    }
    loop = [];
  };
  for (let i = 0; i + 3 < curves.length; i += 4) {
    const a: [number, number] = [curves[i], curves[i + 1]], c: [number, number] = [curves[i + 2], curves[i + 3]];
    const last = loop[loop.length - 1];
    if (!last || !near(last[0], a[0], 0.3) || !near(last[1], a[1], 0.3)) { flush(); loop.push(a); }
    loop.push(c);
    const first = loop[0];
    if (loop.length > 2 && near(c[0], first[0], 0.3) && near(c[1], first[1], 0.3)) flush();
  }
  flush();
  return out;
}

const inside = (p: { x: number; y: number }, b: Box, pad = 0) => p.x >= b.x0 - pad && p.x <= b.x1 + pad && p.y >= b.y0 - pad && p.y <= b.y1 + pad;
const centre = (t: TextBox) => ({ x: (t.x0 + t.x1) / 2, y: (t.y0 + t.y1) / 2 });
const overlapX = (b: Box, t: TextBox) => Math.min(b.x1, t.x1) - Math.max(b.x0, t.x0);

/** The text that labels a box: the nearest run to its left on the same line, else the nearest run just above it. */
export function labelFor(b: Box, texts: TextBox[], used = new Set<TextBox>()): TextBox | null {
  const h = b.y1 - b.y0;
  const lefts = texts.filter((t) => !used.has(t) && t.x1 <= b.x0 + 2 && b.x0 - t.x1 <= Math.max(40, h * 2) && centre(t).y >= b.y0 - 2 && centre(t).y <= b.y1 + 2)
    .sort((p, q) => (b.x0 - p.x1) - (b.x0 - q.x1));
  if (lefts.length) return lefts[0];
  const aboves = texts.filter((t) => !used.has(t) && t.y1 <= b.y0 + 2 && b.y0 - t.y1 <= 24 && overlapX(b, t) > 0)
    .sort((p, q) => (b.y0 - p.y1) - (b.y0 - q.y1));
  return aboves[0] ?? null;
}

/** A field name from a label: trailing colons and punctuation dropped, spaces kept. */
export const nameFromLabel = (s: string) => s.replace(/[:：*#.]+\s*$/u, '').replace(/[^\p{L}\p{N} _\-/]+/gu, ' ').replace(/\s+/g, ' ').trim();

/** The fields found on a page from its boxes, circles and text runs (`skip`: areas already holding fields). */
export function detectFields(boxes: Box[], circles: Box[], texts: TextBox[], skip: Box[] = []): DetectedField[] {
  const out: DetectedField[] = [];
  const used = new Set<TextBox>();
  const names = new Map<string, number>();
  const unique = (base: string) => {
    const b = base || 'Field';
    const n = names.get(b) ?? 0;
    names.set(b, n + 1);
    return n ? `${b} ${n + 1}` : b;
  };
  const taken = (b: Box) => skip.some((s) => inside({ x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 }, s));
  // Outer frames (holding other boxes) and boxes with text inside are not fields.
  const fieldBoxes = boxes.filter((b) => {
    const w = b.x1 - b.x0, h = b.y1 - b.y0;
    if (w < 6 || h < 6 || taken(b)) return false;
    if (boxes.some((o) => o !== b && o.x0 >= b.x0 - 1 && o.x1 <= b.x1 + 1 && o.y0 >= b.y0 - 1 && o.y1 <= b.y1 + 1 && (o.x1 - o.x0) * (o.y1 - o.y0) < w * h * 0.9)) return false;
    return !texts.some((t) => inside(centre(t), b, -1));
  }).sort((p, q) => p.y0 - q.y0 || p.x0 - q.x0);
  for (const b of fieldBoxes) {
    const w = b.x1 - b.x0, h = b.y1 - b.y0;
    const square = w <= 24 && h <= 24 && near(w, h, 3);
    let label = labelFor(b, texts, used);
    if (square && !label) {
      // A check box is usually labelled on its right.
      label = texts.filter((t) => !used.has(t) && t.x0 >= b.x1 - 2 && t.x0 - b.x1 <= 30 && centre(t).y >= b.y0 - 2 && centre(t).y <= b.y1 + 2).sort((p, q) => p.x0 - q.x0)[0] ?? null;
    }
    if (label) used.add(label);
    const text = label ? nameFromLabel(label.str) : '';
    if (square) { out.push({ type: 'checkbox', name: unique(text || 'Check Box'), rect: b }); continue; }
    if (/\bsign(ature|ed)?\b/i.test(text)) { out.push({ type: 'signature', name: unique(text || 'Signature'), rect: b }); continue; }
    out.push({ type: 'text', name: unique(text || (/\bdate\b/i.test(text) ? 'Date' : 'Text')), rect: b, multiline: h > 30 || undefined });
  }
  // Radio buttons: circles in a column or row share a group named by the text above the first one; each takes the text on its right.
  const groups: Box[][] = [];
  for (const c of circles.filter((c) => !taken(c)).sort((p, q) => p.y0 - q.y0 || p.x0 - q.x0)) {
    const g = groups.find((grp) => grp.some((o) => (near(o.x0, c.x0, 3) && Math.abs(o.y0 - c.y0) <= 40) || (near(o.y0, c.y0, 3) && Math.abs(o.x0 - c.x0) <= 120)));
    if (g) g.push(c); else groups.push([c]);
  }
  groups.forEach((g, gi) => {
    const first = g[0];
    const above = texts.filter((t) => !used.has(t) && t.y1 <= first.y0 + 2 && first.y0 - t.y1 <= 30 && t.x0 <= first.x1 + 20 && t.x1 >= first.x0 - 60).sort((p, q) => (first.y0 - p.y1) - (first.y0 - q.y1))[0];
    const left = texts.filter((t) => !used.has(t) && t.x1 <= first.x0 + 2 && first.x0 - t.x1 <= 40 && centre(t).y >= first.y0 - 2 && centre(t).y <= first.y1 + 2)[0];
    const title = above ?? left;
    if (title) used.add(title);
    const group = unique(title ? nameFromLabel(title.str) : `Choice${groups.length > 1 ? ` ${gi + 1}` : ''}`);
    g.forEach((c, i) => {
      const t = texts.filter((t) => !used.has(t) && t.x0 >= c.x1 - 2 && t.x0 - c.x1 <= 30 && centre(t).y >= c.y0 - 2 && centre(t).y <= c.y1 + 2).sort((p, q) => p.x0 - q.x0)[0];
      if (t) used.add(t);
      out.push({ type: 'radio', name: group, rect: c, option: t ? nameFromLabel(t.str) : `Choice${i + 1}` });
    });
  });
  return out;
}
