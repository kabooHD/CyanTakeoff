// Multiply dialog (Revu): parallel copies of the selected markups in one of
// the four directions, a distance apart in the page's scale units (or inches
// without a scale), as many as fit on the sheet.
import { useState } from 'react';
import { create } from 'zustand';
import { useApp } from '../model/store';
import { multiplyMarkups, type Direction } from '../model/multiply';
import { unitLabel } from '../model/measure';
import { scaleAt } from '../model/measure';
import { offsetPt } from './OffsetBar';

export const useMultiply = create<{ open: boolean }>(() => ({ open: false }));

export function MultiplyDialog() {
  const open = useMultiply((x) => x.open);
  const d = useApp((s) => s.docs.find((x) => x.id === s.activeId));
  const [dir, setDir] = useState<Direction>('right');
  const [dist, setDist] = useState('1');
  const [count, setCount] = useState('1');
  if (!open || !d?.selection.length) return null;
  const page = d.loaded.pages[d.page];
  const first = d.markups.find((m) => d.selection.includes(m.id));
  const scale = first ? scaleAt(d.calibrations[d.page], d.viewports[d.page], first.points[0]) ?? null : null;
  const close = () => useMultiply.setState({ open: false });
  const ok = () => {
    const sel = d.markups.filter((m) => d.selection.includes(m.id) && m.page === d.page);
    const copies = multiplyMarkups(sel, dir, offsetPt(Number(dist) || 0, scale), Number(count) || 0, page.width, page.height, new Date().toISOString());
    close();
    if (!copies.length) { useApp.getState().setStatus('Multiply: no copy fits on the sheet'); return; }
    useApp.getState().addMarkups(copies);
    useApp.getState().select(copies.map((m) => m.id));
    useApp.getState().setStatus(`Multiply: ${copies.length / sel.length} cop${copies.length / sel.length === 1 ? 'y' : 'ies'} placed`);
  };
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal" role="dialog" aria-label="Multiply" onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') close(); if (e.key === 'Enter') ok(); }}>
        <div className="modal-title">Multiply</div>
        <div className="scale-dialog">
          <div className="form-row"><span>Direction</span>
            <select aria-label="Direction" value={dir} onChange={(e) => setDir(e.target.value as Direction)}>
              <option value="up">Up</option><option value="down">Down</option><option value="left">Left</option><option value="right">Right</option>
            </select>
          </div>
          <div className="form-row"><span>Distance</span>
            <input aria-label="Distance" type="number" min={0} step="any" value={dist} onChange={(e) => setDist(e.target.value)} style={{ width: 80 }} /> {scale ? unitLabel(scale.unit) : 'in'}
          </div>
          <div className="form-row"><span>Copies</span><input aria-label="Copies" type="number" min={1} max={500} value={count} onChange={(e) => setCount(e.target.value)} style={{ width: 70 }} /></div>
          {!scale && <p className="muted small">The page has no scale: the distance is in inches. Set a scale for drawing units.</p>}
          <div className="modal-actions"><span className="spacer" /><button className="primary" onClick={ok}>OK</button><button onClick={close}>Cancel</button></div>
        </div>
      </div>
    </div>
  );
}
