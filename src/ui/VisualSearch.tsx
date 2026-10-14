// VisualSearch (Search panel > Visual): Get Rectangle around a symbol on
// the sheet, then find it on the current page, the document or all open
// documents. Sensitivity sets how close a match must be; Search Multiple
// Rotations also tries 45° steps. Results show a thumbnail; checked ones can
// get a Count measurement, a Highlight or a Mark for Redaction.
import { create } from 'zustand';
import type { PDFPageProxy } from 'pdfjs-dist';
import { useApp, type DocState } from '../model/store';
import type { Pt } from '../model/types';
import { findMatches, paletteOf, rotateMask, scaleMask, suppress, toColorMask, toMask, trim, type Mask, type Match, type RGB } from '../model/visualSearch';
import { toolById } from '../tools/tools';
import { showHit, useSearch } from './Search';

/** Render resolution (pixels per point), capped for very large sheets. */
const K = 1.5, MAX_PX = 12_000_000;
const kFor = (w: number, h: number) => Math.min(K, Math.sqrt(MAX_PX / (w * h)));

export interface VResult { docId: string; page: number; rect: [Pt, Pt]; score: number; thumb: string; checked: boolean }
interface VState {
  template: { docId: string; page: number; rect: [Pt, Pt]; mask: Mask; k: number; preview: string; pixels: Uint8ClampedArray; w: number; h: number } | null;
  sensitivity: number; rotations: boolean; scope: 'page' | 'document' | 'all';
  /** Filter by Color: the symbol's colours, each on or off. */
  byColor: boolean; colors: { rgb: RGB; on: boolean }[];
  results: VResult[]; running: boolean; progress: string;
}
export const useVisual = create<VState>(() => ({ template: null, sensitivity: 0.8, rotations: false, scope: 'document', byColor: false, colors: [], results: [], running: false, progress: '' }));

/** The colours to match, or null when Filter by Color is off. */
const activeColors = (st: VState): RGB[] | null => (st.byColor && st.colors.some((c) => c.on) ? st.colors.filter((c) => c.on).map((c) => c.rgb) : null);

async function render(page: PDFPageProxy, k: number) {
  const vp = page.getViewport({ scale: k });
  const c = document.createElement('canvas');
  c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  await page.render({ canvas: c, viewport: vp, annotationMode: 0 }).promise;
  return { c, ctx };
}

export function startPick() {
  useApp.getState().setTool('visual-pick');
  useApp.getState().setStatus('VisualSearch: drag a rectangle around the symbol to find.');
}

/** The rectangle picked on the sheet (page space) becomes the symbol to find. */
export async function setVisualTemplate(d: DocState, pageIdx: number, a: Pt, b: Pt) {
  const page = await d.loaded.pdf.getPage(pageIdx + 1);
  const info = d.loaded.pages[pageIdx];
  const k = kFor(info.width, info.height);
  const x0 = Math.max(0, Math.floor(Math.min(a.x, b.x) * k)), y0 = Math.max(0, Math.floor(Math.min(a.y, b.y) * k));
  const x1 = Math.ceil(Math.max(a.x, b.x) * k), y1 = Math.ceil(Math.max(a.y, b.y) * k);
  const { c, ctx } = await render(page, k);
  const w = Math.min(c.width, x1) - x0, h = Math.min(c.height, y1) - y0;
  if (w < 3 || h < 3) return;
  const img = ctx.getImageData(x0, y0, w, h);
  const t = trim(toMask(img.data, w, h));
  const crop = document.createElement('canvas');
  crop.width = w; crop.height = h;
  crop.getContext('2d')!.putImageData(img, 0, 0);
  c.width = c.height = 0;
  if (!t) { useApp.getState().setStatus('VisualSearch: nothing drawn inside that rectangle.'); return; }
  useVisual.setState({
    template: { docId: d.id, page: pageIdx, rect: [a, b], mask: t.mask, k, preview: crop.toDataURL(), pixels: img.data, w, h }, results: [],
    colors: paletteOf(img.data, w, h).map((rgb) => ({ rgb, on: true })),
  });
  useApp.getState().setPanels({ left: 'search' });
  useSearch.setState({ mode: 'visual' });
  useApp.getState().setStatus('VisualSearch: symbol set. Click Search.');
}

