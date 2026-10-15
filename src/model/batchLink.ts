// Batch Link (Revu): the search terms and their targets, link appearance,
// what to do where a link already exists, and the summary report.

export interface LinkTarget { docId: string; docName: string; page: number; label: string }
export type TermSource = 'label' | 'filename';
export type LinkAppearance = 'outline' | 'highlight' | 'none';
export type Overlap = 'skip' | 'replace';

export interface BatchLinkOptions {
  source: TermSource;
  appearance: LinkAppearance;
  color: string;
  overlap: Overlap;
  report: boolean;
}

export const DEFAULT_BATCH_LINK: BatchLinkOptions = { source: 'label', appearance: 'outline', color: '#ffd400', overlap: 'skip', report: false };

const stripExt = (s: string) => s.replace(/\.pdf$/i, '');

/**
 * The terms to look for and where they lead: every page label that is not
 * a plain number (Page Label), or every file's name leading to its first
 * page (Filename).
 */
export function linkTargets(docs: { id: string; name: string; labels: string[] }[], source: TermSource): LinkTarget[] {
  if (source === 'filename') return docs.map((d) => ({ docId: d.id, docName: d.name, page: 0, label: stripExt(d.name) })).filter((t) => t.label);
  return docs.flatMap((d) => d.labels.map((label, page) => ({ docId: d.id, docName: d.name, page, label })))
    .filter((t) => t.label && !/^\d+$/.test(t.label));
}

export interface LinkReportRow { document: string; page: string; created: number; replaced: number; note: string }

/** The Batch Link Summary as CSV: links created and replaced per page, pages skipped for lack of text. */
export function batchLinkReportCsv(rows: LinkReportRow[]): string {
  const esc = (v: string | number) => { const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const created = rows.reduce((n, r) => n + r.created, 0), replaced = rows.reduce((n, r) => n + r.replaced, 0), skipped = rows.filter((r) => r.note).length;
  return ['Document,Page,Links created,Links replaced,Note', ...rows.map((r) => [r.document, r.page, r.created, r.replaced, r.note].map(esc).join(',')),
    `Total,,${created},${replaced},${skipped} page(s) skipped`].join('\r\n');
}
