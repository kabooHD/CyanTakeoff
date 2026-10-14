// Offset toolbar (Revu, select a markup and press O): distance, Replace
// Markup, Angle Miter Limit and Offset as; then click the side to place it.
import { create } from 'zustand';
import { useApp } from '../model/store';
import { OFFSET_AS, canOffset } from '../model/offset';
import type { MarkupType, Scale } from '../model/types';
import { toolById } from '../tools/tools';
import { unitLabel } from '../model/measure';

interface OffsetSettings { dist: number; replace: boolean; miter: number; as: MarkupType | '' }
const LS = 'cyantakeoff:offset';
const load = (): OffsetSettings => { try { return { dist: 1, replace: false, miter: 4, as: '', ...JSON.parse(localStorage.getItem(LS) ?? '{}') }; } catch { return { dist: 1, replace: false, miter: 4, as: '' }; } };
export const useOffset = create<OffsetSettings>(() => (typeof localStorage === 'undefined' ? { dist: 1, replace: false, miter: 4, as: '' } : load()));
const set = (p: Partial<OffsetSettings>) => { useOffset.setState(p); try { localStorage.setItem(LS, JSON.stringify(useOffset.getState())); } catch { /* ignore */ } };

/** The offset distance in page points: in the page's scale units when it has a scale, else inches. */
export const offsetPt = (dist: number, scale: Scale | null | undefined) => (scale ? dist / scale.factor : dist * 72);

export function startOffset() {
  const s = useApp.getState();
  const d = s.docs.find((x) => x.id === s.activeId);
  const m = d?.markups.find((x) => x.id === d.selection[0]);
  if (!d || d.selection.length !== 1 || !m) { s.setStatus('Offset: select one line, polyline, polygon, rectangle or measurement.'); return; }
  if (!canOffset(m)) { s.setStatus(`Offset does not work on ${toolById(m.type).name} markups (or curved ones).`); return; }
  useApp.setState({ offsetOp: { id: m.id }, status: 'Offset: click on the side where the copy goes (Esc cancels).' });
}

export function OffsetBar({ scale }: { scale: Scale | null }) {
  const o = useOffset();
  return (
    <div className="fill-bar" role="toolbar" aria-label="Offset">
      <strong>Offset</strong>
      <label className="inline">Distance <input type="number" aria-label="Offset distance" min={0} step="any" value={o.dist} onChange={(e) => set({ dist: Math.max(0, Number(e.target.value) || 0) })} style={{ width: 70 }} /> {scale ? unitLabel(scale.unit) : 'in'}</label>
      <label className="inline"><input type="checkbox" checked={o.replace} onChange={(e) => set({ replace: e.target.checked })} /> Replace Markup</label>
      <label className="inline">Angle Miter Limit <input type="number" aria-label="Miter limit" min={1} max={100} value={o.miter} onChange={(e) => set({ miter: Math.max(1, Number(e.target.value) || 4) })} style={{ width: 50 }} /></label>
      <label className="inline">Offset as <select aria-label="Offset as" value={o.as} onChange={(e) => set({ as: e.target.value as MarkupType | '' })}>
        <option value="">Same type</option>{OFFSET_AS.map((t) => <option key={t} value={t}>{toolById(t).name}</option>)}
      </select></label>
      <button onClick={() => useApp.setState({ offsetOp: null })}>Done</button>
    </div>
  );
}
