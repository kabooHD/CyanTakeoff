// Quantity Link: measurement totals linked to cells of an Excel workbook.
// In Revu this is an Excel add-in; in the browser the links live here: each
// link names a cell, a total (count, length, area, volume) and filters on
// Markups List columns (Subject, Layer, Page Label, Space, custom columns…).
// Totals update live as markups change; Update Workbook writes them into
// the workbook (in place when the browser can, else as a download), leaving
// the rest of the workbook untouched.
import { useEffect, useMemo, useRef } from 'react';
import { create } from 'zustand';
import { useApp, type DocState } from '../model/store';
import { measure } from '../model/measure';
import { buildXlsx } from '../model/xlsx';
import { parseCellRef, setCells } from '../model/xlsxEdit';
import { allColumns } from './actions';
import { pickFile } from './toolActions';

export type QTotal = 'count' | 'length' | 'area' | 'volume';
export interface QFilter { column: string; value: string }
export interface QLink { id: string; name: string; cell: string; total: QTotal; source: 'active' | 'all'; filters: QFilter[] }

const LS = 'cyantakeoff:quantity-links';
const load = (): QLink[] => { try { return JSON.parse(localStorage.getItem(LS) ?? '[]'); } catch { return []; } };

interface QState {
  open: boolean; links: QLink[];
  workbook: { name: string; bytes: Uint8Array; handle?: FileSystemFileHandle } | null;
  auto: boolean;
}
export const useQuantityLink = create<QState>(() => ({ open: false, links: load(), workbook: null, auto: false }));
const setLinks = (links: QLink[]) => {
  useQuantityLink.setState({ links });
  try { localStorage.setItem(LS, JSON.stringify(links)); } catch { /* storage unavailable */ }
};

const TOTALS: Record<QTotal, string> = { count: 'Count', length: 'Length', area: 'Area', volume: 'Volume' };

/** The total a link stands for, over the measurements its filters keep. */
export function linkValue(link: QLink, docs: DocState[], activeId: string | null): { value: number; unit: string; n: number } {
  const ds = link.source === 'all' ? docs : docs.filter((d) => d.id === activeId);
  let value = 0, unit = '', n = 0;
  for (const d of ds) {
    const cols = allColumns(d);
    const filters = link.filters.filter((f) => f.column).map((f) => ({ f, col: cols.find((c) => c.key === f.column) }));
    for (const m of d.markups) {
      const r = measure(m);
      if (!r) continue;
      if (!filters.every(({ f, col }) => col && String(col.value(m, d)) === f.value)) continue;
      const v = link.total === 'count' ? r.count ?? 1 : link.total === 'length' ? r.length : link.total === 'area' ? r.area : r.volume;
      if (v === undefined) continue;
      value += v; n++;
      if (!unit) unit = link.total === 'count' ? 'ea' : String(cols.find((c) => c.key === 'units')?.value(m, d) ?? '');
    }
  }
  return { value: Math.round(value * 1000) / 1000, unit, n };
}

function download(name: string, bytes: Uint8Array) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  Object.assign(document.createElement('a'), { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

type Picker = (o: unknown) => Promise<FileSystemFileHandle[]>;
async function openWorkbook() {
  const w = window as unknown as { showOpenFilePicker?: Picker };
  if (w.showOpenFilePicker) {
    try {
      const [h] = await w.showOpenFilePicker({ types: [{ description: 'Excel workbook', accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] } }] });
      const f = await h.getFile();
      useQuantityLink.setState({ workbook: { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()), handle: h } });
    } catch { /* cancelled */ }
    return;
  }
  const f = await pickFile('.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  if (f) useQuantityLink.setState({ workbook: { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) } });
}

/** Write every link's total into its cell; save in place or download. */
export async function updateWorkbook(quiet = false) {
  const st = useQuantityLink.getState();
  const app = useApp.getState();
  const writes = st.links.flatMap((l) => {
    const ref = parseCellRef(l.cell);
    return ref ? [{ ...ref, value: linkValue(l, app.docs, app.activeId).value }] : [];
  });
  if (!writes.length) { app.setStatus('Quantity Link: give each link a cell (e.g. B3 or Estimate!C12).'); return; }
  let wb = st.workbook;
  if (!wb) {
    // No workbook yet: start one listing the links, values in column B.
    const bytes = buildXlsx('Quantities', ['Item', 'Quantity', 'Unit'], st.links.map((l) => [l.name, 0, linkValue(l, app.docs, app.activeId).unit]));
    wb = { name: 'Quantities.xlsx', bytes };
  }
  try {
    const out = setCells(wb.bytes, writes);
    useQuantityLink.setState({ workbook: { ...wb, bytes: out } });
    if (wb.handle) {
      const w = await (wb.handle as unknown as { createWritable(): Promise<{ write(d: Uint8Array): Promise<void>; close(): Promise<void> }> }).createWritable();
      await w.write(out); await w.close();
      if (!quiet) app.setStatus(`Quantity Link: ${writes.length} cell${writes.length === 1 ? '' : 's'} updated in ${wb.name}`);
    } else {
      download(wb.name, out);
      app.setStatus(`Quantity Link: ${wb.name} downloaded with ${writes.length} updated cell${writes.length === 1 ? '' : 's'}`);
    }
  } catch (e) { app.setStatus(`Quantity Link: ${(e as Error).message}`); }
}

