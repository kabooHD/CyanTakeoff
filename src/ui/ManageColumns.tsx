// Revu's Manage Columns > Custom Columns: add, edit and delete custom
// columns (Text, Number, Checkmark, Choice, Date, Formula).
import { useState } from 'react';
import { useApp, useActiveDoc } from '../model/store';
import { checkFormula } from '../model/formula';
import type { CustomColumn } from '../model/types';

const TYPES: { id: CustomColumn['type']; label: string }[] = [
  { id: 'text', label: 'Text' }, { id: 'number', label: 'Number' }, { id: 'checkmark', label: 'Checkmark' },
  { id: 'choice', label: 'Choice' }, { id: 'date', label: 'Date' }, { id: 'formula', label: 'Formula' },
];
const BUILT_IN_VARS = ['Measurement', 'Length', 'Area', 'Volume', 'Count', 'Angle', 'Depth'];

export function ManageColumns({ onClose }: { onClose: () => void }) {
  const s = useApp();
  const doc = useActiveDoc();
  const [editing, setEditing] = useState<CustomColumn | null>(null);
  if (!doc) return null;
  const cols = doc.columns;
  const save = (c: CustomColumn) => {
    s.setColumns(cols.some((x) => x.id === c.id) ? cols.map((x) => (x.id === c.id ? c : x)) : [...cols, c]);
    setEditing(null);
  };
  const move = (i: number, d: number) => {
    const next = [...cols];
    const [c] = next.splice(i, 1);
    next.splice(Math.max(0, Math.min(next.length, i + d)), 0, c);
    s.setColumns(next);
  };
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide" role="dialog" aria-label="Manage Columns" onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') (editing ? setEditing(null) : onClose()); }}>
        <div className="modal-title">Manage Columns: Custom Columns</div>
        {editing ? (
          <ColumnForm col={editing} names={[...BUILT_IN_VARS, ...cols.filter((c) => c.id !== editing.id && c.type !== 'text' && c.type !== 'date').map((c) => c.name)]}
            onSave={save} onCancel={() => setEditing(null)} />
        ) : (
          <>
            <table className="cc-list">
              <thead><tr><th>Name</th><th>Type</th><th /></tr></thead>
              <tbody>
                {cols.map((c, i) => (
                  <tr key={c.id}>
                    <td>{c.name}</td><td>{TYPES.find((t) => t.id === c.type)?.label}{c.type === 'formula' ? `: ${c.expression}` : ''}</td>
                    <td className="cc-actions">
                      <button onClick={() => move(i, -1)} disabled={!i} title="Up">▲</button>
                      <button onClick={() => move(i, 1)} disabled={i === cols.length - 1} title="Down">▼</button>
                      <button onClick={() => setEditing(c)}>Edit</button>
                      <button onClick={() => s.setColumns(cols.filter((x) => x.id !== c.id))}>Delete</button>
                    </td>
                  </tr>
                ))}
                {!cols.length && <tr><td colSpan={3} className="muted">No custom columns yet.</td></tr>}
              </tbody>
            </table>
            <div className="modal-actions">
              <button onClick={() => setEditing({ id: crypto.randomUUID(), name: '', type: 'text' })}>Add…</button>
              <span className="spacer" />
              <button className="primary" onClick={onClose}>Close</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ColumnForm({ col, names, onSave, onCancel }: { col: CustomColumn; names: string[]; onSave: (c: CustomColumn) => void; onCancel: () => void }) {
  const [c, setC] = useState<CustomColumn>(col);
  const set = (p: Partial<CustomColumn>) => setC({ ...c, ...p });
  const formulaError = c.type === 'formula' ? checkFormula(c.expression ?? '', names) : null;
  const ok = c.name.trim() && !formulaError && !(c.type === 'choice' && !(c.options ?? []).length);
  const numeric = c.type === 'number' || c.type === 'formula';
  return (
    <div className="scale-dialog">
      <div className="form-row"><span>Name</span><input autoFocus aria-label="Column name" value={c.name} onChange={(e) => set({ name: e.target.value })} style={{ width: 220 }} /></div>
      <div className="form-row"><span>Type</span>
        <select aria-label="Column type" value={c.type} onChange={(e) => set({ type: e.target.value as CustomColumn['type'], defaultValue: undefined })}>
          {TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
      </div>
      {c.type === 'formula' && (
        <div className="form-row"><span>Expression</span>
          <input aria-label="Expression" value={c.expression ?? ''} onChange={(e) => set({ expression: e.target.value })} placeholder="Area * [Unit Cost]" style={{ width: 260 }} />
        </div>
      )}
      {c.type === 'formula' && <p className="muted small">Columns: {names.join(', ')}. Use [brackets] for names with spaces; + - * / ^ ( ), min, max, round, abs, sqrt.{formulaError && c.expression ? ` ${formulaError}.` : ''}</p>}
      {c.type === 'choice' && (
        <div className="form-row"><span>Options</span>
          <textarea aria-label="Options" rows={4} value={(c.options ?? []).join('\n')} onChange={(e) => set({ options: e.target.value.split('\n').map((x) => x.trim()).filter(Boolean) })}
            placeholder="One per line" style={{ width: 220 }} />
        </div>
      )}
      {numeric && (
        <div className="form-row"><span>Format</span>
          <select aria-label="Format" value={c.format ?? 'normal'} onChange={(e) => set({ format: e.target.value as CustomColumn['format'] })}>
            <option value="normal">Normal</option><option value="currency">Currency</option><option value="percent">Percentage</option>
          </select>
          <select aria-label="Decimal places" value={c.decimals ?? 2} onChange={(e) => set({ decimals: Number(e.target.value) })}>
            {[0, 1, 2, 3, 4, 5, 6].map((d) => <option key={d} value={d}>{d} decimals</option>)}
          </select>
          {c.format === 'currency' && <input aria-label="Currency symbol" value={c.currency ?? '$'} onChange={(e) => set({ currency: e.target.value })} style={{ width: 40 }} />}
          <label><input type="checkbox" checked={c.includeInTotals !== false} onChange={(e) => set({ includeInTotals: e.target.checked })} /> Include in totals</label>
        </div>
      )}
      {c.type !== 'formula' && (
        <div className="form-row"><span>Default</span>
          {c.type === 'checkmark' ? <label><input type="checkbox" checked={!!c.defaultValue} onChange={(e) => set({ defaultValue: e.target.checked || undefined })} /> Checked</label>
            : c.type === 'date' ? (
              <select aria-label="Default" value={c.defaultValue === 'today' ? 'today' : ''} onChange={(e) => set({ defaultValue: e.target.value || undefined })}>
                <option value="">None</option><option value="today">Current date</option>
              </select>
            ) : c.type === 'choice' ? (
              <select aria-label="Default" value={String(c.defaultValue ?? '')} onChange={(e) => set({ defaultValue: e.target.value || undefined })}>
                <option value="" />{(c.options ?? []).map((o) => <option key={o}>{o}</option>)}
              </select>
            ) : <input aria-label="Default" type={c.type === 'number' ? 'number' : 'text'} value={String(c.defaultValue ?? '')}
              onChange={(e) => set({ defaultValue: e.target.value === '' ? undefined : c.type === 'number' ? Number(e.target.value) : e.target.value })} />}
        </div>
      )}
      <div className="modal-actions">
        <span className="spacer" />
        <button className="primary" disabled={!ok} onClick={() => onSave({ ...c, name: c.name.trim() })}>OK</button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
