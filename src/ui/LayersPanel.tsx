// Revu's Layers panel (Alt+Y): the PDF's layers with visibility, Isolate,
// Markup Layer, add (before / after / child), layer groups, rename,
// delete (content and markups removed or moved to the base PDF), Layer
// Properties, saved configurations, and reordering by drag.
import { useState } from 'react';
import { create } from 'zustand';
import { PDFArray, PDFDict, PDFName, PDFRef } from 'pdf-lib';
import { activeDoc, serialize, useApp, type DocState } from '../model/store';
import { alphabetical, layerMatrix, findNode, idsUnder, insertNode, moveNode, nodeKey, removeNodes, withoutLayers, type Where } from '../model/layerTree';
import { keepOnlyLayers, readLayers, refId, stripLayerContent, transformLayer, writeLayers, type Layer, type LayerNode, type LayerSet } from '../pdf/layers';
import { loadForUpdate } from '../pdf/incremental';
import { layerShown } from './layersView';
import { ContextMenu, type MenuItem } from './ContextMenu';
import { openCompare } from './Compare';

const EMPTY: LayerSet = { layers: {}, order: [], configs: [] };

export const useLayersUi = create<{ dialog: { kind: 'delete' | 'props' | 'adjust'; keys: string[] } | null; onPage: boolean; alpha: boolean }>(() => ({ dialog: null, onPage: false, alpha: false }));

const setOf = (d: DocState) => d.layers ?? EMPTY;
const newId = () => `new:${crypto.randomUUID()}`;

/** Add a blank layer (Revu: Add New Layer). Returns its id. */
export function addLayer(name: string, target: string | null, where: Where): string | null {
  const d = activeDoc();
  if (!d || !name.trim()) return null;
  const set = setOf(d);
  const id = newId();
  const layer: Layer = { id, name: name.trim(), on: true, locked: false, print: true };
  useApp.getState().setLayers({ ...set, layers: { ...set.layers, [id]: layer }, order: insertNode(set.order, { id, kids: [] }, target, where) },
    { layerVisible: { ...d.layerVisible, [id]: true } });
  return id;
}

/** Revu's Delete Layer: content and markups on the layers are deleted or moved to the base PDF. */
export async function deleteLayers(keys: string[], deleteContent: boolean, deleteMarkups: boolean) {
  const app = useApp.getState();
  const d = activeDoc();
  if (!d?.layers) return;
  const nodes = keys.map((k) => findNode(d.layers!.order, k)).filter(Boolean) as LayerNode[];
  const ids = new Set(nodes.flatMap(idsUnder));
  // Group labels go too.
  const order = removeNodes(d.layers.order, new Set(keys.filter((k) => k.startsWith('g:'))));
  // Markups in memory on these layers.
  const on = d.markups.filter((m) => m.layer && ids.has(m.layer)).map((m) => m.id);
  if (deleteMarkups) app.deleteMarkups(on); else app.updateMarkups(on, () => ({ layer: undefined }));
  const fileIds = new Set([...ids].filter((id) => !id.startsWith('new:')));
  const rest = withoutLayers({ ...d.layers, order }, ids);
  if (!fileIds.size) { app.setLayers(Object.keys(rest.layers).length ? rest : null); app.setStatus('Layer deleted'); return; }
  // Layers in the file: rewrite the page content (and annotations still in the file) as Revu does.
  app.setLayers(withoutLayers({ ...d.layers, order }, new Set([...ids].filter((id) => id.startsWith('new:')))));
  await app.transformDoc((lib) => {
    stripLayerContent(lib, fileIds, deleteContent);
    for (const page of lib.getPages()) {
      const annots = page.node.lookup(PDFName.of('Annots'));
      if (!(annots instanceof PDFArray)) continue;
      const keep = annots.asArray().filter((r) => {
        const a = lib.context.lookup(r);
        const oc = a instanceof PDFDict ? a.get(PDFName.of('OC')) : undefined;
        if (!(oc instanceof PDFRef) || !fileIds.has(refId(oc))) return true;
        if (deleteMarkups) return false;
        (a as PDFDict).delete(PDFName.of('OC'));
        return true;
      });
      page.node.set(PDFName.of('Annots'), lib.context.obj(keep));
    }
    const now = readLayers(lib) ?? EMPTY;
    writeLayers(lib, withoutLayers(now, fileIds));
  }, `Deleted ${fileIds.size} layer(s)`);
}

