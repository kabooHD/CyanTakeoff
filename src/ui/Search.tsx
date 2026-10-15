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
import { countPointsByPage, queryRegExp, searchFields, searchMarkups, searchProperties } from '../model/searchScope';
import { markupBounds } from './hit';
import { toolById } from '../tools/tools';

export interface Hit {
  page: number; rect: [Pt, Pt]; context: string;
  /** Where the hit is: page text (default), a markup, a form field or a document property (page -1). */
  kind?: 'text' | 'markup' | 'field' | 'property';
  markupId?: string;
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
  /** What is searched (Revu: Search Pages, Search Markups, Search Form Fields, Search File Properties). */
  scope: { pages: boolean; markups: boolean; fields: boolean; props: boolean };
}
export const useSearch = create<SearchState>(() => ({ query: '', matchCase: false, wholeWord: false, hits: [], index: -1, running: false, docId: null, focusTick: 0, searched: '', mode: 'text', replaceWith: '', scope: { pages: true, markups: false, fields: false, props: false } }));

const signature = (s: Pick<SearchState, 'query' | 'matchCase' | 'wholeWord' | 'scope'>, docId: string) => `${docId}|${s.matchCase}|${s.wholeWord}|${JSON.stringify(s.scope)}|${s.query}`;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export async function runSearch(doc: DocState) {
  const { query, matchCase, wholeWord, scope } = useSearch.getState();
  if (!query.trim()) { useSearch.setState({ hits: [], index: -1 }); return; }
  useSearch.setState({ running: true, hits: [], index: -1, docId: doc.id, searched: signature(useSearch.getState(), doc.id) });
  const re = new RegExp(wholeWord ? `\\b${escapeRe(query)}\\b` : escapeRe(query), matchCase ? 'g' : 'gi');
  const hits: Hit[] = [];
  const re1 = queryRegExp(query, matchCase, wholeWord);
  if (scope.props) {
    const info = await doc.loaded.pdf.getMetadata().then((m) => (m.info ?? {}) as Record<string, unknown>).catch(() => ({}));
    hits.push(...searchProperties(info, re1));
  }
  if (scope.markups) hits.push(...searchMarkups(doc.markups, re1, (m) => markupBounds(m)));
  if (scope.fields) hits.push(...searchFields(doc.loaded.fields, doc.formValues, re1));
  for (const info of scope.pages ? doc.loaded.pages : []) {
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
        hits.push({ kind: 'text', page: info.index, rect, context: b.str.trim(), run: b, index: m.index, len: m[0].length, checked: true });
        if (!m[0].length) re.lastIndex++;
      }
    }
    if (useSearch.getState().docId !== doc.id) return;
  }
  for (const h of hits) if (h.checked === undefined) h.checked = true;
  hits.sort((a, b) => a.page - b.page);
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
  if (h.page < 0) { app.setStatus(`Document property: ${h.context}`); return; }
  app.setPage(h.page);
  if (h.markupId) app.select([h.markupId]);
  setTimeout(() => viewerApi.centerOn({ x: (h.rect[0].x + h.rect[1].x) / 2, y: (h.rect[0].y + h.rect[1].y) / 2 }), 60);
}

export type CheckAction = 'hyperlink' | 'highlight' | 'underline' | 'squiggly' | 'strikeout' | 'redaction' | 'count';

/**
 * Check Options (Revu): a markup on every checked result found in the page
 * text; Count puts one Count per page with a point on each result.
 */
