// Sheet tools: Page Labels (from title-block sheet numbers), Batch Link
// (hyperlink sheet references across the open documents) and the Sets panel.
import { useState } from 'react';
import { create } from 'zustand';
import { useApp, type DocState } from '../model/store';
import { findSheetNumber, sheetReferences } from '../model/sheets';
import { writePageLabels } from '../pdf/pages';
import { pageText } from './toolActions';
import { inRect } from '../model/measure';
import { DEFAULT_BATCH_LINK, batchLinkReportCsv, linkTargets, type BatchLinkOptions, type LinkAppearance, type LinkReportRow, type Overlap, type TermSource } from '../model/batchLink';
import { setSheets, useTagDialogs, useTags } from './Tags';
import { ContextMenu, type MenuItem } from './ContextMenu';
import { openPrint } from './Print';
import { DEFAULT_SET_OPTIONS, displayName, latestRevisions, previousRevisions, sortSheets, stackRevisions, type SetOptions, type SetSheet } from '../model/revisions';
import { toolById } from '../tools/tools';
import type { Markup } from '../model/types';

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
export async function batchLink(docs: DocState[], o: BatchLinkOptions = DEFAULT_BATCH_LINK): Promise<{ created: number; rows: LinkReportRow[] }> {
  const app = useApp.getState();
  const targets = linkTargets(docs.map((d) => ({ id: d.id, name: d.name, labels: d.loaded.pages.map((p) => p.label) })), o.source);
  const labels = [...new Set(targets.map((t) => t.label))];
  const byId = new Map(docs.map((d) => [d.id, d]));
  // Link appearance (Revu): an outline, a coloured highlight, or nothing visible (the link still works).
  const style = o.appearance === 'highlight' ? { ...app.toolDefaults.link, color: o.color, fill: o.color, fillOpacity: 0.35, width: 0 }
    : o.appearance === 'none' ? { ...app.toolDefaults.link, width: 0 } : app.toolDefaults.link;
  let n = 0;
  const rows: LinkReportRow[] = [];
  const cur = app.activeId;
  for (const d of docs) {
    for (const pg of d.loaded.pages) {
      const boxes = await pageBoxes(d, pg.index);
      const refs = sheetReferences(boxes, labels).filter((r) => r.label !== pg.label);
      const existing = d.markups.filter((m) => m.type === 'link' && m.page === pg.index);
      useApp.setState({ activeId: d.id });
      let created = 0, replaced = 0;
      for (const r of refs) {
        const c = { x: (r.box.x0 + r.box.x1) / 2, y: (r.box.y0 + r.box.y1) / 2 };
        const over = existing.filter((m) => inRect(c, [m.points[0], m.points[1]]));
        if (over.length) {
          if (o.overlap === 'skip') continue; // already linked
          useApp.getState().deleteMarkups(over.map((m) => m.id));
          replaced += over.length;
        }
        const t = targets.find((x) => x.label === r.label && x.docId === d.id) ?? targets.find((x) => x.label === r.label)!;
        const other = byId.get(t.docId);
        useApp.getState().addMarkup({
          type: 'link', page: pg.index, points: [{ x: r.box.x0, y: r.box.y0 }, { x: r.box.x1, y: r.box.y1 }],
          style, subject: 'Hyperlink', comment: `${t.docId === d.id ? '' : `${t.docName}: `}${r.label}`,
          link: t.docId === d.id ? { page: t.page } : { file: other?.name ?? t.docName, page: t.page },
        });
        n++; created++;
      }
      rows.push({ document: d.name, page: pg.label, created, replaced, note: boxes.length ? '' : 'no searchable text' });
    }
  }
  useApp.setState({ activeId: cur });
  return { created: n, rows };
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
  const [o, setO] = useState<BatchLinkOptions>(DEFAULT_BATCH_LINK);
  const set = (p: Partial<BatchLinkOptions>) => setO((x) => ({ ...x, ...p }));
  const close = () => useSheetsDialog.setState({ open: null });
  return (
    <Frame title="Batch Link">
      <div className="scale-dialog">
        <div className="form-row"><span>Link</span>
          <select aria-label="Batch link scope" value={scope} onChange={(e) => setScope(e.target.value as 'doc')}>
            <option value="doc">This document</option><option value="all">All open documents (as a set)</option>
          </select>
        </div>
        <div className="form-row"><span>Search terms</span>
          <select aria-label="Search terms" value={o.source} onChange={(e) => set({ source: e.target.value as TermSource })}><option value="label">Page labels (sheet numbers)</option><option value="filename">File names</option></select>
        </div>
        <div className="form-row"><span>Appearance</span>
          <select aria-label="Link appearance" value={o.appearance} onChange={(e) => set({ appearance: e.target.value as LinkAppearance })}><option value="outline">Outline</option><option value="highlight">Highlight Links</option><option value="none">Invisible</option></select>
          {o.appearance === 'highlight' && <input type="color" aria-label="Highlight colour" value={o.color} onChange={(e) => set({ color: e.target.value })} />}
        </div>
        <div className="form-row"><span>Existing links</span>
          <select aria-label="Overlap" value={o.overlap} onChange={(e) => set({ overlap: e.target.value as Overlap })}><option value="skip">Keep (skip the mention)</option><option value="replace">Replace</option></select>
        </div>
        <div className="form-row"><label><input type="checkbox" checked={o.report} onChange={(e) => set({ report: e.target.checked })} /> Save the summary report (CSV)</label></div>
        <p className="muted small">Finds the terms (page labels such as A-101, or file names) mentioned in the drawings and turns each mention into a hyperlink to that sheet. Set page labels first (Document &gt; Page Labels).</p>
        <div className="modal-actions">
          <span className="spacer" />
          <button className="primary" onClick={async () => {
            close();
            s.setStatus('Batch Link: reading sheets…');
            const { created: n, rows } = await batchLink(scope === 'all' ? s.docs : [doc], o);
            s.setStatus(`Batch Link created ${n} hyperlink${n === 1 ? '' : 's'}`);
            if (o.report) {
              const url = URL.createObjectURL(new Blob(['\ufeff' + batchLinkReportCsv(rows)], { type: 'text/csv' }));
              Object.assign(document.createElement('a'), { href: url, download: `${doc.name.replace(/\.pdf$/i, '')} - Batch Link report.csv` }).click();
              setTimeout(() => URL.revokeObjectURL(url), 10_000);
            }
          }}>Run</button>
          <button onClick={close}>Cancel</button>
        </div>
      </div>
    </Frame>
  );
}