export async function runVisualSearch() {
  const st = useVisual.getState();
  const app = useApp.getState();
  const t = st.template;
  if (!t) return;
  const active = app.docs.find((d) => d.id === app.activeId);
  if (!active) return;
  const docs = st.scope === 'all' ? app.docs : [active];
  const angles = st.rotations ? [0, 45, 90, 135, 180, 225, 270, 315] : [0];
  const colors = activeColors(st);
  const tMask = colors ? trim(toColorMask(t.pixels, t.w, t.h, colors))?.mask : t.mask;
  if (!tMask) { app.setStatus('VisualSearch: none of the chosen colours is in the symbol.'); return; }
  useVisual.setState({ running: true, results: [], progress: '' });
  const results: VResult[] = [];
  for (const d of docs) {
    const pages = st.scope === 'page' ? [d.page] : d.loaded.pages.map((p) => p.index);
    for (const p of pages) {
      useVisual.setState({ progress: `${d.name}: page ${d.loaded.pages[p].label}` });
      const info = d.loaded.pages[p];
      const k = kFor(info.width, info.height);
      const { c, ctx } = await render(await d.loaded.pdf.getPage(p + 1), k);
      const px = ctx.getImageData(0, 0, c.width, c.height).data;
      const mask = colors ? toColorMask(px, c.width, c.height, colors) : toMask(px, c.width, c.height);
      const base = scaleMask(tMask, k / t.k);
      let found: Match[] = [];
      for (const a of angles) {
        found.push(...findMatches(mask, rotateMask(base, a), st.sensitivity, a));
        await new Promise((r) => setTimeout(r, 0)); // keep the page responsive
      }
      found = suppress(found, 500);
      for (const m of found) {
        const pad = Math.round(Math.max(m.w, m.h) * 0.3);
        const tx = Math.max(0, m.x - pad), ty = Math.max(0, m.y - pad);
        const tw = Math.min(c.width - tx, m.w + 2 * pad), th = Math.min(c.height - ty, m.h + 2 * pad);
        const th_ = document.createElement('canvas');
        const s = Math.min(1, 72 / Math.max(tw, th));
        th_.width = Math.max(1, Math.round(tw * s)); th_.height = Math.max(1, Math.round(th * s));
        th_.getContext('2d')!.drawImage(c, tx, ty, tw, th, 0, 0, th_.width, th_.height);
        results.push({
          docId: d.id, page: p, score: m.score, checked: true, thumb: results.length < 300 ? th_.toDataURL() : '',
          rect: [{ x: m.x / k, y: m.y / k }, { x: (m.x + m.w) / k, y: (m.y + m.h) / k }],
        });
      }
      c.width = c.height = 0;
      useVisual.setState({ results: [...results] });
    }
  }
  useVisual.setState({ running: false, progress: '' });
  if (results.length) showVisual(0);
  app.setStatus(`VisualSearch: ${results.length} match${results.length === 1 ? '' : 'es'}`);
}

/** Go to result i (highlighted like text search results). */
export function showVisual(i: number) {
  const { results } = useVisual.getState();
  const r = results[i];
  if (!r) return;
  const app = useApp.getState();
  if (app.activeId !== r.docId) app.setActive(r.docId);
  const same = results.filter((x) => x.docId === r.docId);
  useSearch.setState({ docId: r.docId, hits: same.map((x) => ({ page: x.page, rect: x.rect, context: '' })) });
  showHit(same.indexOf(r));
}

/** Apply a markup to the checked results: Count (one per page), Highlight or Mark for Redaction. */
export function applyToChecked(kind: 'count' | 'highlight' | 'redaction') {
  const app = useApp.getState();
  const checked = useVisual.getState().results.filter((r) => r.checked && r.docId === app.activeId);
  if (!checked.length) { app.setStatus('Check results in the active document first.'); return; }
  if (kind === 'count') {
    const byPage = new Map<number, Pt[]>();
    for (const r of checked) byPage.set(r.page, [...(byPage.get(r.page) ?? []), { x: (r.rect[0].x + r.rect[1].x) / 2, y: (r.rect[0].y + r.rect[1].y) / 2 }]);
    for (const [page, points] of byPage) app.addMarkup({ type: 'count', page, points, style: app.toolDefaults.count, subject: toolById('count').subject });
  } else {
    for (const r of checked) app.addMarkup({ type: kind, page: r.page, points: r.rect, style: app.toolDefaults[kind], subject: toolById(kind).subject });
  }
  app.setStatus(`${checked.length} result${checked.length === 1 ? '' : 's'}: ${kind === 'count' ? 'counted' : kind === 'highlight' ? 'highlighted' : 'marked for redaction'}`);
}