/**
 * Revu's Export Layer to Page: a new PDF with only the selected layers (and
 * their children). Layers set not to export, or hidden now, come without
 * their content.
 */
export async function exportLayers(keys: string[]) {
  const app = useApp.getState();
  const d = activeDoc();
  if (!d?.layers) return;
  const set = d.layers;
  const chosen = keys.map((k) => findNode(set.order, k)).filter(Boolean).flatMap((n) => idsUnder(n!));
  const withContent = new Set(chosen.filter((id) => set.layers[id]?.export !== false && d.layerVisible[id] !== false).map((id) => set.layers[id].name));
  const names = new Set(chosen.map((id) => set.layers[id]?.name));
  app.setStatus('Exporting layers…');
  const lib = await loadForUpdate(await serialize(d));
  // Layers created in this session got their ids on serialising: find them by name.
  const now = readLayers(lib) ?? EMPTY;
  const keepIds = new Set(Object.values(now.layers).filter((l) => withContent.has(l.name)).map((l) => l.id));
  keepOnlyLayers(lib, keepIds);
  const others = new Set(Object.values(now.layers).filter((l) => !names.has(l.name)).map((l) => l.id));
  writeLayers(lib, withoutLayers(now, others));
  const label = [...names].join(', ');
  await app.openBytes(await lib.save({ useObjectStreams: false }), `${d.name.replace(/\.pdf$/i, '')} - ${label}.pdf`);
  app.setStatus(`Exported layer(s) ${label} to a new PDF`);
}

export async function adjustLayer(id: string, m: [number, number, number, number, number, number]) {
  const app = useApp.getState();
  const d = activeDoc();
  const name = d?.layers?.layers[id]?.name;
  if (!d || !name) return;
  await app.transformDoc((lib) => {
    const target = Object.values(readLayers(lib)?.layers ?? {}).find((l) => l.id === id || l.name === name);
    if (target) transformLayer(lib, target.id, m);
  }, `Layer "${name}" moved`);
}

