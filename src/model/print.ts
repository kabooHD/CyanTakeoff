// Print layout (Revu's Print dialog): which pages go on which sheet of
// paper, and where. Paper size Auto follows each page; page scaling None,
// Fit to Paper, Reduce to Paper or a custom percentage; several pages per
// sheet in a grid; auto-rotation turns a page to match the paper; copies,
// collate and reverse order. All sizes are in PDF points (1/72 inch).

export type Scaling = 'none' | 'fit' | 'reduce' | 'custom';
export type Orientation = 'portrait' | 'landscape';

export interface PaperSize { name: string; w: number; h: number }

const IN = 72, MM = 72 / 25.4;
/** Paper sizes offered by the dialog (width × height in portrait). */
export const PAPER_SIZES: PaperSize[] = [
  { name: 'Letter', w: 8.5 * IN, h: 11 * IN },
  { name: 'Legal', w: 8.5 * IN, h: 14 * IN },
  { name: 'Tabloid (11×17)', w: 11 * IN, h: 17 * IN },
  { name: 'ARCH C (18×24)', w: 18 * IN, h: 24 * IN },
  { name: 'ARCH D (24×36)', w: 24 * IN, h: 36 * IN },
  { name: 'ARCH E (36×48)', w: 36 * IN, h: 48 * IN },
  { name: 'ANSI D (22×34)', w: 22 * IN, h: 34 * IN },
  { name: 'A4', w: 210 * MM, h: 297 * MM },
  { name: 'A3', w: 297 * MM, h: 420 * MM },
  { name: 'A2', w: 420 * MM, h: 594 * MM },
  { name: 'A1', w: 594 * MM, h: 841 * MM },
  { name: 'A0', w: 841 * MM, h: 1189 * MM },
];

export interface PrintOptions {
  /** Paper size name, or 'auto' (each sheet the size of its page). */
  paper: string;
  orientation: Orientation;
  scaling: Scaling;
  /** Percentage for custom scaling. */
  customScale: number;
  /** Turn a page 90° when that fits the paper better. */
  autoRotate: boolean;
  /** Pages per sheet: 1, 2, 4, 6, 9 or 16. */
  perSheet: number;
  copies: number;
  collate: boolean;
  reverse: boolean;
}

export const DEFAULT_PRINT: PrintOptions = {
  paper: 'auto', orientation: 'portrait', scaling: 'fit', customScale: 100, autoRotate: true,
  perSheet: 1, copies: 1, collate: true, reverse: false,
};

/** A page placed on a sheet: its box on the sheet (top-left origin), scale, and rotation (0 or 90, clockwise). */
export interface Placed { page: number; x: number; y: number; w: number; h: number; scale: number; rotate: 0 | 90 }
export interface Sheet { w: number; h: number; items: Placed[] }

/** Grid (columns × rows) for n pages per sheet on a sheet of this shape. */
export function grid(n: number, landscape: boolean): [number, number] {
  const g: Record<number, [number, number]> = { 1: [1, 1], 2: [1, 2], 4: [2, 2], 6: [2, 3], 9: [3, 3], 16: [4, 4] };
  const [c, r] = g[n] ?? [1, 1];
  return landscape ? [r, c] : [c, r];
}

/** Order of the pages to print: reverse, then copies (collated: 1,2,3,1,2,3; else 1,1,2,2,3,3). */
export function printOrder(pages: number[], o: Pick<PrintOptions, 'copies' | 'collate' | 'reverse'>): number[] {
  const list = o.reverse ? [...pages].reverse() : pages;
  const n = Math.max(1, Math.floor(o.copies));
  return o.collate ? Array.from({ length: n }, () => list).flat() : list.flatMap((p) => Array(n).fill(p));
}

/** Scale of a w×h page inside a cell of cw×ch. */
function fitScale(w: number, h: number, cw: number, ch: number, o: PrintOptions): number {
  const fit = Math.min(cw / w, ch / h);
  if (o.scaling === 'fit') return fit;
  if (o.scaling === 'reduce') return Math.min(1, fit);
  if (o.scaling === 'custom') return Math.max(1, o.customScale) / 100;
  return 1;
}

/**
 * Lay out the pages (sizes in points, as displayed) onto sheets. Pages are
 * centred in their cell; pages larger than the paper at the chosen scale
 * are clipped by the paper, as in Revu.
 */
export function layoutSheets(sizes: { w: number; h: number }[], order: number[], o: PrintOptions): Sheet[] {
  const paper = PAPER_SIZES.find((p) => p.name === o.paper);
  const perSheet = paper ? Math.max(1, o.perSheet) : 1;
  const sheets: Sheet[] = [];
  for (let i = 0; i < order.length; i += perSheet) {
    const pages = order.slice(i, i + perSheet);
    let sw: number, sh: number;
    if (!paper) {
      const s = sizes[pages[0]];
      sw = s.w; sh = s.h;
    } else {
      [sw, sh] = o.orientation === 'landscape' ? [paper.h, paper.w] : [paper.w, paper.h];
    }
    const [cols, rows] = grid(perSheet, sw > sh);
    const cw = sw / cols, ch = sh / rows;
    const items = pages.map((page, k): Placed => {
      const { w, h } = sizes[page];
      // Auto-rotate when the page's shape is the opposite of its cell's.
      const rotate: 0 | 90 = paper && o.autoRotate && (w > h) !== (cw > ch) && Math.abs(w - h) > 1e-6 ? 90 : 0;
      const [rw, rh] = rotate ? [h, w] : [w, h];
      const scale = paper ? fitScale(rw, rh, cw, ch, o) : 1;
      const col = k % cols, row = Math.floor(k / cols);
      const x = col * cw + (cw - rw * scale) / 2, y = row * ch + (ch - rh * scale) / 2;
      return { page, x, y, w: rw * scale, h: rh * scale, scale, rotate };
    });
    sheets.push({ w: sw, h: sh, items });
  }
  return sheets;
}

/** Render resolution (dots per point) for a page, capped so a canvas stays under `maxPixels`. */
export function renderScale(w: number, h: number, scale: number, dpi: number, maxPixels = 16_777_216): number {
  const s = (scale * dpi) / 72;
  const px = w * h * s * s;
  return px > maxPixels ? Math.sqrt(maxPixels / (w * h)) : s;
}
