import type { LengthUnit } from '../model/types';
import { BookmarksPanel } from './BookmarksPanel';
import { updateTool, useSequenceDialog } from './SequenceDialog';
import { HatchSelect, LineStyleSelect } from './LineStyles';
import { LayersPanel } from './LayersPanel';
import { LinksPanel } from './LinksPanel';
import { FlagsPanel } from './FlagsPanel';
import { DocumentProps } from './DocumentProps';
import { flaggedPages } from '../model/flags';
import { StatusSelect } from './StatusModels';
import { FileAccessPanel } from './FileAccess';
import { layerIds } from '../pdf/layers';
import { SignaturesPanel } from './DigitalSignature';
import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { TOOLS } from '../tools/tools';
import { applyToolProperties } from '../model/toolScale';
import { scaleAt, areaLabel, volumeLabel } from '../model/measure';
import { LENGTH_UNITS, SEGMENT_TYPES, displayText } from '../model/measureDisplay';
import { placeColumns } from '../model/listColumns';
import { layoutOf, withLayout } from '../model/layoutProps';
import { addCapture, openCapturePreview } from './Capture';
import { DEFAULT_LINE_HEIGHT, DEFAULT_MARGIN, TEXT_FONTS, textStyleOf } from '../model/textStyle';
import { COUNT_SYMBOLS, symbolForType } from '../model/count';
import { usePageSetup } from './PageSetup';
import { useApp, useActiveDoc, type DocState } from '../model/store';
import { DECIMAL_PRECISIONS, FRACTION_PRECISIONS, SCALE_PRESETS, formatNumber, measure, precisionOf, unitLabel, withPrecision } from '../model/measure';
import type { Markup, MarkupStyle, MarkupType, Scale, ToolPreset, ToolSet } from '../model/types';
import { toolById } from '../tools/tools';
import { Icon } from './icons';
import { SpacesPanel } from './SpacesPanel';
import { SearchPanel } from './Search';
import { SetsPanel } from './Sheets';
import { pickFile } from './toolActions';
import { ContextMenu, type MenuItem } from './ContextMenu';
import { openPagesDialog } from './PagesDialog';
import { deletePages, extractPages, movePage, rotatePages, writePageLabels } from '../pdf/pages';
import { PDFDocument } from 'pdf-lib';
import { serialize } from '../model/store';
import { copyPages, hasPageClipboard, pastePages } from './pageClipboard';
import { copyPageToSnapshot } from './textCommands';
import { useApplyStamp } from './ApplyStamp';
import { useColorProcess } from './ColorProcess';
import { useSheetsDialog } from './Sheets';
import { openPrint } from './Print';
import { emailBytes } from './DocTools';
import { exportSummaryCsv } from './actions';
import { legendKey } from '../model/legend';

// ---------------- side tab strips ----------------