export function LayersPanel({ doc }: { doc: DocState }) {
  const s = useApp();
  const ui = useLayersUi();
  const [sel, setSel] = useState<string[]>([]);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [drag, setDrag] = useState<string | null>(null);
  const set = setOf(doc);
  const vis = doc.layerVisible;
  const view = (layerVisible: Record<string, boolean>) => s.setLayerView({ layerVisible });
  const allIds = Object.keys(set.layers);
  const target = sel[0] ?? null;

  const toggleNode = (n: LayerNode, on?: boolean) => {
    const ids = idsUnder(n).filter((id) => !set.layers[id]?.locked);
    const next = on ?? !(n.id ? vis[n.id] !== false : ids.some((id) => vis[id] === false));
    view({ ...vis, ...Object.fromEntries(ids.map((id) => [id, next])) });
  };
  const isolate = (n: LayerNode) => {
    const keep = new Set(idsUnder(n));
    view(Object.fromEntries(allIds.map((id) => [id, keep.has(id) || (set.layers[id].locked && vis[id] !== false)])));
  };
  const showAll = () => view(Object.fromEntries(allIds.map((id) => [id, true])));
  const configVis = (name: string | null) => {
    const c = set.configs.find((x) => x.name === name);
    return Object.fromEntries(allIds.map((id) => [id, c ? !c.off.includes(id) : set.layers[id].on]));
  };
  const add = (where: Where) => {
    const name = prompt('Layer name', `Layer ${allIds.length + 1}`);
    if (name) { const id = addLayer(name, target, where); if (id) setSel([id]); }
  };
  const addGroup = () => {
    const label = prompt('Layer group name', 'Group');
    if (label && !findNode(set.order, `g:${label}`)) s.setLayers({ ...set, order: insertNode(set.order, { label, kids: [] }, target, 'after') });
  };
  const rename = (key: string) => {
    const n = findNode(set.order, key);
    if (!n) return;
    if (n.id) {
      const l = set.layers[n.id];
      if (l.locked) return;
      const name = prompt('Layer name', l.name);
      if (name?.trim()) s.setLayers({ ...set, layers: { ...set.layers, [l.id]: { ...l, name: name.trim() } } });
    } else {
      const label = prompt('Layer group name', n.label);
      if (label?.trim()) s.setLayers({ ...set, order: relabel(set.order, key, label.trim()) });
    }
  };
  const setMarkupLayer = (id: string) => s.setLayerView({ markupLayer: doc.markupLayer === id ? null : id });

  const rowMenu = (e: React.MouseEvent, n: LayerNode) => {
    e.preventDefault();
    const key = nodeKey(n);
    const keys = sel.includes(key) ? sel : [key];
    if (!sel.includes(key)) setSel([key]);
    const l = n.id ? set.layers[n.id] : undefined;
    setMenu({
      x: e.clientX, y: e.clientY, items: [
        { label: 'Show Layer', checked: n.id ? vis[n.id] !== false : undefined, action: () => toggleNode(n) },
        { label: 'Isolate', action: () => isolate(n) },
        { label: 'Show All', action: showAll },
        ...(l ? [{ label: 'Markup Layer', checked: doc.markupLayer === l.id, action: () => setMarkupLayer(l.id) }] : []),
        { sep: true },
        { label: 'Add New Layer', action: () => add('after') },
        { label: 'Add Layer from Page…', action: () => openCompare('layer') },
        { label: 'New Layer Group', action: addGroup },
        { label: 'Rename', shortcut: 'F2', disabled: !!l?.locked, action: () => rename(key) },
        { label: 'Delete', action: () => useLayersUi.setState({ dialog: { kind: 'delete', keys } }) },
        { sep: true },
        { label: 'Export Layer to Page…', action: () => void exportLayers(keys) },
        ...(n.id ? [{ label: 'Move / Rotate / Scale…', disabled: n.id.startsWith('new:') || !!l?.locked, action: () => useLayersUi.setState({ dialog: { kind: 'adjust', keys: [n.id!] } }) }] : []),
        ...(n.id ? [{ label: 'Layer Properties…', action: () => useLayersUi.setState({ dialog: { kind: 'props', keys: keys.filter((k) => !k.startsWith('g:')) } }) }] : []),
      ],
    });
  };

  const onPage = new Set([...(doc.loaded.pageLayers[doc.page] ?? []), ...doc.markups.filter((m) => m.page === doc.page && m.layer).map((m) => m.layer!)]);
  const visibleNode = (n: LayerNode): boolean => !ui.onPage || (n.id ? onPage.has(n.id) : false) || n.kids.some(visibleNode);
  const rows = (nodes: LayerNode[], depth: number): React.ReactNode[] => nodes.filter(visibleNode).flatMap((n) => {
    const key = nodeKey(n);
    const l = n.id ? set.layers[n.id] : undefined;
    return [
      <div key={key} className={`layer-row ${sel.includes(key) ? 'selected' : ''} ${drag === key ? 'dragging' : ''}`} style={{ paddingLeft: 4 + depth * 16 }}
        role="treeitem" aria-label={l ? `Layer ${l.name}` : `Layer group ${n.label}`} aria-selected={sel.includes(key)}
        draggable onDragStart={() => setDrag(key)} onDragEnd={() => setDrag(null)}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (!drag) return;
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          // Drop to the right to make it a child (Revu), in the upper half to place it before.
          const where: Where = e.clientX - r.left > 4 + depth * 16 + 60 ? 'child' : e.clientY < r.top + r.height / 2 ? 'before' : 'after';
          s.setLayers({ ...set, order: moveNode(set.order, drag, key, where) });
          setDrag(null);
        }}
        onClick={(e) => setSel(e.ctrlKey || e.metaKey || e.shiftKey ? (sel.includes(key) ? sel.filter((x) => x !== key) : [...sel, key]) : [key])}
        onDoubleClick={() => rename(key)}
        onContextMenu={(e) => rowMenu(e, n)}>
        {l ? (
          <input type="checkbox" className="layer-eye" aria-label={`Show ${l.name}`} checked={vis[l.id] !== false} disabled={l.locked}
            onClick={(e) => e.stopPropagation()} onChange={() => toggleNode(n)} />
        ) : <span className="layer-eye-space" />}
        <span className={`layer-name ${l ? '' : 'layer-group'} ${l && !layerShown({ ...doc, layerVisible: {} }, l.id, doc.zoom || 1) ? 'out-of-range' : ''}`}
          title={l?.zoom ? `Shown from ${Math.round(l.zoom.min * 100)}% to ${Number.isFinite(l.zoom.max) ? `${Math.round(l.zoom.max * 100)}%` : 'any zoom'}` : undefined}>{l?.locked && '🔒 '}{l ? l.name : n.label}</span>
        {l && doc.markupLayer === l.id && <span className="layer-badge" title="Markup Layer: new markups go here">✎</span>}
      </div>,
      ...rows(n.kids, depth + 1),
    ];
  });

  const layersMenu = (e: React.MouseEvent) => setMenu({
    x: e.clientX, y: e.clientY, items: [
      { label: 'Reset Layers', action: () => view(configVis(doc.layerConfig)) },
      { label: 'Show Print Layers', action: () => view(Object.fromEntries(allIds.map((id) => [id, set.layers[id].print]))) },
      { label: 'Show Export Layers', action: () => view(Object.fromEntries(allIds.map((id) => [id, set.layers[id].export !== false]))) },
      { label: 'Show All Layers', action: showAll },
      { label: 'Show Layers on Page Only', checked: ui.onPage, action: () => useLayersUi.setState({ onPage: !ui.onPage }) },
      { label: 'Show Layers Alphabetically', checked: ui.alpha, action: () => useLayersUi.setState({ alpha: !ui.alpha }) },
    ],
  });
  const addMenu = (e: React.MouseEvent) => setMenu({
    x: e.clientX, y: e.clientY, items: [
      { label: 'Add Before', action: () => add('before') }, { label: 'Add After', action: () => add('after') },
      { label: 'Add Child', disabled: !target || target.startsWith('g:'), action: () => add('child') },
      { sep: true }, { label: 'New Layer Group', action: addGroup },
    ],
  });
  const saveMenu = (e: React.MouseEvent) => setMenu({
    x: e.clientX, y: e.clientY, items: [
      { label: 'Save Configuration', action: () => {
        if (!doc.layerConfig) s.setLayers({ ...set, layers: Object.fromEntries(allIds.map((id) => [id, { ...set.layers[id], on: vis[id] !== false }])) });
        else s.setLayers({ ...set, configs: set.configs.map((c) => (c.name === doc.layerConfig ? { ...c, off: allIds.filter((id) => vis[id] === false) } : c)) });
        s.setStatus(`Layer configuration "${doc.layerConfig ?? 'Default'}" saved`);
      } },
      { label: 'New Configuration…', action: () => {
        const name = prompt('Configuration name', `Configuration ${set.configs.length + 1}`)?.trim();
        if (!name || name === 'Default' || set.configs.some((c) => c.name === name)) return;
        s.setLayers({ ...set, configs: [...set.configs, { name, off: allIds.filter((id) => vis[id] === false) }] }, { layerConfig: name });
      } },
      { label: 'Delete Configuration', disabled: !doc.layerConfig, action: () => s.setLayers({ ...set, configs: set.configs.filter((c) => c.name !== doc.layerConfig) }, { layerConfig: null }) },
    ],
  });

  return (
    <div className="layers-panel">
      <div className="layers-toolbar">
        <button onClick={layersMenu} aria-label="Layers menu">Layers ▾</button>
        <button onClick={() => add('after')} title="Add New Layer (after the selected layer)">+ Layer</button>
        <button onClick={addMenu} aria-label="Add layer options">▾</button>
        <button onClick={() => openCompare('layer')} title="Add Layer from Page">From Page…</button>
      </div>
      <div className="layers-toolbar">
        <select aria-label="Layer configuration" value={doc.layerConfig ?? ''} onChange={(e) => {
          const name = e.target.value || null;
          s.setLayerView({ layerConfig: name, layerVisible: configVis(name) });
        }}>
          <option value="">Default</option>
          {set.configs.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
        </select>
        <button onClick={saveMenu} aria-label="Save configuration">Save ▾</button>
      </div>
      <div className="layers-list" role="tree" aria-label="Layers" tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'F2' && target) { e.preventDefault(); rename(target); } if (e.key === 'Delete' && sel.length) { e.stopPropagation(); useLayersUi.setState({ dialog: { kind: 'delete', keys: sel } }); } }}>
        {rows(ui.alpha ? alphabetical(set) : set.order, 0)}
        {!allIds.length && <p className="muted small pad">This PDF has no layers. Add a layer, then assign markups to it (right-click a markup &gt; Layer) or make it the Markup Layer.</p>}
      </div>
      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
    </div>
  );
}

