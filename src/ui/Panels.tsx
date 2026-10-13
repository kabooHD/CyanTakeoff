import { useEffect, useRef, useState } from 'react';
import { useApp, useActiveDoc, type DocState } from '../model/store';
import { DECIMAL_PRECISIONS, FRACTION_PRECISIONS, SCALE_PRESETS, measure, precisionOf, unitLabel, withPrecision } from '../model/measure';
import type { LineStyle, Markup, MarkupStyle, MarkupType, Scale, ToolPreset } from '../model/types';
import { toolById } from '../tools/tools';
import { Icon } from './icons';
import { SpacesPanel } from './SpacesPanel';

// ---------------- side tab strips ----------------

export function SideTabs({ side }: { side: 'left' | 'right' }) {
  const s = useApp();
  const tabs = side === 'left'
    ? [{ id: 'thumbnails', label: 'Thumbnails' }, { id: 'bookmarks', label: 'Bookmarks' }, { id: 'spaces', label: 'Spaces' }] as const
    : [{ id: 'properties', label: 'Properties' }, { id: 'toolchest', label: 'Tool Chest' }, { id: 'measurements', label: 'Measurements' }] as const;
  const cur = side === 'left' ? s.left : s.right;
  return (
    <div className={`side-tabs side-${side}`}>
      {tabs.map((t) => (
        <button key={t.id} className={cur === t.id ? 'active' : ''} title={t.label}
          onClick={() => s.setPanels(side === 'left'
            ? { left: cur === t.id ? null : t.id as never }
            : { right: cur === t.id ? null : t.id as never })}>
          <Icon name={t.id} size={18} />
        </button>
      ))}
    </div>
  );
}

function PanelFrame({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="panel">
      <div className="panel-header"><span>{title}</span><button onClick={onClose} title="Close"><Icon name="close" size={12} /></button></div>
      <div className="panel-body">{children}</div>
    </div>
  );
}

export function LeftPanel() {
  const s = useApp();
  const doc = useActiveDoc();
  if (!s.left) return null;
  const close = () => s.setPanels({ left: null });
  if (s.left === 'spaces') return <PanelFrame title="Spaces" onClose={close}>{doc ? <SpacesPanel doc={doc} /> : null}</PanelFrame>;
  return s.left === 'thumbnails'
    ? <PanelFrame title="Thumbnails" onClose={close}>{doc ? <Thumbnails doc={doc} /> : null}</PanelFrame>
    : <PanelFrame title="Bookmarks" onClose={close}>{doc ? <Bookmarks doc={doc} /> : null}</PanelFrame>;
}

export function RightPanel() {
  const s = useApp();
  if (!s.right) return null;
  const close = () => s.setPanels({ right: null });
  if (s.right === 'properties') return <PanelFrame title="Properties" onClose={close}><Properties /></PanelFrame>;
  if (s.right === 'toolchest') return <PanelFrame title="Tool Chest" onClose={close}><ToolChest /></PanelFrame>;
  return <PanelFrame title="Measurements" onClose={close}><Measurements /></PanelFrame>;
}

// ---------------- Thumbnails ----------------

function Thumb({ doc, index }: { doc: DocState; index: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const p = doc.loaded.pages[index];
  const w = 130, h = (p.height / p.width) * w;
  useEffect(() => {
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setVisible(true));
    io.observe(ref.current!);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    doc.loaded.pdf.getPage(index + 1).then((page) => {
      if (cancelled) return;
      const vp = page.getViewport({ scale: (w * 2) / p.width });
      const c = ref.current!;
      c.width = vp.width; c.height = vp.height;
      page.render({ canvas: c, viewport: vp }).promise.catch(() => {});
    });
    return () => { cancelled = true; };
  }, [visible, doc.loaded.pdf, index, p.width]);
  const s = useApp();
  const count = doc.markups.filter((m) => m.page === index).length;
  return (
    <div className={`thumb ${doc.page === index ? 'active' : ''}`} onClick={() => s.setPage(index)}>
      <canvas ref={ref} style={{ width: w, height: h }} />
      <div className="thumb-label">{p.label}{count ? <span className="thumb-count">{count}</span> : null}</div>
    </div>
  );
}

