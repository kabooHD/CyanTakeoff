// Split Document (Revu): how a file's pages are divided into new files,
// by page count, by page ranges, at top-level bookmarks, or by file size.

export type SplitMode = 'count' | 'ranges' | 'bookmarks' | 'size';

export interface SplitOptions {
  mode: SplitMode;
  /** Pages per file (count). */
  every: number;
  /** Ranges like "1-3, 4, 7-9" (ranges); pages not listed are left out. */
  ranges: string;
  /** Largest file in MB (size); the file's byte size and page count give the estimate. */
  maxMb: number;
}

export interface SplitPart { pages: number[]; /** Name suffix for the file: a bookmark title or "part N". */ name: string }

/** Parses "1-3, 5" into 0-based page groups, one per range, clamped to the page count. */
export function parseRanges(text: string, n: number): number[][] {
  const out: number[][] = [];
  for (const tok of text.split(',').map((t) => t.trim()).filter(Boolean)) {
    const m = /^(\d+)\s*(?:-\s*(\d+))?$/.exec(tok);
    if (!m) continue;
    const a = Math.max(1, Number(m[1])), b = Math.min(n, Number(m[2] ?? m[1]));
    const pages: number[] = [];
    for (let p = a; p <= b; p++) pages.push(p - 1);
    if (pages.length) out.push(pages);
  }
  return out;
}

/**
 * The parts a document splits into. Bookmarks are the top-level ones with a
 * page, in page order; pages before the first bookmark form a part of their
 * own. By size, pages per file is estimated from the average page size.
 */
export function splitParts(n: number, o: SplitOptions, bookmarks: { title: string; page: number | null }[] = [], bytes = 0): SplitPart[] {
  const part = (pages: number[], i: number, name?: string): SplitPart => ({ pages, name: name || `part ${i + 1}` });
  if (o.mode === 'ranges') return parseRanges(o.ranges, n).map((pages, i) => part(pages, i, `pages ${pages[0] + 1}${pages.length > 1 ? `-${pages[pages.length - 1] + 1}` : ''}`));
  if (o.mode === 'bookmarks') {
    const marks = bookmarks.filter((b): b is { title: string; page: number } => b.page !== null && b.page >= 0 && b.page < n)
      .sort((a, b) => a.page - b.page)
      .filter((b, i, arr) => i === 0 || arr[i - 1].page !== b.page);
    if (!marks.length) return [part(Array.from({ length: n }, (_, i) => i), 0)];
    const out: SplitPart[] = [];
    if (marks[0].page > 0) out.push(part(Array.from({ length: marks[0].page }, (_, i) => i), 0));
    marks.forEach((b, i) => {
      const end = i + 1 < marks.length ? marks[i + 1].page : n;
      out.push(part(Array.from({ length: end - b.page }, (_, k) => b.page + k), out.length, b.title.trim()));
    });
    return out;
  }
  let every = Math.max(1, Math.floor(o.every) || 1);
  if (o.mode === 'size') {
    const perPage = n > 0 ? bytes / n : 0;
    every = perPage > 0 ? Math.max(1, Math.floor((o.maxMb * 1024 * 1024) / perPage)) : n;
  }
  const out: SplitPart[] = [];
  for (let i = 0; i < n; i += every) out.push(part(Array.from({ length: Math.min(every, n - i) }, (_, k) => i + k), out.length));
  return out;
}

/** A file name for a part, safe for downloads. */
export const partFileName = (base: string, p: SplitPart) => `${base} - ${p.name.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'part'}.pdf`.slice(0, 120);
