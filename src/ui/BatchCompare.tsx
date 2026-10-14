// Batch > Compare Documents / Overlay Pages (Revu): pages of the chosen
// "current" open files are paired with pages of the "revised" ones (by file
// name and page index, or by page label with a Match Filter), then each pair
// is compared (clouds on the revised sheet) or overlaid (one overlay PDF per
// pair). A CSV report of the pairs can be downloaded.
import { useMemo, useState } from 'react';
import { create } from 'zustand';
import { useApp, type DocState } from '../model/store';
import { batchReportCsv, pairSheets, type MatchBy, type SheetRef } from '../model/batchPairs';
import { compareDocuments, overlayPages } from './Compare';

export const useBatchCompare = create<{ mode: 'compare' | 'overlay' | null }>(() => ({ mode: null }));
export const openBatchCompare = (mode: 'compare' | 'overlay') => useBatchCompare.setState({ mode });

const sheetsOf = (docs: DocState[]): SheetRef[] => docs.flatMap((d) => d.loaded.pages.map((p, i) => ({ docId: d.id, docName: d.name, page: i, label: p.label || String(i + 1) })));
const describe = (s: SheetRef) => `${s.docName} p${s.page + 1}${s.label && s.label !== String(s.page + 1) ? ` (${s.label})` : ''}`;

function downloadText(name: string, text: string) {
  const href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  Object.assign(document.createElement('a'), { href, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

export function BatchCompareDialog() {
  const mode = useBatchCompare((x) => x.mode);
  return mode ? <Form mode={mode} /> : null;
}

function Form({ mode }: { mode: 'compare' | 'overlay' }) {
  const s = useApp();
  const docs = s.docs;
  const active = docs.find((d) => d.id === s.activeId) ?? docs[0];
  const [current, setCurrent] = useState<string[]>(() => docs.filter((d) => d.id !== active?.id).map((d) => d.id));
  const [revised, setRevised] = useState<string[]>(() => (active ? [active.id] : []));
  const [by, setBy] = useState<MatchBy>('name-index');
  const [filter, setFilter] = useState('');
  const [method, setMethod] = useState<'raster' | 'vector'>('raster');
  const [report, setReport] = useState(false);
  const title = mode === 'compare' ? 'Batch Compare Documents' : 'Batch Overlay Pages';
  const close = () => useBatchCompare.setState({ mode: null });
  const pairs = useMemo(() => pairSheets(sheetsOf(docs.filter((d) => current.includes(d.id))), sheetsOf(docs.filter((d) => revised.includes(d.id))), by, filter), [docs, current, revised, by, filter]);
  const pick = (e: React.ChangeEvent<HTMLSelectElement>) => Array.from(e.target.selectedOptions).map((o) => o.value);
  const ok = async () => {
    close();
    const rows: { current: string; revised: string; result: string }[] = [];
    let total = 0;
    try {
      for (const { a, b } of pairs) {
        const da = docs.find((d) => d.id === a.docId)!, db = docs.find((d) => d.id === b.docId)!;
        if (mode === 'compare') {
          const n = await compareDocuments(da, a.page, db, b.page, { cloudA: false, color: '#ff0000', method });
          total += n;
          rows.push({ current: describe(a), revised: describe(b), result: String(n) });
        } else {
          await overlayPages(da, a.page, db, b.page, '#e00000', '#0050ff');
          rows.push({ current: describe(a), revised: describe(b), result: `Overlay - ${da.name.replace(/\.pdf$/i, '')} vs ${db.name.replace(/\.pdf$/i, '')}.pdf` });
        }
      }
    } catch (e) { useApp.getState().setStatus(`${title} failed: ${(e as Error).message}`); return; }
    if (report) downloadText(`${title}.csv`, batchReportCsv(rows, mode === 'compare' ? 'Differences' : 'Overlay file'));
    const n = pairs.length;
    useApp.getState().setStatus(mode === 'compare'
      ? `Batch Compare: ${n} pair${n === 1 ? '' : 's'}, ${total} difference${total === 1 ? '' : 's'} clouded`
      : `Batch Overlay: ${n} overlay PDF${n === 1 ? '' : 's'} created`);
  };
  const list = (label: string, value: string[], set: (v: string[]) => void) => (
    <div className="form-row" style={{ alignItems: 'flex-start' }}><span>{label}</span>
      <select multiple aria-label={label} value={value} onChange={(e) => set(pick(e))} size={Math.min(6, Math.max(3, docs.length))} style={{ minWidth: 260 }}>
        {docs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
      </select>
    </div>
  );
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal" role="dialog" aria-label={title} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') close(); }}>
        <div className="modal-title">{title}</div>
        <div className="scale-dialog">
          {list('Current files', current, setCurrent)}
          {list('Revised files', revised, setRevised)}
          <div className="form-row"><span>Match pages by</span>
            <select aria-label="Match pages by" value={by} onChange={(e) => setBy(e.target.value as MatchBy)}>
              <option value="name-index">File Name, Page Index</option>
              <option value="label">Page Label</option>
            </select>
            <input aria-label="Match filter" placeholder="Match filter (e.g. ?-###)" value={filter} onChange={(e) => setFilter(e.target.value)} title="* non-numeric characters, # numbers, ? a letter, ; separates filters" style={{ width: 150 }} />
          </div>
          {mode === 'compare' && (
            <div className="form-row"><span>Compare</span>
              <select aria-label="Compare method" value={method} onChange={(e) => setMethod(e.target.value as 'raster' | 'vector')}>
                <option value="raster">Visual (rendered pages)</option>
                <option value="vector">Vector (lines and text)</option>
              </select>
            </div>
          )}
          <div className="form-row"><label><input type="checkbox" checked={report} onChange={(e) => setReport(e.target.checked)} /> Create CSV report</label></div>
          <div className="batch-pairs" aria-label="Matched pages">
            {pairs.length ? pairs.slice(0, 12).map((p, i) => <div key={i} className="small">{describe(p.a)} ⇄ {describe(p.b)}</div>) : <div className="muted small">No pages match. Open the files to compare and pick them above; with Page Label, labels must agree (a Match Filter can pick the sheet number out of a longer label).</div>}
            {pairs.length > 12 && <div className="muted small">… {pairs.length - 12} more</div>}
          </div>
          <div className="modal-actions">
            <span className="spacer" />
            <button className="primary" disabled={!pairs.length} onClick={ok}>OK</button>
            <button onClick={close}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}