export function SideTabs({ side }: { side: 'left' | 'right' }) {
  const s = useApp();
  const tabs = side === 'left'
    ? [{ id: 'thumbnails', label: 'Thumbnails' }, { id: 'bookmarks', label: 'Bookmarks' }, { id: 'spaces', label: 'Spaces' }, { id: 'search', label: 'Search' }, { id: 'sets', label: 'Sets' }, { id: 'signatures', label: 'Signatures' }, { id: 'layers', label: 'Layers' }, { id: 'links', label: 'Links' }, { id: 'flags', label: 'Flags' }, { id: 'files', label: 'File Access' }] as const
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
  if (s.left === 'signatures') return <PanelFrame title="Signatures" onClose={close}>{doc ? <SignaturesPanel doc={doc} /> : null}</PanelFrame>;
  if (s.left === 'sets') return <PanelFrame title="Sets" onClose={close}><SetsPanel /></PanelFrame>;
  if (s.left === 'search') return <PanelFrame title="Search" onClose={close}>{doc ? <SearchPanel doc={doc} /> : null}</PanelFrame>;
  if (s.left === 'files') return <PanelFrame title="File Access" onClose={close}><FileAccessPanel /></PanelFrame>;
  if (s.left === 'links') return <PanelFrame title="Links" onClose={close}>{doc ? <LinksPanel doc={doc} /> : null}</PanelFrame>;
  if (s.left === 'flags') return <PanelFrame title="Flags" onClose={close}>{doc ? <FlagsPanel doc={doc} /> : null}</PanelFrame>;
  if (s.left === 'layers') return <PanelFrame title="Layers" onClose={close}>{doc ? <LayersPanel doc={doc} /> : null}</PanelFrame>;
  if (s.left === 'spaces') return <PanelFrame title="Spaces" onClose={close}>{doc ? <SpacesPanel doc={doc} /> : null}</PanelFrame>;
  return s.left === 'thumbnails'
    ? <PanelFrame title="Thumbnails" onClose={close}>{doc ? <Thumbnails doc={doc} /> : null}</PanelFrame>
    : <PanelFrame title="Bookmarks" onClose={close}>{doc ? <BookmarksPanel doc={doc} /> : null}</PanelFrame>;
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

/** Pages selected in the Thumbnails panel (Ctrl/Shift+click), per document; Print's "Selected" range. */
export const useThumbSel = create<{ sel: Record<string, number[]> }>(() => ({ sel: {} }));
const NO_PAGES: number[] = [];
export const selectedPages = (d: DocState): number[] =>
  (useThumbSel.getState().sel[d.id] ?? []).filter((i) => i < d.loaded.pages.length).sort((a, b) => a - b);

function Thumb({ doc, index, selected, onClick, w = 130, labels }: { doc: DocState; index: number; selected: boolean; onClick: (e: React.MouseEvent) => void; w?: number; labels: ThumbLabels }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const p = doc.loaded.pages[index];
  const h = (p.height / p.width) * w;
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
  const count = doc.markups.filter((m) => m.page === index).length;
  const flagged = flaggedPages(doc.markups, doc.loaded.flags).has(index);
  return (
    <div className={`thumb ${doc.page === index ? 'active' : ''} ${selected ? 'selected' : ''}`} aria-selected={selected} onClick={onClick}>
      <canvas ref={ref} style={{ width: w, height: h }} />
      {labels.label && <div className="thumb-label">{p.label}{count ? <span className="thumb-count">{count}</span> : null}{flagged ? <span className="thumb-flag" title="This page has a flag">⚑</span> : null}</div>}
      {labels.scale && <div className="thumb-scale muted small" title="Page scale (double-click to set)" onDoubleClick={(e) => { e.stopPropagation(); useApp.getState().openScaleDialog({ page: index }); }}>{doc.calibrations[index]?.label ?? 'Scale Not Set'}</div>}
    </div>
  );
}

interface ThumbLabels { label: boolean; scale: boolean }
/** Thumbnails panel settings (Labels menu, size slider), kept per browser. */
export const useThumbPrefs = create<{ labels: ThumbLabels; size: number }>(() => {
  try { const v = JSON.parse(localStorage.getItem('ct-thumbs') ?? 'null'); if (v?.labels && v.size) return v; } catch { /* fresh */ }
  return { labels: { label: true, scale: false }, size: 130 };
});
const setThumbPrefs = (p: Partial<{ labels: ThumbLabels; size: number }>) => {
  useThumbPrefs.setState(p);
  try { localStorage.setItem('ct-thumbs', JSON.stringify(useThumbPrefs.getState())); } catch { /* storage unavailable */ }
};

function Thumbnails({ doc }: { doc: DocState }) {
  const s = useApp();
  const { labels, size } = useThumbPrefs();
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const sel = useThumbSel((x) => x.sel[doc.id] ?? NO_PAGES);
  const setSel = (ids: number[]) => useThumbSel.setState((x) => ({ sel: { ...x.sel, [doc.id]: ids } }));
  const click = (e: React.MouseEvent, index: number) => {
    if (e.ctrlKey || e.metaKey) { setSel(sel.includes(index) ? sel.filter((i) => i !== index) : [...sel, index]); return; }
    if (e.shiftKey) {
      const a = Math.min(doc.page, index), z = Math.max(doc.page, index);
      setSel(Array.from({ length: z - a + 1 }, (_, i) => a + i));
      return;
    }
    setSel([index]);
    s.setPage(index);
  };
  /** The pages a command works on: the selection, else the current page. */
  const target = () => (sel.length ? [...sel].sort((a, b) => a - b) : [doc.page]);
  const relabel = () => {
    const i = doc.page;
    const v = prompt('Page label', doc.loaded.pages[i].label);
    if (v === null) return;
    const labels = doc.loaded.pages.map((p, k) => (k === i ? v.trim() : p.label));
    s.transformDoc((lib) => writePageLabels(lib, labels), `Page ${i + 1} labelled "${v.trim()}"`);
  };
  const exportPages = async () => {
    const pages = target();
    const lib = await PDFDocument.load(await serialize(doc), { updateMetadata: false });
    const bytes = await (await extractPages(lib, pages)).save();
    const href = URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' }));
    Object.assign(document.createElement('a'), { href, download: `${doc.name.replace(/\.pdf$/i, '')} - pages ${pages.map((p) => p + 1).join(',')}.pdf`.slice(0, 120) }).click();
    setTimeout(() => URL.revokeObjectURL(href), 10_000);
    s.setStatus(`Exported ${pages.length} page${pages.length === 1 ? '' : 's'}`);
  };
  const emailPages = async () => {
    const pages = target();
    const lib = await PDFDocument.load(await serialize(doc), { updateMetadata: false });
    const bytes = await (await extractPages(lib, pages)).save();
    await emailBytes(bytes, `${doc.name.replace(/\.pdf$/i, '')} - pages ${pages.map((p) => p + 1).join(',')}.pdf`);
  };
  const printPages = () => { if (!sel.length) setSel([doc.page]); openPrint('selected'); };
  const commands = (index: number): MenuItem[] => {
    const rot = (d: 90 | -90) => s.transformDoc((lib) => rotatePages(lib, target(), d), d > 0 ? 'Rotated clockwise' : 'Rotated counterclockwise');
    const n = target().length;
    const some = n === 1 ? '' : ` (${n})`;
    return [
      { label: 'Page Setup…', action: () => usePageSetup.setState({ open: 'setup' }) },
      { sep: true },
      { label: `Cut Pages${some}`, disabled: doc.loaded.pages.length < 2, action: () => copyPages(doc, target(), true) },
      { label: `Copy Pages${some}`, action: () => copyPages(doc, target()) },
      { label: 'Copy Page to Snapshot', shortcut: 'Ctrl+Alt+C', action: () => copyPageToSnapshot() },
      { label: 'Paste Pages', disabled: !hasPageClipboard(), action: () => pastePages(index) },
      { label: 'Apply Stamp…', action: () => useApplyStamp.setState({ open: true }) },
      { sep: true },
      { label: 'Insert Blank Page…', action: () => openPagesDialog('insert-blank') },
      { label: 'Insert Pages…', action: () => openPagesDialog('insert') },
      { label: 'Extract Pages…', action: () => openPagesDialog('extract') },
      { label: 'Replace Pages…', action: () => openPagesDialog('replace') },
      { label: `Delete Page${some}`, disabled: doc.loaded.pages.length <= n, action: () => s.transformDoc((lib) => deletePages(lib, target()), `Deleted ${n} page${n === 1 ? '' : 's'}`) },
      { label: 'Rotate Clockwise', shortcut: 'Shift+Alt+Plus', action: () => rot(90) },
      { label: 'Rotate Counterclockwise', shortcut: 'Shift+Alt+Minus', action: () => rot(-90) },
      { sep: true },
      { label: 'Number Pages…', action: () => usePageSetup.setState({ open: 'number' }) },
      { label: 'Create Page Labels from Bookmarks…', action: () => usePageSetup.setState({ open: 'bookmarks' }) },
      { label: 'Re-Label…', action: relabel },
      { label: 'Set Scale…', action: () => s.openScaleDialog({ page: index }) },
      { sep: true },
      { label: `Export Pages${some}`, action: exportPages },
      { label: `Email Pages${some}`, action: emailPages },
      { label: `Print Pages${some}…`, action: printPages },
      { label: 'Repair PDF…', action: () => useColorProcess.setState({ open: 'repair' }) },
      { label: 'Flatten…', action: () => openPagesDialog('flatten') },
      { label: 'Markup Summary (CSV)', action: () => exportSummaryCsv() },
    ];
  };
  const onMenu = (e: React.MouseEvent, index: number) => {
    e.preventDefault();
    if (!sel.includes(index)) { s.setPage(index); setSel([index]); } else s.setPage(index);
    setMenu({ x: e.clientX, y: e.clientY, items: commands(index) });
  };
  const openToolbarMenu = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu({ x: r.left, y: r.bottom, items: commands(doc.page) });
  };
  const openLabelsMenu = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu({ x: r.left, y: r.bottom, items: [
      { label: 'Page Label', checked: labels.label, action: () => setThumbPrefs({ labels: { ...labels, label: !labels.label } }) },
      { label: 'Page Scale', checked: labels.scale, action: () => setThumbPrefs({ labels: { ...labels, scale: !labels.scale } }) },
    ] });
  };
  return (
    <div className="thumbs">
      <div className="panel-toolbar thumbs-toolbar">
        <button title="Page commands" aria-label="Thumbnails menu" onClick={openToolbarMenu}>Thumbnails ▾</button>
        <button title="Show page labels and scales under the thumbnails" aria-label="Labels menu" onClick={openLabelsMenu}>Labels ▾</button>
        <button title="Create Page Labels from the title block or bookmarks" onClick={() => useSheetsDialog.setState({ open: 'labels' })}>Create Page Label</button>
        <input type="range" aria-label="Thumbnail size" min={70} max={260} step={10} value={size} onChange={(e) => setThumbPrefs({ size: Number(e.target.value) })} title="Thumbnail size" />
      </div>
      {doc.loaded.pages.map((p) => (
        <div key={`${doc.id}-${p.index}`} draggable onDragStart={(e) => { setDrag(p.index); e.dataTransfer.effectAllowed = 'move'; }}
          onDragOver={(e) => { if (drag !== null) e.preventDefault(); }}
          onDrop={(e) => {
            e.preventDefault(); e.stopPropagation();
            const from = drag; setDrag(null);
            if (from !== null && from !== p.index) s.transformDoc((lib) => movePage(lib, from, p.index), `Moved page ${from + 1} to ${p.index + 1}`, p.index);
          }}
          onDragEnd={() => setDrag(null)}
          onContextMenu={(e) => onMenu(e, p.index)}>
          <Thumb doc={doc} index={p.index} selected={sel.includes(p.index)} onClick={(e) => click(e, p.index)} w={size} labels={labels} />
        </div>
      ))}
      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
    </div>
  );
}