const relabel = (nodes: LayerNode[], key: string, label: string): LayerNode[] =>
  nodes.map((n) => (nodeKey(n) === key ? { ...n, label, kids: n.kids } : { ...n, kids: relabel(n.kids, key, label) }));

export function LayerDialogs() {
  const dialog = useLayersUi((x) => x.dialog);
  const doc = useApp((s) => s.docs.find((d) => d.id === s.activeId));
  if (!dialog || !doc?.layers) return null;
  if (dialog.kind === 'adjust') return <AdjustForm doc={doc} id={dialog.keys[0]} />;
  return dialog.kind === 'delete' ? <DeleteForm doc={doc} keys={dialog.keys} /> : <PropsForm doc={doc} keys={dialog.keys} />;
}

function Frame({ title, children }: { title: string; children: React.ReactNode }) {
  const close = () => useLayersUi.setState({ dialog: null });
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal" role="dialog" aria-label={title} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') close(); }}>
        <div className="modal-title">{title}</div>
        <div className="scale-dialog">{children}</div>
      </div>
    </div>
  );
}

function DeleteForm({ doc, keys }: { doc: DocState; keys: string[] }) {
  const [content, setContent] = useState(true);
  const [markups, setMarkups] = useState(true);
  const close = () => useLayersUi.setState({ dialog: null });
  const names = keys.map((k) => { const n = findNode(doc.layers!.order, k); return n?.id ? doc.layers!.layers[n.id]?.name : n?.label; }).filter(Boolean);
  return (
    <Frame title="Delete Layer">
      <p>Delete Layer: <strong>{names.join(', ')}</strong></p>
      <label className="form-row"><input type="checkbox" checked={content} onChange={(e) => setContent(e.target.checked)} /> Delete Layer Content on Page</label>
      <label className="form-row"><input type="checkbox" checked={markups} onChange={(e) => setMarkups(e.target.checked)} /> Delete Layer Annotations</label>
      <p className="muted small">Unchecked: the content or markups stay, moved to the base PDF (no longer on a layer).</p>
      <div className="modal-actions"><span className="spacer" />
        <button className="primary" onClick={async () => { close(); await deleteLayers(keys, content, markups); }}>Delete</button>
        <button onClick={close}>Cancel</button>
      </div>
    </Frame>
  );
}

