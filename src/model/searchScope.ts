// Search panel scopes beyond the page text (Revu: Search Markups, Search
// Form Fields, Search File Properties) and the "Check Options" that act on
// the checked results. Pure helpers; the panel renders the hits.
import type { Markup, Pt } from './types';

export interface ScopeHit {
  kind: 'markup' | 'field' | 'property';
  /** Page of the hit; -1 for a document property. */
  page: number;
  rect: [Pt, Pt];
  context: string;
  /** The markup found (Search Markups): clicking the result selects it. */
  markupId?: string;
}

/** A regular expression for the query, as the text search builds it. */
export function queryRegExp(query: string, matchCase: boolean, wholeWord: boolean): RegExp {
  const esc = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(wholeWord ? `\\b${esc}\\b` : esc, matchCase ? 'i'.replace('i', '') : 'i');
}

const first = (s: string, re: RegExp, around = 40) => {
  const m = re.exec(s);
  if (!m) return null;
  const a = Math.max(0, m.index - around), z = Math.min(s.length, m.index + m[0].length + around);
  return `${a > 0 ? '…' : ''}${s.slice(a, z).replace(/\s+/g, ' ')}${z < s.length ? '…' : ''}`;
};

/** Markups whose subject, label or comment matches. */
export function searchMarkups(markups: Markup[], re: RegExp, boundsOf: (m: Markup) => { minX: number; minY: number; maxX: number; maxY: number }): ScopeHit[] {
  const out: ScopeHit[] = [];
  for (const m of markups) {
    if (m.hidden) continue;
    const text = [m.subject, m.label, m.comment].filter(Boolean).join(' · ');
    const ctx = first(text, re);
    if (ctx === null) continue;
    const b = boundsOf(m);
    out.push({ kind: 'markup', page: m.page, rect: [{ x: b.minX, y: b.minY }, { x: b.maxX, y: b.maxY }], context: ctx, markupId: m.id });
  }
  return out;
}

export interface FieldLike { name: string; value: unknown; widgets: { page: number; rect: [number, number, number, number] }[] }

/** Form fields whose name or value matches (the first widget places the hit; `rect` is already in page space). */
export function searchFields(fields: FieldLike[], values: Record<string, unknown>, re: RegExp): ScopeHit[] {
  const out: ScopeHit[] = [];
  for (const f of fields) {
    const v = values[f.name] ?? f.value;
    const text = `${f.name}: ${typeof v === 'boolean' ? (v ? 'checked' : 'unchecked') : String(v ?? '')}`;
    const ctx = first(text, re);
    const w = f.widgets[0];
    if (ctx === null || !w) continue;
    out.push({ kind: 'field', page: w.page, rect: [{ x: w.rect[0], y: w.rect[1] }, { x: w.rect[2], y: w.rect[3] }], context: ctx });
  }
  return out;
}

/** Document properties (Title, Author, Subject, Keywords...) that match. */
export function searchProperties(info: Record<string, unknown>, re: RegExp): ScopeHit[] {
  const out: ScopeHit[] = [];
  for (const key of ['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer']) {
    const v = info[key];
    if (typeof v !== 'string') continue;
    const ctx = first(`${key}: ${v}`, re);
    if (ctx !== null) out.push({ kind: 'property', page: -1, rect: [{ x: 0, y: 0 }, { x: 0, y: 0 }], context: ctx });
  }
  return out;
}

/** Apply Count Measurement to Checked: one Count per page, a point at the centre of each hit. */
export function countPointsByPage(hits: { page: number; rect: [Pt, Pt] }[]): Map<number, Pt[]> {
  const byPage = new Map<number, Pt[]>();
  for (const h of hits) {
    if (h.page < 0) continue;
    byPage.set(h.page, [...(byPage.get(h.page) ?? []), { x: (h.rect[0].x + h.rect[1].x) / 2, y: (h.rect[0].y + h.rect[1].y) / 2 }]);
  }
  return byPage;
}
