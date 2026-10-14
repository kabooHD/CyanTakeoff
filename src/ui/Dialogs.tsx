import { useState } from 'react';
import { newViewportId, useApp, useActiveDoc } from '../model/store';
import {
  DECIMAL_PRECISIONS, FRACTION_PRECISIONS, SCALE_PRESETS, calibrate, customScale, parsePageRange,
  precisionOf, stripY, withPrecision, withYScale, yOf, type PaperUnit,
} from '../model/measure';
import type { LengthUnit, Scale } from '../model/types';
import { TOOLS } from '../tools/tools';

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label={title} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') onClose(); }}>
        <div className="modal-title">{title}</div>
        {children}
      </div>
    </div>
  );
}

const REAL_UNITS: { value: LengthUnit; label: string }[] = [
  { value: 'ft-in', label: `ft' in"` }, { value: 'ft', label: 'ft' }, { value: 'in', label: 'in' },
  { value: 'yd', label: 'yd' }, { value: 'm', label: 'm' }, { value: 'cm', label: 'cm' }, { value: 'mm', label: 'mm' },
];

type Mode = 'preset' | 'custom' | 'calibrate' | 'existing';

/**
 * One scale chooser: Preset / Custom / Calibrated. Used for the X scale and,
 * with "Separate Y Scale", again for the Y scale.
 */
