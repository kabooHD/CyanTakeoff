import { anchorOf, spaceAt } from '../model/spaces';
import { activeDoc, useApp, type DocState } from '../model/store';
import { areaLabel, measure, unitLabel, volumeLabel } from '../model/measure';
import type { CustomColumn, Markup } from '../model/types';
import { displayValue, isNumericColumn, numericValue } from '../model/columns';
import { buildXlsx } from '../model/xlsx';

type Picker = (o: unknown) => Promise<FileSystemFileHandle[]>;

/** File > Open. Uses the File System Access API when available so Save writes back in place. */
export async function openFile() {
  const w = window as unknown as { showOpenFilePicker?: Picker };
  if (w.showOpenFilePicker) {
    let handles: FileSystemFileHandle[];
    try {
      handles = await w.showOpenFilePicker({
        multiple: true,
        types: [{ description: 'PDF', accept: { 'application/pdf': ['.pdf'] } }],
      });
    } catch { return; }
    for (const h of handles) {
      const f = await h.getFile();
      await useApp.getState().openBytes(new Uint8Array(await f.arrayBuffer()), f.name, h);
    }
    return;
  }
  const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.pdf,application/pdf', multiple: true });
  input.onchange = async () => {
    for (const f of Array.from(input.files ?? [])) await openFileObject(f);
  };
  input.click();
}

export async function openFileObject(f: File) {
  await useApp.getState().openBytes(new Uint8Array(await f.arrayBuffer()), f.name);
}

export async function openSample() {
  const res = await fetch(`${import.meta.env.BASE_URL}sample-floorplan.pdf`);
  await useApp.getState().openBytes(new Uint8Array(await res.arrayBuffer()), 'Sample Floor Plan.pdf');
}

// ---------- Markups List summary ----------

export interface SummaryColumn {
  key: string;
  label: string;
  value: (m: Markup, d: DocState) => string | number;
  numeric?: boolean;
  /** Custom column definition, for custom columns. */
  custom?: CustomColumn;
  /** Exclude from the totals row. */
  noTotal?: boolean;
}

/** Built-in columns plus the document's custom columns. */
export function allColumns(d: DocState | null | undefined): SummaryColumn[] {
  const custom = (d?.columns ?? []).map((c): SummaryColumn => ({
    key: `c:${c.id}`, label: c.name, custom: c,
    numeric: isNumericColumn(c), noTotal: isNumericColumn(c) && c.includeInTotals === false,
    value: (m, doc) => displayValue(m, c, doc.columns),
  }));
  return [...SUMMARY_COLUMNS, ...custom];
}

const meas = (m: Markup) => measure(m);

export const SUMMARY_COLUMNS: SummaryColumn[] = [
  { key: 'subject', label: 'Subject', value: (m) => m.subject },
  { key: 'page', label: 'Page Label', value: (m, d) => d.loaded.pages[m.page]?.label ?? m.page + 1 },
  { key: 'space', label: 'Space', value: (m, d) => spaceAt(d.spaces[m.page], anchorOf(m))?.title ?? '' },
  { key: 'label', label: 'Label', value: (m) => m.label },
  { key: 'comment', label: 'Comments', value: (m) => m.comment || m.text || '' },
  { key: 'author', label: 'Author', value: (m) => m.author },
  { key: 'date', label: 'Date', value: (m) => new Date(m.modified).toLocaleString() },
  { key: 'status', label: 'Status', value: (m) => m.status },
  { key: 'color', label: 'Color', value: (m) => m.style.color },
  { key: 'measurement', label: 'Measurement', value: (m) => meas(m)?.text ?? '' },
  { key: 'length', label: 'Length', value: (m) => round(meas(m)?.length), numeric: true },
  { key: 'area', label: 'Area', value: (m) => round(meas(m)?.area), numeric: true },
  { key: 'volume', label: 'Volume', value: (m) => round(meas(m)?.volume), numeric: true },
  { key: 'angle', label: 'Angle', value: (m) => round(meas(m)?.angle), numeric: true },
  { key: 'count', label: 'Count', value: (m) => meas(m)?.count ?? '', numeric: true },
  { key: 'depth', label: 'Depth', value: (m) => m.depth ?? '', numeric: true },
  { key: 'slope', label: 'Slope', value: (m) => (m.slope ? `${m.slope.value}${m.slope.unit === 'pitch' ? '/12' : m.slope.unit === 'degree' ? '°' : '%'}` : '') },
  { key: 'units', label: 'Units', value: (m) => unitsOf(m) },
];

function round(v: number | undefined) {
  return v === undefined ? '' : Math.round(v * 100) / 100;
}

function unitsOf(m: Markup) {
  const u = m.scale?.unit;
  if (!u) return '';
  switch (m.type) {
    case 'area': return areaLabel(u);
    case 'volume': return volumeLabel(u);
    case 'count': return 'ea';
    case 'length': case 'polylength': case 'perimeter': case 'radius': case 'diameter': return unitLabel(u);
    case 'angle': return '°';
    default: return '';
  }
}

export function exportSummaryCsv(markups?: Markup[], columns: SummaryColumn[] = SUMMARY_COLUMNS) {
  const d = activeDoc();
  if (!d) return;
  const rows = markups ?? d.markups;
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [
    columns.map((c) => c.label).join(','),
    ...rows.map((m) => columns.map((c) => esc(c.value(m, d))).join(',')),
  ].join('\r\n');
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: d.name.replace(/\.pdf$/i, '') + ' - Markups Summary.csv' });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Summary to Excel (.xlsx): the rows and columns shown, with numeric cells and a totals row. */
export function exportSummaryXlsx(markups: Markup[], columns: SummaryColumn[]) {
  const d = activeDoc();
  if (!d) return;
  const num = (c: SummaryColumn, m: Markup): number | string => {
    if (c.custom && isNumericColumn(c.custom)) return numericValue(m, c.custom, d.columns) ?? '';
    const v = c.value(m, d);
    return c.numeric && v !== '' ? Number(v) : v;
  };
  const rows = markups.map((m) => columns.map((c) => num(c, m)));
  const totals = columns.map((c, i) => (i === 0 ? 'Total'
    : c.numeric && !c.noTotal && !['depth', 'angle', 'slope'].includes(c.key)
      ? Math.round(rows.reduce((t, r) => t + (Number(r[i]) || 0), 0) * 1e6) / 1e6 : ''));
  const bytes = buildXlsx('Markups', columns.map((c) => c.label), rows, totals);
  const url = URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: d.name.replace(/\.pdf$/i, '') + ' - Markups Summary.xlsx' });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
