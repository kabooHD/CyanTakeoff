// Links panel (Revu, Alt+N): Places (named destinations: add, edit, delete,
// jump, hyperlink to a Place) and every hyperlink in the document (jump,
// multi-select with Ctrl, Edit Action, delete), each with a search filter.
import { useState } from 'react';
import { create } from 'zustand';
import { activeDoc, useApp, type DocState } from '../model/store';
import type { Markup, Pt } from '../model/types';
import { writePlaces, type Place } from '../pdf/places';
import { viewerApi } from './Viewer';
import { pickRect } from './pickRect';
import { anchorOf } from '../model/spaces';

/** Go to a Place: its page, then its view (top-left and zoom, or a rectangle). */
export function goToPlace(d: DocState, p: Place) {
  const s = useApp.getState();
  if (p.page === null || !d.loaded.pages[p.page]) { s.setStatus(`Place “${p.name}” points to a page that is not in this file`); return; }
  s.setPage(p.page);
  const vp = d.loaded.pages[p.page].viewport;
  const toPage = (x: number, y: number): Pt => { const [px, py] = vp.convertToViewportPoint(x, y); return { x: px, y: py }; };
  const [a0, a1, a2, a3] = p.args;
  setTimeout(() => {
    if (p.fit === 'FitR' && [a0, a1, a2, a3].every((v) => typeof v === 'number')) {
      const q0 = toPage(a0!, a1!), q1 = toPage(a2!, a3!);
      const { w, h } = viewerApi.viewSize();
      const rw = Math.abs(q1.x - q0.x), rh = Math.abs(q1.y - q0.y);
      if (rw > 0 && rh > 0) s.setZoom(Math.min(w / rw, h / rh) * 0.95);
      setTimeout(() => viewerApi.centerOn({ x: (q0.x + q1.x) / 2, y: (q0.y + q1.y) / 2 }), 60);
    } else if (p.fit === 'XYZ') {
      if (typeof a2 === 'number' && a2 > 0) s.setZoom(a2);
      setTimeout(() => viewerApi.showAt(toPage(a0 ?? 0, a1 ?? vp.viewBox[3])), 60);
    } else viewerApi.fitPage();
  }, 60);
}

/** Follow a hyperlink's Place. */
export function followPlace(d: DocState, name: string) {
  const p = d.loaded.places.find((x) => x.name === name);
  if (!p) { useApp.getState().setStatus(`The Place “${name}” no longer exists`); return; }
  goToPlace(d, p);
}

const savePlaces = (places: Place[], done: string) => useApp.getState().transformDoc((lib) => writePlaces(lib, places), done);

export function describeLink(d: DocState, m: Markup): string {
  const l = m.link;
  if (!l) return '';
  if (l.uri) return l.uri;
  if (l.dest) return `Place: ${l.dest}`;
  if (l.file) return `${l.file}, page ${(l.page ?? 0) + 1}`;
  return `Page ${d.loaded.pages[l.page ?? 0]?.label ?? (l.page ?? 0) + 1}`;
}

// ---------- Place dialog ----------

type PlaceDlg = { edit?: string; name: string; mode: 'page' | 'view' | 'rect'; page: number; rect?: { page: number; a: Pt; b: Pt } };
export const usePlaceDialog = create<{ dlg: PlaceDlg | null }>(() => ({ dlg: null }));