function Thumbnails({ doc }: { doc: DocState }) {
  return <div className="thumbs">{doc.loaded.pages.map((p) => <Thumb key={`${doc.id}-${p.index}`} doc={doc} index={p.index} />)}</div>;
}

// ---------------- Bookmarks ----------------

interface OutlineNode { title: string; dest: unknown; items: OutlineNode[] }

function Bookmarks({ doc }: { doc: DocState }) {
  const [outline, setOutline] = useState<OutlineNode[] | null>(null);
  const s = useApp();
  useEffect(() => { doc.loaded.pdf.getOutline().then((o) => setOutline((o as OutlineNode[]) ?? [])); }, [doc.loaded.pdf]);
  const go = async (dest: unknown) => {
    const pdf = doc.loaded.pdf;
    const d = typeof dest === 'string' ? await pdf.getDestination(dest) : dest as unknown[];
    if (!d) return;
    const ref = d[0];
    const idx = typeof ref === 'number' ? ref : await pdf.getPageIndex(ref as never);
    s.setPage(idx);
  };
  const render = (nodes: OutlineNode[], depth = 0): React.ReactNode => nodes.map((n, i) => (
    <div key={i}>
      <button className="bookmark" style={{ paddingLeft: 8 + depth * 14 }} onClick={() => go(n.dest)}>{n.title}</button>
      {n.items?.length ? render(n.items, depth + 1) : null}
    </div>
  ));
  if (!outline) return null;
  return outline.length ? <div>{render(outline)}</div> : <p className="muted pad">This document has no bookmarks.</p>;
}

// ---------------- Properties ----------------

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="prop-row"><span>{label}</span>{children}</label>;
}

function StyleEditor({ style, type, onChange }: { style: MarkupStyle; type: MarkupType; onChange: (p: Partial<MarkupStyle>) => void }) {
  const textual = type === 'textbox' || type === 'callout';
  return (
    <>
      <div className="prop-section">Appearance</div>
      <Row label="Color"><input type="color" value={style.color} onChange={(e) => onChange({ color: e.target.value })} /></Row>
      <Row label="Fill Color">
        <span className="inline">
          <input type="checkbox" checked={!!style.fill} onChange={(e) => onChange({ fill: e.target.checked ? style.fill ?? style.color : null })} />
          {style.fill && <input type="color" value={style.fill} onChange={(e) => onChange({ fill: e.target.value })} />}
        </span>
      </Row>
      <Row label="Opacity"><span className="inline"><input type="range" min={0} max={100} value={Math.round(style.opacity * 100)} onChange={(e) => onChange({ opacity: +e.target.value / 100 })} />{Math.round(style.opacity * 100)}</span></Row>
      {style.fill && <Row label="Fill Opacity"><span className="inline"><input type="range" min={0} max={100} value={Math.round(style.fillOpacity * 100)} onChange={(e) => onChange({ fillOpacity: +e.target.value / 100 })} />{Math.round(style.fillOpacity * 100)}</span></Row>}
      <Row label="Line Width"><input type="number" min={0} max={50} step={0.25} value={style.width} onChange={(e) => onChange({ width: Math.max(0, +e.target.value) })} /></Row>
      <Row label="Line Style">
        <select value={style.lineStyle} onChange={(e) => onChange({ lineStyle: e.target.value as LineStyle })}>
          <option value="solid">Solid</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option>
        </select>
      </Row>
      {(textual || ['length', 'polylength', 'area', 'perimeter', 'volume', 'angle', 'radius', 'diameter'].includes(type)) && (
        <Row label="Font Size"><input type="number" min={4} max={144} value={style.fontSize} onChange={(e) => onChange({ fontSize: Math.max(4, +e.target.value) })} /></Row>
      )}
    </>
  );
}