function useScalePicker(opts: { current: Scale | null; pagePts?: number; existing: boolean; onCalibrate: () => void }) {
  const s = useApp();
  const { current, pagePts } = opts;
  const [mode, setMode] = useState<Mode>(pagePts ? 'calibrate' : opts.existing && current ? 'existing' : 'preset');
  const [presetLabel, setPresetLabel] = useState(current?.label ?? '');
  const [paper, setPaper] = useState('1');
  const [paperUnit, setPaperUnit] = useState<PaperUnit>('in');
  const [real, setReal] = useState('10');
  const [realIn, setRealIn] = useState('0');
  const [realUnit, setRealUnit] = useState<LengthUnit>(current?.unit ?? 'ft-in');
  const allPresets = [...s.savedScales, ...SCALE_PRESETS.flatMap((g) => g.items)];
  const realValue = realUnit === 'ft-in' ? (Number(real) || 0) + (Number(realIn) || 0) / 12 : Number(real) || 0;

  let scale: Scale | null = null;
  if (mode === 'existing') scale = current;
  else if (mode === 'preset') {
    const p = allPresets.find((x) => x.label === presetLabel);
    if (p) scale = { factor: p.factor, unit: p.unit, label: p.label, format: (p as Scale).format };
  } else if (mode === 'custom') {
    if (Number(paper) > 0 && realValue > 0) scale = customScale(Number(paper), paperUnit, realValue, realUnit);
  } else if (pagePts && realValue > 0) {
    scale = calibrate(pagePts, realValue, realUnit);
  }

  const realInputs = (
    <>
      <input type="number" min={0} value={real} onChange={(e) => setReal(e.target.value)} style={{ width: 70 }} />
      {realUnit === 'ft-in' && <>ft <input type="number" min={0} value={realIn} onChange={(e) => setRealIn(e.target.value)} style={{ width: 50 }} />in</>}
      <select value={realUnit} onChange={(e) => setRealUnit(e.target.value as LengthUnit)}>
        {REAL_UNITS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
      </select>
    </>
  );
  const ui = (
    <>
      {mode === 'existing' && current && (
        <div className="form-row"><span>Scale</span><strong>{current.label}</strong> (current)</div>
      )}
      <div className="form-row scale-modes">
        <label><input type="radio" checked={mode === 'preset'} onChange={() => setMode('preset')} /> Preset</label>
        <label><input type="radio" checked={mode === 'custom'} onChange={() => setMode('custom')} /> Custom</label>
        <label><input type="radio" checked={mode === 'calibrate'} onChange={() => setMode('calibrate')} disabled={!pagePts} /> Calibrated</label>
        <button onClick={opts.onCalibrate}>Calibrate…</button>
      </div>
      {mode === 'preset' && (
        <div className="form-row">
          <span>Scale</span>
          <select value={presetLabel} onChange={(e) => setPresetLabel(e.target.value)}>
            <option value="">Choose a scale…</option>
            {s.savedScales.length > 0 && (
              <optgroup label="Saved">{s.savedScales.map((p) => <option key={p.label}>{p.label}</option>)}</optgroup>
            )}
            {SCALE_PRESETS.map((g) => (
              <optgroup key={g.group} label={g.group}>{g.items.map((p) => <option key={p.label}>{p.label}</option>)}</optgroup>
            ))}
          </select>
          {s.savedScales.some((x) => x.label === presetLabel) && (
            <button onClick={() => { s.removeSavedScale(presetLabel); setPresetLabel(''); }} title="Delete this saved scale">Delete</button>
          )}
        </div>
      )}
      {mode === 'custom' && (
        <div className="form-row">
          <span>Scale</span>
          <input type="number" min={0} value={paper} onChange={(e) => setPaper(e.target.value)} style={{ width: 60 }} />
          <select value={paperUnit} onChange={(e) => setPaperUnit(e.target.value as PaperUnit)}>
            <option value="in">in</option><option value="mm">mm</option><option value="cm">cm</option>
          </select>
          = {realInputs}
        </div>
      )}
      {mode === 'calibrate' && pagePts && (
        <div className="form-row">
          <span>Scale</span>
          <input readOnly value={`${(pagePts / 72).toFixed(4)} in`} style={{ width: 90 }} /> = {realInputs}
        </div>
      )}
    </>
  );
  return { scale, ui, mode, realUnit };
}

/**
 * Revu's "Apply Scale to Pages" dialog (or "Apply Scale to Viewport"):
 * Preset / Custom / Calibrate, optional separate Y scale, page range,
 * precision and "+ Add Preset". Opened from the status bar scale, the
 * Measurements panel, Measure > Set Scale, or when measuring on an unscaled page.
 */
export function ScaleDialog() {
  const dlg = useApp((st) => st.scaleDialog);
  // Remount for each opening so the form starts fresh.
  return dlg ? <ScaleDialogForm key={JSON.stringify(dlg)} /> : null;
}

function ScaleDialogForm() {
  const s = useApp();
  const doc = useActiveDoc();
  const dlg = s.scaleDialog!;
  const vpd = dlg.viewport;
  const existingVp = vpd?.id && doc ? doc.viewports[dlg.page]?.find((v) => v.id === vpd.id) : undefined;
  const current = vpd ? existingVp?.scale ?? null : doc ? doc.calibrations[dlg.page] : null;
  const [name, setName] = useState(vpd?.name ?? existingVp?.name ?? '');
  const [separateY, setSeparateY] = useState(!!dlg.calibrateY || !!dlg.xScale || !!current?.yFactor);
  const [pagesMode, setPagesMode] = useState<'current' | 'all' | 'custom'>(dlg.reuse ? 'all' : 'current');
  const [range, setRange] = useState('');
  const [precision, setPrecision] = useState<number | null>(null);
  // After calibrating the Y scale, the X scale chosen before comes back as dlg.xScale.
  const xCurrent = dlg.xScale ?? (current ? stripY(current) : null);
  const reopen = (y: boolean, x?: Scale | null) => s.startCalibrate({ ...dlg, pagePts: y ? dlg.pagePts : undefined, viewport: vpd && { ...vpd, name }, calibrateY: y, xScale: x ?? undefined });
  const X = useScalePicker({ current: xCurrent, pagePts: dlg.calibrateY ? undefined : dlg.pagePts, existing: !!(dlg.reuse || existingVp || dlg.xScale), onCalibrate: () => reopen(false) });
  const yCurrent = current?.yFactor ? yOf(current) : null;
  const Y = useScalePicker({ current: yCurrent, pagePts: dlg.calibrateY ? dlg.pagePts : undefined, existing: !!yCurrent, onCalibrate: () => reopen(true, X.scale) });
  if (!doc) return null;
  const n = doc.loaded.pages.length;

  let scale = X.scale;
  const prec = precision ?? (scale ? precisionOf(scale) : 4);
  if (scale) scale = withPrecision(scale, scale.unit === 'ft-in' ? (FRACTION_PRECISIONS.includes(prec) ? prec : 4) : (DECIMAL_PRECISIONS.includes(prec) ? prec : 2));
  if (scale && separateY) scale = Y.scale ? withYScale(scale, Y.scale) : null;

  const pages = pagesMode === 'current' ? [dlg.page]
    : pagesMode === 'all' ? doc.loaded.pages.map((p) => p.index)
      : parsePageRange(range, n);

  const close = () => s.openScaleDialog(null);
  const apply = () => {
    if (!scale) return;
    if (vpd) {
      s.setViewport(dlg.page, { id: vpd.id ?? newViewportId(), name: name.trim(), rect: vpd.rect, scale });
      s.setTool('select');
      return;
    }
    if (!pages.length) return;
    s.setScale(pages, scale);
    s.setTool(dlg.then ?? 'select');
  };

  return (
    <Modal title={vpd ? 'Apply Scale to Viewport' : 'Apply Scale to Pages'} onClose={close}>
      <div className="scale-dialog" onKeyDown={(e) => e.key === 'Enter' && apply()}>
        {vpd && (
          <div className="form-row">
            <span>Label</span>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Viewport name" style={{ width: 200 }} />
          </div>
        )}
        {!vpd && <div className="form-row">
          <span>Pages</span>
          <select value={pagesMode} onChange={(e) => setPagesMode(e.target.value as typeof pagesMode)}>
            <option value="current">Current ({doc.loaded.pages[dlg.page]?.label ?? dlg.page + 1})</option>
            <option value="all">All Pages</option>
            <option value="custom">Custom</option>
          </select>
          {pagesMode === 'custom' && <input placeholder="1-3, 5, 9" value={range} onChange={(e) => setRange(e.target.value)} style={{ width: 110 }} />}
        </div>}
        {separateY && <div className="prop-section">X Scale</div>}
        {X.ui}
        <div className="form-row">
          <label><input type="checkbox" checked={separateY} onChange={(e) => setSeparateY(e.target.checked)} /> Separate Y Scale</label>
        </div>
        {separateY && <div className="y-scale"><div className="prop-section">Y Scale</div>{Y.ui}</div>}
        <div className="form-row">
          <span>Precision</span>
          <select value={prec} onChange={(e) => setPrecision(Number(e.target.value))}>
            {(X.scale?.unit ?? X.realUnit) === 'ft-in'
              ? FRACTION_PRECISIONS.map((d) => <option key={d} value={d}>{d === 1 ? '1"' : `1/${d}"`}</option>)
              : DECIMAL_PRECISIONS.map((d) => <option key={d} value={d}>{d === 0 ? '1' : (0).toFixed(d).slice(0, -1) + '1'}</option>)}
          </select>
        </div>
        {scale && !vpd && <p className="muted">Scale: <strong>{scale.label}</strong> on {pages.length} page{pages.length === 1 ? '' : 's'}</p>}
        {!current && dlg.then && <p className="muted small">This page has no scale yet. Set one to measure.</p>}
        <div className="modal-actions">
          <button disabled={!scale || X.mode === 'preset'} onClick={() => scale && s.addSavedScale(scale)}>+ Add Preset</button>
          <span className="spacer" />
          <button className="primary" disabled={!scale || (!vpd && !pages.length)} onClick={apply}>{vpd ? 'Apply' : 'Apply Scale'}</button>
          <button onClick={close}>Cancel</button>
        </div>
      </div>
    </Modal>
  );
}

// Revu 20/21 defaults that CyanTakeoff implements.
const GENERAL = [
  ['Ctrl+O / Ctrl+S / Ctrl+Shift+S', 'Open / Save / Save As'], ['Ctrl+F4', 'Close document'],
  ['Ctrl+Z / Ctrl+Y', 'Undo / Redo'], ['Ctrl+X / Ctrl+C / Ctrl+V', 'Cut / Copy / Paste'],
  ['Ctrl+Shift+V', 'Paste in Place'], ['Ctrl+A', 'Select all on page'], ['Del', 'Delete'],
  ['Plus / Minus', 'Zoom in / out'], ['Ctrl+9 / Ctrl+0 / Ctrl+8', 'Fit Page / Fit Width / Actual Size'],
  ['Ctrl+Right / Ctrl+Left', 'Next / previous page'], ['Home / End', 'First / last page'],
  ['Shift+F9', 'Show Grid'], ['Ctrl+Shift+F9', 'Snap to Grid'], ['Ctrl+Shift+F8', 'Snap to Content'],
  ['Ctrl+Shift+F7', 'Snap to Markup'], ['Alt+L', 'Markups List'], ['Alt+T / Alt+B', 'Thumbnails / Bookmarks'],
  ['Alt+P / Alt+X / Alt+U', 'Properties / Tool Chest / Measurements'], ['Shift+F4', 'Hide panels'],
  ['F1', 'Help'], ['Esc', 'Cancel / back to Select'], ['Enter or double-click', 'Finish polyline / area'],
  ['Shift (hold)', 'Horizontal, vertical or 45° lines'], ['Space (hold) / middle button', 'Pan'],
  ['Mouse wheel (Ctrl toggles)', 'Zoom at cursor / scroll'],
];

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Keyboard Shortcuts" onClose={onClose}>
      <div className="shortcuts">
        <table>
          <tbody>
            {TOOLS.filter((t) => t.shortcut).map((t) => <tr key={t.id}><td><kbd>{t.shortcut}</kbd></td><td>{t.name}</td></tr>)}
          </tbody>
        </table>
        <table>
          <tbody>
            {GENERAL.map(([k, v]) => <tr key={k}><td><kbd>{k}</kbd></td><td>{v}</td></tr>)}
          </tbody>
        </table>
      </div>
      <p className="muted small">These are Revu's default shortcuts. Double-click a tool button to lock it. Some browser-reserved keys (Ctrl+Tab, Ctrl+T, Ctrl+N) only work in the desktop version.</p>
      <div className="modal-actions"><button className="primary" onClick={onClose}>Close</button></div>
    </Modal>
  );
}

