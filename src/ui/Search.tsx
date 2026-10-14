// Revu's Search panel (Ctrl+F / Alt+1): find text in the document, list
// results with context, highlight them on the page; F3 / Shift+F3 step.
import { useEffect, useRef } from 'react';
import { create } from 'zustand';
import { useApp, type DocState } from '../model/store';
import type { Pt } from '../model/types';
import { pageText, type TextBox } from './toolActions';
import { editText } from '../pdf/editText';
import { replaceRanges } from '../model/textSelect';
import { viewerApi } from './Viewer';
import { VisualSearchPanel } from './VisualSearch';

export interface Hit {
  page: number; rect: [Pt, Pt]; context: string;
  /** The text run it is in (page space), and where in it: for Replace Checked. */
  run?: TextBox; index?: number; len?: number;
  /** Checked for Replace Checked (all are, after a search). */
  checked?: boolean;
}

interface SearchState {
  query: string; matchCase: boolean; wholeWord: boolean;
  hits: Hit[]; index: number; running: boolean; docId: string | null; focusTick: number;
  /** The query (and options) the current hits are for. */
  searched: string;
  /** Text or VisualSearch. */
  mode: 'text' | 'visual';
  /** Search > Replace Checked: the replacement text. */
  replaceWith: string;
}
export const useSearch = create<SearchState>(() => ({ query: '', matchCase: false, wholeWord: false, hits: [], index: -1, running: false, docId: null, focusTick: 0, searched: '', mode: 'text', replaceWith: '' }));

const signature = (s: Pick<SearchState, 'query' | 'matchCase' | 'wholeWord'>, docId: string) => `${docId}|${s.matchCase}|${s.wholeWord}|${s.query}`;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export async function runSearch(doc: DocState) {
  const { query, matchCase, wholeWord } = useSearch.getState();
  if (!query.trim()) { useSearch.setState({ hits: [], index: -1 }); return; }
  useSearch.setState({ running: true, hits: [], index: -1, docId: doc.id, searched: signature(useSearch.getState(), doc.id) });
  const re = new RegExp(wholeWord ? `\\b${escapeRe(query)}\\b` : escapeRe(query), matchCase ? 'g' : 'gi');
  const hits: Hit[] = [];
  for (const info of doc.loaded.pages) {
    const page = await doc.loaded.pdf.getPage(info.index + 1);
    const boxes = await pageText(page, info.viewport);
    for (const b of boxes) {
      re.lastIndex = 0;
      for (let m = re.exec(b.str); m; m = re.exec(b.str)) {
        // Place the match proportionally along its text run.
        const n = Math.max(1, b.str.length);
        const horiz = b.x1 - b.x0 >= b.y1 - b.y0;
        const a = m.index / n, z = (m.index + m[0].length) / n;
        const rect: [Pt, Pt] = horiz
          ? [{ x: b.x0 + (b.x1 - b.x0) * a, y: b.y0 }, { x: b.x0 + (b.x1 - b.x0) * z, y: b.y1 }]
          : [{ x: b.x0, y: b.y1 - (b.y1 - b.y0) * z }, { x: b.x1, y: b.y1 - (b.y1 - b.y0) * a }];
        hits.push({ page: info.index, rect, context: b.str.trim(), run: b, index: m.index, len: m[0].length, checked: true });
        if (!m[0].length) re.lastIndex++;
      }
    }
    if (useSearch.getState().docId !== doc.id) return;
  }
  useSearch.setState({ hits, running: false, index: hits.length ? 0 : -1 });
  if (hits.length) showHit(0);
}

export function showHit(i: number) {
  const { hits } = useSearch.getState();
  if (!hits.length) return;
  const k = ((i % hits.length) + hits.length) % hits.length;
  useSearch.setState({ index: k });
  const h = hits[k];
  const app = useApp.getState();
  app.setPage(h.page);
  setTimeout(() => viewerApi.centerOn({ x: (h.rect[0].x + h.rect[1].x) / 2, y: (h.rect[0].y + h.rect[1].y) / 2 }), 60);
}

/**
 * Search > Replace Checked (Revu): replace the checked results in the
 * page content, run by run (Edit Text), as one undoable change.
 */
