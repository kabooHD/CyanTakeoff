// Sheet numbers on construction drawings (e.g. A-101, S2.01, M-3): found
// in the title block to label pages, and found in callouts to link sheets.
import type { TextBox } from '../ui/toolActions';

/** Typical sheet number: 1-3 letters, optional separator, 1-4 digits, optional .digits / letter suffix. */
export const SHEET_RE = /^[A-Z]{1,3}[-.]?\d{1,4}(?:\.\d{1,3})?[A-Z]?$/;

/**
 * The sheet number of a page: the largest text matching SHEET_RE in the
 * lower-right quarter (title block), else anywhere on the page.
 */
export function findSheetNumber(boxes: TextBox[], pageW: number, pageH: number): string | null {
  const cands = boxes
    .map((b) => ({ b, t: b.str.trim().toUpperCase() }))
    .filter(({ t }) => SHEET_RE.test(t) && /\d/.test(t));
  if (!cands.length) return null;
  const size = (b: TextBox) => Math.min(b.x1 - b.x0, b.y1 - b.y0);
  const inTitle = cands.filter(({ b }) => b.x0 > pageW * 0.6 && b.y0 > pageH * 0.6);
  const pool = inTitle.length ? inTitle : cands;
  return pool.sort((p, q) => size(q.b) - size(p.b))[0].t;
}

/** Text runs on a page that mention one of `labels` (whole word), with the label found. */
export function sheetReferences(boxes: TextBox[], labels: string[]): { box: TextBox; label: string }[] {
  const set = new Map(labels.filter(Boolean).map((l) => [l.toUpperCase(), l]));
  const out: { box: TextBox; label: string }[] = [];
  for (const b of boxes) {
    const words = b.str.toUpperCase().split(/[\s,;()/]+/).filter(Boolean);
    for (const w of words) {
      const hit = set.get(w);
      if (!hit) continue;
      // Narrow the box to the word within the run (proportional).
      const i = b.str.toUpperCase().indexOf(w), n = Math.max(1, b.str.length);
      const horiz = b.x1 - b.x0 >= b.y1 - b.y0;
      const box = horiz
        ? { ...b, x0: b.x0 + ((b.x1 - b.x0) * i) / n, x1: b.x0 + ((b.x1 - b.x0) * (i + w.length)) / n }
        : { ...b, y0: b.y1 - ((b.y1 - b.y0) * (i + w.length)) / n, y1: b.y1 - ((b.y1 - b.y0) * i) / n };
      out.push({ box, label: hit });
    }
  }
  return out;
}

/** A page region as fractions of the page (so it applies to pages of other sizes). */
export interface Region { x0: number; y0: number; x1: number; y1: number }

/**
 * AutoMark: the text in a region of a page, lines top to bottom, runs left
 * to right, whitespace collapsed. A run belongs to the region when its
 * centre is inside.
 */
export function textInRegion(boxes: TextBox[], r: Region, pageW: number, pageH: number): string {
  const X0 = Math.min(r.x0, r.x1) * pageW, X1 = Math.max(r.x0, r.x1) * pageW;
  const Y0 = Math.min(r.y0, r.y1) * pageH, Y1 = Math.max(r.y0, r.y1) * pageH;
  const inside = boxes.filter((b) => { const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2; return cx >= X0 && cx <= X1 && cy >= Y0 && cy <= Y1; });
  // Group into lines by vertical overlap.
  const lines: TextBox[][] = [];
  for (const b of [...inside].sort((p, q) => p.y0 - q.y0)) {
    const line = lines.find((l) => { const h = Math.min(l[0].y1 - l[0].y0, b.y1 - b.y0); return Math.abs((l[0].y0 + l[0].y1) / 2 - (b.y0 + b.y1) / 2) < h * 0.5; });
    if (line) line.push(b); else lines.push([b]);
  }
  return lines.map((l) => l.sort((p, q) => p.x0 - q.x0).map((b) => b.str.trim()).join(' ')).join(' ').replace(/\s+/g, ' ').trim();
}
