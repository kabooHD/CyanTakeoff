import { useEffect, useRef, useState } from 'react';
import { useApp, useActiveDoc } from '../model/store';
import { formatLength } from '../model/measure';
import type { Toggles, ToolId } from '../model/types';
import { TOOLS, toolById } from '../tools/tools';
import { Icon } from './icons';
import { MenuList, type MenuItem } from './ContextMenu';
import { exportSummaryCsv, openFile, openSample } from './actions';
import { viewerApi } from './Viewer';
import { useCursor } from './cursor';

// ---------------- Menu bar ----------------

export function MenuBar({ onShortcuts, onAbout }: { onShortcuts: () => void; onAbout: () => void }) {
  const s = useApp();
  const doc = useActiveDoc();
  const [open, setOpen] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => { if (!ref.current?.contains(e.target as Node)) setOpen(null); };
    window.addEventListener('pointerdown', close, true);
    return () => window.removeEventListener('pointerdown', close, true);
  }, [open]);

  const noDoc = !doc;
  const toolItems = (group: 'markup' | 'measure'): MenuItem[] => TOOLS.filter((t) => t.group === group).map((t) => ({
    label: t.name, shortcut: t.shortcut, disabled: noDoc, checked: s.tool === t.id, action: () => s.setTool(t.id),
  }));

  const menus: Record<string, MenuItem[]> = {
    File: [
      { label: 'Open…', shortcut: 'Ctrl+O', action: openFile },
      { label: 'Open Sample Drawing', action: openSample },
      { label: 'Close', shortcut: 'Ctrl+W', disabled: noDoc, action: () => doc && s.closeDoc(doc.id) },
      { sep: true },
      { label: 'Save', shortcut: 'Ctrl+S', disabled: noDoc, action: () => s.save() },
      { label: 'Save As…', shortcut: 'Ctrl+Shift+S', disabled: noDoc, action: () => s.save(true) },
      { sep: true },
      { label: 'Export Markups Summary (CSV)', disabled: noDoc, action: () => exportSummaryCsv() },
    ],
    Edit: [
      { label: 'Undo', shortcut: 'Ctrl+Z', disabled: !doc?.undo.length, action: s.undo },
      { label: 'Redo', shortcut: 'Ctrl+Y', disabled: !doc?.redo.length, action: s.redo },
      { sep: true },
      { label: 'Copy', shortcut: 'Ctrl+C', disabled: !doc?.selection.length, action: s.copy },
      { label: 'Paste', shortcut: 'Ctrl+V', disabled: !s.clipboard.length || noDoc, action: s.paste },
      { label: 'Delete', shortcut: 'Del', disabled: !doc?.selection.length, action: () => doc && s.deleteMarkups(doc.selection) },
      { label: 'Select All', shortcut: 'Ctrl+A', disabled: noDoc, action: () => doc && s.select(doc.markups.filter((m) => m.page === doc.page).map((m) => m.id)) },
      { sep: true },
      { label: 'Author Name…', action: () => { const a = prompt('Author name for new markups', s.author); if (a) s.setAuthor(a); } },
    ],
    View: [
      { label: 'Zoom In', shortcut: 'Ctrl+=', disabled: noDoc, action: () => viewerApi.zoomBy(1.25) },
      { label: 'Zoom Out', shortcut: 'Ctrl+-', disabled: noDoc, action: () => viewerApi.zoomBy(0.8) },
      { label: 'Fit Page', shortcut: 'Ctrl+0', disabled: noDoc, action: () => viewerApi.fitPage() },
      { label: 'Fit Width', shortcut: 'Ctrl+2', disabled: noDoc, action: () => viewerApi.fitWidth() },
      { label: 'Actual Size', shortcut: 'Ctrl+1', disabled: noDoc, action: () => s.setZoom(1) },
      { sep: true },
      { label: 'Grid', checked: s.toggles.grid, action: () => s.toggle('grid') },
      { label: 'Snap', checked: s.toggles.snap, action: () => s.toggle('snap') },
    ],
    Document: [
      { label: 'First Page', shortcut: 'Home', disabled: noDoc, action: () => s.setPage(0) },
      { label: 'Previous Page', shortcut: 'PgUp', disabled: noDoc, action: () => doc && s.setPage(doc.page - 1) },
      { label: 'Next Page', shortcut: 'PgDn', disabled: noDoc, action: () => doc && s.setPage(doc.page + 1) },
      { label: 'Last Page', shortcut: 'End', disabled: noDoc, action: () => doc && s.setPage(doc.loaded.pages.length - 1) },
    ],
    Tools: [
      { label: 'Select', shortcut: 'V', checked: s.tool === 'select', action: () => s.setTool('select') },
      { label: 'Pan', shortcut: 'Shift+V', checked: s.tool === 'pan', action: () => s.setTool('pan') },
      { sep: true },
      ...toolItems('markup'),
    ],
    Measure: toolItems('measure'),
    Window: [
      { label: 'Thumbnails', checked: s.left === 'thumbnails', action: () => s.setPanels({ left: s.left === 'thumbnails' ? null : 'thumbnails' }) },
      { label: 'Bookmarks', checked: s.left === 'bookmarks', action: () => s.setPanels({ left: s.left === 'bookmarks' ? null : 'bookmarks' }) },
      { label: 'Properties', checked: s.right === 'properties', action: () => s.setPanels({ right: s.right === 'properties' ? null : 'properties' }) },
      { label: 'Tool Chest', checked: s.right === 'toolchest', action: () => s.setPanels({ right: s.right === 'toolchest' ? null : 'toolchest' }) },
      { label: 'Measurements', checked: s.right === 'measurements', action: () => s.setPanels({ right: s.right === 'measurements' ? null : 'measurements' }) },
      { label: 'Markups List', shortcut: 'Alt+L', checked: s.markupsList, action: () => s.setPanels({ markupsList: !s.markupsList }) },
      { sep: true },
      { label: 'Reset Layout', action: () => s.setPanels({ left: 'thumbnails', right: 'properties', markupsList: true }) },
    ],
    Help: [
      { label: 'Keyboard Shortcuts', shortcut: 'F1', action: onShortcuts },
      { label: 'About CyanTakeoff', action: onAbout },
    ],
  };

  return (
    <div className="menubar" ref={ref}>
      <span className="app-badge" title="CyanTakeoff">CT</span>
      {Object.entries(menus).map(([name, items]) => (
        <div key={name} className="menubar-item">
          <button className={open === name ? 'active' : ''}
            onClick={() => setOpen(open === name ? null : name)}
            onMouseEnter={() => open && setOpen(name)}>{name}</button>
          {open === name && (
            <div className="menu-dropdown"><MenuList items={items} onClose={() => setOpen(null)} /></div>
          )}
        </div>
      ))}
      <div className="menubar-title">{doc ? `${doc.name}${doc.dirty ? ' *' : ''} - CyanTakeoff` : 'CyanTakeoff'}</div>
    </div>
  );
}

