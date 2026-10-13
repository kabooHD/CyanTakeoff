// Revu's Search panel (Ctrl+F / Alt+1): find text in the document, list
// results with context, highlight them on the page; F3 / Shift+F3 step.
import { useEffect, useRef } from 'react';
import { create } from 'zustand';
import { useApp, type DocState } from '../model/store';
import type { Pt } from '../model/types';
import { pageText } from './toolActions';
import { viewerApi } from './Viewer';

export interface Hit { page: number; rect: [Pt, Pt]; context: string }

interface SearchState {
  query: string; matchCase: boolean; wholeWord: boolean;
  hits: Hit[]; index: number; running: boolean; docId: string | null; focusTick: number;
}
export const useSearch = create<SearchState>(() => ({ query: '', matchCase: false, wholeWord: false, hits: [], index: -1, running: false, docId: null, focusTick: 0 }));

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export async function runSearch(doc: DocState) {
  const { query, matchCase, wholeWord } = useSearch.getState();
  if (!query.trim()) { useSearch.setState({ hits: [], index: -1 }); return; }
  useSearch.setState({ running: true, hits: [], index: -1, docId: doc.id });
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
        hits.push({ page: info.index, rect, context: b.str.trim() });
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

export const nextHit = (d: 1 | -1) => showHit(useSearch.getState().index + d);

export function SearchPanel({ doc }: { doc: DocState }) {
  const st = useSearch();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); input.current?.select(); }, [st.focusTick]);
  const hits = st.docId === doc.id ? st.hits : [];
  return (
    <div className="search-panel">
      <div className="search-row">
        <input ref={input} aria-label="Search text" placeholder="Search" value={st.query}
          onChange={(e) => useSearch.setState({ query: e.target.value })}
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') { if (e.shiftKey) nextHit(-1); else if (hits.length && st.query) nextHit(1); else runSearch(doc); } }} />
        <button onClick={() => runSearch(doc)}>Search</button>
      </div>
      <div className="search-row small">
        <label><input type="checkbox" checked={st.matchCase} onChange={(e) => useSearch.setState({ matchCase: e.target.checked })} /> Match case</label>
        <label><input type="checkbox" checked={st.wholeWord} onChange={(e) => useSearch.setState({ wholeWord: e.target.checked })} /> Whole words</label>
      </div>
      <div className="muted small">{st.running ? 'Searching…' : st.docId === doc.id && st.query ? `${hits.length} result${hits.length === 1 ? '' : 's'}` : ''}</div>
      <div className="search-results">
        {hits.map((h, i) => (
          <button key={i} className={`search-hit ${i === st.index ? 'active' : ''}`} onClick={() => showHit(i)}>
            <span className="muted">{doc.loaded.pages[h.page].label}</span> {h.context}
          </button>
        ))}
      </div>
    </div>
  );
}
