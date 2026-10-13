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