// ---------------- Toolbar ----------------

function ToolButton({ id }: { id: ToolId }) {
  const s = useApp();
  const t = toolById(id);
  const active = s.tool === id && !s.preset;
  return (
    <button className={`tb-btn ${active ? 'active' : ''} ${active && s.toolLocked ? 'locked' : ''}`}
      title={`${t.name}${t.shortcut ? ` (${t.shortcut})` : ''}\nDouble-click to lock`}
      onClick={() => s.setTool(id)}
      onDoubleClick={() => s.setTool(id, { locked: true })}>
      <Icon name={id} />
    </button>
  );
}

export function Toolbar() {
  const s = useApp();
  const doc = useActiveDoc();
  return (
    <div className="toolbar">
      <div className="tb-group">
        <button className="tb-btn" title="Open (Ctrl+O)" onClick={openFile}><Icon name="open" /></button>
        <button className="tb-btn" title="Save (Ctrl+S)" disabled={!doc} onClick={() => s.save()}><Icon name="save" /></button>
        <button className="tb-btn" title="Undo (Ctrl+Z)" disabled={!doc?.undo.length} onClick={s.undo}><Icon name="undo" /></button>
        <button className="tb-btn" title="Redo (Ctrl+Y)" disabled={!doc?.redo.length} onClick={s.redo}><Icon name="redo" /></button>
      </div>
      <div className="tb-group">
        <ToolButton id="select" /><ToolButton id="pan" /><ToolButton id="zoom" />
      </div>
      <div className="tb-group">
        {TOOLS.filter((t) => t.group === 'markup').map((t) => <ToolButton key={t.id} id={t.id} />)}
      </div>
      <div className="tb-group">
        {TOOLS.filter((t) => t.group === 'measure').map((t) => <ToolButton key={t.id} id={t.id} />)}
      </div>
      <div className="tb-group">
        <button className="tb-btn" title="Fit Page (Ctrl+0)" disabled={!doc} onClick={() => viewerApi.fitPage()}><Icon name="fitpage" /></button>
        <button className="tb-btn" title="Fit Width (Ctrl+2)" disabled={!doc} onClick={() => viewerApi.fitWidth()}><Icon name="fitwidth" /></button>
        <button className="tb-btn" title="Zoom Out (Ctrl+-)" disabled={!doc} onClick={() => viewerApi.zoomBy(0.8)}><Icon name="zoomout" /></button>
        <button className="tb-btn" title="Zoom In (Ctrl+=)" disabled={!doc} onClick={() => viewerApi.zoomBy(1.25)}><Icon name="zoomin" /></button>
      </div>
    </div>
  );
}