export function VisualSearchPanel() {
  const st = useVisual();
  const set = (p: Partial<VState>) => useVisual.setState(p);
  const toggleAll = (v: boolean) => set({ results: st.results.map((r) => ({ ...r, checked: v })) });
  const docs = useApp((s) => s.docs);
  return (
    <div className="visual-search">
      <div className="search-row">
        <button onClick={startPick}>Get Rectangle</button>
        {st.template ? <img className="vs-preview" src={st.template.preview} alt="Symbol to find" /> : <span className="muted small">Drag a rectangle around a symbol on the sheet.</span>}
      </div>
      <div className="search-row small">
        <span>Search in</span>
        <select aria-label="Search in" value={st.scope} onChange={(e) => set({ scope: e.target.value as VState['scope'] })}>
          <option value="page">Current Page</option><option value="document">Current Document</option><option value="all">All Open Documents</option>
        </select>
      </div>
      <div className="search-row small">
        <span>Sensitivity</span>
        <input aria-label="Sensitivity" type="range" min={50} max={98} value={Math.round(st.sensitivity * 100)} onChange={(e) => set({ sensitivity: +e.target.value / 100 })} />
        <span>{Math.round(st.sensitivity * 100)}%</span>
      </div>
      <div className="search-row small"><label><input type="checkbox" checked={st.rotations} onChange={(e) => set({ rotations: e.target.checked })} /> Search multiple rotations</label></div>
      <div className="search-row small"><label><input type="checkbox" checked={st.byColor} disabled={!st.colors.length} onChange={(e) => set({ byColor: e.target.checked })} /> Filter by Color</label></div>
      {st.byColor && st.colors.length > 0 && (
        <div className="search-row small vs-colors" aria-label="Colors">
          {st.colors.map((c, i) => (
            <label key={i} title={`rgb(${c.rgb.join(', ')})`}>
              <input type="checkbox" aria-label={`Color ${i + 1}`} checked={c.on} onChange={(e) => set({ colors: st.colors.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)) })} />
              <span className="vs-swatch" style={{ background: `rgb(${c.rgb.join(',')})` }} />
            </label>
          ))}
        </div>
      )}
      <div className="search-row"><button className="primary" disabled={!st.template || st.running} onClick={() => runVisualSearch()}>Search</button></div>
      <div className="muted small">{st.running ? `Searching… ${st.progress}` : st.results.length ? `${st.results.length} result${st.results.length === 1 ? '' : 's'}` : ''}</div>
      {st.results.length > 0 && (
        <div className="search-row small">
          <label><input type="checkbox" aria-label="Check all" checked={st.results.every((r) => r.checked)} onChange={(e) => toggleAll(e.target.checked)} /> All</label>
          <select aria-label="Actions" value="" onChange={(e) => { const v = e.target.value; if (v === 'clear') set({ results: [] }); else if (v) applyToChecked(v as 'count'); }}>
            <option value="">Actions…</option>
            <option value="count">Apply Count Measurement to Checked</option>
            <option value="highlight">Highlight Checked</option>
            <option value="redaction">Mark for Redaction</option>
            <option value="clear">Clear Search Results</option>
          </select>
        </div>
      )}
      <div className="search-results vs-results">
        {st.results.map((r, i) => (
          <div key={i} className="vs-result">
            <input type="checkbox" aria-label={`Result ${i + 1}`} checked={r.checked} onChange={(e) => set({ results: st.results.map((x, j) => (j === i ? { ...x, checked: e.target.checked } : x)) })} />
            <button className="vs-hit" onClick={() => showVisual(i)} title={`${Math.round(r.score * 100)}% match`}>
              {r.thumb ? <img src={r.thumb} alt="" /> : null}
              <span className="small">{docs.length > 1 ? `${docs.find((d) => d.id === r.docId)?.name ?? ''} · ` : ''}{docs.find((d) => d.id === r.docId)?.loaded.pages[r.page]?.label}</span>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
