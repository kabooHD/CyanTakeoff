// Status picker (Markups List column, Properties, right-click Set Status)
// and the Manage Status dialog (custom models and states with colour and
// text, visibility, default model and state).
import { useState } from 'react';
import { create } from 'zustand';
import { activeDoc, useApp } from '../model/store';
import type { Markup } from '../model/types';
import { REVIEW, saveStatusConfig, statusChanges, statusLabel, useStatusModels, type StatusConfig, type StatusModel } from '../model/statusModels';
import type { MenuItem } from './ContextMenu';

export const useManageStatus = create<{ open: boolean }>(() => ({ open: false }));

export function setStatus(ids: string[], model: string, state: string) {
  const s = useApp.getState(), d = activeDoc();
  if (!d) return;
  const ch = statusChanges(d.markups, ids, model, state, s.author);
  s.updateMarkups([...ch.keys()], (m) => ch.get(m.id) ?? {});
}

/** A <select> of every visible model's states for markup `m` (applies to `ids`). */
export function StatusSelect({ m, ids }: { m: Markup; ids: string[] }) {
  const models = useStatusModels((x) => x.models);
  const cur = `${m.statusModel ?? 'Review'}|${m.status}`;
  const known = models.some((x) => x.name === (m.statusModel ?? 'Review') && x.states.some((st) => st.name === m.status));
  return (
    <select aria-label="Status" value={cur} title={m.statusBy ? `${statusLabel(m)}, set by ${m.statusBy}${m.statusDate ? ` on ${new Date(m.statusDate).toLocaleString()}` : ''}` : undefined}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => { if (e.target.value === '__manage') { useManageStatus.setState({ open: true }); return; } const [mo, st] = e.target.value.split('|'); setStatus(ids, mo, st); }}>
      {!known && <option value={cur}>{statusLabel(m)}</option>}
      {models.filter((x) => !x.hidden || x.name === (m.statusModel ?? 'Review')).map((x) => (
        <optgroup key={x.name} label={x.name}>{x.states.map((st) => <option key={st.name} value={`${x.name}|${st.name}`}>{x.name === 'Review' ? st.name : `${x.name}: ${st.name}`}</option>)}</optgroup>
      ))}
      <option value="__manage">Manage Status…</option>
    </select>
  );
}

/** Right-click menu entries: Set Status › Model › State. */
export function statusMenuItems(hit: Markup, ids: string[]): MenuItem[] {
  return [
    ...useStatusModels.getState().models.filter((x) => !x.hidden).flatMap((x) => x.states.map((st) => ({
      label: `Set Status › ${x.name} › ${st.name}`, checked: (hit.statusModel ?? 'Review') === x.name && hit.status === st.name,
      action: () => setStatus(ids, x.name, st.name),
    }))),
    { label: 'Manage Status…', action: () => useManageStatus.setState({ open: true }) },
  ];
}

export function ManageStatusDialog() {
  const open = useManageStatus((x) => x.open);
  return open ? <ManageForm /> : null;
}