export function DocTabs() {
  const s = useApp();
  if (!s.docs.length) return null;
  return (
    <div className="doc-tabs">
      {s.docs.map((d) => (
        <div key={d.id} className={`doc-tab ${d.id === s.activeId ? 'active' : ''}`} onClick={() => s.setActive(d.id)}
          onAuxClick={(e) => e.button === 1 && s.closeDoc(d.id)} title={d.name}>
          <span>{d.name}{d.dirty ? ' *' : ''}</span>
          <button className="tab-close" onClick={(e) => { e.stopPropagation(); s.closeDoc(d.id); }} title="Close"><Icon name="close" size={12} /></button>
        </div>
      ))}
    </div>
  );
}

// ---------------- Status bar ----------------

const TOGGLES: { key: keyof Toggles; label: string; title: string }[] = [
  { key: 'snap', label: 'Snap', title: 'Snap to points' },
  { key: 'grid', label: 'Grid', title: 'Show grid (snaps when Snap is on)' },
  { key: 'content', label: 'Content', title: 'Snap to PDF content (coming soon)' },
  { key: 'markup', label: 'Markup', title: 'Snap to markups' },
  { key: 'reuse', label: 'Reuse', title: 'Keep the current tool after placing a markup' },
  { key: 'sync', label: 'Sync', title: 'Sync views across documents (coming soon)' },
];

export function StatusBar() {
  const s = useApp();
  const doc = useActiveDoc();
  const cursor = useCursor();
  const [pageInput, setPageInput] = useState('');
  const n = doc?.loaded.pages.length ?? 0;
  const scale = doc?.calibrations[doc.page];
  const pos = cursor.p && (scale
    ? `${formatLength(cursor.p.x * scale.factor, scale.unit)}, ${formatLength(cursor.p.y * scale.factor, scale.unit)}`
    : `${(cursor.p.x / 72).toFixed(2)}", ${(cursor.p.y / 72).toFixed(2)}"`);
  const page = doc?.loaded.pages[doc.page];
  return (
    <div className="statusbar">
      <div className="sb-section sb-status" title={s.status}>{s.busy ? '⏳ ' : ''}{s.status}</div>
      {doc && (
        <div className="sb-section sb-nav">
          <button onClick={() => s.setPage(0)} title="First Page"><Icon name="first" size={14} /></button>
          <button onClick={() => s.setPage(doc.page - 1)} title="Previous Page"><Icon name="prev" size={14} /></button>
          <input value={pageInput || page?.label || ''} onChange={(e) => setPageInput(e.target.value)}
            onFocus={(e) => e.target.select()}
            onBlur={() => setPageInput('')}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              const v = pageInput.trim();
              const byLabel = doc.loaded.pages.findIndex((p) => p.label === v);
              s.setPage(byLabel >= 0 ? byLabel : Number(v) - 1);
              setPageInput('');
              (e.target as HTMLInputElement).blur();
            }} />
          <span>({doc.page + 1} of {n})</span>
          <button onClick={() => s.setPage(doc.page + 1)} title="Next Page"><Icon name="next" size={14} /></button>
          <button onClick={() => s.setPage(n - 1)} title="Last Page"><Icon name="last" size={14} /></button>
        </div>
      )}
      {doc && <div className="sb-section">{Math.round((doc.zoom || 1) * 100)}%</div>}
      {doc && page && <div className="sb-section" title="Page size">{(page.width / 72).toFixed(2)} x {(page.height / 72).toFixed(2)} in</div>}
      {doc && <div className="sb-section sb-scale" title="Page scale (Calibrate in the Measurements panel)">{scale ? scale.label : 'Not calibrated'}</div>}
      {doc && <div className="sb-section sb-pos">{pos ?? ''}</div>}
      <div className="sb-toggles">
        {TOGGLES.map((t) => (
          <button key={t.key} className={s.toggles[t.key] ? 'on' : ''} title={t.title} onClick={() => s.toggle(t.key)}>{t.label}</button>
        ))}
      </div>
    </div>
  );
}
