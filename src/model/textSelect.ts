// Select Text (Revu, Shift+T): the text runs a dragged rectangle touches,
// in reading order, as copyable text and highlight rectangles.
import type { Pt } from './types';

export interface TextRun { x0: number; y0: number; x1: number; y1: number; str: string }
export interface TextSelection { rects: [Pt, Pt][]; text: string }

/** Text inside the rectangle a-b (all of it when a and b are omitted). */
export function selectText(runs: TextRun[], a?: Pt, b?: Pt): TextSelection {
  const x0 = a && b ? Math.min(a.x, b.x) : -Infinity, x1 = a && b ? Math.max(a.x, b.x) : Infinity;
  const y0 = a && b ? Math.min(a.y, b.y) : -Infinity, y1 = a && b ? Math.max(a.y, b.y) : Infinity;
  const hit = runs.filter((t) => t.x1 >= x0 && t.x0 <= x1 && t.y1 >= y0 && t.y0 <= y1);
  // Group into lines by vertical overlap, then read each line left to right.
  const lines: { y0: number; y1: number; runs: TextRun[] }[] = [];
  for (const t of [...hit].sort((p, q) => p.y0 - q.y0)) {
    const mid = (t.y0 + t.y1) / 2;
    const l = lines.find((q) => mid > q.y0 && mid < q.y1);
    if (l) { l.runs.push(t); l.y0 = Math.min(l.y0, t.y0); l.y1 = Math.max(l.y1, t.y1); }
    else lines.push({ y0: t.y0, y1: t.y1, runs: [t] });
  }
  lines.sort((p, q) => p.y0 - q.y0);
  const rects: [Pt, Pt][] = [];
  const text = lines.map((l) => {
    const rs = l.runs.sort((p, q) => p.x0 - q.x0);
    const h = l.y1 - l.y0;
    let s = '', last: TextRun | null = null;
    let seg: [Pt, Pt] | null = null;
    for (const r of rs) {
      // A gap wider than a fraction of the line height is a space; a wide gap starts a new highlight.
      if (last) s += r.x0 - last.x1 > h * 0.15 && !/\s$/.test(s) && !/^\s/.test(r.str) ? ' ' : '';
      s += r.str;
      if (seg && r.x0 - seg[1].x < h * 2) seg[1] = { x: Math.max(seg[1].x, r.x1), y: l.y1 };
      else { if (seg) rects.push(seg); seg = [{ x: r.x0, y: l.y0 }, { x: r.x1, y: l.y1 }]; }
      last = r;
    }
    if (seg) rects.push(seg);
    return s.trimEnd();
  }).join('\n');
  return { rects, text };
}

/** `str` with each [index, length) range replaced by `by` (ranges may come in any order; overlaps are skipped). */
export function replaceRanges(str: string, ranges: { index: number; len: number }[], by: string): string {
  let out = str, lastStart = Infinity;
  for (const r of [...ranges].sort((a, b) => b.index - a.index)) {
    if (r.index + r.len > lastStart) continue;
    out = out.slice(0, r.index) + by + out.slice(r.index + r.len);
    lastStart = r.index;
  }
  return out;
}