export async function replaceChecked(doc: DocState) {
  const s = useApp.getState();
  const { hits, replaceWith } = useSearch.getState();
  const runs = new Map<string, { page: number; run: TextBox; ranges: { index: number; len: number }[] }>();
  for (const h of hits) {
    if (!h.checked || !h.run || h.index === undefined) continue;
    const key = `${h.page}:${h.run.x0}:${h.run.y0}:${h.run.str}`;
    const e = runs.get(key) ?? { page: h.page, run: h.run, ranges: [] };
    e.ranges.push({ index: h.index, len: h.len ?? 0 });
    runs.set(key, e);
  }
  let done = 0, missed = 0;
  const ok = await s.transformDoc(async (lib) => {
    for (const { page, run, ranges } of runs.values()) {
      const vp = doc.loaded.pages[page].viewport;
      const h = run.y1 - run.y0;
      const [c0, c1] = [{ x: run.x0 + 0.3, y: run.y0 + h * 0.2 }, { x: run.x1 - 0.3, y: run.y1 - h * 0.2 }].map((q) => vp.convertToPdfPoint(q.x, q.y) as [number, number]);
      const rect: [number, number, number, number] = [Math.min(c0[0], c1[0]), Math.min(c0[1], c1[1]), Math.max(c0[0], c1[0]), Math.max(c0[1], c1[1])];
      const r = await editText(lib, page, rect, run.str, replaceRanges(run.str, ranges, replaceWith), run.font);
      if (r.found) done += ranges.length; else missed += ranges.length;
    }
  }, 'Replaced');
  if (!ok) return;
  useSearch.setState({ hits: [], index: -1, searched: '' });
  s.setStatus(`Replaced ${done} result${done === 1 ? '' : 's'}${missed ? `; ${missed} could not be changed in the page content` : ''}`);
}

export const nextHit = (d: 1 | -1) => showHit(useSearch.getState().index + d);

export function SearchPanel({ doc }: { doc: DocState }) {
  const st = useSearch();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); input.current?.select(); }, [st.focusTick]);
  const hits = st.docId === doc.id ? st.hits : [];
  const modes = (
    <div className="search-row search-modes" role="tablist">
      <button role="tab" aria-selected={st.mode === 'text'} className={st.mode === 'text' ? 'active' : ''} onClick={() => useSearch.setState({ mode: 'text' })}>Text</button>
      <button role="tab" aria-selected={st.mode === 'visual'} className={st.mode === 'visual' ? 'active' : ''} onClick={() => useSearch.setState({ mode: 'visual' })}>Visual</button>
    </div>
  );
  if (st.mode === 'visual') return <div className="search-panel">{modes}<VisualSearchPanel /></div>;
  return (
    <div className="search-panel">
      {modes}
      <div className="search-row">
        <input ref={input} aria-label="Search text" placeholder="Search" value={st.query}
          onChange={(e) => useSearch.setState({ query: e.target.value })}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key !== 'Enter') return;
            // Enter searches; pressed again for the same query it steps through the results.
            if (st.searched !== signature(st, doc.id) || !hits.length) runSearch(doc);
            else nextHit(e.shiftKey ? -1 : 1);
          }} />
        <button onClick={() => runSearch(doc)}>Search</button>
      </div>
      <div className="search-row small">
        <label><input type="checkbox" checked={st.matchCase} onChange={(e) => useSearch.setState({ matchCase: e.target.checked })} /> Match case</label>
        <label><input type="checkbox" checked={st.wholeWord} onChange={(e) => useSearch.setState({ wholeWord: e.target.checked })} /> Whole words</label>
      </div>
      <div className="muted small">{st.running ? 'Searching…' : st.docId === doc.id && st.query ? `${hits.length} result${hits.length === 1 ? '' : 's'}` : ''}</div>
      {hits.length > 0 && (
        <div className="search-row small search-replace">
          <input aria-label="Replace with" placeholder="Replace with" value={st.replaceWith} onChange={(e) => useSearch.setState({ replaceWith: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />
          <button disabled={!hits.some((h) => h.checked)} onClick={() => replaceChecked(doc)}>Replace Checked</button>
          <button title="Check all" onClick={() => useSearch.setState({ hits: hits.map((h) => ({ ...h, checked: !hits.every((x) => x.checked) })) })}>{hits.every((x) => x.checked) ? 'None' : 'All'}</button>
        </div>
      )}
      <div className="search-results">
        {hits.map((h, i) => (
          <div key={i} className={`search-hit ${i === st.index ? 'active' : ''}`}>
            <input type="checkbox" aria-label="Replace this result" checked={!!h.checked} onChange={(e) => useSearch.setState({ hits: hits.map((x, k) => (k === i ? { ...x, checked: e.target.checked } : x)) })} />
            <button onClick={() => showHit(i)}><span className="muted">{doc.loaded.pages[h.page].label}</span> {h.context}</button>
          </div>
        ))}
      </div>
    </div>
  );
}
