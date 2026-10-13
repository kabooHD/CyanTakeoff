import { useEffect, useRef, useState } from 'react';
import { activeDoc, useApp, useActiveDoc } from '../model/store';
import { formatLength } from '../model/measure';
import type { Toggles, ToolId } from '../model/types';
import { TOOLS, toolById } from '../tools/tools';
import { Icon } from './icons';
import { MenuList, type MenuItem } from './ContextMenu';
import { allColumns, exportSummaryCsv, exportSummaryPdf, exportSummaryXlsx, openFile, openSample } from './actions';
import { viewerApi } from './Viewer';
import { combineFiles, openPagesDialog } from './PagesDialog';
import { openCompare } from './Compare';
import { openPrint } from './Print';
import { openSignDialog } from './DigitalSignature';
import { useFormsDialog } from './FormsEditor';
import { useSheetsDialog } from './Sheets';
import { usePrefsDialog } from './Prefs';
import { useSignature } from './Signature';
import { runApplyRedactions } from './redactUi';
import { effectiveCombo } from './commands';
import { arrangeItems } from './arrangeMenu';
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
  const toolItems = (group: 'markup' | 'measure' | 'form'): MenuItem[] => TOOLS.filter((t) => t.group === group && !['viewport', 'space', 'legend'].includes(t.id)).map((t) => ({
    label: t.name, shortcut: effectiveCombo(`tool:${t.id}`, s.customKeys) || undefined, disabled: noDoc, checked: s.tool === t.id, action: () => s.setTool(t.id),
  }));

  const menus: Record<string, MenuItem[]> = {
    CyanTakeoff: [
      { label: 'Keyboard Shortcuts…', action: () => usePrefsDialog.setState({ open: 'keys' }) },
      { label: 'Profiles…', action: () => usePrefsDialog.setState({ open: 'profiles' }) },
      { label: 'Author Name…', action: () => { const a = prompt('Author name for new markups', s.author); if (a) s.setAuthor(a); } },
      { sep: true },
      { label: 'About CyanTakeoff', action: onAbout },
    ],
    File: [
      { label: 'Open…', shortcut: 'Ctrl+O', action: openFile },
      { label: 'Open Sample Drawing', action: openSample },
      { label: 'Combine Files…', action: combineFiles },
      { label: 'Close', shortcut: 'Ctrl+F4', disabled: noDoc, action: () => doc && s.closeDoc(doc.id) },
      { sep: true },
      { label: 'Save', shortcut: 'Ctrl+S', disabled: noDoc, action: () => s.save() },
      { label: 'Save As…', shortcut: 'Ctrl+Shift+S', disabled: noDoc, action: () => s.save(true) },
      { sep: true },
      { label: 'Export Markups Summary (CSV)', disabled: noDoc, action: () => exportSummaryCsv() },
      { sep: true },
      { label: 'Print…', shortcut: 'Ctrl+P', disabled: noDoc, action: openPrint },
    ],
    Edit: [
      { label: 'Undo', shortcut: 'Ctrl+Z', disabled: !doc?.undo.length, action: s.undo },
      { label: 'Redo', shortcut: 'Ctrl+Y', disabled: !doc?.redo.length, action: s.redo },
      { sep: true },
      { label: 'Copy', shortcut: 'Ctrl+C', disabled: !doc?.selection.length, action: s.copy },
      { label: 'Paste', shortcut: 'Ctrl+V', disabled: !s.clipboard.length || noDoc, action: () => s.paste() },
      { label: 'Paste in Place', shortcut: 'Ctrl+Shift+V', disabled: !s.clipboard.length || noDoc, action: () => s.paste(true) },
      { label: 'Delete', shortcut: 'Del', disabled: !doc?.selection.length, action: () => doc && s.deleteMarkups(doc.selection) },
      { label: 'Select All', shortcut: 'Ctrl+A', disabled: noDoc, action: () => doc && s.select(doc.markups.filter((m) => m.page === doc.page).map((m) => m.id)) },
      { sep: true },
      ...arrangeItems(),
    ],
    View: [
      { label: 'Zoom In', shortcut: 'Plus', disabled: noDoc, action: () => viewerApi.zoomBy(1.25) },
      { label: 'Zoom Out', shortcut: 'Minus', disabled: noDoc, action: () => viewerApi.zoomBy(0.8) },
      { label: 'Fit Page', shortcut: 'Ctrl+9', disabled: noDoc, action: () => viewerApi.fitPage() },
      { label: 'Fit Width', shortcut: 'Ctrl+0', disabled: noDoc, action: () => viewerApi.fitWidth() },
      { label: 'Actual Size', shortcut: 'Ctrl+8', disabled: noDoc, action: () => s.setZoom(1) },
      { sep: true },
      { label: 'Single Page', shortcut: 'Ctrl+4', checked: s.viewMode === 'single', action: () => s.setViewMode('single') },
      { label: 'Continuous', shortcut: 'Ctrl+5', checked: s.viewMode === 'continuous', action: () => s.setViewMode('continuous') },
      { label: 'Side by Side', shortcut: 'Ctrl+6', checked: s.viewMode === 'side', action: () => s.setViewMode('side') },
      { label: 'Continuous Side by Side', shortcut: 'Ctrl+7', checked: s.viewMode === 'continuous-side', action: () => s.setViewMode('continuous-side') },
      { label: 'Rotate View Clockwise', shortcut: 'Ctrl+Shift+Plus', disabled: noDoc, action: () => s.rotateView(90) },
      { label: 'Rotate View Counterclockwise', shortcut: 'Ctrl+Shift+Minus', disabled: noDoc, action: () => s.rotateView(-90) },
      { sep: true },
      { label: 'Show Grid', shortcut: 'Shift+F9', checked: s.toggles.grid, action: () => s.toggle('grid') },
      { label: 'Snap to Grid', shortcut: 'Ctrl+Shift+F9', checked: s.toggles.snap, action: () => s.toggle('snap') },
    ],
    Document: [
      { label: 'First Page', shortcut: 'Home', disabled: noDoc, action: () => s.setPage(0) },
      { label: 'Previous Page', shortcut: 'Ctrl+Left', disabled: noDoc, action: () => doc && s.setPage(doc.page - 1) },
      { label: 'Next Page', shortcut: 'Ctrl+Right', disabled: noDoc, action: () => doc && s.setPage(doc.page + 1) },
      { label: 'Last Page', shortcut: 'End', disabled: noDoc, action: () => doc && s.setPage(doc.loaded.pages.length - 1) },
      { sep: true },
      { label: 'Insert Pages…', shortcut: 'Ctrl+Shift+I', disabled: noDoc, action: () => openPagesDialog('insert') },
      { label: 'Insert Blank Page…', shortcut: 'Ctrl+Shift+N', disabled: noDoc, action: () => openPagesDialog('insert-blank') },
      { label: 'Delete Pages…', shortcut: 'Ctrl+Shift+D', disabled: noDoc, action: () => openPagesDialog('delete') },
      { label: 'Extract Pages…', shortcut: 'Ctrl+Shift+X', disabled: noDoc, action: () => openPagesDialog('extract') },
      { label: 'Replace Pages…', shortcut: 'Ctrl+Shift+Y', disabled: noDoc, action: () => openPagesDialog('replace') },
      { label: 'Rotate Pages…', shortcut: 'Ctrl+Shift+R', disabled: noDoc, action: () => openPagesDialog('rotate') },
      { label: 'Split Document…', disabled: noDoc, action: () => openPagesDialog('split') },
      { label: 'Slip Sheet…', disabled: noDoc, action: () => openPagesDialog('slip-sheet') },
      { label: 'Page Labels…', disabled: noDoc, action: () => useSheetsDialog.setState({ open: 'labels' }) },
      { label: 'Batch Link…', disabled: noDoc, action: () => useSheetsDialog.setState({ open: 'batch-link' }) },
      { sep: true },
      { label: 'Flatten Markups…', shortcut: 'Ctrl+Shift+M', disabled: noDoc, action: () => openPagesDialog('flatten') },
      { sep: true },
      { label: 'Signature…', disabled: noDoc, action: () => useSignature.setState({ open: true }) },
      { label: 'Sign Document (Digital ID)…', disabled: noDoc, action: () => openSignDialog() },
      { label: 'Mark for Redaction', shortcut: 'Shift+R', disabled: noDoc, action: () => s.setTool('redaction') },
      { label: 'Mark Text for Redaction', shortcut: 'Shift+K', disabled: noDoc, action: () => s.setTool('redact-text') },
      { label: 'Apply Redactions…', shortcut: 'Shift+A', disabled: noDoc, action: runApplyRedactions },
      { label: 'OCR…', shortcut: 'Ctrl+Shift+O', disabled: noDoc, action: () => openPagesDialog('ocr') },
      { sep: true },
      { label: 'Compare Documents…', disabled: noDoc, action: () => openCompare('compare') },
      { label: 'Overlay Pages…', disabled: noDoc, action: () => openCompare('overlay') },
    ],
    Tools: [
      { label: 'Select', shortcut: 'V', checked: s.tool === 'select', action: () => s.setTool('select') },
      { label: 'Pan', shortcut: 'Shift+V', checked: s.tool === 'pan', action: () => s.setTool('pan') },
      { sep: true },
      ...toolItems('markup'),
      { sep: true },
      ...toolItems('form'),
      { label: 'Forms Editor…', shortcut: 'Ctrl+Shift+F', disabled: noDoc, action: () => useFormsDialog.setState({ editor: true }) },
    ],
    Measure: [
      { label: 'Set Scale…', disabled: noDoc, action: () => doc && s.openScaleDialog({ page: doc.page }) },
      { sep: true },
      ...toolItems('measure'),
    ],
    Batch: [
      { label: 'Batch Link…', disabled: noDoc, action: () => useSheetsDialog.setState({ open: 'batch-link' }) },
      { label: 'Slip Sheet…', disabled: noDoc, action: () => openPagesDialog('slip-sheet') },
      { label: 'Flatten…', disabled: noDoc, action: () => openPagesDialog('flatten') },
      { label: 'Summary (Excel)', disabled: noDoc, action: () => { const d = activeDoc(); if (d) exportSummaryXlsx(d.markups, allColumns(d)); } },
      { label: 'Summary (PDF)', disabled: noDoc, action: () => { const d = activeDoc(); if (d) exportSummaryPdf(d.markups, allColumns(d)); } },
      { label: 'Combine Files…', action: combineFiles },
    ],
    Window: [
      { label: 'Thumbnails', shortcut: 'Alt+T', checked: s.left === 'thumbnails', action: () => s.setPanels({ left: s.left === 'thumbnails' ? null : 'thumbnails' }) },
      { label: 'Bookmarks', shortcut: 'Alt+B', checked: s.left === 'bookmarks', action: () => s.setPanels({ left: s.left === 'bookmarks' ? null : 'bookmarks' }) },
      { label: 'Properties', shortcut: 'Alt+P', checked: s.right === 'properties', action: () => s.setPanels({ right: s.right === 'properties' ? null : 'properties' }) },
      { label: 'Tool Chest', shortcut: 'Alt+X', checked: s.right === 'toolchest', action: () => s.setPanels({ right: s.right === 'toolchest' ? null : 'toolchest' }) },
      { label: 'Measurements', shortcut: 'Alt+U', checked: s.right === 'measurements', action: () => s.setPanels({ right: s.right === 'measurements' ? null : 'measurements' }) },
      { label: 'Layers', shortcut: 'Alt+Y', checked: s.left === 'layers', action: () => s.setPanels({ left: s.left === 'layers' ? null : 'layers' }) },
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
      onMouseDown={(e) => e.preventDefault()}
      title={`${t.name}${effectiveCombo(`tool:${t.id}`, s.customKeys) ? ` (${effectiveCombo(`tool:${t.id}`, s.customKeys)})` : ''}\nDouble-click to lock`}
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
        {TOOLS.filter((t) => t.group === 'markup' && !['legend', 'redaction', 'redact-text'].includes(t.id)).map((t) => <ToolButton key={t.id} id={t.id} />)}
      </div>
      <div className="tb-group">
        {TOOLS.filter((t) => t.group === 'measure' && t.id !== 'viewport' && t.id !== 'space').map((t) => <ToolButton key={t.id} id={t.id} />)}
      </div>
      <div className="tb-group">
        <button className="tb-btn" title="Fit Page (Ctrl+9)" disabled={!doc} onClick={() => viewerApi.fitPage()}><Icon name="fitpage" /></button>
        <button className="tb-btn" title="Fit Width (Ctrl+0)" disabled={!doc} onClick={() => viewerApi.fitWidth()}><Icon name="fitwidth" /></button>
        <button className="tb-btn" title="Zoom Out (Minus)" disabled={!doc} onClick={() => viewerApi.zoomBy(0.8)}><Icon name="zoomout" /></button>
        <button className="tb-btn" title="Zoom In (Plus)" disabled={!doc} onClick={() => viewerApi.zoomBy(1.25)}><Icon name="zoomin" /></button>
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

const TOOL_HINTS: Partial<Record<string, string>> = {
  'two-point': 'Click and drag, or click two points. Hold Shift for horizontal, vertical or 45°.',
  box: 'Click and drag to draw.',
  poly: 'Click to add points. Double-click or Enter to finish, Backspace removes the last point.',
  freehand: 'Click and drag to draw.',
  point: 'Click to place.',
  count: 'Click each item to count it. Enter or Esc to finish.',
  callout: 'Click the arrow point, then click where the text box goes.',
};

const TOGGLES: { key: keyof Toggles; label: string; title: string }[] = [
  { key: 'snap', label: 'Snap', title: 'Snap to Grid (Ctrl+Shift+F9)' },
  { key: 'grid', label: 'Grid', title: 'Show Grid (Shift+F9)' },
  { key: 'content', label: 'Content', title: 'Snap to Content: line endpoints and lines in the drawing (Ctrl+Shift+F8)' },
  { key: 'markup', label: 'Markup', title: 'Snap to Markup (Ctrl+Shift+F7)' },
  { key: 'reuse', label: 'Reuse', title: 'Reuse Markup Tools: keep the tool after placing a markup, until Esc or right-click' },
  { key: 'sync', label: 'Sync', title: 'Sync views in split view (coming with split view)' },
];

export function StatusBar() {
  const s = useApp();
  const doc = useActiveDoc();
  const cursor = useCursor();
  const [pageInput, setPageInput] = useState('');
  const n = doc?.loaded.pages.length ?? 0;
  const scale = doc?.calibrations[doc.page];
  const pos = cursor.p && (scale
    ? `${formatLength(cursor.p.x * scale.factor, scale.unit)}, ${formatLength(cursor.p.y * (scale.yFactor ?? scale.factor), scale.unit)}`
    : `${(cursor.p.x / 72).toFixed(2)}", ${(cursor.p.y / 72).toFixed(2)}"`);
  const page = doc?.loaded.pages[doc.page];
  const t = toolById(s.tool);
  const hint = TOOL_HINTS[t.interaction] ?? '';
  return (
    <div className="statusbar">
      {/* Left: snap/reuse toggles and help for the current tool, as in Revu */}
      <div className="sb-toggles">
        {TOGGLES.map((x) => (
          <button key={x.key} className={s.toggles[x.key] ? 'on' : ''} title={x.title}
            onMouseDown={(e) => e.preventDefault()} onClick={() => s.toggle(x.key)}>{x.label}</button>
        ))}
      </div>
      <div className="sb-section sb-status" title={s.status}>
        {s.busy ? '⏳ ' : ''}{s.tool !== 'select' && hint ? `${t.name}: ${hint}` : s.status}
      </div>
      {doc && (
        <div className="sb-section sb-nav">
          <button onClick={() => s.setPage(0)} title="First Page (Home)"><Icon name="first" size={14} /></button>
          <button onClick={() => s.setPage(doc.page - 1)} title="Previous Page (Ctrl+Left)"><Icon name="prev" size={14} /></button>
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
          <button onClick={() => s.setPage(doc.page + 1)} title="Next Page (Ctrl+Right)"><Icon name="next" size={14} /></button>
          <button onClick={() => s.setPage(n - 1)} title="Last Page (End)"><Icon name="last" size={14} /></button>
          <span className="sb-zoom">{Math.round((doc.zoom || 1) * 100)}%</span>
        </div>
      )}
      {/* Right: page scale (click to set), page size, cursor position */}
      {doc && (
        <button className="sb-section sb-scale" title="Page scale. Click to set or reset it."
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => s.openScaleDialog({ page: doc.page })}>
          {scale ? scale.label : 'Scale Not Set'}
        </button>
      )}
      {doc && page && <div className="sb-section sb-size" title="Page size">{(page.width / 72).toFixed(2)} x {(page.height / 72).toFixed(2)} in</div>}
      {doc && <div className="sb-section sb-pos" title="Cursor position">{pos ?? ''}</div>}
    </div>
  );
}