// ---------------- Sets panel (Alt+2) ----------------

const SET_OPTIONS_KEY = 'cyantakeoff:set-options';
const loadSetOptions = (): SetOptions => {
  try { return { ...DEFAULT_SET_OPTIONS, ...(JSON.parse(localStorage.getItem(SET_OPTIONS_KEY) ?? 'null') ?? {}) }; } catch { return DEFAULT_SET_OPTIONS; }
};
/** Set options (Revu: Sets > Options: Sorting tab), kept in the browser. */
export const useSetOptions = create<{ o: SetOptions; set: (p: Partial<SetOptions>) => void }>((set, get) => ({
  o: typeof localStorage === 'undefined' ? DEFAULT_SET_OPTIONS : loadSetOptions(),
  set: (p) => { const o = { ...get().o, ...p }; set({ o }); try { localStorage.setItem(SET_OPTIONS_KEY, JSON.stringify(o)); } catch { /* private mode */ } },
}));

/** Stamp Previous Revisions "Superseded" (Revu): a stamp in the middle of every previous revision sheet. */
function stampSuperseded(sheets: SetSheet[]) {
  const s = useApp.getState();
  const now = new Date().toISOString();
  let n = 0;
  for (const d of s.docs) {
    const ms: Markup[] = sheets.filter((sh) => sh.docId === d.id).map((sh) => {
      const info = d.loaded.pages[sh.page];
      return { id: crypto.randomUUID(), type: 'stamp', page: sh.page, points: [{ x: info.width / 2, y: info.height / 2 }], style: s.toolDefaults.stamp, subject: toolById('stamp').subject, text: 'SUPERSEDED', author: s.author, created: now, modified: now, status: 'None', label: '', comment: '' };
    });
    if (ms.length) { s.addMarkups(ms, d.id); n += ms.length; }
  }
  s.setStatus(`Superseded stamp added to ${n} sheet${n === 1 ? '' : 's'}.`);
}

