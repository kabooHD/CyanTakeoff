// Sets (Revu): sorting options and revision stacks. Sheets with the same
// base name and a revision suffix ("A-101", "A-101 R2", "A-101_B") are one
// stack; the latest revision is current, the others are previous.
import { filterPatterns } from './batchPairs';

export interface SetOptions {
  /** What names a sheet in the list. */
  show: 'label' | 'filename' | 'name-label' | 'sheetNumber' | 'sheetName';
  sortBy: 'label' | 'name-label' | 'name-index';
  order: 'alnum-asc' | 'alnum-desc' | 'alpha-asc' | 'alpha-desc';
  /** Revision detection: from the names (Auto), with a wildcard pattern, or none. */
  filter: 'auto' | 'wildcard' | 'off';
  pattern: string;
  /** How previous revisions are listed. */
  previous: 'hide' | 'gray' | 'strike' | 'show';
  /** Stack previous revisions under the current one (expand with the arrow). */
  stack: boolean;
}

export const DEFAULT_SET_OPTIONS: SetOptions = { show: 'label', sortBy: 'name-label', order: 'alnum-asc', filter: 'auto', pattern: '', previous: 'gray', stack: true };

export interface SetSheet {
  /** docName#page */
  key: string;
  docId: string;
  docName: string;
  page: number;
  label: string;
  sheetNumber?: string;
  sheetName?: string;
}

const stripExt = (s: string) => s.replace(/\.pdf$/i, '').trim();
const trimSep = (s: string) => s.replace(/^[\s_\-.]+|[\s_\-.]+$/g, '');

/** A name split into its base and revision suffix (null when it has none). */
export function splitRevision(name: string, o: Pick<SetOptions, 'filter' | 'pattern'>): { base: string; rev: string | null } {
  const n = stripExt(name);
  if (o.filter === 'off') return { base: n, rev: null };
  if (o.filter === 'wildcard') {
    for (const re of filterPatterns(o.pattern)) {
      const m = re.exec(n);
      if (m && m[0]) return { base: trimSep(n.slice(0, m.index) + n.slice(m.index + m[0].length)), rev: m[0] };
    }
    return { base: n, rev: null };
  }
  // Auto: "... rev 2", "...-R1", "... B", "..._2", "... (3)" after a base that holds a digit.
  const m = /^(.*?\d.*?)[\s_\-.]*(?:rev(?:ision)?|r)[\s_\-.]*([a-z0-9]{1,3})$/i.exec(n)
    ?? /^(.*?\d.*?)[\s_\-]+([A-Z]|\d{1,2})$/.exec(n)
    ?? /^(.*?)\s*\((\d+)\)$/.exec(n);
  return m ? { base: trimSep(m[1]), rev: m[2] } : { base: n, rev: null };
}

/** Older first: no revision, then numbers, then letters (both numeric-aware). */
export function compareRevisions(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  const na = /^\d+$/.test(a), nb = /^\d+$/.test(b);
  if (na && nb) return Number(a) - Number(b);
  if (na !== nb) return na ? -1 : 1;
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

export interface RevisionStack { base: string; sheets: SetSheet[]; latest: SetSheet }

/** The text revisions are read from: the page label, or the file name. */
const identity = (s: SetSheet, o: SetOptions) => (o.sortBy === 'label' ? s.label : s.docName);

/**
 * Sheets grouped into revision stacks (a sheet without siblings is a stack
 * of one), in the sheets' order. Revisions read from file names pair the
 * same page of each file, so the pages of one document never stack.
 */
export function stackRevisions(sheets: SetSheet[], o: SetOptions): RevisionStack[] {
  const groups = new Map<string, { base: string; items: { s: SetSheet; rev: string | null }[] }>();
  for (const s of sheets) {
    const { base, rev } = splitRevision(identity(s, o), o);
    const k = base.toLowerCase() + (o.sortBy === 'label' ? '' : `#${s.page}`);
    if (!groups.has(k)) groups.set(k, { base, items: [] });
    groups.get(k)!.items.push({ s, rev });
  }
  // Sheets that share a name without any revision suffix (the same file opened twice) are not revisions of each other.
  return [...groups.values()].flatMap((g) => {
    if (g.items.every((i) => i.rev === null)) return g.items.map((i) => ({ base: g.base, sheets: [i.s], latest: i.s }));
    const items = g.items.slice().sort((p, q) => compareRevisions(p.rev, q.rev));
    const sheets = items.map((i) => i.s);
    return [{ base: g.base, sheets, latest: sheets[sheets.length - 1] }];
  });
}

/** Keys of the previous revisions (everything but the latest of each stack). */
export const previousRevisions = (stacks: RevisionStack[]) => new Set(stacks.flatMap((st) => st.sheets.filter((s) => s !== st.latest).map((s) => s.key)));
export const latestRevisions = (stacks: RevisionStack[]) => new Set(stacks.map((st) => st.latest.key));

const cmp = (a: string, b: string, o: SetOptions) => {
  const r = o.order.startsWith('alnum') ? a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }) : a.localeCompare(b, undefined, { sensitivity: 'base' });
  return o.order.endsWith('desc') ? -r : r;
};

/** Sheets in the set's sort order. */
export function sortSheets(sheets: SetSheet[], o: SetOptions): SetSheet[] {
  return sheets.slice().sort((a, b) => {
    if (o.sortBy === 'label') return cmp(a.label, b.label, o) || cmp(a.docName, b.docName, o) || a.page - b.page;
    return cmp(a.docName, b.docName, o) || (o.sortBy === 'name-label' ? cmp(a.label, b.label, o) || a.page - b.page : a.page - b.page);
  });
}

/** What the list shows for a sheet. */
export function displayName(s: SetSheet, show: SetOptions['show']): string {
  switch (show) {
    case 'filename': return stripExt(s.docName);
    case 'name-label': return `${stripExt(s.docName)} · ${s.label}`;
    case 'sheetNumber': return s.sheetNumber || s.label;
    case 'sheetName': return s.sheetName ? `${s.sheetNumber || s.label} ${s.sheetName}` : s.label;
    default: return s.label;
  }
}