function PropsForm({ doc, keys }: { doc: DocState; keys: string[] }) {
  const s = useApp();
  const set = doc.layers!;
  const ls = keys.map((k) => set.layers[k]).filter(Boolean);
  const first = ls[0];
  const [name, setName] = useState(first?.name ?? '');
  const [on, setOn] = useState(first?.on ?? true);
  const [locked, setLocked] = useState(first?.locked ?? false);
  const [print, setPrint] = useState(first?.print ?? true);
  const [exp, setExp] = useState(first?.export !== false);
  const [zoomOn, setZoomOn] = useState(!!first?.zoom);
  const [zmin, setZmin] = useState(first?.zoom ? String(Math.round(first.zoom.min * 100)) : '100');
  const [zmax, setZmax] = useState(first?.zoom && Number.isFinite(first.zoom.max) ? String(Math.round(first.zoom.max * 100)) : '');
  const [view, setView] = useState(first ? doc.layerVisible[first.id] !== false : true);
  const close = () => useLayersUi.setState({ dialog: null });
  if (!first) return null;
  const ok = () => {
    close();
    const layers = { ...set.layers };
    const zoom = zoomOn ? { min: Math.max(0, Number(zmin) || 0) / 100, max: zmax.trim() ? Math.max(0, Number(zmax)) / 100 : Infinity } : undefined;
    for (const l of ls) layers[l.id] = { ...l, name: ls.length === 1 && name.trim() ? name.trim() : l.name, on, locked, print, export: exp, zoom };
    s.setLayers({ ...set, layers }, { layerVisible: { ...doc.layerVisible, ...Object.fromEntries(ls.map((l) => [l.id, view])) } });
  };
  const onOff = (v: boolean, set: (x: boolean) => void, label: string) => (
    <select aria-label={label} value={v ? 'on' : 'off'} onChange={(e) => set(e.target.value === 'on')}><option value="on">On</option><option value="off">Off</option></select>
  );
  return (
    <Frame title="Layer Properties">
      {ls.length === 1 && <div className="form-row"><span>Title</span><input aria-label="Layer title" value={name} disabled={first.locked} onChange={(e) => setName(e.target.value)} /></div>}
      <div className="form-row"><span>Default State</span>{onOff(on, setOn, 'Default state')}</div>
      <div className="form-row"><label><input type="checkbox" checked={locked} onChange={(e) => setLocked(e.target.checked)} /> Locked</label></div>
      <div className="prop-section">Usage</div>
      <div className="form-row"><span>View</span>{onOff(view, setView, 'View')}</div>
      <div className="form-row"><span>Print</span>{onOff(print, setPrint, 'Print')}</div>
      <div className="form-row"><span>Export</span>{onOff(exp, setExp, 'Export')}</div>
      <div className="form-row"><span>Zoom</span>
        <select aria-label="Zoom" value={zoomOn ? 'range' : 'always'} onChange={(e) => setZoomOn(e.target.value === 'range')}>
          <option value="always">Always visible</option><option value="range">On when in range</option>
        </select>
      </div>
      {zoomOn && (
        <div className="form-row"><span>Range</span>
          <input aria-label="Minimum zoom" type="number" min={0} style={{ width: 64 }} value={zmin} onChange={(e) => setZmin(e.target.value)} /> % to
          <input aria-label="Maximum zoom" type="number" min={0} style={{ width: 64 }} placeholder="any" value={zmax} onChange={(e) => setZmax(e.target.value)} /> %
        </div>
      )}
      <div className="modal-actions"><span className="spacer" />
        <button className="primary" onClick={ok}>OK</button><button onClick={close}>Cancel</button>
      </div>
    </Frame>
  );
}

