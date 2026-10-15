// Markup Summary dialog (Revu: Summary): Columns, Filter & Sort and Output
// tabs. CSV, XML, Excel or a PDF report (downloaded, printed, or appended
// to the document with each row hyperlinked to its markup), with Revu's
// options: title and date, totals, ID columns, units, replies, page breaks
// per field and thumbnails.
import { useMemo, useState } from 'react';
import { create } from 'zustand';
import { PDFDocument } from 'pdf-lib';
import { useApp, serialize, type DocState } from '../model/store';
import { csvText, filterRows, groupRows, sortRows, summaryTitle, totalsRow, xmlText, type SortSpec, type SummaryCol, type SummaryRow } from '../model/summary';
import { allColumns, type SummaryColumn } from './actions';
import { buildXlsx } from '../model/xlsx';
import { drawSummary, type SummarySection } from '../pdf/summary';
import { insertPages } from '../pdf/pages';
import { snapshot } from './toolActions';
import { markupBounds } from './hit';
import { drawMarkups } from './markupRaster';
import { openPrint } from './Print';
import { unitLabel } from '../model/measure';

export const useSummaryDialog = create<{ open: boolean }>(() => ({ open: false }));
export const openSummaryDialog = () => useSummaryDialog.setState({ open: true });

type Format = 'csv' | 'xml' | 'xlsx' | 'pdf' | 'print';
type Tab = 'columns' | 'sort' | 'output';

