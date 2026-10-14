// Page labels (Revu Thumbnails > Number Pages, Create Page Labels): numerals
// in a style with a prefix over a page range, or labels from bookmarks.
import type { Bookmark } from '../pdf/bookmarks';
import { flatten } from './bookmarkTree';

export type NumberStyle = 'decimal' | 'roman-upper' | 'roman-lower' | 'alpha-upper' | 'alpha-lower' | 'none';
export const NUMBER_STYLES: { id: NumberStyle; name: string }[] = [
  { id: 'decimal', name: '1, 2, 3' }, { id: 'roman-upper', name: 'I, II, III' }, { id: 'roman-lower', name: 'i, ii, iii' },
  { id: 'alpha-upper', name: 'A, B, C' }, { id: 'alpha-lower', name: 'a, b, c' }, { id: 'none', name: 'None (prefix only)' },
];

function roman(n: number): string {
  if (n < 1) return String(n);
  const t: [number, string][] = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let out = '';
  for (const [v, s] of t) while (n >= v) { out += s; n -= v; }
  return out;
}
function alpha(n: number): string {
  // 1 = A … 26 = Z, 27 = AA (as PDF page labels do).
  if (n < 1) return String(n);
  const k = Math.ceil(n / 26);
  return String.fromCharCode(64 + ((n - 1) % 26) + 1).repeat(k);
}

/** The numeral for `n` in a style. */
export function numeral(style: NumberStyle, n: number): string {
  switch (style) {
    case 'decimal': return String(n);
    case 'roman-upper': return roman(n);
    case 'roman-lower': return roman(n).toLowerCase();
    case 'alpha-upper': return alpha(n);
    case 'alpha-lower': return alpha(n).toLowerCase();
    default: return '';
  }
}

/** Labels with `pages` (0-based, in order) renumbered from `start` in `style` after `prefix`. */
export function numberPages(labels: string[], pages: number[], style: NumberStyle, prefix: string, start: number): string[] {
  const out = [...labels];
  [...pages].sort((a, b) => a - b).forEach((p, i) => { if (p >= 0 && p < out.length) out[p] = `${prefix}${numeral(style, start + i)}`; });
  return out;
}

/** Labels of `pages` replaced by the title of the first bookmark pointing at each page. */
export function labelsFromBookmarks(labels: string[], bookmarks: Bookmark[], pages: number[]): string[] {
  const out = [...labels];
  const first = new Map<number, string>();
  for (const { b } of flatten(bookmarks)) if (b.page !== null && b.title.trim() && !first.has(b.page)) first.set(b.page, b.title.trim());
  for (const p of pages) { const t = first.get(p); if (t !== undefined) out[p] = t; }
  return out;
}