export function applyToCheckedHits(doc: DocState, action: CheckAction) {
  const app = useApp.getState();
  const checked = useSearch.getState().hits.filter((h) => h.checked && h.page >= 0 && (h.kind ?? 'text') === 'text');
  if (!checked.length) { app.setStatus('Check results found in the page text first.'); return; }
  const ms: Parameters<typeof app.addMarkup>[0][] = [];
  if (action === 'count') {
    for (const [page, points] of countPointsByPage(checked)) ms.push({ type: 'count', page, points, style: app.toolDefaults.count, subject: toolById('count').subject });
  } else if (action === 'hyperlink') {
    const to = prompt('Hyperlink the checked results to (a web address, or a page number)', 'https://');
    if (!to) return;
    const page = /^\d+$/.test(to.trim()) ? Number(to.trim()) - 1 : undefined;
    const link = page !== undefined && doc.loaded.pages[page] ? { page } : { uri: to.trim() };
    for (const h of checked) ms.push({ type: 'link', page: h.page, points: h.rect, style: app.toolDefaults.link, subject: 'Hyperlink', comment: 'uri' in link ? link.uri : `Page ${page! + 1}`, link });
  } else {
    for (const h of checked) ms.push({ type: action, page: h.page, points: h.rect, style: app.toolDefaults[action], subject: toolById(action).subject });
  }
  const cur = app.activeId;
  useApp.setState({ activeId: doc.id });
  app.addMarkups(ms.map((m) => ({ ...m, id: crypto.randomUUID(), author: app.author, created: new Date().toISOString(), modified: new Date().toISOString(), status: 'None', label: '', comment: m.comment ?? '' } as never)));
  useApp.setState({ activeId: cur });
  const what = { hyperlink: 'hyperlinked', highlight: 'highlighted', underline: 'underlined', squiggly: 'marked squiggly', strikeout: 'struck through', redaction: 'marked for redaction', count: 'counted' }[action];
  app.setStatus(`${checked.length} result${checked.length === 1 ? '' : 's'} ${what}`);
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
      <div className="search-row small search-scope">
        {([['pages', 'Pages'], ['markups', 'Markups'], ['fields', 'Form Fields'], ['props', 'File Properties']] as const).map(([k, label]) => (
          <label key={k}><input type="checkbox" checked={st.scope[k]} onChange={(e) => useSearch.setState({ scope: { ...st.scope, [k]: e.target.checked } })} /> {label}</label>
        ))}
      </div>
      <div className="muted small">{st.running ? 'Searching…' : st.docId === doc.id && st.query ? `${hits.length} result${hits.length === 1 ? '' : 's'}` : ''}</div>
      {hits.length > 0 && (
        <>
          <div className="search-row small search-actions">
            <button title="Check every result" onClick={() => useSearch.setState({ hits: hits.map((h) => ({ ...h, checked: !hits.every((x) => x.checked) })) })}>{hits.every((x) => x.checked) ? 'Select None' : 'Select All'}</button>
            <select aria-label="Check options" value="" disabled={!hits.some((h) => h.checked)} onChange={(e) => { const v = e.target.value as CheckAction | ''; e.target.value = ''; if (v) applyToCheckedHits(doc, v); }}>
              <option value="">Check Options…</option>
              <option value="hyperlink">Hyperlink Checked</option>
              <option value="redaction">Mark for Redaction</option>
              <option value="count">Apply Count Measurement to Checked</option>
              <option value="highlight">Highlight Checked</option>
              <option value="underline">Underline Checked</option>
              <option value="squiggly">Squiggly Checked</option>
              <option value="strikeout">Strikethrough Checked</option>
            </select>
            <button title="Clear the results" onClick={() => useSearch.setState({ hits: [], index: -1, searched: '' })}>Clear</button>
          </div>
          {hits.some((h) => (h.kind ?? 'text') === 'text') && (
            <div className="search-row small search-replace">
              <input aria-label="Replace with" placeholder="Replace with" value={st.replaceWith} onChange={(e) => useSearch.setState({ replaceWith: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />
              <button disabled={!hits.some((h) => h.checked && (h.kind ?? 'text') === 'text')} onClick={() => replaceChecked(doc)}>Replace Checked</button>
            </div>
          )}
        </>
      )}
      <div className="search-results">
        {hits.map((h, i) => (
          <div key={i} className={`search-hit ${i === st.index ? 'active' : ''}`}>
            <input type="checkbox" aria-label="Check this result" checked={!!h.checked} onChange={(e) => useSearch.setState({ hits: hits.map((x, k) => (k === i ? { ...x, checked: e.target.checked } : x)) })} />
            <button onClick={() => showHit(i)} data-kind={h.kind ?? 'text'}><span className="muted">{h.page < 0 ? 'Properties' : doc.loaded.pages[h.page].label}{h.kind === 'markup' ? ' ✎' : h.kind === 'field' ? ' ▭' : ''}</span> {h.context}</button>
          </div>
        ))}
      </div>
    </div>
  );
}
