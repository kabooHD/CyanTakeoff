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