function SetOptionsDialog({ onClose }: { onClose: () => void }) {
  const { o, set } = useSetOptions();
  const Sel = <K extends keyof SetOptions>({ k, label, items }: { k: K; label: string; items: [SetOptions[K] & string, string][] }) => (
    <div className="form-row"><span>{label}</span>
      <select aria-label={label} value={o[k] as string} onChange={(e) => set({ [k]: e.target.value } as Partial<SetOptions>)}>{items.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
    </div>
  );
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label="Set Options" onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') onClose(); }}>
        <div className="modal-title">Set Options</div>
        <div className="scale-dialog">
          <div className="prop-section">Sorting</div>
          <Sel k="show" label="Show" items={[['label', 'Page Label'], ['filename', 'File Name'], ['name-label', 'File Name and Page Label'], ['sheetNumber', 'Sheet Number'], ['sheetName', 'Sheet Number and Name']]} />
          <Sel k="sortBy" label="Sort By" items={[['label', 'Page Label'], ['name-label', 'File Name, Page Label'], ['name-index', 'File Name, Page Index']]} />
          <Sel k="order" label="Sort Order" items={[['alnum-asc', 'Alphanumeric ascending'], ['alnum-desc', 'Alphanumeric descending'], ['alpha-asc', 'Alphabetic ascending'], ['alpha-desc', 'Alphabetic descending']]} />
          <div className="prop-section">Revisions</div>
          <Sel k="filter" label="Revision Filter" items={[['auto', 'Auto'], ['wildcard', 'Wildcard'], ['off', 'Off']]} />
          {o.filter === 'wildcard' && <div className="form-row"><span>Wildcard</span><input aria-label="Revision wildcard" placeholder="e.g. R#  (* any, # number, ? letter, ; separates)" value={o.pattern} onChange={(e) => set({ pattern: e.target.value })} /></div>}
          <Sel k="previous" label="Previous Revisions" items={[['hide', 'Hide'], ['gray', 'Gray out'], ['strike', 'Cross out'], ['show', 'Show']]} />
          <div className="form-row"><label><input type="checkbox" checked={o.stack} onChange={(e) => set({ stack: e.target.checked })} /> Stack revisions (arrow shows the previous ones)</label></div>
          <div className="modal-actions"><span className="spacer" /><button className="primary" onClick={onClose}>Close</button></div>
        </div>
      </div>
    </div>
  );
}