/** Move / rotate / scale a layer's content (e.g. a sheet added from a page), about a base point. */
function AdjustForm({ doc, id }: { doc: DocState; id: string }) {
  const l = doc.layers?.layers[id];
  const pg = doc.loaded.pages[doc.page];
  // Inches on paper, base point at the page centre (PDF space: origin bottom-left).
  const [dx, setDx] = useState('0');
  const [dy, setDy] = useState('0');
  const [deg, setDeg] = useState('0');
  const [pct, setPct] = useState('100');
  const [step, setStep] = useState('0.125');
  const [bx, setBx] = useState(((pg?.width ?? 0) / 144).toFixed(3));
  const [by, setBy] = useState(((pg?.height ?? 0) / 144).toFixed(3));
  const close = () => useLayersUi.setState({ dialog: null });
  if (!l) return null;
  const nudge = (x: number, y: number) => { const st = Number(step) || 0; setDx(String(+((Number(dx) || 0) + x * st).toFixed(4))); setDy(String(+((Number(dy) || 0) + y * st).toFixed(4))); };
  const ok = async () => {
    close();
    await adjustLayer(id, layerMatrix((Number(dx) || 0) * 72, (Number(dy) || 0) * 72, Number(deg) || 0, (Number(pct) || 100) / 100, (Number(bx) || 0) * 72, (Number(by) || 0) * 72));
  };
  const field = (label: string, v: string, set: (x: string) => void, unit: string) => (
    <div className="form-row"><span>{label}</span><input aria-label={label} type="number" step="any" style={{ width: 90 }} value={v} onChange={(e) => set(e.target.value)} /> {unit}</div>
  );
  return (
    <Frame title="Move / Rotate / Scale Layer">
      <p className="small">Layer: <strong>{l.name}</strong>. Moves its content on every page; the PDF stays a normal layered PDF.</p>
      {field('Move right', dx, setDx, 'in')}
      {field('Move up', dy, setDy, 'in')}
      <div className="form-row"><span>Nudge</span>
        <button aria-label="Nudge left" onClick={() => nudge(-1, 0)}>←</button><button aria-label="Nudge right" onClick={() => nudge(1, 0)}>→</button>
        <button aria-label="Nudge up" onClick={() => nudge(0, 1)}>↑</button><button aria-label="Nudge down" onClick={() => nudge(0, -1)}>↓</button>
        by <input aria-label="Nudge step" type="number" step="any" style={{ width: 70 }} value={step} onChange={(e) => setStep(e.target.value)} /> in
      </div>
      {field('Rotate', deg, setDeg, '° counterclockwise')}
      {field('Scale', pct, setPct, '%')}
      <div className="form-row"><span>Base point</span>
        <input aria-label="Base point X" type="number" step="any" style={{ width: 70 }} value={bx} onChange={(e) => setBx(e.target.value)} /> ,
        <input aria-label="Base point Y" type="number" step="any" style={{ width: 70 }} value={by} onChange={(e) => setBy(e.target.value)} /> in from the bottom-left (default: page centre)
      </div>
      <div className="modal-actions"><span className="spacer" />
        <button className="primary" onClick={ok}>Apply</button><button onClick={close}>Cancel</button>
      </div>
    </Frame>
  );
}