function ManageForm() {
  const [c, setC] = useState<StatusConfig>(() => structuredClone(useStatusModels.getState()));
  const [sel, setSel] = useState(c.models[0]?.name ?? 'Review');
  const [stSel, setStSel] = useState<number | null>(null);
  const close = () => useManageStatus.setState({ open: false });
  const model = c.models.find((x) => x.name === sel);
  const setModel = (m: StatusModel) => setC({ ...c, models: c.models.map((x) => (x.name === sel ? m : x)) });
  const addModel = () => {
    const name = prompt('Model name', 'Custom')?.trim();
    if (!name || c.models.some((x) => x.name === name)) return;
    setC({ ...c, models: [...c.models, { name, states: [{ name: 'None' }] }] });
    setSel(name);
  };
  const st = model && stSel !== null ? model.states[stSel] : null;
  const editState = (p: Partial<{ name: string; color?: string; text?: string }>) => {
    if (!model || stSel === null) return;
    setModel({ ...model, states: model.states.map((x, i) => (i === stSel ? { ...x, ...p } : x)) });
  };
  const custom = c.models.filter((x) => !x.builtIn);
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal" role="dialog" aria-label="Manage Status" onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') close(); }}>
        <div className="modal-title">Manage Status</div>
        <div className="scale-dialog status-manage">
          <div className="status-cols">
            <div>
              <div className="links-head">Models</div>
              <div className="status-list">
                {c.models.map((x) => (
                  <div key={x.name} className={`space-row ${x.name === sel ? 'selected' : ''}`} onClick={() => { setSel(x.name); setStSel(null); }}>
                    <input type="checkbox" title="Show in the Status menus" checked={!x.hidden} onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setC({ ...c, models: c.models.map((y) => (y.name === x.name ? { ...y, hidden: !e.target.checked || undefined } : y)) })} />
                    <span>{x.name}</span>
                  </div>
                ))}
              </div>
              <div className="prop-actions"><button onClick={addModel}>Add</button>
                <button disabled={!model || model.builtIn} onClick={() => { setC({ ...c, models: c.models.filter((x) => x.name !== sel) }); setSel('Review'); }}>Delete</button></div>
            </div>
            <div>
              <div className="links-head">States</div>
              <div className="status-list">
                {model?.states.map((x, i) => (
                  <div key={i} className={`space-row ${i === stSel ? 'selected' : ''}`} onClick={() => setStSel(i)}>
                    <span className="swatch" style={{ background: x.color ?? 'transparent' }} /><span>{x.name}</span>{x.text && <span className="muted">“{x.text}”</span>}
                  </div>
                ))}
              </div>
              <div className="prop-actions">
                <button disabled={!model || model.builtIn} onClick={() => { if (!model) return; setModel({ ...model, states: [...model.states, { name: `State ${model.states.length + 1}` }] }); setStSel(model.states.length); }}>Add</button>
                <button disabled={!model || model.builtIn || stSel === null} onClick={() => { if (!model) return; setModel({ ...model, states: model.states.filter((_, i) => i !== stSel) }); setStSel(null); }}>Delete</button>
              </div>
            </div>
          </div>
          {st && model && (
            <div className="status-props">
              <div className="form-row"><span>Name</span><input aria-label="State name" value={st.name} disabled={model.builtIn} onChange={(e) => editState({ name: e.target.value })} /></div>
              <div className="form-row"><label><input type="checkbox" checked={st.color !== undefined} onChange={(e) => editState({ color: e.target.checked ? '#00aa00' : undefined })} /> Color</label>
                {st.color !== undefined && <input type="color" aria-label="State color" value={st.color} onChange={(e) => editState({ color: e.target.value })} />}</div>
              <div className="form-row"><label><input type="checkbox" checked={st.text !== undefined} onChange={(e) => editState({ text: e.target.checked ? st.name : undefined })} /> Text</label>
                {st.text !== undefined && <input aria-label="State text" value={st.text} onChange={(e) => editState({ text: e.target.value })} />}</div>
              <p className="muted small">Colour recolours a markup set to this state; Text goes into a text box grouped with it.</p>
            </div>
          )}
          <div className="form-row"><span>Default for new markups</span>
            <select aria-label="Default status" value={c.defaultModel ? `${c.defaultModel}|${c.defaultState}` : ''} onChange={(e) => { const [m, s] = e.target.value.split('|'); setC({ ...c, defaultModel: m || undefined, defaultState: s || undefined }); }}>
              <option value="">None (Review)</option>
              {custom.flatMap((x) => x.states.map((s) => <option key={`${x.name}|${s.name}`} value={`${x.name}|${s.name}`}>{x.name}: {s.name}</option>))}
            </select>
          </div>
          <div className="modal-actions"><span className="spacer" /><button className="primary" onClick={() => { saveStatusConfig({ ...c, models: [REVIEW, ...custom] }); close(); }}>OK</button><button onClick={close}>Cancel</button></div>
        </div>
      </div>
    </div>
  );
}