/** Revu Sets: several PDFs browsed as one set of sheets. Here: the open documents, with revision stacks and the Set options. */
export function SetsPanel() {
  const s = useApp();
  const { o } = useSetOptions();
  const tagState = useTags();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [options, setOptions] = useState(false);
  const docs = s.docs;
  const match = (t: string) => !q || t.toLowerCase().includes(q.toLowerCase());
  const tagged = setSheets(docs, tagState.values, tagState.tags);
  const sheets: SetSheet[] = sortSheets(docs.flatMap((d) => d.loaded.pages.map((p) => {
    const t = tagged.find((x) => x.docName === d.name && x.page === p.index)?.values ?? {};
    return { key: `${d.name}#${p.index}`, docId: d.id, docName: d.name, page: p.index, label: p.label, sheetNumber: t['Sheet Number'], sheetName: t['Sheet Name'] };
  })), o);
  const stacks = stackRevisions(sheets, o);
  const previous = previousRevisions(stacks), latest = latestRevisions(stacks);
  const pick = (keys: Iterable<string>, what: string) => { const k = new Set(keys); setSel(k); s.setStatus(`Selected ${k.size} ${what}.`); };
  const items: MenuItem[] = [
    { label: 'Select All', action: () => pick(sheets.map((x) => x.key), 'sheets') },
    { label: 'Select Latest Revisions', action: () => pick(latest, 'latest revisions') },
    { label: 'Select Previous Revisions', disabled: !previous.size, action: () => pick(previous, 'previous revisions') },
    { sep: true },
    { label: 'Options…', action: () => setOptions(true) },
    { label: 'Stamp Previous Revisions "Superseded"', disabled: !previous.size, action: () => stampSuperseded(sheets.filter((x) => previous.has(x.key))) },
    { sep: true },
    { label: 'Print Set…', disabled: !docs.length, action: () => openPrint() },
    { label: 'Search Set', disabled: !docs.length, action: () => s.setPanels({ left: 'search' }) },
    { label: 'Tags…', disabled: !docs.length, action: () => useTagDialogs.setState({ open: 'tags' }) },
    { label: 'Export Drawing Log…', disabled: !docs.length, action: () => useTagDialogs.setState({ open: 'log' }) },
  ];
  const go = (sh: SetSheet, e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey) { const k = new Set(sel); if (k.has(sh.key)) k.delete(sh.key); else k.add(sh.key); setSel(k); return; }
    setSel(new Set([sh.key]));
    s.setActive(sh.docId); s.setPage(sh.page);
  };
  const row = (sh: SetSheet, prev: boolean) => (
    <button key={sh.key} className={`set-sheet ${sh.docId === s.activeId && docs.find((d) => d.id === sh.docId)?.page === sh.page ? 'active' : ''} ${sel.has(sh.key) ? 'selected' : ''} ${prev ? `prev-${o.previous}` : ''}`}
      aria-label={`Sheet ${displayName(sh, o.show)}${prev ? ' (previous revision)' : ''}`} onClick={(e) => go(sh, e)}>
      {displayName(sh, o.show)}
    </button>
  );
  const shown = stacks.filter((st) => st.sheets.some((sh) => match(displayName(sh, o.show)) || match(sh.docName)));
  return (
    <div className="sets-panel">
      <div className="layers-toolbar">
        <button onClick={(e) => setMenu({ x: e.clientX, y: e.clientY, items })}>Sets ▾</button>
        <input aria-label="Filter sheets" placeholder="Filter sheets" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {shown.map((st) => {
        const prevs = st.sheets.filter((sh) => sh !== st.latest);
        const open = expanded.has(st.base);
        return (
          <div key={st.base + st.latest.key} className="set-stack">
            {row(st.latest, false)}
            {prevs.length > 0 && o.previous !== 'hide' && o.stack && (
              <button className="set-stack-toggle" aria-label={`${open ? 'Hide' : 'Show'} previous revisions of ${st.base}`} aria-expanded={open}
                onClick={() => { const k = new Set(expanded); if (open) k.delete(st.base); else k.add(st.base); setExpanded(k); }}>{open ? '▾' : '▸'} {prevs.length} previous revision{prevs.length === 1 ? '' : 's'}</button>
            )}
            {o.previous !== 'hide' && (!o.stack || open) && prevs.map((sh) => row(sh, true))}
          </div>
        );
      })}
      {!docs.length && <p className="muted small">Open several PDFs (Ctrl+O, choose many) to browse them as one set.</p>}
      <div className="prop-actions">
        <button disabled={docs.length < 1} onClick={() => useSheetsDialog.setState({ open: 'batch-link' })}>Batch Link…</button>
        <button disabled={!docs.length} onClick={() => useSheetsDialog.setState({ open: 'labels' })}>Page Labels…</button>
        <button disabled={!docs.length} onClick={() => useTagDialogs.setState({ open: 'tags' })}>Tags…</button>
        <button disabled={!docs.length} onClick={() => useTagDialogs.setState({ open: 'log' })}>Export Drawing Log…</button>
      </div>
      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
      {options && <SetOptionsDialog onClose={() => setOptions(false)} />}
    </div>
  );
}