function download(blob: Blob, name: string) {
  const href = URL.createObjectURL(blob);
  Object.assign(document.createElement('a'), { href, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

const UNIT_KEYS: Record<string, (d: DocState, m: SummaryRow) => string> = {
  length: (d, r) => unitLabel(d.calibrations[r.page]?.unit ?? 'ft'),
  area: (d, r) => `${unitLabel(d.calibrations[r.page]?.unit ?? 'ft')}²`,
  volume: (d, r) => `${unitLabel(d.calibrations[r.page]?.unit ?? 'ft')}³`,
};

export function SummaryDialog() {
  const open = useSummaryDialog((x) => x.open);
  const doc = useApp((s) => s.docs.find((d) => d.id === s.activeId));
  return open && doc ? <Form doc={doc} /> : null;
}

function Form({ doc }: { doc: DocState }) {
  const s = useApp();
  const defs = useMemo(() => allColumns(doc), [doc]);
  const [tab, setTab] = useState<Tab>('columns');
  const [chosen, setChosen] = useState<string[]>(() => defs.filter((c) => !['capture', 'lock', 'checked'].includes(c.key)).map((c) => c.key));
  const [showEmpty, setShowEmpty] = useState(false);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [sorts, setSorts] = useState<SortSpec[]>([{ key: 'page', dir: 1 }]);
  const [format, setFormat] = useState<Format>('pdf');
  const [title, setTitle] = useState(`${doc.name.replace(/\.pdf$/i, '')} - Markups Summary`);
  const [appendDate, setAppendDate] = useState(false);
  const [include, setInclude] = useState<'markups' | 'totals' | 'both'>('both');
  const [headers, setHeaders] = useState(true);
  const [idColumns, setIdColumns] = useState(false);
  const [units, setUnits] = useState(false);
  const [replies, setReplies] = useState(false);
  const [appendToPdf, setAppendToPdf] = useState(false);
  const [breakPer, setBreakPer] = useState('');
  const [totals, setTotals] = useState(true);
  const [thumb, setThumb] = useState<'none' | 'small' | 'medium'>('none');
  const [pageContent, setPageContent] = useState(false);
  const [busy, setBusy] = useState(false);
  const close = () => useSummaryDialog.setState({ open: false });

  const all: SummaryRow[] = useMemo(() => doc.markups.map((m) => ({
    id: m.id, parent: m.groupId, page: m.page, replies: (m.replies ?? []).map((r) => ({ author: r.author, date: r.date, text: r.text })),
    v: Object.fromEntries(defs.map((c) => [c.key, c.value(m, doc)])) as Record<string, string | number>,
  })), [doc, defs]);
  const rows = useMemo(() => sortRows(filterRows(all, filters), sorts), [all, filters, sorts]);
  const columns: SummaryColumn[] = chosen.map((k) => defs.find((c) => c.key === k)!).filter(Boolean)
    .filter((c) => showEmpty || rows.some((r) => String(r.v[c.key] ?? '') !== ''));
  const cols: SummaryCol[] = columns.map((c) => ({ key: c.key, label: c.label, numeric: c.numeric, noTotal: c.noTotal, unit: UNIT_KEYS[c.key] && rows[0] ? UNIT_KEYS[c.key](doc, rows[0]) : undefined }));
  const values = (key: string) => [...new Set(all.map((r) => String(r.v[key] ?? '')))].filter(Boolean).sort();
  const move = (key: string, dir: -1 | 1) => {
    const i = chosen.indexOf(key), j = i + dir;
    if (i < 0 || j < 0 || j >= chosen.length) return;
    const next = [...chosen]; [next[i], next[j]] = [next[j], next[i]];
    setChosen(next);
  };
  const name = summaryTitle(title.trim() || 'Markups Summary', appendDate);

  const thumbnails = async (list: SummaryRow[]): Promise<(Uint8Array | null)[]> => {
    if (thumb === 'none') return list.map(() => null);
    const out: (Uint8Array | null)[] = [];
    const px = thumb === 'small' ? 36 : 72;
    for (const r of list) {
      const m = doc.markups.find((x) => x.id === r.id);
      if (!m) { out.push(null); continue; }
      try {
        const b = markupBounds(m);
        const pad = Math.max(6, Math.max(b.maxX - b.minX, b.maxY - b.minY) * 0.1);
        const a = { x: b.minX - pad, y: b.minY - pad }, c = { x: b.maxX + pad, y: b.maxY + pad };
        let url: string;
        if (pageContent) url = await snapshot(await doc.loaded.pdf.getPage(m.page + 1), a, c, Math.min(3, (px * 3) / Math.max(1, c.y - a.y)), [m]);
        else {
          const canvas = document.createElement('canvas');
          const k = Math.min(4, (px * 2) / Math.max(1, c.y - a.y));
          canvas.width = Math.max(1, Math.round((c.x - a.x) * k)); canvas.height = Math.max(1, Math.round((c.y - a.y) * k));
          const ctx = canvas.getContext('2d')!;
          ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
          await drawMarkups(canvas, [m], a.x, a.y, c.x - a.x, c.y - a.y);
          url = canvas.toDataURL('image/png');
        }
        out.push(Uint8Array.from(atob(url.split(',')[1]), (ch) => ch.charCodeAt(0)));
      } catch { out.push(null); }
    }
    return out;
  };

  const run = async () => {
    setBusy(true);
    try {
      const opts = { include, headers, idColumns, units, replies };
      if (format === 'csv') { download(new Blob(['﻿' + csvText(cols, rows, opts)], { type: 'text/csv' }), `${name}.csv`); }
      else if (format === 'xml') { download(new Blob([xmlText(cols, rows, opts)], { type: 'application/xml' }), `${name}.xml`); }
      else if (format === 'xlsx') {
        const body = rows.map((r) => cols.map((c) => (c.numeric && r.v[c.key] !== '' ? Number(String(r.v[c.key]).replace(/[^0-9.eE+-]/g, '')) || 0 : r.v[c.key] ?? '')));
        download(new Blob([buildXlsx('Markups', cols.map((c) => c.label), body, include !== 'markups' ? totalsRow(cols, rows) : undefined) as unknown as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${name}.xlsx`);
      } else {
        const groups = groupRows(rows, breakPer || null);
        const sections: SummarySection[] = [];
        for (const g of groups) {
          const label = breakPer ? `${defs.find((c) => c.key === breakPer)?.label ?? breakPer}: ${g.value || '—'}` : undefined;
          sections.push({
            title: label, rows: g.rows.map((r) => cols.map((c) => r.v[c.key] ?? '')), thumbs: await thumbnails(g.rows),
            targets: appendToPdf ? g.rows.map((r) => r.page) : undefined,
            replies: replies ? g.rows.map((r) => r.replies.map((rp) => `${rp.author} (${rp.date}): ${rp.text}`)) : undefined,
          });
        }
        const table = {
          title: name, subtitle: `${rows.length} markup${rows.length === 1 ? '' : 's'}, ${new Date().toLocaleString()}, CyanTakeoff`,
          header: cols.map((c) => c.label), rows: [], sections, numeric: cols.map((c) => !!c.numeric), totals: totals ? totalsRow(cols, rows) : undefined,
          thumb: thumb === 'none' ? 0 : thumb === 'small' ? 24 : 48,
        };
        if (appendToPdf && format === 'pdf') {
          const n = await (async () => { let k = 0; const ok = await s.transformDoc(async (lib) => { k = await drawSummary(lib, table); }, `Markups Summary appended (${rows.length} rows)`); return ok ? k : 0; })();
          if (n) useApp.getState().setStatus(`Markups Summary: ${n} page${n === 1 ? '' : 's'} appended, rows hyperlinked to their markups`);
        } else {
          const out = await PDFDocument.create();
          out.setTitle(name); out.setProducer('CyanTakeoff');
          await drawSummary(out, table);
          const bytes = await out.save();
          if (format === 'print') { await useApp.getState().openBytes(bytes, `${name}.pdf`); openPrint(); }
          else download(new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' }), `${name}.pdf`);
        }
      }
      if (!(appendToPdf && format === 'pdf')) useApp.getState().setStatus(`Markups Summary: ${rows.length} row${rows.length === 1 ? '' : 's'} as ${format.toUpperCase()}`);
      close();
    } catch (e) { useApp.getState().setStatus(`Summary failed: ${(e as Error).message}`); }
    setBusy(false);
  };
  void serialize; void insertPages;

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal summary-dialog" role="dialog" aria-label="Markup Summary" onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') close(); }}>
        <div className="modal-title">Markup Summary</div>
        <div className="search-modes" role="tablist">
          {([['columns', 'Columns'], ['sort', 'Filter & Sort'], ['output', 'Output']] as const).map(([k, label]) => (
            <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{label}</button>
          ))}
        </div>
        <div className="scale-dialog">
          {tab === 'columns' && (
            <>
              <div className="summary-columns">
                {[...chosen, ...defs.map((c) => c.key).filter((k) => !chosen.includes(k))].map((k) => {
                  const c = defs.find((x) => x.key === k)!;
                  const on = chosen.includes(k);
                  return (
                    <div key={k} className="log-element">
                      <label><input type="checkbox" checked={on} onChange={() => setChosen(on ? chosen.filter((x) => x !== k) : [...chosen, k])} /> {c.label}</label>
                      {on && <span className="tag-head-actions"><button title="Up" onClick={() => move(k, -1)}>▲</button><button title="Down" onClick={() => move(k, 1)}>▼</button></span>}
                    </div>
                  );
                })}
              </div>
              <label className="pref-row"><input type="checkbox" checked={showEmpty} onChange={(e) => setShowEmpty(e.target.checked)} /> Show empty columns</label>
            </>
          )}
          {tab === 'sort' && (
            <>
              <div className="summary-filters">
                {defs.filter((c) => chosen.includes(c.key) && values(c.key).length > 1 && values(c.key).length <= 40).map((c) => (
                  <label key={c.key} className="pref-row"><span>{c.label}</span>
                    <select aria-label={`Filter ${c.label}`} value={filters[c.key] ?? ''} onChange={(e) => setFilters({ ...filters, [c.key]: e.target.value })}>
                      <option value="">(All)</option>
                      {values(c.key).map((v) => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </label>
                ))}
              </div>
              {sorts.map((sp, i) => (
                <label key={i} className="pref-row"><span>{i ? 'Then by' : 'Sort by'}</span>
                  <select aria-label={i ? `Then by ${i}` : 'Sort by'} value={sp.key} onChange={(e) => setSorts(sorts.map((x, k) => (k === i ? { ...x, key: e.target.value } : x)))}>
                    {defs.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                  </select>
                  <select aria-label={`Sort direction ${i + 1}`} value={sp.dir} onChange={(e) => setSorts(sorts.map((x, k) => (k === i ? { ...x, dir: Number(e.target.value) as 1 | -1 } : x)))}>
                    <option value={1}>Ascending</option><option value={-1}>Descending</option>
                  </select>
                  {i > 0 && <button onClick={() => setSorts(sorts.filter((_, k) => k !== i))}>×</button>}
                </label>
              ))}
              {sorts.length < 3 && <button onClick={() => setSorts([...sorts, { key: 'subject', dir: 1 }])}>Then by…</button>}
            </>
          )}
          {tab === 'output' && (
            <>
              <label className="pref-row"><span>Export as</span>
                <select aria-label="Export as" value={format} onChange={(e) => setFormat(e.target.value as Format)}>
                  <option value="pdf">PDF</option><option value="csv">CSV</option><option value="xml">XML</option><option value="xlsx">Excel (.xlsx)</option><option value="print">Print</option>
                </select>
              </label>
              <label className="pref-row"><span>Title</span><input aria-label="Summary title" value={title} onChange={(e) => setTitle(e.target.value)} /></label>
              <label className="pref-row"><input type="checkbox" checked={appendDate} onChange={(e) => setAppendDate(e.target.checked)} /> Append date to title</label>
              {(format === 'csv' || format === 'xml' || format === 'xlsx') && (
                <>
                  <label className="pref-row"><span>Include</span>
                    <select aria-label="Include" value={include} onChange={(e) => setInclude(e.target.value as typeof include)}>
                      <option value="markups">Markups only</option><option value="totals">Totals only</option><option value="both">Markups & Totals</option>
                    </select>
                  </label>
                  {format === 'csv' && <label className="pref-row"><input type="checkbox" checked={headers} onChange={(e) => setHeaders(e.target.checked)} /> Column headers</label>}
                  {format === 'csv' && <label className="pref-row"><input type="checkbox" checked={idColumns} onChange={(e) => setIdColumns(e.target.checked)} /> ID columns (ID and Parent)</label>}
                  <label className="pref-row"><input type="checkbox" checked={units} onChange={(e) => setUnits(e.target.checked)} /> Measurement units</label>
                  <label className="pref-row"><input type="checkbox" checked={replies} onChange={(e) => setReplies(e.target.checked)} /> Replies</label>
                </>
              )}
              {(format === 'pdf' || format === 'print') && (
                <>
                  {format === 'pdf' && <label className="pref-row"><input type="checkbox" checked={appendToPdf} onChange={(e) => setAppendToPdf(e.target.checked)} /> Append and hyperlink to current PDF</label>}
                  <label className="pref-row"><span>Insert page break per</span>
                    <select aria-label="Page break per" value={breakPer} onChange={(e) => setBreakPer(e.target.value)}>
                      <option value="">(None)</option>
                      {defs.filter((c) => chosen.includes(c.key)).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                    </select>
                  </label>
                  <label className="pref-row"><input type="checkbox" checked={totals} onChange={(e) => setTotals(e.target.checked)} /> Include totals</label>
                  <label className="pref-row"><span>Thumbnail</span>
                    <select aria-label="Thumbnail" value={thumb} onChange={(e) => setThumb(e.target.value as typeof thumb)}>
                      <option value="none">None</option><option value="small">Small</option><option value="medium">Medium</option>
                    </select>
                  </label>
                  {thumb !== 'none' && <label className="pref-row"><input type="checkbox" checked={pageContent} onChange={(e) => setPageContent(e.target.checked)} /> Include page content (slower)</label>}
                  <label className="pref-row"><input type="checkbox" checked={replies} onChange={(e) => setReplies(e.target.checked)} /> Replies</label>
                </>
              )}
            </>
          )}
          <p className="muted small">{rows.length} of {all.length} markups, {columns.length} columns.</p>
          <div className="modal-actions">
            <span className="spacer" />
            <button className="primary" disabled={busy || !columns.length} onClick={run}>{busy ? 'Working…' : 'OK'}</button>
            <button onClick={close}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}
