// Print layout (Revu's Print dialog): which pages go on which sheet of
// paper, and where. Paper size Auto follows each page; page scaling None,
// Fit to Paper, Reduce to Paper or a custom percentage; several pages per
// sheet in a grid; auto-rotation turns a page to match the paper; copies,
// collate and reverse order; margins (Fit/Reduce to Margins keep the page
// inside them). All sizes are in PDF points (1/72 inch).

export type Scaling = 'none' | 'fit' | 'reduce' | 'custom' | 'fitMargins' | 'reduceMargins';
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
  /** Printer margins in points (top, right, bottom, left); Fit/Reduce to Margins stay inside them. */
  margins: [number, number, number, number];
  /** Centre each page in its cell (else top-left). */
  center: boolean;
  /** Several pages per sheet: filled across then down (rows) or down then across (columns), with a border around each page. */
  sheetOrder?: 'rows' | 'columns';
  border?: boolean;
}

/** Page range filters (Revu): by position or orientation. */
export type PageFilter = 'even' | 'odd' | 'landscape' | 'portrait' | 'first' | 'last';

/** The pages (0-based) kept by a filter; `sizes` gives each page's size for the orientation filters. */
export function filterPages(pages: number[], filter: PageFilter, sizes: { w: number; h: number }[]): number[] {
  switch (filter) {
    case 'even': return pages.filter((p) => (p + 1) % 2 === 0);
    case 'odd': return pages.filter((p) => (p + 1) % 2 === 1);
    case 'landscape': return pages.filter((p) => sizes[p] && sizes[p].w > sizes[p].h);
    case 'portrait': return pages.filter((p) => sizes[p] && sizes[p].w <= sizes[p].h);
    case 'first': return pages.slice(0, 1);
    case 'last': return pages.slice(-1);
  }
}

export const DEFAULT_PRINT: PrintOptions = {
  paper: 'auto', orientation: 'portrait', scaling: 'fit', customScale: 100, autoRotate: true,
  perSheet: 1, copies: 1, collate: true, reverse: false, margins: [18, 18, 18, 18], center: true,
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

/** Scale of a w×h page inside a cell of cw×ch (iw×ih is the cell inside the margins). */
function fitScale(w: number, h: number, cw: number, ch: number, iw: number, ih: number, o: PrintOptions): number {
  const fit = Math.min(cw / w, ch / h), fitM = Math.min(iw / w, ih / h);
  if (o.scaling === 'fit') return fit;
  if (o.scaling === 'reduce') return Math.min(1, fit);
  if (o.scaling === 'fitMargins') return fitM;
  if (o.scaling === 'reduceMargins') return Math.min(1, fitM);
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
    // Margins apply to the sheet; inside a grid, each cell keeps its share of them.
    const [mt, mr, mb, ml] = paper ? (o.margins ?? [0, 0, 0, 0]).map((m) => Math.max(0, m)) : [0, 0, 0, 0];
    const iw = Math.max(1, cw - (ml + mr) / cols), ih = Math.max(1, ch - (mt + mb) / rows);
    const toMargins = o.scaling === 'fitMargins' || o.scaling === 'reduceMargins';
    const items = pages.map((page, k): Placed => {
      const { w, h } = sizes[page];
      // Auto-rotate when the page's shape is the opposite of its cell's.
      const rotate: 0 | 90 = paper && o.autoRotate && (w > h) !== (cw > ch) && Math.abs(w - h) > 1e-6 ? 90 : 0;
      const [rw, rh] = rotate ? [h, w] : [w, h];
      const scale = paper ? fitScale(rw, rh, cw, ch, iw, ih, o) : 1;
      const col = o.sheetOrder === 'columns' ? Math.floor(k / rows) : k % cols, row = o.sheetOrder === 'columns' ? k % rows : Math.floor(k / cols);
      // The box the page is placed in: the cell, or the cell inside the margins.
      const bx = col * cw + (toMargins ? ml / cols : 0), by = row * ch + (toMargins ? mt / rows : 0);
      const bw = toMargins ? iw : cw, bh = toMargins ? ih : ch;
      const center = o.center ?? true;
      const x = bx + (center ? (bw - rw * scale) / 2 : 0), y = by + (center ? (bh - rh * scale) / 2 : 0);
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

/** Where a Note's pop-up prints (Print Pop-Ups): its box and the comment wrapped into lines. */
export interface PopupBox { x: number; y: number; w: number; h: number; lines: string[] }

/** Words wrapped to at most `chars` characters a line (a longer word gets a line of its own). */
export function wrapWords(text: string, chars: number): string[] {
  const out: string[] = [];
  for (const para of text.replace(/\r/g, '').split('\n')) {
    let line = '';
    for (const w of para.split(/\s+/).filter(Boolean)) {
      if (!line) line = w;
      else if ((line + ' ' + w).length <= chars) line += ' ' + w;
      else { out.push(line); line = w; }
    }
    out.push(line);
  }
  return out;
}

/**
 * The pop-up of a note at `at` (page space, points): to the right of the
 * icon, or to its left when there is no room, kept inside the page; a
 * header line (author and date) above the wrapped comment.
 */
export function popupLayout(at: { x: number; y: number }, comment: string, page: { w: number; h: number }, width = 180, lineH = 13, chars = 30): PopupBox {
  const lines = wrapWords(comment, chars).slice(0, 40);
  const h = lineH * (lines.length + 1) + 8;
  let x = at.x + 22;
  if (x + width > page.w) x = at.x - 4 - width;
  x = Math.max(0, Math.min(x, Math.max(0, page.w - width)));
  const y = Math.max(0, Math.min(at.y, Math.max(0, page.h - h)));
  return { x, y, w: width, h, lines };
}
