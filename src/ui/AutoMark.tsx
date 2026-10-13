// Create Bookmarks (Bookmarks panel > Bookmarks > Create Bookmarks), with
// Revu's AutoMark: one bookmark per page, named from the page labels or from
// the text in one or more regions of the page (e.g. the title block's sheet
// number and sheet title), over a page range.
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { useApp, type DocState } from '../model/store';
import type { Bookmark } from '../pdf/bookmarks';
import { parsePageRange } from '../model/measure';
import { textInRegion, type Region } from '../model/sheets';
import { pageText } from './toolActions';
import { pickRect } from './pickRect';

const LS = 'cyantakeoff:automark-regions';
const loadRegions = (): Region[] => { try { return JSON.parse(localStorage.getItem(LS) ?? '[]'); } catch { return []; } };

interface AMState {
  open: boolean; picking: boolean; source: 'labels' | 'region'; regions: Region[];
  range: 'all' | 'current' | 'custom'; custom: string; separator: string; replace: boolean;
}
export const useAutoMark = create<AMState>(() => ({ open: false, picking: false, source: 'region', regions: loadRegions(), range: 'all', custom: '', separator: ' - ', replace: true }));
const set = (p: Partial<AMState>) => {
  useAutoMark.setState(p);
  if (p.regions) try { localStorage.setItem(LS, JSON.stringify(p.regions)); } catch { /* storage unavailable */ }
};

export const openAutoMark = () => set({ open: true, picking: false });

function pages(d: DocState, st: AMState) {
  const n = d.loaded.pages.length;
  return st.range === 'all' ? Array.from({ length: n }, (_, i) => i) : st.range === 'current' ? [d.page] : parsePageRange(st.custom, n);
}

/** Bookmark titles for these pages. */
export async function autoMarkTitles(d: DocState, st: Pick<AMState, 'source' | 'regions' | 'separator'>, list: number[]): Promise<string[]> {
  const out: string[] = [];
  for (const i of list) {
    const info = d.loaded.pages[i];
    if (st.source === 'labels' || !st.regions.length) { out.push(info.label); continue; }
    const boxes = await pageText(await d.loaded.pdf.getPage(i + 1), info.viewport);
    const parts = st.regions.map((r) => textInRegion(boxes, r, info.width, info.height)).filter(Boolean);
    out.push(parts.join(st.separator) || info.label);
  }
  return out;
}

function addRegion() {
  set({ picking: true });
  pickRect('AutoMark: drag a rectangle around the text to use (e.g. the sheet number).', (docId, page, a, b) => {
    const d = useApp.getState().docs.find((x) => x.id === docId);
    if (!d) return;
    const { width: w, height: h } = d.loaded.pages[page];
    const st = useAutoMark.getState();
    set({ picking: false, source: 'region', regions: [...st.regions, { x0: Math.min(a.x, b.x) / w, y0: Math.min(a.y, b.y) / h, x1: Math.max(a.x, b.x) / w, y1: Math.max(a.y, b.y) / h }] });
  });
}

export function AutoMarkDialog() {
  const st = useAutoMark();
  const d = useApp((s) => s.docs.find((x) => x.id === s.activeId));
  const [preview, setPreview] = useState<string[]>([]);
  const list = d ? pages(d, st) : [];
  const key = `${d?.id}|${st.source}|${JSON.stringify(st.regions)}|${st.separator}|${list.join(',')}`;
  useEffect(() => {
    if (!d || !st.open || st.picking) return;
    let alive = true;
    autoMarkTitles(d, st, list.slice(0, 12)).then((t) => alive && setPreview(t));
    return () => { alive = false; };
  }, [key, st.open, st.picking]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!st.open || st.picking || !d) return null;
  const close = () => set({ open: false });
  const ok = async () => {
    const titles = await autoMarkTitles(d, st, list);
    const made: Bookmark[] = list.map((p, i) => ({ id: crypto.randomUUID(), title: titles[i], page: p, fit: 'Fit', args: [], destEdited: true, open: false, kids: [] }));
    const cur = useApp.getState().docs.find((x) => x.id === d.id)!;
    useApp.getState().setBookmarks(st.replace ? made : [...cur.bookmarks, ...made]);
    useApp.getState().setPanels({ left: 'bookmarks' });
    useApp.getState().setStatus(`Created ${made.length} bookmark${made.length === 1 ? '' : 's'}`);
    close();
  };
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal" role="dialog" aria-label="Create Bookmarks" onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') close(); }}>
        <div className="modal-title">Create Bookmarks</div>
        <div className="scale-dialog">
          <div className="form-row"><label><input type="radio" name="am-src" checked={st.source === 'labels'} onChange={() => set({ source: 'labels' })} /> Page Labels</label></div>
          <div className="form-row"><label><input type="radio" name="am-src" checked={st.source === 'region'} onChange={() => set({ source: 'region' })} /> Page Region (AutoMark)</label></div>
          {st.source === 'region' && (
            <>
              {st.regions.map((r, i) => (
                <div key={i} className="form-row"><span>Region {i + 1}</span>
                  <span className="muted small">{Math.round(r.x0 * 100)}–{Math.round(r.x1 * 100)}% across, {Math.round(r.y0 * 100)}–{Math.round(r.y1 * 100)}% down</span>
                  <button aria-label={`Remove region ${i + 1}`} onClick={() => set({ regions: st.regions.filter((_, j) => j !== i) })}>×</button>
                </div>
              ))}
              <div className="form-row"><span /><button onClick={addRegion}>{st.regions.length ? 'Add Region…' : 'Select Region…'}</button></div>
              {st.regions.length > 1 && <div className="form-row"><span>Join with</span><input aria-label="Separator" value={st.separator} onChange={(e) => set({ separator: e.target.value })} style={{ width: 60 }} /></div>}
            </>
          )}
          <div className="form-row"><span>Pages</span>
            <select aria-label="Pages" value={st.range} onChange={(e) => set({ range: e.target.value as AMState['range'] })}>
              <option value="all">All Pages</option><option value="current">Current ({d.loaded.pages[d.page]?.label})</option><option value="custom">Custom</option>
            </select>
            {st.range === 'custom' && <input aria-label="Custom pages" value={st.custom} placeholder="1-3, 5" onChange={(e) => set({ custom: e.target.value })} style={{ width: 100 }} />}
          </div>
          <div className="form-row"><label><input type="checkbox" checked={st.replace} onChange={(e) => set({ replace: e.target.checked })} /> Replace existing bookmarks</label></div>
          <div className="form-row"><span>Preview</span>
            <ol className="am-preview" aria-label="Bookmark preview">{preview.map((t, i) => <li key={i}>{t}</li>)}{list.length > 12 && <li className="muted">…</li>}</ol>
          </div>
          <div className="modal-actions"><span className="spacer" />
            <button className="primary" disabled={!list.length || (st.source === 'region' && !st.regions.length)} onClick={ok}>OK</button>
            <button onClick={close}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}
