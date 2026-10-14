// Sheet tools: Page Labels (from title-block sheet numbers), Batch Link
// (hyperlink sheet references across the open documents) and the Sets panel.
import { useState } from 'react';
import { create } from 'zustand';
import { useApp, type DocState } from '../model/store';
import { findSheetNumber, sheetReferences } from '../model/sheets';
import { writePageLabels } from '../pdf/pages';
import { pageText } from './toolActions';
import { inRect } from '../model/measure';
import { useTagDialogs } from './Tags';

export const useSheetsDialog = create<{ open: 'labels' | 'batch-link' | null }>(() => ({ open: null }));

async function pageBoxes(d: DocState, i: number) {
  const p = await d.loaded.pdf.getPage(i + 1);
  return pageText(p, d.loaded.pages[i].viewport);
}

/** Sheet numbers found in each page's title block (null where none). */
export async function detectSheetNumbers(d: DocState): Promise<(string | null)[]> {
  const out: (string | null)[] = [];
  for (const pg of d.loaded.pages) out.push(findSheetNumber(await pageBoxes(d, pg.index), pg.width, pg.height));
  return out;
}

/**
 * Batch Link: for every page of `docs`, hyperlink each mention of another
 * page's label (sheet number) to that page, in the same or another document.
 */
export async function batchLink(docs: DocState[]): Promise<number> {
  const app = useApp.getState();
  const targets = docs.flatMap((d) => d.loaded.pages.map((p) => ({ doc: d, page: p.index, label: p.label })))
    .filter((t) => t.label && !/^\d+$/.test(t.label)); // plain page numbers are not sheet references
  const labels = [...new Set(targets.map((t) => t.label))];
  let n = 0;
  const cur = app.activeId;
  for (const d of docs) {
    for (const pg of d.loaded.pages) {
      const refs = sheetReferences(await pageBoxes(d, pg.index), labels).filter((r) => r.label !== pg.label);
      const existing = d.markups.filter((m) => m.type === 'link' && m.page === pg.index);
      useApp.setState({ activeId: d.id });
      for (const r of refs) {
        const c = { x: (r.box.x0 + r.box.x1) / 2, y: (r.box.y0 + r.box.y1) / 2 };
        if (existing.some((m) => inRect(c, [m.points[0], m.points[1]]))) continue; // already linked
        const t = targets.find((x) => x.label === r.label && x.doc.id === d.id) ?? targets.find((x) => x.label === r.label)!;
        useApp.getState().addMarkup({
          type: 'link', page: pg.index, points: [{ x: r.box.x0, y: r.box.y0 }, { x: r.box.x1, y: r.box.y1 }],
          style: app.toolDefaults.link, subject: 'Hyperlink', comment: `${t.doc.id === d.id ? '' : `${t.doc.name}: `}${r.label}`,
          link: t.doc.id === d.id ? { page: t.page } : { file: t.doc.name, page: t.page },
        });
        n++;
      }
    }
  }
  useApp.setState({ activeId: cur });
  return n;
}

export function SheetsDialog() {
  const open = useSheetsDialog((x) => x.open);
  const doc = useApp((s) => s.docs.find((d) => d.id === s.activeId));
  if (!open || !doc) return null;
  return open === 'labels' ? <LabelsForm doc={doc} /> : <BatchLinkForm doc={doc} />;
}

function Frame({ title, children }: { title: string; children: React.ReactNode }) {
  const close = () => useSheetsDialog.setState({ open: null });
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal" role="dialog" aria-label={title} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') close(); }}>
        <div className="modal-title">{title}</div>
        {children}
      </div>
    </div>
  );
}