// ---------------- Properties ----------------

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="prop-row"><span>{label}</span>{children}</label>;
}

function StyleEditor({ style, type, onChange }: { style: MarkupStyle; type: MarkupType; onChange: (p: Partial<MarkupStyle>) => void }) {
  const textual = type === 'textbox' || type === 'callout';
  const textTypes = textual || type === 'typewriter' || type === 'cloudplus';
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
      <Row label="Line Style"><LineStyleSelect style={style} onChange={onChange} /></Row>
      <HatchSelect style={style} type={type} onChange={onChange} />
      {(textual || ['length', 'polylength', 'area', 'perimeter', 'volume', 'angle', 'radius', 'diameter'].includes(type)) && !textTypes && (
        <Row label="Font Size"><input type="number" min={4} max={144} value={style.fontSize} onChange={(e) => onChange({ fontSize: Math.max(4, +e.target.value) })} /></Row>
      )}
      {textTypes && <TextStyleEditor style={style} type={type} onChange={onChange} />}
      {type === 'count' && (
        <>
          <Row label="Symbol">
            <select aria-label="Count symbol" value={style.countSymbol ?? 'circle'} onChange={(e) => onChange({ countSymbol: e.target.value === 'circle' ? undefined : e.target.value as MarkupStyle['countSymbol'] })}>
              {COUNT_SYMBOLS.map((sym) => <option key={sym} value={sym}>{sym === 'x' ? 'X' : sym[0].toUpperCase() + sym.slice(1)}</option>)}
            </select>
          </Row>
          <Row label="Scale"><input aria-label="Count scale" type="number" min={0.25} max={10} step={0.25} value={style.countScale ?? 1} onChange={(e) => onChange({ countScale: +e.target.value === 1 ? undefined : Math.max(0.25, +e.target.value) })} style={{ width: 60 }} /></Row>
        </>
      )}
    </>
  );
}

