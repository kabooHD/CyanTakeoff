import { anchorOf, spaceAt } from '../model/spaces';
import { activeDoc, serialize, useApp, type DocState } from '../model/store';
import { areaLabel, measure, unitLabel, volumeLabel } from '../model/measure';
import type { CustomColumn, Markup } from '../model/types';
import { displayValue, isNumericColumn, numericValue } from '../model/columns';
import { buildXlsx } from '../model/xlsx';
import { buildSummaryPdf } from '../pdf/summary';
import { pickFile } from './toolActions';

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

export async function openFileObject(f: File, handle?: FileSystemFileHandle) {
  await useApp.getState().openBytes(new Uint8Array(await f.arrayBuffer()), f.name, handle);
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
  { key: 'comment', label: 'Comments', value: (m) => [m.comment || m.text || '', ...(m.replies ?? []).map((r) => `${r.author}: ${r.text}`)].filter(Boolean).join(' | ') },
  { key: 'author', label: 'Author', value: (m) => m.author },
  { key: 'date', label: 'Date', value: (m) => new Date(m.modified).toLocaleString() },
  { key: 'created', label: 'Creation Date', value: (m) => new Date(m.created).toLocaleString() },
  { key: 'checkmark', label: 'Checkmark', value: (m) => (m.checked ? '✓' : '') },
  { key: 'lock', label: 'Lock', value: (m) => (m.locked ? 'Locked' : '') },
  { key: 'pageIndex', label: 'Page Index', value: (m) => m.page + 1, numeric: true, noTotal: true },
  { key: 'status', label: 'Status', value: (m) => m.status },
  { key: 'layer', label: 'Layer', value: (m, d) => (m.layer ? d.layers?.layers[m.layer]?.name ?? '' : '') },
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

/** Summary as a PDF report of the rows and columns shown. */
export async function exportSummaryPdf(markups: Markup[], columns: SummaryColumn[]) {
  const d = activeDoc();
  if (!d) return;
  const rows = markups.map((m) => columns.map((c) => c.value(m, d)));
  const totals = columns.map((c, i) => (i === 0 ? 'Total'
    : c.numeric && !c.noTotal && !['depth', 'angle', 'slope'].includes(c.key)
      ? Math.round(rows.reduce((t, r) => t + (Number(String(r[i]).replace(/[^0-9.eE+-]/g, '')) || 0), 0) * 100) / 100 : ''));
  const bytes = await buildSummaryPdf({
    title: `Markups Summary: ${d.name}`,
    subtitle: `${markups.length} markup${markups.length === 1 ? '' : 's'}, ${new Date().toLocaleString()}, CyanTakeoff`,
    header: columns.map((c) => c.label), rows, totals, numeric: columns.map((c) => !!c.numeric),
  });
  const url = URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: d.name.replace(/\.pdf$/i, '') + ' - Markups Summary.pdf' });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// ---------- XFDF markups exchange ----------

/** File > Export Markups (XFDF). */
export async function exportMarkupsXfdf() {
  const d = activeDoc();
  if (!d) return;
  const { PDFDocument } = await import('pdf-lib');
  const { exportXfdf } = await import('../pdf/xfdf');
  const doc = await PDFDocument.load(await serialize(d), { updateMetadata: false });
  const xml = exportXfdf(doc, d.name);
  const url = URL.createObjectURL(new Blob([xml], { type: 'application/vnd.adobe.xfdf' }));
  Object.assign(document.createElement('a'), { href: url, download: d.name.replace(/\.pdf$/i, '') + '.xfdf' }).click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  useApp.getState().setStatus(`Exported markups to ${d.name.replace(/\.pdf$/i, '')}.xfdf`);
}

/** File > Import Markups (XFDF): adds them to the active document (same-named markups are replaced). */
export async function importMarkupsXfdf(file?: File) {
  const f = file ?? await pickFile('.xfdf,.xml,application/vnd.adobe.xfdf');
  if (!f) return;
  const xml = await f.text();
  const { importXfdf } = await import('../pdf/xfdf');
  let n = 0;
  const ok = await useApp.getState().transformDoc((lib) => { n = importXfdf(lib, xml); }, 'Markups imported');
  if (ok) useApp.getState().setStatus(`Imported ${n} markup${n === 1 ? '' : 's'} from ${f.name}`);
}
