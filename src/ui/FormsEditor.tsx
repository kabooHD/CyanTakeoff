// Revu Forms: create fields by dragging their box (Tools menu; X adds a
// signature field), then name them; the Forms Editor renames, re-options
// and deletes fields. Fields are written into the PDF's AcroForm.
import { useState } from 'react';
import { create } from 'zustand';
import { useApp, type DocState } from '../model/store';
import type { Pt, ToolId } from '../model/types';
import { awaitingSignatureBox, placeSignatureBox } from './DigitalSignature';
import { createField, deleteField, renameField, setFieldOptions, uniqueFieldName, type FieldSpec, type NewFieldType } from '../pdf/forms';

const KIND: Partial<Record<ToolId, NewFieldType>> = {
  'form-text': 'text', 'form-checkbox': 'checkbox', 'form-radio': 'radio',
  'form-dropdown': 'dropdown', 'form-list': 'list', 'form-signature': 'signature', 'form-button': 'button',
};
const BASE: Record<NewFieldType, string> = { text: 'Text', checkbox: 'Check Box', radio: 'Radio', dropdown: 'Dropdown', list: 'List Box', signature: 'Signature', button: 'Button' };
const TITLE: Record<NewFieldType, string> = { text: 'Text Field', checkbox: 'Check Box', radio: 'Radio Button', dropdown: 'Dropdown', list: 'List Box', signature: 'Signature Field', button: 'Button' };

export const useFormsDialog = create<{ draft: Omit<FieldSpec, 'name'> | null; editor: boolean }>(() => ({ draft: null, editor: false }));

/** A field box was dragged on page `page` (page space): ask for its name. */
export function newFormField(tool: ToolId, doc: DocState, page: number, a: Pt, b: Pt) {
  const type = KIND[tool];
  if (!type) return;
  if (type === 'signature' && awaitingSignatureBox()) { placeSignatureBox(doc, page, a, b); return; }
  const vp = doc.loaded.pages[page].viewport;
  const [x0, y0] = vp.convertToPdfPoint(a.x, a.y), [x1, y1] = vp.convertToPdfPoint(b.x, b.y);
  if (Math.abs(x1 - x0) < 4 || Math.abs(y1 - y0) < 4) return;
  useFormsDialog.setState({ draft: { type, page, rect: [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)] } });
  const app = useApp.getState();
  if (!app.toolLocked) app.setTool('select');
}

export function FormsDialogs() {
  const f = useFormsDialog();
  const doc = useApp((s) => s.docs.find((d) => d.id === s.activeId));
  if (!doc) return null;
  if (f.draft) return <NewFieldForm doc={doc} draft={f.draft} />;
  if (f.editor) return <EditorForm doc={doc} />;
  return null;
}

function Frame({ title, children, wide }: { title: string; children: React.ReactNode; wide?: boolean }) {
  const close = () => useFormsDialog.setState({ draft: null, editor: false });
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-label={title} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') close(); }}>
        <div className="modal-title">{title}</div>
        {children}
      </div>
    </div>
  );
}

const lines = (t: string) => t.split('\n').map((x) => x.trim()).filter(Boolean);

function NewFieldForm({ doc, draft }: { doc: DocState; draft: Omit<FieldSpec, 'name'> }) {
  const s = useApp();
  const names = doc.loaded.fields.map((f) => f.name);
  const groups = doc.loaded.fields.filter((f) => f.type === 'radio');
  const [name, setName] = useState(() => (draft.type === 'radio' && groups.length ? groups[groups.length - 1].name : uniqueFieldName(names, BASE[draft.type])));
  const group = groups.find((g) => g.name === name);
  const [option, setOption] = useState(() => uniqueFieldName(group?.options ?? [], 'Choice'));
  const [options, setOptions] = useState('');
  const [multiline, setMultiline] = useState(false);
  const [caption, setCaption] = useState('Button');
  const close = () => useFormsDialog.setState({ draft: null });
  const clash = names.includes(name.trim()) && !(draft.type === 'radio' && group);
  const ok = async () => {
    close();
    const spec: FieldSpec = { ...draft, name: name.trim(), option: option.trim(), options: lines(options), multiline, caption: caption.trim() || name.trim() };
    await s.transformDoc((lib) => createField(lib, spec), `${TITLE[draft.type]} "${spec.name}" added`);
  };
  return (
    <Frame title={`New ${TITLE[draft.type]}`}>
      <div className="scale-dialog">
        <div className="form-row"><span>{draft.type === 'radio' ? 'Group' : 'Name'}</span>
          <input aria-label="Field name" value={name} onChange={(e) => setName(e.target.value)} list="radio-groups" autoFocus />
          {draft.type === 'radio' && <datalist id="radio-groups">{groups.map((g) => <option key={g.name} value={g.name} />)}</datalist>}
        </div>
        {draft.type === 'radio' && (
          <div className="form-row"><span>Value</span><input aria-label="Button value" value={option} onChange={(e) => setOption(e.target.value)} /></div>
        )}
        {draft.type === 'button' && (
          <div className="form-row"><span>Caption</span><input aria-label="Button caption" value={caption} onChange={(e) => setCaption(e.target.value)} /></div>
        )}
        {draft.type === 'text' && (
          <div className="form-row"><label><input type="checkbox" checked={multiline} onChange={(e) => setMultiline(e.target.checked)} /> Multi-line</label></div>
        )}
        {(draft.type === 'dropdown' || draft.type === 'list') && (
          <div className="form-row"><span>Items</span>
            <textarea aria-label="Field items" rows={4} placeholder="One item per line" value={options} onChange={(e) => setOptions(e.target.value)} />
          </div>
        )}
        {draft.type === 'radio' && <p className="muted small">Radio buttons with the same group name work together: choosing one clears the others.</p>}
        {clash && <p className="error small">A field named "{name}" already exists.</p>}
        <div className="modal-actions">
          <span className="spacer" />
          <button className="primary" disabled={!name.trim() || clash} onClick={ok}>OK</button>
          <button onClick={close}>Cancel</button>
        </div>
      </div>
    </Frame>
  );
}