export function AboutDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="About CyanTakeoff" onClose={onClose}>
      <p>CyanTakeoff is a free, open-source PDF markup and quantity takeoff tool (Apache-2.0).</p>
      <p className="muted small">It is an independent project, not affiliated with or endorsed by Bluebeam, Inc. Bluebeam and Revu are trademarks of their respective owners.</p>
      <div className="modal-actions"><button className="primary" onClick={onClose}>OK</button></div>
    </Modal>
  );
}

/**
 * Revu's Hyperlink / Action dialog: open a web address, jump to a page, or
 * jump to a Place. With `ids` it edits the action of existing links (Links
 * panel > Edit Action, several at once).
 */
export function LinkDialog() {
  const dlg = useApp((s) => s.linkDialog);
  const doc = useActiveDoc();
  if (!dlg || !doc) return null;
  return <LinkForm key={JSON.stringify(dlg)} />;
}

function LinkForm() {
  const s = useApp();
  const doc = useActiveDoc()!;
  const dlg = s.linkDialog!;
  const first = dlg.ids?.length ? doc.markups.find((m) => m.id === dlg.ids![0])?.link : dlg.place ? { dest: dlg.place } : undefined;
  const places = doc.loaded.places;
  const [kind, setKind] = useState<'uri' | 'page' | 'place' | 'file'>(first?.dest ? 'place' : first?.file ? 'file' : first?.page !== undefined ? 'page' : 'uri');
  const [uri, setUri] = useState(first?.uri ?? 'https://');
  const [pageNo, setPageNo] = useState(String((first?.page ?? 0) + 1));
  const [place, setPlace] = useState(first?.dest ?? places[0]?.name ?? '');
  const close = () => useApp.setState({ linkDialog: null });
  const n = doc.loaded.pages.length;
  const target = kind === 'uri' ? (/^[a-z]+:\/\/./i.test(uri) || /^mailto:/i.test(uri) ? { uri } : null)
    : kind === 'place' ? (place ? { dest: place } : null)
    : kind === 'file' ? first ?? null
    : Number(pageNo) >= 1 && Number(pageNo) <= n ? { page: Number(pageNo) - 1 } : null;
  const comment = (t: NonNullable<typeof target>) => t.uri ?? (t.dest ? `Place: ${t.dest}` : t.file ? `${t.file}: page ${(t.page ?? 0) + 1}` : `Page ${(t.page ?? 0) + 1}`);
  const apply = () => {
    if (!target) return;
    if (dlg.ids?.length) {
      s.updateMarkups(dlg.ids, () => ({ link: target, comment: comment(target) }));
    } else {
      const m = s.addMarkup({ type: 'link', page: dlg.page, points: dlg.rect, style: s.toolDefaults.link, subject: 'Hyperlink', link: target, comment: comment(target) });
      s.select([m.id]);
    }
    close();
  };
  return (
    <Modal title={dlg.ids?.length ? `Action${dlg.ids.length > 1 ? ` (${dlg.ids.length} links)` : ''}` : 'Hyperlink'} onClose={close}>
      <div className="scale-dialog" onKeyDown={(e) => e.key === 'Enter' && apply()}>
        <div className="form-row">
          <label><input type="radio" checked={kind === 'uri'} onChange={() => setKind('uri')} /> Open web address</label>
          <input aria-label="Web address" value={uri} onChange={(e) => setUri(e.target.value)} onFocus={() => setKind('uri')} style={{ width: 240 }} />
        </div>
        <div className="form-row">
          <label><input type="radio" checked={kind === 'page'} onChange={() => setKind('page')} /> Jump to page</label>
          <input aria-label="Page number" type="number" min={1} max={n} value={pageNo} onChange={(e) => setPageNo(e.target.value)} onFocus={() => setKind('page')} style={{ width: 70 }} /> of {n}
        </div>
        <div className="form-row">
          <label><input type="radio" checked={kind === 'place'} disabled={!places.length} onChange={() => setKind('place')} /> Jump to Place</label>
          <select aria-label="Place" value={place} disabled={!places.length} onChange={(e) => { setPlace(e.target.value); setKind('place'); }}>
            {!places.length && <option value="">(no Places: add one in the Links panel)</option>}
            {places.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
          </select>
        </div>
        {first?.file && (
          <div className="form-row">
            <label><input type="radio" checked={kind === 'file'} onChange={() => setKind('file')} /> Keep: {first.file}, page {(first.page ?? 0) + 1}</label>
          </div>
        )}
        <div className="modal-actions">
          <span className="spacer" />
          <button className="primary" disabled={!target} onClick={apply}>OK</button>
          <button onClick={close}>Cancel</button>
        </div>
      </div>
    </Modal>
  );
}
