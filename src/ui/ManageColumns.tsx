// Revu's Manage Columns > Custom Columns: add, edit and delete custom
// columns (Text, Number, Checkmark, Choice, Date, Formula).
import { useState } from 'react';
import { useApp, useActiveDoc } from '../model/store';
import { checkFormula } from '../model/formula';
import type { CustomColumn } from '../model/types';
import { parseChoiceCsv, profileColumns, saveProfileColumns } from '../model/columns';
import { pickFile } from './toolActions';

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
              <button disabled={!cols.length} title="These columns start every new document that has none of its own (Revu: Save to Profile)" onClick={() => { saveProfileColumns(cols); s.setStatus(`${cols.length} custom column${cols.length === 1 ? '' : 's'} saved to the profile`); }}>Save to Profile</button>
              <button disabled={!profileColumns().length} title="Future documents start without custom columns" onClick={() => { saveProfileColumns(null); s.setStatus('Custom columns removed from the profile'); }}>Delete from Profile</button>
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
      {c.type === 'choice' && <ChoiceItems c={c} set={set} />}
      {c.type === 'number' && (
        <div className="form-row"><span>Range</span>
          <input aria-label="Minimum" type="number" placeholder="Min" value={c.min ?? ''} onChange={(e) => set({ min: e.target.value === '' ? undefined : Number(e.target.value) })} style={{ width: 80 }} />
          <input aria-label="Maximum" type="number" placeholder="Max" value={c.max ?? ''} onChange={(e) => set({ max: e.target.value === '' ? undefined : Number(e.target.value) })} style={{ width: 80 }} />
        </div>
      )}
      {c.type === 'text' && (
        <div className="form-row"><span /><label><input type="checkbox" checked={!!c.multiline} onChange={(e) => set({ multiline: e.target.checked || undefined })} /> Multiline</label></div>
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

/** Choice items with Revu's Subject link and numeric value, CSV import and Allow Custom Text. */
function ChoiceItems({ c, set }: { c: CustomColumn; set: (p: Partial<CustomColumn>) => void }) {
  const [item, setItem] = useState('');
  const items = c.options ?? [];
  const meta = c.choiceMeta ?? {};
  const setMeta = (name: string, p: { subject?: string; value?: number }) => {
    const next = { ...meta, [name]: { ...(meta[name] ?? {}), ...p } };
    if (next[name].subject === '' ) delete next[name].subject;
    if (next[name].value === undefined) delete next[name].value;
    if (!Object.keys(next[name]).length) delete next[name];
    set({ choiceMeta: next });
  };
  const add = () => { const n = item.trim(); if (!n || items.includes(n)) return; set({ options: [...items, n] }); setItem(''); };
  const importCsv = async () => {
    const f = await pickFile('.csv,text/csv');
    if (!f) return;
    const r = parseChoiceCsv(await f.text());
    set({ options: [...items, ...r.options.filter((o) => !items.includes(o))], choiceMeta: { ...meta, ...r.choiceMeta } });
  };
  return (
    <>
      <div className="form-row" style={{ alignItems: 'flex-start' }}><span>Items</span>
        <table className="cc-list choice-items">
          <thead><tr><th>Item</th><th>Subject</th><th>Numeric value</th><th /></tr></thead>
          <tbody>
            {items.map((o, i) => (
              <tr key={o}>
                <td>{o}</td>
                <td><input aria-label={`Subject of ${o}`} value={meta[o]?.subject ?? ''} placeholder="(any)" onChange={(e) => setMeta(o, { subject: e.target.value })} style={{ width: 110 }} /></td>
                <td><input aria-label={`Value of ${o}`} type="number" step="any" value={meta[o]?.value ?? ''} onChange={(e) => setMeta(o, { value: e.target.value === '' ? undefined : Number(e.target.value) })} style={{ width: 80 }} /></td>
                <td className="cc-actions">
                  <button title="Up" disabled={!i} onClick={() => { const n = [...items]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; set({ options: n }); }}>▲</button>
                  <button title="Down" disabled={i === items.length - 1} onClick={() => { const n = [...items]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; set({ options: n }); }}>▼</button>
                  <button aria-label={`Remove ${o}`} onClick={() => { const next = { ...meta }; delete next[o]; set({ options: items.filter((x) => x !== o), choiceMeta: next, defaultValue: c.defaultValue === o ? undefined : c.defaultValue }); }}>×</button>
                </td>
              </tr>
            ))}
            <tr>
              <td colSpan={4}>
                <input aria-label="New item" placeholder="New item" value={item} onChange={(e) => setItem(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} style={{ width: 160 }} />
                <button onClick={add} disabled={!item.trim()}>Add</button>
                <button onClick={importCsv} title="CSV: item, subject, numeric value">Import…</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="form-row"><span /><label><input type="checkbox" checked={!!c.allowCustomText} onChange={(e) => set({ allowCustomText: e.target.checked || undefined })} /> Allow custom text</label></div>
      <p className="muted small">Subject links an item to markups with that Subject (filters); a numeric value lets formulas use the choice.</p>
    </>
  );
}