export function PlaceDialog() {
  const dlg = usePlaceDialog((x) => x.dlg);
  const d = useApp((s) => s.docs.find((x) => x.id === s.activeId));
  if (!dlg || !d) return null;
  const set = (p: Partial<PlaceDlg>) => usePlaceDialog.setState({ dlg: { ...dlg, ...p } });
  const close = () => usePlaceDialog.setState({ dlg: null });
  const n = d.loaded.pages.length;
  const taken = d.loaded.places.some((p) => p.name === dlg.name.trim() && p.name !== dlg.edit);
  const ok = async () => {
    const name = dlg.name.trim();
    if (!name || taken) return;
    let place: Place;
    if (dlg.mode === 'rect' && dlg.rect) {
      const vp = d.loaded.pages[dlg.rect.page].viewport;
      const [x0, y0] = vp.convertToPdfPoint(dlg.rect.a.x, dlg.rect.a.y), [x1, y1] = vp.convertToPdfPoint(dlg.rect.b.x, dlg.rect.b.y);
      place = { name, page: dlg.rect.page, fit: 'FitR', args: [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)] };
    } else if (dlg.mode === 'view') {
      const vp = d.loaded.pages[d.page].viewport;
      const tl = viewerApi.topLeft();
      const [x, y] = vp.convertToPdfPoint(tl.x, tl.y);
      place = { name, page: d.page, fit: 'XYZ', args: [Math.round(x), Math.round(y), d.zoom || null] };
    } else place = { name, page: Math.max(0, Math.min(n - 1, dlg.page)), fit: 'Fit', args: [] };
    close();
    const rest = d.loaded.places.filter((p) => p.name !== (dlg.edit ?? name));
    const ok = await savePlaces([...rest, place], dlg.edit ? 'Place changed' : `Place “${name}” added`);
    // Renaming a Place re-points the links that used its old name (Revu would leave them broken).
    if (ok && dlg.edit && dlg.edit !== name) {
      const s = useApp.getState(), cur = activeDoc();
      const ids = cur?.markups.filter((m) => m.link?.dest === dlg.edit).map((m) => m.id) ?? [];
      if (ids.length) s.updateMarkups(ids, (m) => ({ link: { ...m.link, dest: name }, comment: `Place: ${name}` }));
    }
  };
  const getRect = () => {
    usePlaceDialog.setState({ dlg: null });
    pickRect('Drag a rectangle for the Place\'s view', (_docId, page, a, b) => usePlaceDialog.setState({ dlg: { ...dlg, mode: 'rect', rect: { page, a, b } } }));
  };
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal" role="dialog" aria-label="Place" onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') close(); }}>
        <div className="modal-title">Place</div>
        <form className="scale-dialog" onSubmit={(e) => { e.preventDefault(); ok(); }}>
          <div className="form-row"><span>Name</span><input autoFocus aria-label="Place name" value={dlg.name} onChange={(e) => set({ name: e.target.value })} /></div>
          {taken && <p className="error">A Place with this name already exists.</p>}
          <div className="form-row"><label><input type="radio" checked={dlg.mode === 'page'} onChange={() => set({ mode: 'page' })} /> Page</label>
            <input type="number" aria-label="Place page" min={1} max={n} value={dlg.page + 1} onChange={(e) => set({ mode: 'page', page: Number(e.target.value) - 1 })} style={{ width: 70 }} /> of {n}</div>
          <div className="form-row"><label><input type="radio" checked={dlg.mode === 'view'} onChange={() => set({ mode: 'view' })} /> Current view (page {d.loaded.pages[d.page].label}, {Math.round((d.zoom || 1) * 100)}%)</label></div>
          <div className="form-row"><label><input type="radio" checked={dlg.mode === 'rect'} disabled={!dlg.rect} onChange={() => set({ mode: 'rect' })} /> Snapshot view{dlg.rect ? ` (page ${d.loaded.pages[dlg.rect.page]?.label})` : ''}</label>
            <button type="button" onClick={getRect}>Get Rectangle</button></div>
          {dlg.edit && dlg.edit !== dlg.name.trim() && <p className="muted small">Links to “{dlg.edit}” will be changed to the new name.</p>}
          <div className="modal-actions"><span className="spacer" /><button className="primary" type="submit" disabled={!dlg.name.trim() || taken}>OK</button><button type="button" onClick={close}>Cancel</button></div>
        </form>
      </div>
    </div>
  );
}

// ---------- panel ----------