function EditorForm({ doc }: { doc: DocState }) {
  const s = useApp();
  const fields = doc.loaded.fields;
  const [rows, setRows] = useState(() => fields.map((f) => ({ name: f.name, options: (f.options ?? []).join(', '), del: false })));
  const close = () => useFormsDialog.setState({ editor: false });
  const set = (i: number, p: Partial<typeof rows[number]>) => setRows(rows.map((r, k) => (k === i ? { ...r, ...p } : r)));
  const finalNames = rows.filter((r) => !r.del).map((r) => r.name.trim());
  const dupes = finalNames.length !== new Set(finalNames).size || finalNames.some((n) => !n);
  const apply = async () => {
    close();
    await s.transformDoc((lib) => {
      fields.forEach((f, i) => {
        const r = rows[i];
        if (r.del) { deleteField(lib, f.name); return; }
        const opts = r.options.split(',').map((x) => x.trim()).filter(Boolean);
        if ((f.type === 'dropdown' || f.type === 'list') && opts.join('\n') !== (f.options ?? []).join('\n')) setFieldOptions(lib, f.name, opts);
      });
      // Rename through temporary names so swapped names don't collide.
      const renames = fields.map((f, i) => ({ from: f.name, to: rows[i].name.trim(), del: rows[i].del })).filter((r) => !r.del && r.to !== r.from);
      renames.forEach((r, i) => renameField(lib, r.from, `__ct_rename_${i}`));
      renames.forEach((r, i) => renameField(lib, `__ct_rename_${i}`, r.to));
    }, 'Form fields updated');
  };
  return (
    <Frame title="Forms Editor" wide>
      <div className="scale-dialog">
        <div className="keys-list">
          <table className="cc-list">
            <thead><tr><th>Name</th><th>Type</th><th>Page</th><th>Items</th><th>Delete</th></tr></thead>
            <tbody>
              {fields.map((f, i) => (
                <tr key={f.name}>
                  <td><input aria-label={`Name of ${f.name}`} value={rows[i].name} onChange={(e) => set(i, { name: e.target.value })} /></td>
                  <td>{f.type}</td>
                  <td>{[...new Set(f.widgets.map((w) => w.page + 1))].join(', ')}</td>
                  <td>{f.type === 'dropdown' || f.type === 'list'
                    ? <input aria-label={`Items of ${f.name}`} value={rows[i].options} onChange={(e) => set(i, { options: e.target.value })} />
                    : f.type === 'radio' ? <span className="muted">{(f.options ?? []).join(', ')}</span> : null}</td>
                  <td><input type="checkbox" aria-label={`Delete ${f.name}`} checked={rows[i].del} onChange={(e) => set(i, { del: e.target.checked })} /></td>
                </tr>
              ))}
              {!fields.length && <tr><td colSpan={5} className="muted">No form fields. Use Tools &gt; Text Field (and the other field tools) to add some.</td></tr>}
            </tbody>
          </table>
        </div>
        {dupes && <p className="error small">Field names must be filled in and different.</p>}
        <div className="modal-actions">
          <span className="spacer" />
          <button className="primary" disabled={dupes || !fields.length} onClick={apply}>Apply</button>
          <button onClick={close}>Cancel</button>
        </div>
      </div>
    </Frame>
  );
}
