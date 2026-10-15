// Batch Compare Documents / Overlay Pages (Revu): pages of the "current"
// files are paired with pages of the "revised" files by file name and
// page index, or by page label. A Match Filter narrows what part of the
// label is compared: "*" stands for non-numeric characters, "#" for
// numbers, "?" for a letter, ";" separates alternatives.

export interface SheetRef { docId: string; docName: string; page: number; label: string }
export type MatchBy = 'name-index' | 'label';

const baseName = (n: string) => n.replace(/\.pdf$/i, '').trim().toLowerCase();

/** The filter's patterns as regular expressions (empty filter: none). */
export function filterPatterns(filter: string): RegExp[] {
  return filter.split(';').map((f) => f.trim()).filter(Boolean).map((f) => {
    const src = f.split('').map((ch) => (ch === '*' ? '[^0-9]*' : ch === '#' ? '[0-9]+' : ch === '?' ? '[A-Za-z]' : ch.replace(/[.+^${}()|[\]\\]/g, '\\$&'))).join('');
    return new RegExp(src, 'i');
  });
}

/** The part of a label the pairing compares: the first match of a filter pattern, else the whole label. */
export function matchKey(label: string, filter: string): string {
  const pats = filterPatterns(filter);
  if (!pats.length) return label.trim().toLowerCase();
  for (const re of pats) {
    const m = re.exec(label);
    if (m && m[0]) return m[0].toLowerCase();
  }
  return '';
}

/** Pair current and revised sheets; unmatched sheets are left out. */
export function pairSheets(current: SheetRef[], revised: SheetRef[], by: MatchBy, filter = ''): { a: SheetRef; b: SheetRef }[] {
  const keyOf = (s: SheetRef) => (by === 'label' ? matchKey(s.label, filter) : `${matchKey(baseName(s.docName), filter)}#${s.page}`);
  const rev = new Map<string, SheetRef>();
  for (const s of revised) { const k = keyOf(s); if (k && !rev.has(k)) rev.set(k, s); }
  const out: { a: SheetRef; b: SheetRef }[] = [];
  for (const a of current) {
    const k = keyOf(a);
    const b = k ? rev.get(k) : undefined;
    if (!b || b.docId === a.docId && b.page === a.page) continue;
    out.push({ a, b });
    rev.delete(k);
  }
  return out;
}

/** The CSV report of a batch run. */
export function batchReportCsv(rows: { current: string; revised: string; result: string }[], what: string): string {
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
  return [`Current,Revised,${what}`, ...rows.map((r) => `${q(r.current)},${q(r.revised)},${q(r.result)}`)].join('\r\n');
}
