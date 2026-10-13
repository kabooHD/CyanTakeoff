import { useState } from 'react';
import { useApp, useActiveDoc } from '../model/store';
import {
  DECIMAL_PRECISIONS, FRACTION_PRECISIONS, SCALE_PRESETS, calibrate, customScale, parsePageRange,
  precisionOf, withPrecision, type PaperUnit,
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
 * Revu's "Apply Scale to Pages" dialog: Preset / Custom / Calibrate, page
 * range, precision and "+ Add Preset". Opened from the status bar scale, the
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
  const dlg = s.scaleDialog;
  const current = doc && dlg ? doc.calibrations[dlg.page] : null;
  const [mode, setMode] = useState<Mode>(dlg?.reuse && current ? 'existing' : dlg?.pagePts ? 'calibrate' : 'preset');
  const [presetLabel, setPresetLabel] = useState(current?.label ?? '');
  const [paper, setPaper] = useState('1');
  const [paperUnit, setPaperUnit] = useState<PaperUnit>('in');
  const [real, setReal] = useState('10');
  const [realIn, setRealIn] = useState('0');
  const [realUnit, setRealUnit] = useState<LengthUnit>(current?.unit ?? 'ft-in');
  const [pagesMode, setPagesMode] = useState<'current' | 'all' | 'custom'>(dlg?.reuse ? 'all' : 'current');
  const [range, setRange] = useState('');
  const [precision, setPrecision] = useState<number | null>(null);
  if (!dlg || !doc) return null;
  const n = doc.loaded.pages.length;

  const allPresets = [...s.savedScales, ...SCALE_PRESETS.flatMap((g) => g.items)];
  const realValue = realUnit === 'ft-in' ? (Number(real) || 0) + (Number(realIn) || 0) / 12 : Number(real) || 0;

  let scale: Scale | null = null;
  if (mode === 'existing') {
    scale = current;
  } else if (mode === 'preset') {
    const p = allPresets.find((x) => x.label === presetLabel);
    if (p) scale = { factor: p.factor, unit: p.unit, label: p.label, format: (p as Scale).format };
  } else if (mode === 'custom') {
    if (Number(paper) > 0 && realValue > 0) scale = customScale(Number(paper), paperUnit, realValue, realUnit);
  } else if (dlg.pagePts && realValue > 0) {
    scale = calibrate(dlg.pagePts, realValue, realUnit);
  }
  const prec = precision ?? (scale ? precisionOf(scale) : 4);
  if (scale) scale = withPrecision(scale, scale.unit === 'ft-in' ? (FRACTION_PRECISIONS.includes(prec) ? prec : 4) : (DECIMAL_PRECISIONS.includes(prec) ? prec : 2));

  const pages = pagesMode === 'current' ? [dlg.page]
    : pagesMode === 'all' ? doc.loaded.pages.map((p) => p.index)
      : parsePageRange(range, n);

  const close = () => s.openScaleDialog(null);
  const apply = () => {
    if (!scale || !pages.length) return;
    s.setScale(pages, scale);
    s.setTool(dlg.then ?? 'select');
  };
  const startCalibrate = () => {
    s.openScaleDialog(null);
    s.setTool('calibrate');
    s.setStatus('Calibrate: click the two ends of a known length on the drawing.');
  };
  const realInputs = (
    <>
      <input type="number" min={0} value={real} onChange={(e) => setReal(e.target.value)} style={{ width: 70 }} />
      {realUnit === 'ft-in' && <>ft <input type="number" min={0} value={realIn} onChange={(e) => setRealIn(e.target.value)} style={{ width: 50 }} />in</>}
      <select value={realUnit} onChange={(e) => { setRealUnit(e.target.value as LengthUnit); setPrecision(null); }}>
        {REAL_UNITS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
      </select>
    </>
  );

  return (
    <Modal title="Apply Scale to Pages" onClose={close}>
      <div className="scale-dialog" onKeyDown={(e) => e.key === 'Enter' && apply()}>
        <div className="form-row">
          <span>Pages</span>
          <select value={pagesMode} onChange={(e) => setPagesMode(e.target.value as typeof pagesMode)}>
            <option value="current">Current ({doc.loaded.pages[dlg.page]?.label ?? dlg.page + 1})</option>
            <option value="all">All Pages</option>
            <option value="custom">Custom</option>
          </select>
          {pagesMode === 'custom' && <input placeholder="1-3, 5, 9" value={range} onChange={(e) => setRange(e.target.value)} style={{ width: 110 }} />}
        </div>
        {mode === 'existing' && current && (
          <div className="form-row"><span>Scale</span><strong>{current.label}</strong> (this page's scale)</div>
        )}
        <div className="form-row scale-modes">
          <label><input type="radio" checked={mode === 'preset'} onChange={() => setMode('preset')} /> Preset</label>
          <label><input type="radio" checked={mode === 'custom'} onChange={() => setMode('custom')} /> Custom</label>
          <label><input type="radio" checked={mode === 'calibrate'} onChange={() => setMode('calibrate')} disabled={!dlg.pagePts} /> Calibrated</label>
          <button onClick={startCalibrate}>Calibrate…</button>
        </div>
        {mode === 'preset' && (
          <div className="form-row">
            <span>Scale</span>
            <select value={presetLabel} onChange={(e) => { setPresetLabel(e.target.value); setPrecision(null); }}>
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
        {mode === 'calibrate' && dlg.pagePts && (
          <div className="form-row">
            <span>Scale</span>
            <input readOnly value={`${(dlg.pagePts / 72).toFixed(4)} in`} style={{ width: 90 }} /> = {realInputs}
          </div>
        )}
        <div className="form-row">
          <span>Precision</span>
          <select value={prec} onChange={(e) => setPrecision(Number(e.target.value))}>
            {(scale?.unit ?? realUnit) === 'ft-in'
              ? FRACTION_PRECISIONS.map((d) => <option key={d} value={d}>{d === 1 ? '1"' : `1/${d}"`}</option>)
              : DECIMAL_PRECISIONS.map((d) => <option key={d} value={d}>{d === 0 ? '1' : (0).toFixed(d).slice(0, -1) + '1'}</option>)}
          </select>
        </div>
        {scale && <p className="muted">Scale: <strong>{scale.label}</strong> on {pages.length} page{pages.length === 1 ? '' : 's'}</p>}
        {!current && dlg.then && <p className="muted small">This page has no scale yet. Set one to measure.</p>}
        <div className="modal-actions">
          <button disabled={!scale || mode === 'preset'} onClick={() => scale && s.addSavedScale(scale)}>+ Add Preset</button>
          <span className="spacer" />
          <button className="primary" disabled={!scale || !pages.length} onClick={apply}>Apply Scale</button>
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
