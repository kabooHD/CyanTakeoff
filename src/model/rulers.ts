// Rulers (View > Rulers, Ctrl+R) and the view history behind Previous /
// Next View (Alt+Left / Alt+Right).

export type RulerUnit = 'in' | 'cm' | 'mm' | 'pt' | 'pc';

/** Points per unit. */
export const RULER_UNITS: Record<RulerUnit, { label: string; pt: number }> = {
  in: { label: 'Inches', pt: 72 },
  cm: { label: 'Centimeters', pt: 72 / 2.54 },
  mm: { label: 'Millimeters', pt: 72 / 25.4 },
  pt: { label: 'Points', pt: 1 },
  pc: { label: 'Picas', pt: 12 },
};

export interface Tick { px: number; major: boolean; label?: string }

/**
 * Ticks for a ruler: `origin` is the screen position (px) of the page edge,
 * `pxPerPt` the zoom, `length` the ruler length in px. Labels count from the
 * page edge in `unit`; major ticks are at least ~60 px apart.
 */
export function rulerTicks(origin: number, length: number, pxPerPt: number, unit: RulerUnit): Tick[] {
  const pxPerUnit = pxPerPt * RULER_UNITS[unit].pt;
  if (!(pxPerUnit > 0)) return [];
  // Major step: 1, 2 or 5 × 10^k units, the smallest at least 60 px wide.
  let step = 10 ** Math.floor(Math.log10(60 / pxPerUnit));
  for (const m of [1, 2, 5, 10]) if (m * step * pxPerUnit >= 60) { step *= m; break; }
  const minor = [10, 5, 2].map((d) => step / d).find((m) => m * pxPerUnit >= 6) ?? step;
  const i0 = Math.ceil(-origin / pxPerUnit / minor - 1e-9);
  const per = Math.round(step / minor);
  const out: Tick[] = [];
  for (let i = i0; origin + i * minor * pxPerUnit <= length && out.length < 2000; i++) {
    const px = origin + i * minor * pxPerUnit;
    const major = i % per === 0;
    out.push(major ? { px, major, label: fmt((i / per) * step) } : { px, major });
  }
  return out;
}

const fmt = (v: number) => String(Math.round(v * 1e6) / 1e6);

/** A view to return to: document, page, zoom and the page point in the middle of the view. */
export interface ViewEntry { docId: string; page: number; zoom: number; cx: number; cy: number }

/** Previous / Next View: views are recorded as you move; going back then recording drops the forward views. */
export class ViewHistory {
  entries: ViewEntry[] = [];
  index = -1;
  constructor(private max = 100) {}
  /** Record the view now shown; the same page and zoom only updates the position. */
  record(v: ViewEntry) {
    const cur = this.entries[this.index];
    if (cur && cur.docId === v.docId && cur.page === v.page && Math.abs(cur.zoom / v.zoom - 1) < 1e-3) {
      this.entries[this.index] = v;
      return;
    }
    this.entries = [...this.entries.slice(0, this.index + 1), v].slice(-this.max);
    this.index = this.entries.length - 1;
  }
  back(): ViewEntry | undefined { return this.index > 0 ? this.entries[--this.index] : undefined; }
  forward(): ViewEntry | undefined { return this.index < this.entries.length - 1 ? this.entries[++this.index] : undefined; }
  get canBack() { return this.index > 0; }
  get canForward() { return this.index < this.entries.length - 1; }
  /** Forget views of a closed document. */
  drop(docId: string) {
    const keep = this.entries.map((e, i) => [e, i] as const).filter(([e]) => e.docId !== docId);
    this.index = Math.max(-1, keep.filter(([, i]) => i <= this.index).length - 1);
    this.entries = keep.map(([e]) => e);
  }
}
