// Markup Summary (Revu: Summary dialog): the rows of the Markups List
// filtered and sorted, written as CSV or XML with the options of Revu's
// Output tab, or grouped for a PDF report with page breaks and totals.

export interface SummaryRow {
  id: string;
  /** Parent markup id for grouped markups (ID Columns). */
  parent?: string;
  page: number;
  v: Record<string, string | number>;
  replies: { author: string; date: string; text: string }[];
}
export interface SummaryCol { key: string; label: string; numeric?: boolean; noTotal?: boolean; unit?: string }
export interface SortSpec { key: string; dir: 1 | -1 }

const cmp = (a: SummaryRow, b: SummaryRow, key: string): number => {
  const x = a.v[key], y = b.v[key];
  if (key === 'page') return a.page - b.page;
  if (typeof x === 'number' || typeof y === 'number') return (Number(x) || 0) - (Number(y) || 0);
  return String(x ?? '').localeCompare(String(y ?? ''));
};

/** Sort by the first spec, ties by the next ones (Revu: Sort by / Then by). */
export function sortRows(rows: SummaryRow[], sorts: SortSpec[]): SummaryRow[] {
  return [...rows].sort((a, b) => {
    for (const s of sorts) { const d = cmp(a, b, s.key) * s.dir; if (d) return d; }
    return 0;
  });
}

/** Keep the rows whose values equal every active filter. */
export function filterRows(rows: SummaryRow[], filters: Record<string, string>): SummaryRow[] {
  const active = Object.entries(filters).filter(([, v]) => v !== '');
  return rows.filter((r) => active.every(([k, v]) => String(r.v[k] ?? '') === v));
}

/** The totals row: numeric columns summed (never depth, angle, slope). */
export function totalsRow(columns: SummaryCol[], rows: SummaryRow[]): (string | number)[] {
  return columns.map((c, i) => (i === 0 ? 'Total'
    : c.numeric && !c.noTotal && !['depth', 'angle', 'slope'].includes(c.key)
      ? Math.round(rows.reduce((t, r) => t + (Number(String(r.v[c.key] ?? '').replace(/[^0-9.eE+-]/g, '')) || 0), 0) * 100) / 100 : ''));
}

export interface TextOptions {
  include: 'markups' | 'totals' | 'both';
  headers: boolean;
  idColumns: boolean;
  units: boolean;
  replies: boolean;
}

const withUnit = (c: SummaryCol, v: string | number, units: boolean) => (units && c.unit && v !== '' ? `${v} ${c.unit}` : v);

export function csvText(columns: SummaryCol[], rows: SummaryRow[], o: TextOptions): string {
  const esc = (v: string | number) => { const s = String(v ?? ''); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const head = [...(o.idColumns ? ['ID', 'Parent'] : []), ...columns.map((c) => c.label)];
  const lines: string[] = [];
  if (o.headers) lines.push(head.map(esc).join(','));
  if (o.include !== 'totals') {
    for (const r of rows) {
      lines.push([...(o.idColumns ? [r.id, r.parent ?? ''] : []), ...columns.map((c) => withUnit(c, r.v[c.key] ?? '', o.units))].map(esc).join(','));
      if (o.replies) for (const rp of r.replies) lines.push([...(o.idColumns ? ['', r.id] : []), `Reply: ${rp.author}`, rp.date, rp.text].map(esc).join(','));
    }
  }
  if (o.include !== 'markups') lines.push([...(o.idColumns ? ['', ''] : []), ...totalsRow(columns, rows)].map(esc).join(','));
  return lines.join('\r\n');
}

const xmlEsc = (s: string | number) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const tag = (label: string) => label.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^(\d)/, '_$1') || 'Column';

export function xmlText(columns: SummaryCol[], rows: SummaryRow[], o: Omit<TextOptions, 'headers' | 'idColumns'>): string {
  const out = ['<?xml version="1.0" encoding="UTF-8"?>', '<MarkupSummary>'];
  if (o.include !== 'totals') {
    for (const r of rows) {
      out.push(`  <Markup id="${xmlEsc(r.id)}"${r.parent ? ` parent="${xmlEsc(r.parent)}"` : ''}>`);
      for (const c of columns) out.push(`    <${tag(c.label)}>${xmlEsc(withUnit(c, r.v[c.key] ?? '', o.units))}</${tag(c.label)}>`);
      if (o.replies) for (const rp of r.replies) out.push(`    <Reply author="${xmlEsc(rp.author)}" date="${xmlEsc(rp.date)}">${xmlEsc(rp.text)}</Reply>`);
      out.push('  </Markup>');
    }
  }
  if (o.include !== 'markups') {
    const t = totalsRow(columns, rows);
    out.push('  <Totals>', ...columns.map((c, i) => (t[i] !== '' && i > 0 ? `    <${tag(c.label)}>${xmlEsc(t[i])}</${tag(c.label)}>` : '')).filter(Boolean), '  </Totals>');
  }
  out.push('</MarkupSummary>');
  return out.join('\n');
}

/** Rows grouped by a column's value, in the rows' order (Insert Page Break per …). */
export function groupRows(rows: SummaryRow[], key: string | null): { value: string; rows: SummaryRow[] }[] {
  if (!key) return [{ value: '', rows }];
  const groups: { value: string; rows: SummaryRow[] }[] = [];
  for (const r of rows) {
    const value = String(r.v[key] ?? '');
    const g = groups.find((x) => x.value === value);
    if (g) g.rows.push(r); else groups.push({ value, rows: [r] });
  }
  return groups;
}

/** The report title, optionally with the date (Append Date to Title). */
export function summaryTitle(title: string, appendDate: boolean, date = new Date()): string {
  const d = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return appendDate ? `${title} ${d}` : title;
}
