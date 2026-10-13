// Revu's Spaces panel (Alt+S): named regions per page, nested by containment.
import { useState } from 'react';
import { activeDoc, useApp, useActiveDoc, type DocState } from '../model/store';
import { spaceTree, type SpaceNode } from '../model/spaces';
import { toolById } from '../tools/tools';
import type { Space } from '../model/types';

function createArea(page: number, sp: Space) {
  const s = useApp.getState();
  const m = s.addMarkup({ type: 'area', page, points: sp.points, style: s.toolDefaults.area, subject: toolById('area').subject, label: sp.title });
  s.select([m.id]);
}

export function SpacesPanel({ doc }: { doc: DocState }) {
  const s = useApp();
  const [editing, setEditing] = useState<string | null>(null);
  const page = doc.page;
  const list = doc.spaces[page] ?? [];
  const sel = list.find((x) => x.id === s.activeSpace);
  const row = (n: SpaceNode, depth: number): React.ReactNode => (
    <div key={n.space.id}>
      <div className={`space-row ${n.space.id === s.activeSpace ? 'selected' : ''}`} style={{ paddingLeft: 6 + depth * 14 }}
        onClick={() => useApp.setState({ activeSpace: n.space.id })} onDoubleClick={() => setEditing(n.space.id)}>
        <span className="swatch" style={{ background: n.space.color }} />
        {editing === n.space.id
          ? <input autoFocus defaultValue={n.space.title} aria-label="Space name"
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur(); }}
            onBlur={(e) => { setEditing(null); if (e.target.value.trim() && e.target.value !== n.space.title) s.setSpace(page, { ...n.space, title: e.target.value.trim() }); }} />
          : <span>{n.space.title || '(unnamed)'}</span>}
      </div>
      {n.kids.map((k) => row(k, depth + 1))}
    </div>
  );
  return (
    <div className="spaces-panel">
      <div className="prop-actions">
        <button onClick={() => { s.setTool('space'); s.setStatus('Add Space: drag a rectangle, or click the corners and click the first point (or Enter) to close.'); }}>Add Space</button>
        <button className={s.spacesHighlight ? 'on' : ''} onClick={() => useApp.setState({ spacesHighlight: !s.spacesHighlight })}>Highlight</button>
      </div>
      <div className="muted small pad-t">{doc.loaded.pages[page].label}</div>
      {list.length ? spaceTree(list).map((n) => row(n, 0)) : <p className="muted small">No Spaces on this page.</p>}
      {sel && (
        <div className="prop-actions">
          <button onClick={() => setEditing(sel.id)}>Rename</button>
          <label className="inline">Color <input type="color" aria-label="Space color" value={sel.color} onChange={(e) => s.setSpace(page, { ...sel, color: e.target.value })} /></label>
          <label className="inline">Opacity <input type="number" aria-label="Space opacity" min={0} max={100} step={5} value={Math.round(sel.opacity * 100)}
            onChange={(e) => s.setSpace(page, { ...sel, opacity: Math.max(0, Math.min(1, Number(e.target.value) / 100)) })} style={{ width: 52 }} />%</label>
          <button onClick={() => createArea(page, sel)}>Create Area Markup</button>
          <button onClick={() => s.deleteSpaces(page, [sel.id])}>Delete</button>
        </div>
      )}
    </div>
  );
}

/** Add Space: name the region just drawn. */
export function SpaceDialog() {
  const s = useApp();
  const doc = useActiveDoc();
  const dlg = s.spaceDialog;
  const [name, setName] = useState('');
  if (!dlg || !doc) return null;
  const close = () => useApp.setState({ spaceDialog: null });
  const ok = () => {
    const d = activeDoc();
    if (!d || !name.trim()) return;
    s.setSpace(dlg.page, { id: crypto.randomUUID(), title: name.trim(), points: dlg.points, color: '#0000ff', opacity: 0.1 });
    setName('');
  };
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal" role="dialog" aria-label="Add Space" onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') close(); if (e.key === 'Enter') ok(); }}>
        <div className="modal-title">Add Space</div>
        <div className="form-row"><span>Name</span><input autoFocus aria-label="Space name" value={name} onChange={(e) => setName(e.target.value)} style={{ width: 220 }} /></div>
        <div className="modal-actions"><span className="spacer" /><button className="primary" disabled={!name.trim()} onClick={ok}>OK</button><button onClick={close}>Cancel</button></div>
      </div>
    </div>
  );
}