function Properties() {
  const s = useApp();
  const doc = useActiveDoc();
  const sel = doc ? doc.markups.filter((m) => doc.selection.includes(m.id)) : [];
  if (!sel.length) {
    const t = toolById(s.tool);
    if (s.tool === 'select' || s.tool === 'pan' || s.tool === 'zoom' || s.tool === 'calibrate') {
      return <p className="muted pad">Select a markup to view and edit its properties, or choose a markup tool to set its defaults.</p>;
    }
    const type = s.tool as MarkupType;
    return (
      <div className="props">
        <div className="prop-title">{t.name} — tool defaults</div>
        <StyleEditor style={s.preset?.style ?? s.toolDefaults[type]} type={type} onChange={(p) => s.setToolDefault(type, p)} />
      </div>
    );
  }
  const m = sel[0];
  const ids = sel.map((x) => x.id);
  const upd = (fn: (x: Markup) => Partial<Markup>) => s.updateMarkups(ids, fn);
  const meas = measure(m);
  return (
    <div className="props">
      <div className="prop-title">{sel.length > 1 ? `${sel.length} markups selected` : toolById(m.type).name}</div>
      <div className="prop-section">General</div>
      <Row label="Subject"><input value={m.subject} onChange={(e) => upd(() => ({ subject: e.target.value }))} /></Row>
      <Row label="Label"><input value={m.label} onChange={(e) => upd(() => ({ label: e.target.value }))} /></Row>
      <Row label="Comments"><textarea rows={3} value={m.comment} onChange={(e) => upd(() => ({ comment: e.target.value }))} /></Row>
      {(m.type === 'textbox' || m.type === 'callout') && sel.length === 1 && (
        <Row label="Text"><textarea rows={3} value={m.text ?? ''} onChange={(e) => upd(() => ({ text: e.target.value }))} /></Row>
      )}
      <Row label="Status">
        <select value={m.status} onChange={(e) => upd(() => ({ status: e.target.value as Markup['status'] }))}>
          {['None', 'Accepted', 'Rejected', 'Cancelled', 'Completed'].map((x) => <option key={x}>{x}</option>)}
        </select>
      </Row>
      <Row label="Author"><input value={m.author} readOnly /></Row>
      <Row label="Date"><input value={new Date(m.modified).toLocaleString()} readOnly /></Row>
      <StyleEditor style={m.style} type={m.type} onChange={(p) => upd((x) => ({ style: { ...x.style, ...p } }))} />
      {meas && (
        <>
          <div className="prop-section">Measurement</div>
          <Row label="Scale"><input readOnly value={m.scale?.label ?? 'Not calibrated'} /></Row>
          {m.type === 'volume' && (
            <Row label={`Depth (${unitLabel(m.scale?.unit ?? 'ft')})`}>
              <input type="number" step={0.01} value={m.depth ?? 0} onChange={(e) => upd(() => ({ depth: +e.target.value }))} />
            </Row>
          )}
          <Row label="Value"><input readOnly value={meas.text} /></Row>
        </>
      )}
      <div className="prop-actions">
        <button onClick={() => s.addToToolChest(m)}>Add to My Tools</button>
        <button onClick={() => s.deleteMarkups(ids)}>Delete</button>
      </div>
    </div>
  );
}

// ---------------- Tool Chest ----------------

function ToolItem({ p, onRemove }: { p: ToolPreset; onRemove?: () => void }) {
  const s = useApp();
  const active = s.preset?.id === p.id;
  return (
    <div className={`tool-item ${active ? 'active' : ''}`} title={`${p.name} (${toolById(p.type).name})\nClick to use, double-click to lock`}
      onClick={() => s.setTool(p.type, { preset: p })}
      onDoubleClick={() => s.setTool(p.type, { preset: p, locked: true })}>
      <span className="tool-swatch" style={{ borderColor: p.style.color, background: p.style.fill ?? 'transparent' }}><Icon name={p.type} size={16} /></span>
      <span className="tool-name">{p.name}</span>
      {onRemove && <button className="tool-remove" title="Remove" onClick={(e) => { e.stopPropagation(); onRemove(); }}><Icon name="close" size={10} /></button>}
    </div>
  );
}

