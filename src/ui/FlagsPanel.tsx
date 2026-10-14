// Flags panel (Revu, Window > Flags): every flag of the document, for
// jumping around it. Linked flags are the Flag markups on the pages (title
// and colour from the markup, click jumps to it); unlinked flags exist only
// here, with an action of their own (Jump to Page / Place / Space, Snapshot
// View, Hyperlink, Open file). Toolbar: Flag (Shift+F), Add, Delete, Action,
// Properties. Flags on the active page span the panel's full width.
import { useState } from 'react';
import { useApp, type DocState } from '../model/store';
import { describeAction, flagRows, type FlagAction, type FlagRow, type UnlinkedFlag } from '../model/flags';
import { writeFlags } from '../pdf/flags';
import { anchorOf } from '../model/spaces';
import { viewerApi } from './Viewer';
import { followPlace } from './LinksPanel';
import { pickRect } from './pickRect';
import { editAction } from './quickCommands';

const newId = () => `flag-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

/** Write the unlinked flags into the document (undoable). */
function saveFlags(flags: UnlinkedFlag[], done: string) {
  return useApp.getState().transformDoc((lib) => writeFlags(lib, flags), done);
}

/** Run a flag's action. */
export function followFlag(d: DocState, row: FlagRow) {
  const s = useApp.getState();
  if (row.markup) {
    s.setPage(row.markup.page);
    const at = row.markup.points[0];
    setTimeout(() => viewerApi.centerOn(at), 60);
    s.select([row.markup.id]);
    return;
  }
  const a = row.unlinked!.action;
  switch (a.kind) {
    case 'page': s.setPage(a.page); if (a.zoom) s.setZoom(a.zoom); break;
    case 'place': followPlace(d, a.name); break;
    case 'space': {
      const sp = d.loaded.spaces.flat().find((x) => x.id === a.id);
      const page = d.loaded.spaces.findIndex((ps) => ps.some((x) => x.id === a.id));
      if (!sp || page < 0) { s.setStatus('That Space no longer exists.'); return; }
      s.setPage(page);
      setTimeout(() => viewerApi.centerOn(anchorOf({ type: 'polygon', points: sp.points } as never)), 60);
      break;
    }
    case 'snapshot': {
      s.setPage(a.page);
      const [x0, y0, x1, y1] = a.rect;
      const { w, h } = viewerApi.viewSize();
      s.setZoom(Math.min(w / Math.max(1, x1 - x0), h / Math.max(1, y1 - y0)) * 0.95);
      setTimeout(() => viewerApi.centerOn({ x: (x0 + x1) / 2, y: (y0 + y1) / 2 }), 60);
      break;
    }
    case 'uri': window.open(a.uri, '_blank', 'noopener'); break;
    case 'file': {
      const t = s.docs.find((x) => x.name === a.file);
      if (!t) { s.setStatus(`Open ${a.file} to follow this flag`); return; }
      s.setActive(t.id); s.setPage(a.page ?? 0);
      break;
    }
  }
}

export function FlagsPanel({ doc }: { doc: DocState }) {
  const s = useApp();
  const [sel, setSel] = useState<string | null>(null);
  const [editing, setEditing] = useState<'props' | 'action' | null>(null);
  const rows = flagRows(doc.markups, doc.loaded.flags);
  const cur = rows.find((r) => r.id === sel) ?? null;
  const label = (p: number) => doc.loaded.pages[p]?.label ?? String(p + 1);
  const unlinked = doc.loaded.flags;
  const update = (id: string, patch: Partial<UnlinkedFlag>, done: string) => saveFlags(unlinked.map((f) => (f.id === id ? { ...f, ...patch } : f)), done);
  const add = () => {
    const f: UnlinkedFlag = { id: newId(), title: label(doc.page), page: doc.page, color: '#000000', action: { kind: 'page', page: doc.page } };
    saveFlags([...unlinked, f], 'Flag added');
    setSel(f.id);
  };
  const del = () => {
    if (!cur) return;
    if (cur.markup) s.deleteMarkups([cur.markup.id]);
    else saveFlags(unlinked.filter((f) => f.id !== cur.id), 'Flag deleted');
    setSel(null); setEditing(null);
  };
  const action = () => {
    if (!cur) return;
    if (cur.markup) { editAction([cur.markup.id]); return; }
    setEditing(editing === 'action' ? null : 'action');
  };
  return (
    <div className="flags-panel">
      <div className="panel-toolbar">
        <button title="Flag (Shift+F): click the page to place a linked flag" onClick={() => s.setTool('flag')}>Flag</button>
        <button title="Add an unlinked flag for this page" onClick={add}>Add</button>
        <button title="Delete the selected flag" disabled={!cur} onClick={del}>Delete</button>
        <button title="Set the action of the selected flag" disabled={!cur} onClick={action}>Action</button>
        <button title="Title, colour and text style" disabled={!cur} onClick={() => setEditing(editing === 'props' ? null : 'props')}>Properties</button>
      </div>
      <div className="flags-list" role="list" aria-label="Flags">
        {rows.map((r) => (
          <div key={r.id} role="listitem" className={`flag-row space-row${r.id === sel ? ' selected' : ''}${r.page === doc.page ? ' on-page' : ''}`}
            style={{ fontWeight: r.bold ? 'bold' : undefined, fontStyle: r.italic ? 'italic' : undefined }}
            title={r.markup ? `Linked flag on page ${label(r.page)}` : describeAction(r.unlinked!.action, label)}
            onClick={() => { setSel(r.id); followFlag(doc, r); }}>
            <span className="swatch" style={{ background: r.color }} />
            <span className="flag-title">{r.title}</span>
            {r.markup && <span className="muted small" title="Linked to a Flag markup">🔗</span>}
            <span className="muted small">p{label(r.page)}</span>
          </div>
        ))}
        {!rows.length && <div className="muted small" style={{ padding: 8 }}>No flags. Flag (Shift+F) places one on the page; Add makes one for this page in the panel only.</div>}
      </div>
      {cur && editing === 'props' && (
        <div className="flag-edit">
          <label>Title <input aria-label="Flag title" value={cur.title} onChange={(e) => {
            if (cur.markup) s.updateMarkups([cur.markup.id], () => ({ label: e.target.value }));
            else update(cur.id, { title: e.target.value }, 'Flag renamed');
          }} /></label>
          <label>Colour <input type="color" aria-label="Flag colour" value={cur.color} onChange={(e) => {
            if (cur.markup) s.updateMarkups([cur.markup.id], (x) => ({ style: { ...x.style, color: e.target.value } }));
            else update(cur.id, { color: e.target.value }, 'Flag colour');
          }} /></label>
          {cur.unlinked && <>
            <label><input type="checkbox" checked={!!cur.bold} onChange={(e) => update(cur.id, { bold: e.target.checked || undefined }, 'Flag style')} /> Bold</label>
            <label><input type="checkbox" checked={!!cur.italic} onChange={(e) => update(cur.id, { italic: e.target.checked || undefined }, 'Flag style')} /> Italic</label>
          </>}
        </div>
      )}
      {cur?.unlinked && editing === 'action' && <ActionEditor doc={doc} flag={cur.unlinked} onChange={(a) => update(cur.id, { action: a }, 'Flag action')} />}
    </div>
  );
}

function ActionEditor({ doc, flag, onChange }: { doc: DocState; flag: UnlinkedFlag; onChange: (a: FlagAction) => void }) {
  const a = flag.action;
  const s = useApp();
  const pages = doc.loaded.pages;
  const spaces = doc.loaded.spaces.flat();
  const setKind = (kind: FlagAction['kind']) => {
    switch (kind) {
      case 'page': onChange({ kind, page: flag.page }); break;
      case 'place': onChange({ kind, name: doc.loaded.places[0]?.name ?? '' }); break;
      case 'space': onChange({ kind, id: spaces[0]?.id ?? '' }); break;
      case 'snapshot': onChange({ kind, page: flag.page, rect: [0, 0, pages[flag.page].width, pages[flag.page].height] }); break;
      case 'uri': onChange({ kind, uri: 'https://' }); break;
      case 'file': onChange({ kind, file: s.docs.find((d) => d.id !== doc.id)?.name ?? '', page: 0 }); break;
    }
  };
  return (
    <div className="flag-edit">
      <label>Action <select aria-label="Flag action" value={a.kind} onChange={(e) => setKind(e.target.value as FlagAction['kind'])}>
        <option value="page">Jump to Page</option>
        <option value="place">Jump to Place</option>
        <option value="space">Jump to Space</option>
        <option value="snapshot">Snapshot View</option>
        <option value="uri">Hyperlink</option>
        <option value="file">Open</option>
      </select></label>
      {a.kind === 'page' && <label>Page <select aria-label="Flag page" value={a.page} onChange={(e) => onChange({ ...a, page: Number(e.target.value) })}>
        {pages.map((p, i) => <option key={i} value={i}>{p.label}</option>)}
      </select> zoom <input aria-label="Flag zoom" type="number" min={10} max={800} step={10} style={{ width: 60 }} value={a.zoom ? Math.round(a.zoom * 100) : ''} placeholder="keep"
        onChange={(e) => onChange({ ...a, zoom: e.target.value ? Number(e.target.value) / 100 : undefined })} />%</label>}
      {a.kind === 'place' && <label>Place <select aria-label="Flag place" value={a.name} onChange={(e) => onChange({ ...a, name: e.target.value })}>
        {doc.loaded.places.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
      </select></label>}
      {a.kind === 'space' && <label>Space <select aria-label="Flag space" value={a.id} onChange={(e) => onChange({ ...a, id: e.target.value })}>
        {spaces.map((sp) => <option key={sp.id} value={sp.id}>{sp.title}</option>)}
      </select></label>}
      {a.kind === 'snapshot' && <button onClick={() => pickRect('Snapshot View: drag the area the flag should show.', (_id, page, p, q) => {
        onChange({ kind: 'snapshot', page, rect: [Math.min(p.x, q.x), Math.min(p.y, q.y), Math.max(p.x, q.x), Math.max(p.y, q.y)] });
        s.setPanels({ left: 'flags' });
      })}>Pick area…</button>}
      {a.kind === 'uri' && <label>URL <input aria-label="Flag URL" value={a.uri} onChange={(e) => onChange({ ...a, uri: e.target.value })} /></label>}
      {a.kind === 'file' && <label>File <input aria-label="Flag file" value={a.file} placeholder="name of an open file" onChange={(e) => onChange({ ...a, file: e.target.value })} /></label>}
    </div>
  );
}
