import { useState } from 'react';
import { useApp } from '../model/store';
import { calibrate, formatLength } from '../model/measure';
import type { LengthUnit } from '../model/types';
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

export function CalibrateDialog() {
  const s = useApp();
  const c = s.calibrating;
  const [feet, setFeet] = useState('10');
  const [inches, setInches] = useState('0');
  const [value, setValue] = useState('1');
  const [unit, setUnit] = useState<LengthUnit>('ft-in');
  const [all, setAll] = useState(false);
  if (!c) return null;
  const real = unit === 'ft-in' ? (Number(feet) || 0) + (Number(inches) || 0) / 12 : Number(value) || 0;
  const apply = () => {
    if (real <= 0) return;
    s.setCalibration(c.page, calibrate(c.pagePts, real, unit), all);
    s.setTool('select');
  };
  const close = () => { s.setCalibrating(null); };
  const preview = real > 0 ? calibrate(c.pagePts, real, unit) : null;
  return (
    <Modal title="Calibrate" onClose={close}>
      <p className="muted">Paper distance between the points: {(c.pagePts / 72).toFixed(3)} in</p>
      <div className="form-row">
        <span>Real distance</span>
        {unit === 'ft-in' ? (
          <span className="inline">
            <input autoFocus type="number" value={feet} onChange={(e) => setFeet(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && apply()} style={{ width: 70 }} /> ft
            <input type="number" value={inches} onChange={(e) => setInches(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && apply()} style={{ width: 60 }} /> in
          </span>
        ) : (
          <input autoFocus type="number" value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && apply()} style={{ width: 100 }} />
        )}
        <select value={unit} onChange={(e) => setUnit(e.target.value as LengthUnit)}>
          <option value="ft-in">ft-in</option><option value="ft">ft</option><option value="in">in</option><option value="yd">yd</option>
          <option value="m">m</option><option value="cm">cm</option><option value="mm">mm</option>
        </select>
      </div>
      <label className="form-row"><span>Apply to all pages</span><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /></label>
      {preview && <p className="muted">Resulting scale: {preview.label} ({formatLength(real, unit)})</p>}
      <div className="modal-actions">
        <button className="primary" onClick={apply} disabled={real <= 0}>OK</button>
        <button onClick={close}>Cancel</button>
      </div>
    </Modal>
  );
}

const GENERAL = [
  ['Ctrl+O', 'Open'], ['Ctrl+S', 'Save'], ['Ctrl+Shift+S', 'Save As'], ['Ctrl+W', 'Close document'],
  ['Ctrl+Z / Ctrl+Y', 'Undo / Redo'], ['Ctrl+C / Ctrl+V', 'Copy / Paste markups'], ['Ctrl+A', 'Select all on page'],
  ['Delete', 'Delete selected markups'], ['Esc', 'Cancel / back to Select'], ['Enter or double-click', 'Finish polyline/area'],
  ['Backspace', 'Remove last point while drawing'], ['Shift (hold)', 'Constrain to 45°'], ['Space (hold) / middle mouse', 'Pan'],
  ['Mouse wheel', 'Zoom at cursor'], ['Ctrl+0 / Ctrl+2 / Ctrl+1', 'Fit page / Fit width / Actual size'],
  ['Ctrl+= / Ctrl+-', 'Zoom in / out'], ['PgUp / PgDn / Home / End', 'Navigate pages'], ['Alt+L', 'Toggle Markups List'],
  ['Arrow keys (+Shift)', 'Nudge selected markups'],
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
      <p className="muted small">Double-click a tool button to lock it (keep drawing until you press Esc).</p>
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