function ToolChest() {
  const s = useApp();
  return (
    <div className="toolchest">
      <details open>
        <summary>Recent Tools</summary>
        {s.recentTools.length ? s.recentTools.map((p) => <ToolItem key={p.id} p={p} />) : <p className="muted pad">Markups you create appear here.</p>}
      </details>
      <details open>
        <summary>My Tools</summary>
        {s.toolChest.map((p) => <ToolItem key={p.id} p={p} onRemove={() => s.removeFromToolChest(p.id)} />)}
        <p className="muted pad small">Right-click a markup and choose “Add to My Tools” to save it here.</p>
      </details>
    </div>
  );
}

// ---------------- Measurements ----------------

/** Revu's Viewports section: regions of the page with their own scale. */
function Viewports() {
  const s = useApp();
  const doc = useActiveDoc()!;
  const list = doc.viewports[doc.page] ?? [];
  const sel = list.find((v) => v.id === s.activeViewport);
  const presets = [...s.savedScales, ...SCALE_PRESETS.flatMap((g) => g.items)];
  const [menu, setMenu] = useState(false);
  return (
    <>
      <div className="prop-section">Viewports</div>
      {list.length > 0 ? (
        <table className="viewport-list">
          <thead><tr><th>Name</th><th>Scale</th><th /></tr></thead>
          <tbody>
            {list.map((v) => (
              <tr key={v.id} className={v.id === s.activeViewport ? 'selected' : ''} onClick={() => s.setActiveViewport(v.id)}>
                <td>
                  <input aria-label="Viewport name" defaultValue={v.name} key={v.name} placeholder="(unnamed)"
                    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                    onBlur={(e) => e.target.value.trim() !== v.name && s.setViewport(doc.page, { ...v, name: e.target.value.trim() })} />
                </td>
                <td>
                  <select aria-label="Viewport scale" value={v.scale.label} onChange={(e) => {
                    const p = presets.find((x) => x.label === e.target.value);
                    if (p) s.setViewport(doc.page, { ...v, scale: { factor: p.factor, unit: p.unit, label: p.label, format: (p as Scale).format } });
                  }}>
                    {!presets.some((p) => p.label === v.scale.label) && <option>{v.scale.label}</option>}
                    {s.savedScales.length > 0 && <optgroup label="Saved">{s.savedScales.map((p) => <option key={p.label}>{p.label}</option>)}</optgroup>}
                    {SCALE_PRESETS.map((g) => (
                      <optgroup key={g.group} label={g.group}>{g.items.map((p) => <option key={p.label}>{p.label}</option>)}</optgroup>
                    ))}
                  </select>
                </td>
                <td>
                  <button title="More Options" onClick={() => s.openScaleDialog({ page: doc.page, viewport: { rect: v.rect, id: v.id, name: v.name } })}>…</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p className="muted small">No viewports on this page.</p>}
      {sel && <p className="muted small">Drag the highlighted viewport's edge to move it, or a corner to resize it.</p>}
      <div className="prop-actions">
        <button onClick={() => { s.setTool('viewport'); s.setStatus('Add Viewport: drag a rectangle around the area that uses a different scale (Shift for a square).'); }}>Add Viewport</button>
        <button disabled={!sel} onClick={() => { if (sel) { s.deleteViewports([doc.page], [sel.id]); s.setActiveViewport(null); } }}>Delete Viewport</button>
        <span className="menu-anchor">
          <button onClick={() => setMenu(!menu)}>Clear All ▾</button>
          {menu && (
            <div className="dropdown" onMouseLeave={() => setMenu(false)}>
              <button onClick={() => { s.deleteViewports([doc.page]); setMenu(false); }}>Clear All from Page</button>
              <button onClick={() => { s.deleteViewports(doc.viewports.flatMap((v, i) => (v.length ? [i] : []))); setMenu(false); }}>Clear All from Document</button>
            </div>
          )}
        </span>
      </div>
    </>
  );
}

function Measurements() {
  const s = useApp();
  const doc = useActiveDoc();
  if (!doc) return <p className="muted pad">Open a document to calibrate and measure.</p>;
  const scale = doc.calibrations[doc.page];
  const sel = doc.markups.filter((m) => doc.selection.includes(m.id));
  const totals = { length: 0, area: 0, volume: 0, count: 0 };
  for (const m of sel) {
    const v = measure(m);
    if (!v) continue;
    totals.length += v.length ?? 0; totals.area += v.area ?? 0; totals.volume += v.volume ?? 0; totals.count += v.count ?? 0;
  }
  return (
    <div className="props">
      <div className="prop-section">Page Scale</div>
      <Row label="Page"><input readOnly value={doc.loaded.pages[doc.page].label} /></Row>
      <div className="scale-current">{scale ? scale.label : 'Scale Not Set'}</div>
      <Row label="Preset">
        <select value="" onChange={(e) => {
          const p = [...s.savedScales, ...SCALE_PRESETS.flatMap((g) => g.items)].find((x) => x.label === e.target.value);
          if (p) s.setScale([doc.page], { factor: p.factor, unit: p.unit, label: p.label, format: (p as Scale).format });
        }}>
          <option value="">Choose a scale…</option>
          {s.savedScales.length > 0 && <optgroup label="Saved">{s.savedScales.map((p) => <option key={p.label}>{p.label}</option>)}</optgroup>}
          {SCALE_PRESETS.map((g) => (
            <optgroup key={g.group} label={g.group}>{g.items.map((p) => <option key={p.label}>{p.label}</option>)}</optgroup>
          ))}
        </select>
      </Row>
      {scale && (
        <Row label="Precision">
          <select value={precisionOf(scale)} onChange={(e) => s.setScale([doc.page], withPrecision(scale, Number(e.target.value)))}>
            {scale.unit === 'ft-in'
              ? FRACTION_PRECISIONS.map((d) => <option key={d} value={d}>{d === 1 ? '1"' : `1/${d}"`}</option>)
              : DECIMAL_PRECISIONS.map((d) => <option key={d} value={d}>{d === 0 ? '1' : (0).toFixed(d).slice(0, -1) + '1'}</option>)}
          </select>
        </Row>
      )}
      <div className="prop-actions">
        <button onClick={() => s.setTool('calibrate')}>Calibrate</button>
        <button onClick={() => s.setTool('dynamic-fill')}>Dynamic Fill</button>
        <button onClick={() => s.openScaleDialog({ page: doc.page })}>Set Scale…</button>
        {scale && <button onClick={() => s.openScaleDialog({ page: doc.page, reuse: true })}>Add Scale to More Pages</button>}
        {scale && <button onClick={() => s.setScale([doc.page], null)}>Clear</button>}
      </div>
      <p className="muted small">Calibrate: pick two points on a known dimension, then enter its real length. Changing the scale updates existing measurements on the page.</p>
      <Viewports />
      {sel.length > 0 && (
        <>
          <div className="prop-section">Selection ({sel.length})</div>
          {totals.length > 0 && <Row label="Length"><input readOnly value={totals.length.toFixed(2)} /></Row>}
          {totals.area > 0 && <Row label="Area"><input readOnly value={totals.area.toFixed(2)} /></Row>}
          {totals.volume > 0 && <Row label="Volume"><input readOnly value={totals.volume.toFixed(2)} /></Row>}
          {totals.count > 0 && <Row label="Count"><input readOnly value={totals.count} /></Row>}
        </>
      )}
    </div>
  );
}
