// Flags panel (Revu): a list for jumping to pages and places. Linked flags
// are Flag markups (their title and colour come from the markup); unlinked
// flags live only in the panel and carry an action of their own.
import type { Markup } from './types';

export type FlagAction =
  | { kind: 'page'; page: number; zoom?: number }
  | { kind: 'place'; name: string }
  | { kind: 'space'; id: string }
  | { kind: 'snapshot'; page: number; rect: [number, number, number, number] }
  | { kind: 'uri'; uri: string }
  | { kind: 'file'; file: string; page?: number };

export interface UnlinkedFlag {
  id: string;
  title: string;
  /** The page the flag is listed under. */
  page: number;
  color: string;
  bold?: boolean;
  italic?: boolean;
  action: FlagAction;
}

export interface FlagRow {
  id: string;
  title: string;
  page: number;
  color: string;
  bold?: boolean;
  italic?: boolean;
  /** The Flag markup of a linked flag. */
  markup?: Markup;
  unlinked?: UnlinkedFlag;
}

/** The title shown for a Flag markup: its label, else its comment's first line, else the subject. */
export const flagTitle = (m: Markup): string => m.label || m.comment.split('\n')[0] || m.subject || 'Flag';

/** All flags of a document in page order; linked ones before unlinked ones on the same page. */
export function flagRows(markups: Markup[], unlinked: UnlinkedFlag[]): FlagRow[] {
  const linked: FlagRow[] = markups.filter((m) => m.type === 'flag' && !m.hidden).map((m) => ({ id: m.id, title: flagTitle(m), page: m.page, color: m.style.color, markup: m }));
  const own: FlagRow[] = unlinked.map((f) => ({ id: f.id, title: f.title, page: f.page, color: f.color, bold: f.bold, italic: f.italic, unlinked: f }));
  return [...linked, ...own].sort((a, b) => a.page - b.page || Number(!!a.unlinked) - Number(!!b.unlinked));
}

/** Pages that carry at least one flag (for the thumbnail indicator). */
export function flaggedPages(markups: Markup[], unlinked: UnlinkedFlag[]): Set<number> {
  return new Set(flagRows(markups, unlinked).map((r) => r.page));
}

/** Describe an action in a few words. */
export function describeAction(a: FlagAction, labels: (page: number) => string): string {
  switch (a.kind) {
    case 'page': return `Page ${labels(a.page)}${a.zoom ? ` at ${Math.round(a.zoom * 100)}%` : ''}`;
    case 'place': return `Place: ${a.name}`;
    case 'space': return 'Space';
    case 'snapshot': return `View on page ${labels(a.page)}`;
    case 'uri': return a.uri;
    case 'file': return `${a.file}${a.page !== undefined ? `, page ${a.page + 1}` : ''}`;
  }
}