/** Revu's text properties: font, size (or Auto), style, alignment, line space, margin, text colour, box shape. */
function TextStyleEditor({ style, type, onChange }: { style: MarkupStyle; type: MarkupType; onChange: (p: Partial<MarkupStyle>) => void }) {
  const t = textStyleOf(style);
  const toggle = (k: 'bold' | 'italic' | 'underline' | 'strike', label: string, title: string) => (
    <button className={`tb-btn text-toggle ${t[k] ? 'active' : ''}`} title={title} aria-label={title} aria-pressed={t[k]} onClick={() => onChange({ [k]: !t[k] || undefined } as Partial<MarkupStyle>)}>{label}</button>
  );
  return (
    <>
      <div className="prop-section">Text</div>
      <Row label="Font">
        <select aria-label="Font" value={t.font} onChange={(e) => onChange({ font: e.target.value === 'Helvetica' ? undefined : e.target.value as MarkupStyle['font'] })}>
          {TEXT_FONTS.map((fnt) => <option key={fnt} value={fnt}>{fnt}</option>)}
        </select>
      </Row>
      <Row label="Font Size">
        <span className="inline">
          <input type="number" min={1} max={144} step={0.5} value={style.fontSize} disabled={t.autoSize} onChange={(e) => onChange({ fontSize: Math.max(1, +e.target.value) })} style={{ width: 60 }} />
          <label title="The largest size that fits the box"><input type="checkbox" checked={t.autoSize} onChange={(e) => onChange({ autoSize: e.target.checked || undefined })} /> Auto</label>
        </span>
      </Row>
      <Row label="Font Style">
        <span className="inline text-styles">
          {toggle('bold', 'B', 'Bold')}{toggle('italic', 'I', 'Italic')}{toggle('underline', 'U', 'Underline')}{toggle('strike', 'S', 'Strikethrough')}
        </span>
      </Row>
      <Row label="Alignment">
        <span className="inline">
          <select aria-label="Text alignment" value={t.align} onChange={(e) => onChange({ align: e.target.value === 'left' ? undefined : e.target.value as MarkupStyle['align'] })}>
            <option value="left">Left</option><option value="center">Center</option><option value="right">Right</option>
          </select>
          <select aria-label="Vertical alignment" value={t.valign} onChange={(e) => onChange({ valign: e.target.value === 'top' ? undefined : e.target.value as MarkupStyle['valign'] })}>
            <option value="top">Top</option><option value="middle">Middle</option><option value="bottom">Bottom</option>
          </select>
        </span>
      </Row>
      <Row label="Line Space"><input aria-label="Line space" type="number" min={0.5} max={5} step={0.05} value={t.lineHeight} onChange={(e) => onChange({ lineHeight: +e.target.value === DEFAULT_LINE_HEIGHT ? undefined : Math.max(0.5, +e.target.value) })} style={{ width: 60 }} /></Row>
      <Row label="Margin"><input aria-label="Text margin" type="number" min={0} max={72} step={0.5} value={t.margin} onChange={(e) => onChange({ margin: +e.target.value === DEFAULT_MARGIN ? undefined : Math.max(0, +e.target.value) })} style={{ width: 60 }} /></Row>
      <Row label="Text Color">
        <span className="inline">
          <input type="checkbox" aria-label="Separate text colour" checked={!!style.textColor} onChange={(e) => onChange({ textColor: e.target.checked ? style.color : undefined })} />
          {style.textColor && <input type="color" aria-label="Text colour" value={style.textColor} onChange={(e) => onChange({ textColor: e.target.value })} />}
        </span>
      </Row>
      {(type === 'textbox' || type === 'callout') && (
        <Row label="Shape">
          <select aria-label="Box shape" value={t.shape} onChange={(e) => onChange({ shape: e.target.value === 'rectangle' ? undefined : e.target.value as MarkupStyle['shape'] })}>
            <option value="rectangle">Rectangle</option><option value="circle">Circle</option><option value="triangle">Triangle</option><option value="hexagon">Hexagon</option>
          </select>
        </Row>
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
      // Revu: with nothing selected the panel shows the document's properties.
      return doc ? <DocumentProps doc={doc} /> : <p className="muted pad">Select a markup to view and edit its properties, or choose a markup tool to set its defaults.</p>;
    }
    const type = s.tool as MarkupType;
    // Tools that draw no markup of their own (form fields, viewports, lasso...) have no style defaults.
    if (!s.toolDefaults[type]) return <p className="muted pad">{t.name}: no style properties. Select a markup to view and edit its properties.</p>;
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
      <Row label="Comments"><textarea rows={3} spellCheck lang="en" value={m.comment} onChange={(e) => upd(() => ({ comment: e.target.value }))} /></Row>
      {(m.type === 'textbox' || m.type === 'callout') && sel.length === 1 && (
        <Row label="Text"><textarea rows={3} spellCheck lang="en" value={m.text ?? ''} onChange={(e) => upd(() => ({ text: e.target.value }))} /></Row>
      )}
      <Row label="Status">
        <StatusSelect m={m} ids={sel.map((x) => x.id)} />
      </Row>
      <Row label="Layer">
        <select aria-label="Markup layer" value={m.layer ?? ''} onChange={(e) => upd(() => ({ layer: e.target.value || undefined }))}>
          <option value="">(none)</option>
          {doc && layerIds(doc.layers?.order ?? []).map((id) => <option key={id} value={id}>{doc.layers!.layers[id].name}</option>)}
        </select>
      </Row>
      <Row label="Author"><input value={m.author} readOnly /></Row>
      <Row label="Date"><input value={new Date(m.modified).toLocaleString()} readOnly /></Row>
      <StyleEditor style={m.style} type={m.type} onChange={(p) => { upd((x) => ({ style: { ...x.style, ...p } })); if (s.prefs.dynamicDefaults && s.toolDefaults[m.type]) s.setToolDefault(m.type, p); }} />
      {m.type === 'legend' && m.legend && (
        <>
          <div className="prop-section">Legend</div>
          <Row label="Title"><input aria-label="Legend title" value={m.legend.title} onChange={(e) => upd((x) => ({ legend: { ...x.legend!, title: e.target.value } }))} /></Row>
          <Row label="Source Pages">
            <select aria-label="Source pages" value={m.legend.source} onChange={(e) => upd((x) => ({ legend: { ...x.legend!, source: e.target.value as 'page' } }))}>
              <option value="page">This page</option><option value="all">All pages</option>
            </select>
          </Row>
          <Row label="Columns">
            <label><input type="checkbox" checked={m.legend.showQuantity} onChange={(e) => upd((x) => ({ legend: { ...x.legend!, showQuantity: e.target.checked } }))} /> Quantity</label>
            <label><input type="checkbox" checked={m.legend.showMeasurement} onChange={(e) => upd((x) => ({ legend: { ...x.legend!, showMeasurement: e.target.checked } }))} /> Measurement</label>
          </Row>
        </>
      )}
      {meas && (
        <>
          <div className="prop-section">Measurement</div>
          <Row label="Scale"><input readOnly value={m.scale?.label ?? 'Not calibrated'} /></Row>
          {['volume', 'length', 'polylength', 'perimeter'].includes(m.type) && (
            <Row label={`Depth (${unitLabel(m.scale?.unit ?? 'ft')})`}>
              <input type="number" step={0.01} aria-label="Depth" value={m.depth ?? 0}
                onChange={(e) => upd(() => ({ depth: +e.target.value || (m.type === 'volume' ? 0 : undefined), ...(+e.target.value ? { rise: undefined } : {}) }))} />
            </Row>
          )}
          {['length', 'polylength'].includes(m.type) && (
            <Row label={`Rise/Drop (${unitLabel(m.scale?.unit ?? 'ft')})`}>
              <input type="number" step={0.01} aria-label="Rise/Drop" value={m.rise ?? 0}
                onChange={(e) => upd(() => ({ rise: +e.target.value || undefined, ...(+e.target.value ? { depth: undefined } : {}) }))} />
            </Row>
          )}
          {['area', 'volume', 'length', 'polylength', 'perimeter'].includes(m.type) && (
            <Row label="Slope">
              <select aria-label="Slope unit" value={m.slope?.unit ?? 'pitch'} onChange={(e) => upd((x) => ({ slope: { unit: e.target.value as 'pitch', value: x.slope?.value ?? 0 } }))}>
                <option value="pitch">Pitch (x/12)</option><option value="degree">Degree</option><option value="grade">Grade (%)</option>
              </select>
              <input type="number" step={0.5} aria-label="Slope" value={m.slope?.value ?? 0} style={{ width: 60 }}
                onChange={(e) => upd((x) => ({ slope: +e.target.value ? { unit: x.slope?.unit ?? 'pitch', value: +e.target.value } : undefined }))} />
            </Row>
          )}
          {meas.area !== undefined && m.type !== 'area' && m.type !== 'volume' && <Row label="Wall Area"><input readOnly value={formatNumber(meas.area, 2, true)} /></Row>}
          <Row label="Value"><input readOnly value={displayText(m, meas)} /></Row>
          {m.scale && ['area', 'volume', 'count', 'diameter', 'rectangle', 'ellipse'].includes(m.type) && (() => {
            const pc = placeColumns(m.points, doc?.loaded.pages[m.page]?.height ?? 0, m.scale);
            return <Row label="Width / Height"><input readOnly value={`${pc.width} × ${pc.height} ${unitLabel(m.scale.unit)}`} /></Row>;
          })()}
          <Row label="Show Caption">
            <select aria-label="Show caption" value={m.display?.caption ?? 'value'} onChange={(e) => upd((x) => ({ display: { ...x.display, caption: e.target.value as 'value' } }))}>
              <option value="value">Value</option><option value="label">Label</option><option value="both">Label and value</option><option value="none">None</option>
            </select>
          </Row>
          {SEGMENT_TYPES.has(m.type) && (
            <Row label="Segment Values">
              <label className="inline"><input type="checkbox" aria-label="Show segment values" checked={!!m.display?.segments} onChange={(e) => upd((x) => ({ display: { ...x.display, segments: e.target.checked || undefined } }))} /> Show</label>
              {m.display?.segments && (
                <select aria-label="Segment value alignment" value={m.display?.segmentAlign ?? 'center'} onChange={(e) => upd((x) => ({ display: { ...x.display, segmentAlign: e.target.value as 'center' } }))}>
                  <option value="center">On the line</option><option value="inside">Inside</option><option value="outside">Outside</option>
                </select>
              )}
            </Row>
          )}
          {m.points.length > 2 && <Row label="Centroid"><label className="inline"><input type="checkbox" aria-label="Show centroid" checked={!!m.display?.centroid} onChange={(e) => upd((x) => ({ display: { ...x.display, centroid: e.target.checked || undefined } }))} /> Show</label></Row>}
          {m.scale && meas.length !== undefined && meas.area === undefined && (
            <Row label="Length Unit"><select aria-label="Length unit" value={m.display?.lengthUnit ?? ''} onChange={(e) => upd((x) => ({ display: { ...x.display, lengthUnit: (e.target.value || undefined) as LengthUnit | undefined } }))}><option value="">Page scale ({unitLabel(m.scale.unit)})</option>{LENGTH_UNITS.map((u) => <option key={u} value={u}>{unitLabel(u)}</option>)}</select></Row>
          )}
          {m.scale && meas.area !== undefined && meas.volume === undefined && (
            <Row label="Area Unit"><select aria-label="Area unit" value={m.display?.areaUnit ?? ''} onChange={(e) => upd((x) => ({ display: { ...x.display, areaUnit: (e.target.value || undefined) as LengthUnit | undefined } }))}><option value="">Page scale</option>{LENGTH_UNITS.map((u) => <option key={u} value={u}>{areaLabel(u)}</option>)}</select></Row>
          )}
          {m.scale && meas.volume !== undefined && (
            <Row label="Volume Unit"><select aria-label="Volume unit" value={m.display?.volumeUnit ?? ''} onChange={(e) => upd((x) => ({ display: { ...x.display, volumeUnit: (e.target.value || undefined) as LengthUnit | undefined } }))}><option value="">Page scale</option>{LENGTH_UNITS.map((u) => <option key={u} value={u}>{volumeLabel(u)}</option>)}</select></Row>
          )}
        </>
      )}
      {sel.length === 1 && m.points.length > 0 && m.type !== 'count' && (() => {
        const pageH = doc?.loaded.pages[m.page]?.height ?? 0;
        const lay = layoutOf(m.points, pageH);
        const field = (k: keyof typeof lay, label: string) => (
          <Row label={label}><input type="number" step={0.01} aria-label={`Layout ${label}`} value={lay[k]} disabled={!!m.locked}
            onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) upd((x) => withLayout(x, pageH, { [k]: v })); }} /></Row>
        );
        return (
          <>
            <div className="prop-section">Layout (in)</div>
            {field('x', 'X')}{field('y', 'Y')}{field('width', 'Width')}{field('height', 'Height')}
          </>
        );
      })()}
      {sel.length === 1 && (
        <>
          <div className="prop-section">Capture</div>
          <div className="capture-list">
            {(m.capture ?? []).map((c, i) => (
              <span key={i} className="capture-thumb">
                <img src={c.data} alt={c.name} title={`${c.name} (double-click to preview)`} onDoubleClick={() => openCapturePreview(m.capture!, i)} />
                <button className="tool-remove" title="Remove photo" aria-label={`Remove ${c.name}`} onClick={() => upd((x) => ({ capture: x.capture?.filter((_, k) => k !== i) }))}>×</button>
              </span>
            ))}
            <label className="button">Add Photo…<input type="file" accept="image/*" aria-label="Add photo" style={{ display: 'none' }} onChange={async (e) => { const f = e.target.files?.[0]; if (f && doc) { try { await addCapture(doc, m, f); } catch { s.setStatus('That image could not be read.'); } } e.target.value = ''; }} /></label>
          </div>
        </>
      )}
      <div className="prop-actions">
        <button onClick={() => s.addToToolChest(m)}>Add to My Tools</button>
        <button title="Make this markup's appearance the tool's default" onClick={() => { s.setToolDefault(m.type, m.style); s.setStatus(`${toolById(m.type).name}: this appearance is now the default`); }}>Set as Default</button>
        <button onClick={() => s.deleteMarkups(ids)}>Delete</button>
      </div>
    </div>
  );
}

