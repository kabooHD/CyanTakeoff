// Form field layout (Revu Forms panel): the alignment toolbar for fields
// (the first selected field is the reference) and tab order helpers.
// Rectangles are PDF space [x0, y0, x1, y1] (y up).

export type Rect = [number, number, number, number];
export type AlignHow = 'left' | 'top' | 'right' | 'bottom' | 'center' | 'middle' | 'width' | 'height' | 'size' | 'centerDoc' | 'distributeH' | 'distributeV';

export const ALIGN_LABELS: Record<AlignHow, string> = {
  left: 'Align Left', top: 'Align Top', right: 'Align Right', bottom: 'Align Bottom', center: 'Align Center', middle: 'Align Middle',
  width: 'Align Width', height: 'Align Height', size: 'Align Size', centerDoc: 'Center in Document', distributeH: 'Distribute Horizontally', distributeV: 'Distribute Vertically',
};

const w = (r: Rect) => r[2] - r[0], h = (r: Rect) => r[3] - r[1];
const at = (r: Rect, x0: number, y0: number): Rect => [x0, y0, x0 + w(r), y0 + h(r)];

/** The rectangles after an alignment; `page` is the page size for Center in Document. */
export function alignRects(rects: Rect[], how: AlignHow, page: { width: number; height: number }): Rect[] {
  if (!rects.length) return rects;
  const ref = rects[0];
  const bounds = rects.reduce((b, r) => [Math.min(b[0], r[0]), Math.min(b[1], r[1]), Math.max(b[2], r[2]), Math.max(b[3], r[3])] as Rect, rects[0]);
  switch (how) {
    case 'left': return rects.map((r) => at(r, ref[0], r[1]));
    case 'right': return rects.map((r) => at(r, ref[2] - w(r), r[1]));
    case 'top': return rects.map((r) => at(r, r[0], ref[3] - h(r)));
    case 'bottom': return rects.map((r) => at(r, r[0], ref[1]));
    case 'center': return rects.map((r) => at(r, (ref[0] + ref[2]) / 2 - w(r) / 2, r[1]));
    case 'middle': return rects.map((r) => at(r, r[0], (ref[1] + ref[3]) / 2 - h(r) / 2));
    case 'width': return rects.map((r) => [r[0], r[1], r[0] + w(ref), r[3]]);
    case 'height': return rects.map((r) => [r[0], r[3] - h(ref), r[2], r[3]]);
    case 'size': return rects.map((r) => [r[0], r[3] - h(ref), r[0] + w(ref), r[3]]);
    case 'centerDoc': {
      const dx = page.width / 2 - (bounds[0] + bounds[2]) / 2, dy = page.height / 2 - (bounds[1] + bounds[3]) / 2;
      return rects.map((r) => at(r, r[0] + dx, r[1] + dy));
    }
    case 'distributeH': case 'distributeV': {
      if (rects.length < 3) return rects;
      const horizontal = how === 'distributeH';
      const order = rects.map((_, i) => i).sort((a, b) => (horizontal ? rects[a][0] - rects[b][0] : rects[b][3] - rects[a][3]));
      const total = horizontal ? bounds[2] - bounds[0] : bounds[3] - bounds[1];
      const used = rects.reduce((s, r) => s + (horizontal ? w(r) : h(r)), 0);
      const gap = (total - used) / (rects.length - 1);
      const out = rects.slice();
      let pos = horizontal ? bounds[0] : bounds[3];
      for (const i of order) {
        const r = rects[i];
        out[i] = horizontal ? at(r, pos, r[1]) : at(r, r[0], pos - h(r));
        pos += horizontal ? w(r) + gap : -(h(r) + gap);
      }
      return out;
    }
  }
}

/** Indexes of the widgets in reading order by row (top to bottom, then left to right) or by column. */
export function tabOrderIndexes(rects: Rect[], mode: 'R' | 'C'): number[] {
  const idx = rects.map((_, i) => i);
  const tol = 4;
  if (mode === 'R') return idx.sort((a, b) => (Math.abs(rects[b][3] - rects[a][3]) > tol ? rects[b][3] - rects[a][3] : rects[a][0] - rects[b][0]));
  return idx.sort((a, b) => (Math.abs(rects[a][0] - rects[b][0]) > tol ? rects[a][0] - rects[b][0] : rects[b][3] - rects[a][3]));
}

/** `list` with the item at `from` moved to `to`. */
export function moved<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const out = list.slice();
  const [it] = out.splice(from, 1);
  out.splice(to, 0, it);
  return out;
}