function LabelsForm({ doc }: { doc: DocState }) {
  const s = useApp();
  const [labels, setLabels] = useState(doc.loaded.pages.map((p) => p.label));
  const [busy, setBusy] = useState(false);
  const close = () => useSheetsDialog.setState({ open: null });
  const detect = async () => {
    setBusy(true);
    const found = await detectSheetNumbers(doc);
    setLabels(labels.map((l, i) => found[i] ?? l));
    setBusy(false);
  };
  return (
    <Frame title="Page Labels">
      <div className="scale-dialog">
        <div className="labels-list">
          {labels.map((l, i) => (
            <div key={i} className="form-row"><span>Page {i + 1}</span>
              <input aria-label={`Label of page ${i + 1}`} value={l} onChange={(e) => setLabels(labels.map((x, k) => (k === i ? e.target.value : x)))} />
            </div>
          ))}
        </div>
        <div className="modal-actions">
          <button disabled={busy} onClick={detect}>{busy ? 'Reading title blocks…' : 'Use Sheet Numbers'}</button>
          <span className="spacer" />
          <button className="primary" onClick={async () => { close(); await s.transformDoc((lib) => writePageLabels(lib, labels), 'Page labels updated'); }}>OK</button>
          <button onClick={close}>Cancel</button>
        </div>
      </div>
    </Frame>
  );
}

function BatchLinkForm({ doc }: { doc: DocState }) {
  const s = useApp();
  const [scope, setScope] = useState<'doc' | 'all'>(s.docs.length > 1 ? 'all' : 'doc');
  const close = () => useSheetsDialog.setState({ open: null });
  return (
    <Frame title="Batch Link">
      <div className="scale-dialog">
        <div className="form-row"><span>Link</span>
          <select aria-label="Batch link scope" value={scope} onChange={(e) => setScope(e.target.value as 'doc')}>
            <option value="doc">This document</option><option value="all">All open documents (as a set)</option>
          </select>
        </div>
        <p className="muted small">Finds sheet numbers (page labels such as A-101) mentioned in the drawings and turns each mention into a hyperlink to that sheet. Set page labels first (Document &gt; Page Labels).</p>
        <div className="modal-actions">
          <span className="spacer" />
          <button className="primary" onClick={async () => {
            close();
            s.setStatus('Batch Link: reading sheets…');
            const n = await batchLink(scope === 'all' ? s.docs : [doc]);
            s.setStatus(`Batch Link created ${n} hyperlink${n === 1 ? '' : 's'}`);
          }}>Run</button>
          <button onClick={close}>Cancel</button>
        </div>
      </div>
    </Frame>
  );
}

// ---------------- Sets panel (Alt+2) ----------------

/** Revu Sets: several PDFs browsed as one set of sheets. Here: the open documents. */
export function SetsPanel() {
  const s = useApp();
  const [q, setQ] = useState('');
  const docs = s.docs;
  const match = (t: string) => !q || t.toLowerCase().includes(q.toLowerCase());
  return (
    <div className="sets-panel">
      <input aria-label="Filter sheets" placeholder="Filter sheets" value={q} onChange={(e) => setQ(e.target.value)} />
      {docs.map((d) => (
        <div key={d.id} className="set-doc">
          <div className="set-doc-name">{d.name}</div>
          {d.loaded.pages.filter((p) => match(p.label) || match(d.name)).map((p) => (
            <button key={p.index} className={`set-sheet ${d.id === s.activeId && d.page === p.index ? 'active' : ''}`}
              onClick={() => { s.setActive(d.id); s.setPage(p.index); }}>
              {p.label}
            </button>
          ))}
        </div>
      ))}
      {!docs.length && <p className="muted small">Open several PDFs (Ctrl+O, choose many) to browse them as one set.</p>}
      <div className="prop-actions">
        <button disabled={docs.length < 1} onClick={() => useSheetsDialog.setState({ open: 'batch-link' })}>Batch Link…</button>
        <button disabled={!docs.length} onClick={() => useSheetsDialog.setState({ open: 'labels' })}>Page Labels…</button>
        <button disabled={!docs.length} onClick={() => useTagDialogs.setState({ open: 'tags' })}>Tags…</button>
        <button disabled={!docs.length} onClick={() => useTagDialogs.setState({ open: 'log' })}>Export Drawing Log…</button>
      </div>
    </div>
  );
}