export function QuantityLinkDialog() {
  const st = useQuantityLink();
  const docs = useApp((s) => s.docs);
  const activeId = useApp((s) => s.activeId);
  const active = docs.find((d) => d.id === activeId);
  const cols = useMemo(() => allColumns(active).filter((c) => !c.numeric && !['comment', 'date', 'created', 'measurement'].includes(c.key)), [active]);
  // Auto update: rewrite the workbook in place a moment after markups change.
  const sig = docs.map((d) => d.markups).join();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (!st.auto || !st.workbook?.handle) return;
    const t = setTimeout(() => updateWorkbook(true), 1500);
    return () => clearTimeout(t);
  }, [sig, st.auto, st.workbook?.handle]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!st.open) return null;
  const close = () => useQuantityLink.setState({ open: false });
  const upd = (id: string, p: Partial<QLink>) => setLinks(st.links.map((l) => (l.id === id ? { ...l, ...p } : l)));
  const valuesOf = (key: string) => {
    const col = cols.find((c) => c.key === key);
    if (!col || !active) return [];
    return [...new Set(active.markups.filter((m) => measure(m)).map((m) => String(col.value(m, active))))].filter(Boolean).sort();
  };
  const nextCell = () => `B${st.links.length + 2}`;
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal quantity-link" role="dialog" aria-label="Quantity Link" onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') close(); }}>
        <div className="modal-title">Quantity Link</div>
        <div className="scale-dialog">
          <div className="form-row"><span>Workbook</span>
            <span className="muted">{st.workbook ? st.workbook.name : 'None (Update creates Quantities.xlsx)'}</span>
            <button onClick={openWorkbook}>Open Workbook…</button>
            {st.workbook && <button onClick={() => useQuantityLink.setState({ workbook: null })}>Close</button>}
          </div>
          <table className="ql-table">
            <thead><tr><th>Name</th><th>Cell</th><th>Total</th><th>From</th><th>Filters</th><th>Value</th><th /></tr></thead>
            <tbody>
              {st.links.map((l) => {
                const v = linkValue(l, docs, activeId);
                return (
                  <tr key={l.id}>
                    <td><input aria-label="Link name" value={l.name} onChange={(e) => upd(l.id, { name: e.target.value })} /></td>
                    <td><input aria-label="Cell" value={l.cell} style={{ width: 90 }} className={parseCellRef(l.cell) ? '' : 'invalid'} onChange={(e) => upd(l.id, { cell: e.target.value })} /></td>
                    <td><select aria-label="Total" value={l.total} onChange={(e) => upd(l.id, { total: e.target.value as QTotal })}>
                      {(Object.keys(TOTALS) as QTotal[]).map((k) => <option key={k} value={k}>{TOTALS[k]}</option>)}
                    </select></td>
                    <td><select aria-label="From" value={l.source} onChange={(e) => upd(l.id, { source: e.target.value as QLink['source'] })}>
                      <option value="active">Active document</option><option value="all">All open documents</option>
                    </select></td>
                    <td className="ql-filters">
                      {l.filters.map((f, i) => (
                        <div key={i} className="ql-filter">
                          <select aria-label="Filter column" value={f.column} onChange={(e) => upd(l.id, { filters: l.filters.map((x, j) => (j === i ? { column: e.target.value, value: '' } : x)) })}>
                            <option value="">(column)</option>
                            {cols.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                          </select>
                          =
                          <select aria-label="Filter value" value={f.value} onChange={(e) => upd(l.id, { filters: l.filters.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })}>
                            <option value="">(value)</option>
                            {[...new Set([f.value, ...valuesOf(f.column)])].filter(Boolean).map((x) => <option key={x}>{x}</option>)}
                          </select>
                          <button aria-label="Remove filter" onClick={() => upd(l.id, { filters: l.filters.filter((_, j) => j !== i) })}>×</button>
                        </div>
                      ))}
                      <button onClick={() => upd(l.id, { filters: [...l.filters, { column: 'subject', value: '' }] })}>+ Filter</button>
                    </td>
                    <td className="ql-value" aria-label="Linked value">{v.value} {v.unit}<div className="muted small">{v.n} markup{v.n === 1 ? '' : 's'}</div></td>
                    <td><button aria-label="Remove link" onClick={() => setLinks(st.links.filter((x) => x.id !== l.id))}>×</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!st.links.length && <p className="muted small">Add a link for each quantity your estimate needs, e.g. Count of Subject = Door into B3.</p>}
          <div className="modal-actions">
            <button onClick={() => setLinks([...st.links, { id: crypto.randomUUID(), name: `Quantity ${st.links.length + 1}`, cell: nextCell(), total: 'area', source: 'active', filters: [] }])}>Add Link</button>
            <label title="Needs a workbook opened with write access (Chromium browsers)"><input type="checkbox" disabled={!st.workbook?.handle} checked={st.auto && !!st.workbook?.handle} onChange={(e) => useQuantityLink.setState({ auto: e.target.checked })} /> Update automatically</label>
            <span className="spacer" />
            <button className="primary" disabled={!st.links.length} onClick={() => updateWorkbook()}>Update Workbook</button>
            <button onClick={close}>Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}