export function LinksPanel({ doc }: { doc: DocState }) {
  const s = useApp();
  const [placeQ, setPlaceQ] = useState('');
  const [linkQ, setLinkQ] = useState('');
  const [selPlaces, setSelPlaces] = useState<string[]>([]);
  const places = doc.loaded.places.filter((p) => p.name.toLowerCase().includes(placeQ.toLowerCase()));
  const links = doc.markups.filter((m) => m.type === 'link')
    .map((m) => ({ m, text: describeLink(doc, m) }))
    .filter((x) => `${x.text} ${x.m.comment}`.toLowerCase().includes(linkQ.toLowerCase()))
    .sort((a, b) => a.m.page - b.m.page || a.m.points[0].y - b.m.points[0].y);
  const selLinks = links.filter((x) => doc.selection.includes(x.m.id)).map((x) => x.m.id);
  const pickPlace = (p: Place, add: boolean) => {
    setSelPlaces(add ? (selPlaces.includes(p.name) ? selPlaces.filter((x) => x !== p.name) : [...selPlaces, p.name]) : [p.name]);
    if (!add) goToPlace(doc, p);
  };
  const pickLink = (m: Markup, add: boolean) => {
    if (m.page !== doc.page) s.setPage(m.page);
    s.select(add ? (doc.selection.includes(m.id) ? doc.selection.filter((x) => x !== m.id) : [...doc.selection, m.id]) : [m.id], false, true);
    if (!add) setTimeout(() => viewerApi.centerOn(anchorOf(m)), 60);
  };
  const editPlace = () => {
    const p = doc.loaded.places.find((x) => x.name === selPlaces[0]);
    if (p) usePlaceDialog.setState({ dlg: { edit: p.name, name: p.name, mode: p.fit === 'FitR' ? 'page' : p.fit === 'XYZ' ? 'view' : 'page', page: p.page ?? 0 } });
  };
  const linkToPlace = (name: string) => {
    useApp.setState({ linkPlace: name });
    s.setTool('link');
    s.setStatus(`Drag the hyperlink's area; it will jump to the Place “${name}”.`);
  };
  return (
    <div className="spaces-panel links-panel">
      <div className="links-head">Places</div>
      <div className="prop-actions">
        <button onClick={() => usePlaceDialog.setState({ dlg: { name: `Place ${doc.loaded.places.length + 1}`, mode: 'view', page: doc.page } })}>Add Place</button>
        <button disabled={selPlaces.length !== 1} onClick={editPlace}>Edit Place</button>
        <button disabled={!selPlaces.length} onClick={() => { const keep = doc.loaded.places.filter((p) => !selPlaces.includes(p.name)); setSelPlaces([]); savePlaces(keep, 'Places deleted'); }}>Delete</button>
      </div>
      <input className="links-search" placeholder="Search Places" aria-label="Search Places" value={placeQ} onChange={(e) => setPlaceQ(e.target.value)} />
      {places.length ? places.map((p) => (
        <div key={p.name} className={`space-row link-row ${selPlaces.includes(p.name) ? 'selected' : ''}`} onClick={(e) => pickPlace(p, e.ctrlKey || e.metaKey)}>
          <span className="link-name">{p.name}</span>
          <span className="muted">{p.page === null ? 'missing page' : doc.loaded.pages[p.page]?.label}</span>
          <button className="link-go" title="Create a hyperlink to this Place" onClick={(e) => { e.stopPropagation(); linkToPlace(p.name); }}>🔗</button>
        </div>
      )) : <p className="muted small">{doc.loaded.places.length ? 'No matching Places.' : 'No Places. Add one to link to a page or view by name.'}</p>}

      <div className="links-head">Hyperlinks</div>
      <div className="prop-actions">
        <button onClick={() => s.setTool('link')}>Hyperlink</button>
        <button disabled={!selLinks.length} onClick={() => { const m = doc.markups.find((x) => x.id === selLinks[0])!; useApp.setState({ linkDialog: { page: m.page, rect: [m.points[0], m.points[1]], ids: selLinks } }); }}>Edit Action</button>
        <button disabled={!selLinks.length} onClick={() => s.deleteMarkups(selLinks)}>Delete</button>
      </div>
      <input className="links-search" placeholder="Search hyperlinks" aria-label="Search hyperlinks" value={linkQ} onChange={(e) => setLinkQ(e.target.value)} />
      {links.length ? links.map(({ m, text }) => (
        <div key={m.id} className={`space-row link-row ${doc.selection.includes(m.id) ? 'selected' : ''}`} onClick={(e) => pickLink(m, e.ctrlKey || e.metaKey)}>
          <span className="muted">{doc.loaded.pages[m.page]?.label}</span>
          <span className="link-name" title={text}>{text}</span>
        </div>
      )) : <p className="muted small">{doc.markups.some((m) => m.type === 'link') ? 'No matching hyperlinks.' : 'No hyperlinks in this document.'}</p>}
    </div>
  );
}
