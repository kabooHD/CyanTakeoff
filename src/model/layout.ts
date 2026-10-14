// Page layout for Revu's view modes (Single Page, Continuous, Side by Side,
// Continuous Side by Side) and Rotate View. Pure functions: sizes in screen
// pixels, page boxes already rotated by the view rotation.

export type ViewMode = 'single' | 'continuous' | 'side' | 'continuous-side';
export type ViewRotation = 0 | 90 | 180 | 270;

export interface Slot { index: number; x: number; y: number; w: number; h: number }

export const GAP = 12;

/** Pages shown by the view: all of them in continuous modes, else the current page (or its pair). */
export function shownPages(mode: ViewMode, count: number, current: number, cover = false): number[] {
  if (mode === 'continuous' || mode === 'continuous-side') return Array.from({ length: count }, (_, i) => i);
  if (mode === 'side') {
    // With a cover page the first page stands alone and the pairs are 2-3, 4-5…
    if (cover && current === 0) return [0];
    const first = cover ? current - ((current + 1) % 2) : current - (current % 2);
    return first + 1 < count ? [first, first + 1] : [first];
  }
  return [current];
}

/**
 * Lay out pages of size `sizes[i]` (screen px, rotated) for `mode`.
 * Rows are centred horizontally; side-by-side rows put pages 1-2, 3-4...
 * next to each other. `pad` is the margin round the whole layout.
 */
export function layoutPages(sizes: { w: number; h: number }[], mode: ViewMode, current: number, pad: number, view: { w: number; h: number }, cover = false) {
  const shown = shownPages(mode, sizes.length, current, cover);
  const pairs = mode === 'side' || mode === 'continuous-side';
  const rows: number[][] = [];
  // A cover page takes a row of its own (Show Cover Page in Side-by-Side).
  const rest = pairs && cover && shown[0] === 0 && shown.length > 1 ? (rows.push([0]), shown.slice(1)) : shown;
  for (let i = 0; i < rest.length; i += pairs ? 2 : 1) rows.push(rest.slice(i, i + (pairs ? 2 : 1)));
  const rowW = rows.map((r) => r.reduce((s, i) => s + sizes[i].w, 0) + GAP * (r.length - 1));
  const rowH = rows.map((r) => Math.max(...r.map((i) => sizes[i].h)));
  const contentW = Math.max(...rowW);
  const contentH = rowH.reduce((s, h) => s + h, 0) + GAP * (rows.length - 1);
  const innerW = Math.max(view.w, contentW + pad * 2), innerH = Math.max(view.h, contentH + pad * 2);
  const slots: Slot[] = [];
  let y = (innerH - contentH) / 2;
  rows.forEach((r, k) => {
    let x = (innerW - rowW[k]) / 2;
    for (const i of r) {
      // Pages of a pair meet in the middle: each is centred vertically in its row.
      slots.push({ index: i, x, y: y + (rowH[k] - sizes[i].h) / 2, w: sizes[i].w, h: sizes[i].h });
      x += sizes[i].w + GAP;
    }
    y += rowH[k] + GAP;
  });
  return { slots, innerW, innerH };
}

/** The slot containing point (x, y) of the layout, else the nearest one vertically. */
export function slotAt(slots: Slot[], x: number, y: number): Slot | undefined {
  const inside = slots.find((s) => x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h);
  if (inside) return inside;
  let best: Slot | undefined, bd = Infinity;
  for (const s of slots) {
    const d = Math.abs(y - (s.y + s.h / 2)) + Math.abs(x - (s.x + s.w / 2)) * 0.01;
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}

/** Size of a page box of `w` x `h` once the view is rotated. */
export const rotatedSize = (w: number, h: number, r: ViewRotation) => (r % 180 ? { w: h, h: w } : { w, h });

/**
 * Map unrotated page pixels (u, v) of a `pw` x `ph` page to the rotated
 * box's pixels: CSS `rotate(r)` (clockwise) about the top-left, then shifted
 * back into positive coordinates.
 */
export function rotateOut(u: number, v: number, pw: number, ph: number, r: ViewRotation): { x: number; y: number } {
  if (r === 90) return { x: ph - v, y: u };
  if (r === 180) return { x: pw - u, y: ph - v };
  if (r === 270) return { x: v, y: pw - u };
  return { x: u, y: v };
}

/** Inverse of rotateOut: rotated box pixels back to page pixels. */
export function rotateIn(x: number, y: number, pw: number, ph: number, r: ViewRotation): { x: number; y: number } {
  if (r === 90) return { x: y, y: ph - x };
  if (r === 180) return { x: pw - x, y: ph - y };
  if (r === 270) return { x: pw - y, y: x };
  return { x, y };
}

/** CSS transform placing a `pw` x `ph` page element rotated by `r` inside its slot. */
export function rotateCss(pw: number, ph: number, r: ViewRotation): string | undefined {
  if (!r) return undefined;
  const t = r === 90 ? `translate(${ph}px,0)` : r === 180 ? `translate(${pw}px,${ph}px)` : `translate(0,${pw}px)`;
  return `${t} rotate(${r}deg)`;
}