// ---------------- Tool Chest ----------------

function ToolItem({ p, onRemove, onMenu, symbol }: { p: ToolPreset; onRemove?: () => void; onMenu?: (e: React.MouseEvent) => void; symbol?: boolean }) {
  const s = useApp();
  const active = s.preset?.id === p.id;
  const use = (e: React.MouseEvent) => {
    // Shift+click with markups selected: apply the tool's appearance to them (Revu applies on a plain click).
    const d = s.docs.find((x) => x.id === s.activeId);
    if (e.shiftKey && d?.selection.length && p.mode !== 'drawing') {
      s.updateMarkups(d.selection, (m) => applyToolProperties(m, p, s.toolChest.commentPersistence));
      s.setStatus(`Applied "${p.name}" to ${d.selection.length} markup${d.selection.length === 1 ? '' : 's'}`);
      return;
    }
    s.setTool(p.type, { preset: p });
  };
  return (
    <div className={`tool-item ${active ? 'active' : ''} ${symbol ? 'symbol' : ''}`} title={`${p.name} (${toolById(p.type).name}, ${p.mode === 'drawing' ? 'Drawing' : 'Properties'} mode)\nClick to use, Shift+click to apply its properties to the selected markups, double-click to lock`}
      onClick={use}
      onDoubleClick={() => s.setTool(p.type, { preset: p, locked: true })}
      onContextMenu={(e) => { e.preventDefault(); onMenu?.(e); }}>
      <span className="tool-swatch" style={{ borderColor: p.style.color, background: p.style.fill ?? 'transparent' }}><Icon name={p.type} size={16} /></span>
      {!symbol && <span className="tool-name">{p.name}</span>}
      {p.mode === 'drawing' && <span className="tool-mode" title="Drawing mode">D</span>}
      {p.sequence && <span className="tool-mode" title="Sequence">#</span>}
      {onRemove && <button className="tool-remove" title="Remove" onClick={(e) => { e.stopPropagation(); onRemove(); }}><Icon name="close" size={10} /></button>}
    </div>
  );
}

/** Tool set file (export/import). */
interface ToolSetFile { format: 'cyantakeoff-toolset'; version: 1; name: string; tools: ToolPreset[] }

function exportToolSet(set: ToolSet) {
  const data: ToolSetFile = { format: 'cyantakeoff-toolset', version: 1, name: set.name, tools: set.tools };
  const href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
  Object.assign(document.createElement('a'), { href, download: `${set.name}.cttools.json` }).click();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

async function importToolSet(): Promise<ToolSet | null> {
  const f = await pickFile('.json,application/json');
  if (!f) return null;
  try {
    const d = JSON.parse(await f.text()) as ToolSetFile;
    if (d.format !== 'cyantakeoff-toolset' || !Array.isArray(d.tools)) throw new Error('not a tool set file');
    return { id: crypto.randomUUID(), name: d.name || f.name, tools: d.tools.map((t) => ({ ...t, id: crypto.randomUUID() })) };
  } catch (e) {
    useApp.getState().setStatus(`${f.name}: ${(e as Error).message}`);
    return null;
  }
}

function ToolChest() {
  const s = useApp();
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const sets = s.toolSets;
  const update = (id: string, fn: (t: ToolSet) => ToolSet | null) => s.setToolSets(sets.flatMap((t) => (t.id === id ? (fn(t) ? [fn(t)!] : []) : [t])));
  const doc = s.docs.find((x) => x.id === s.activeId);
  const pageScale = doc ? scaleAt(doc.calibrations[doc.page], doc.viewports[doc.page], undefined) : null;
  const setMenuFor = (e: React.MouseEvent, set: ToolSet) => setMenu({ x: e.clientX, y: e.clientY, items: [
    { label: 'Symbol', checked: set.view === 'symbol', action: () => update(set.id, (t) => ({ ...t, view: 'symbol' })) },
    { label: 'Detail', checked: set.view !== 'symbol', action: () => update(set.id, (t) => ({ ...t, view: 'detail' })) },
    { sep: true },
    { label: set.scale ? `Set Scale (now ${set.scale.label || 'set'})…` : 'Set Scale…', disabled: !pageScale, action: () => { if (pageScale) { update(set.id, (t) => ({ ...t, scale: pageScale })); s.setStatus(`${set.name}: tools keep their real size (scale ${pageScale.label || 'of this page'})`); } } },
    { label: 'Remove Scale', disabled: !set.scale, action: () => update(set.id, (t) => ({ ...t, scale: undefined })) },
    { sep: true },
    { label: 'Rename…', action: () => { const n = prompt('Tool set name', set.name); if (n) update(set.id, (t) => ({ ...t, name: n })); } },
    { label: 'Export…', action: () => exportToolSet(set) },
    { label: 'Hide', action: () => update(set.id, (t) => ({ ...t, hidden: true })) },
    { label: 'Create Legend', disabled: !set.tools.length, action: () => {
      useApp.setState({ legendKeys: [...new Set(set.tools.map(legendKey))] });
      s.setTool('legend');
      s.setStatus(`Click on the drawing to place the Legend for ${set.name}.`);
    } },
    { sep: true },
    { label: 'Delete Tool Set', disabled: sets.length < 2, action: () => { if (confirm(`Delete the tool set "${set.name}"?`)) update(set.id, () => null); } },
  ] });
  const toolMenuFor = (e: React.MouseEvent, set: ToolSet, p: ToolPreset) => setMenu({ x: e.clientX, y: e.clientY, items: [
    { label: 'Properties Mode', checked: p.mode !== 'drawing', action: () => update(set.id, (t) => ({ ...t, tools: t.tools.map((x) => (x.id === p.id ? { ...x, mode: 'properties' } : x)) })) },
    { label: 'Drawing Mode', checked: p.mode === 'drawing', disabled: !p.markup, action: () => update(set.id, (t) => ({ ...t, tools: t.tools.map((x) => (x.id === p.id ? { ...x, mode: 'drawing' } : x)) })) },
    { sep: true },
    { label: 'Sequence: Define…', checked: !!p.sequence, action: () => useSequenceDialog.setState({ toolId: p.id }) },
    { label: 'Sequence: Reset', disabled: !p.sequence, action: () => { updateTool(p.id, (x) => ({ ...x, sequence: { ...x.sequence!, run: x.sequence!.run + 1 } })); s.setStatus(`${p.name}: the sequence starts again`); } },
    { label: 'Sequence: Remove', disabled: !p.sequence, action: () => updateTool(p.id, (x) => ({ ...x, sequence: undefined })) },
    { sep: true },
    ...(p.type !== 'count' ? [{ label: 'Create Count', action: () => {
      // Revu: a count tool with this tool's colours; the symbol follows the shape (ours: the standard symbols).
      const tool: ToolPreset = { id: crypto.randomUUID(), name: `${p.name} Count`, type: 'count', subject: p.subject || p.name, style: { ...s.toolDefaults.count, color: p.style.color, fill: p.style.fill ?? p.style.color, opacity: p.style.opacity, countSymbol: symbolForType(p.type) } };
      update(set.id, (t) => ({ ...t, tools: [...t.tools, tool] }));
      s.setStatus(`${tool.name} added to ${set.name}`);
    } }] : []),
    { label: 'Rename…', action: () => { const n = prompt('Tool name', p.name); if (n) update(set.id, (t) => ({ ...t, tools: t.tools.map((x) => (x.id === p.id ? { ...x, name: n } : x)) })); } },
    { label: 'Remove', action: () => s.removeFromToolChest(p.id) },
  ] });
  const tc = s.toolChest;
  const chestMenu = (e: React.MouseEvent) => setMenu({ x: e.clientX, y: e.clientY, items: [
    ...sets.map((t) => ({ label: t.name, checked: !t.hidden, action: () => update(t.id, (x) => ({ ...x, hidden: !x.hidden })) })),
    { label: 'Recent Tools', checked: !tc.size || !s.recentHidden, action: () => useApp.setState({ recentHidden: !s.recentHidden }) },
    { sep: true },
    { label: 'Manage Tool Sets: New Tool Set…', action: () => { const n = prompt('New tool set name', 'New Tool Set'); if (n) s.setToolSets([...sets, { id: crypto.randomUUID(), name: n, tools: [] }]); } },
    { label: 'Manage Tool Sets: Import…', action: async () => { const t = await importToolSet(); if (t) s.setToolSets([...sets, t]); } },
    { sep: true },
    { label: 'Comment Persistence › No', checked: tc.commentPersistence === 'none', action: () => s.setToolChest({ commentPersistence: 'none' }) },
    { label: 'Comment Persistence › Exclude Text Boxes', checked: tc.commentPersistence === 'excludeText', action: () => s.setToolChest({ commentPersistence: 'excludeText' }) },
    { label: 'Comment Persistence › All Markups', checked: tc.commentPersistence === 'all', action: () => s.setToolChest({ commentPersistence: 'all' }) },
    { label: 'Update Tool Set Item on Reuse', checked: tc.updateOnReuse, action: () => s.setToolChest({ updateOnReuse: !tc.updateOnReuse }) },
  ] });
  const recentMenu = (e: React.MouseEvent) => setMenu({ x: e.clientX, y: e.clientY, items: [
    { label: 'Maximum Recents…', action: () => { const n = prompt('Maximum recent tools', String(tc.maxRecents)); if (n && Number(n) > 0) s.setToolChest({ maxRecents: Math.floor(Number(n)) }); } },
    { label: 'Clear Recents', disabled: !s.recentTools.length, action: () => useApp.setState({ recentTools: [] }) },
    { label: 'Hide', action: () => useApp.setState({ recentHidden: true }) },
  ] });
  return (
    <div className="toolchest" style={{ ['--tool-size' as string]: tc.size }}>
      <div className="prop-actions pad">
        <button aria-label="Tool Chest menu" onClick={chestMenu}>Tool Chest ▾</button>
        <input aria-label="Tool size" type="range" min={0.7} max={1.8} step={0.1} value={tc.size} title="Size" onChange={(e) => s.setToolChest({ size: Number(e.target.value) })} style={{ width: 70 }} />
      </div>
      {!s.recentHidden && (
        <details open>
          <summary onContextMenu={(e) => { e.preventDefault(); recentMenu(e); }}>Recent Tools<button className="toolset-gear" title="Recent Tools options" onClick={(e) => { e.preventDefault(); recentMenu(e); }}>⚙</button></summary>
          {s.recentTools.length ? s.recentTools.map((p) => <ToolItem key={p.id} p={p} />) : <p className="muted pad">Markups you create appear here.</p>}
        </details>
      )}
      {sets.filter((t) => !t.hidden).map((set, i) => (
        <details key={set.id} open>
          <summary onContextMenu={(e) => { e.preventDefault(); setMenuFor(e, set); }}>
            {set.name}{set.scale ? <span className="muted small"> · scale {set.scale.label || 'set'}</span> : null}
            <button className="toolset-gear" title="Tool set options" onClick={(e) => { e.preventDefault(); setMenuFor(e, set); }}>⚙</button>
          </summary>
          {set.view === 'symbol'
            ? <div className="tool-symbols">{set.tools.map((p) => <ToolItem key={p.id} p={p} symbol onRemove={() => s.removeFromToolChest(p.id)} onMenu={(e) => toolMenuFor(e, set, p)} />)}</div>
            : set.tools.map((p) => <ToolItem key={p.id} p={p} onRemove={() => s.removeFromToolChest(p.id)} onMenu={(e) => toolMenuFor(e, set, p)} />)}
          {i === 0 && <p className="muted pad small">Right-click a markup and choose “Add to My Tools” to save it here. Right-click a tool for Drawing mode.</p>}
        </details>
      ))}
      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
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
  const [measureMenu, setMeasureMenu] = useState<{ x: number; y: number } | null>(null);
  if (!doc) return <p className="muted pad">Open a document to calibrate and measure.</p>;
  const scale = doc.calibrations[doc.page];
  const sel = doc.markups.filter((m) => doc.selection.includes(m.id));
  const totals = { length: 0, area: 0, volume: 0, count: 0 };
  for (const m of sel) {
    const v = measure(m);
    if (!v) continue;
    totals.length += v.length ?? 0; totals.area += v.area ?? 0; totals.volume += v.volume ?? 0; totals.count += v.count ?? 0;
  }
  const measureTools = TOOLS.filter((t) => t.group === 'measure' && t.id !== 'viewport' && t.id !== 'space');
  return (
    <div className="props">
      <div className="prop-actions pad measure-head">
        <button aria-label="Measurements menu" onClick={(e) => setMeasureMenu({ x: e.clientX, y: e.clientY })}>Measurements ▾</button>
      </div>
      {measureMenu && <ContextMenu x={measureMenu.x} y={measureMenu.y} onClose={() => setMeasureMenu(null)} items={[
        { label: 'Show Measurement Tools', checked: !s.toggles.noMeasureTools, action: () => s.toggle('noMeasureTools') },
        { label: 'Snap Orthogonal', checked: !!s.toggles.snapOrtho, action: () => s.toggle('snapOrtho') },
        { label: 'Snap to Content', checked: s.toggles.content, action: () => s.toggle('content') },
        { label: 'Highlight Viewports', checked: !s.toggles.noViewportHighlight, action: () => s.toggle('noViewportHighlight') },
      ]} />}
      {!s.toggles.noMeasureTools && (
        <div className="measure-tools" role="toolbar" aria-label="Measurement tools">
          {measureTools.map((t) => (
            <button key={t.id} className={s.tool === t.id ? 'on' : ''} title={`${t.name}${t.shortcut ? ` (${t.shortcut})` : ''}`} aria-label={t.name} onClick={() => s.setTool(t.id)}><Icon name={t.id} size={16} /></button>
          ))}
        </div>
      )}
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
