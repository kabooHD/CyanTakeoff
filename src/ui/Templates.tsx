// File > New PDF from Template: start a document from a saved template;
// manage the templates (add a PDF file or the current document, rename,
// delete). Templates live in the browser.
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { PDFDocument } from 'pdf-lib';
import { serialize, useApp } from '../model/store';
import { deleteTemplate, loadTemplates, renameTemplate, saveTemplate, useTemplates } from '../model/templates';
import { pickFile } from './toolActions';

export const useTemplateDialog = create<{ open: boolean }>(() => ({ open: false }));

export function TemplateDialog() {
  const open = useTemplateDialog((x) => x.open);
  return open ? <TemplateForm /> : null;
}

function TemplateForm() {
  const { list, loaded } = useTemplates();
  const d = useApp((s) => s.docs.find((x) => x.id === s.activeId));
  const [sel, setSel] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  useEffect(() => { void loadTemplates(); }, []);
  const close = () => useTemplateDialog.setState({ open: false });
  const cur = list.find((t) => t.id === sel) ?? list[0];
  const createFrom = async () => {
    if (!cur) return;
    close();
    const s = useApp.getState();
    await s.openBytes(cur.bytes.slice(), 'Untitled.pdf');
    const nd = s.docs.find((x) => x.id === useApp.getState().activeId);
    if (nd) useApp.setState((st) => ({ docs: st.docs.map((x) => (x.id === nd.id ? { ...x, dirty: true } : x)) }));
    useApp.getState().setStatus(`New PDF from template "${cur.name}"`);
  };
  const addFile = async () => {
    const f = await pickFile('.pdf,application/pdf');
    if (!f) return;
    const bytes = new Uint8Array(await f.arrayBuffer());
    let pages = 0;
    try { pages = (await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })).getPageCount(); } catch { useApp.getState().setStatus('That file could not be read as a PDF.'); return; }
    await saveTemplate(f.name.replace(/\.pdf$/i, ''), bytes, pages);
  };
  const addCurrent = async () => {
    if (!d) return;
    await saveTemplate(d.name.replace(/\.pdf$/i, ''), await serialize(d), d.loaded.pages.length);
  };
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal" role="dialog" aria-label="New PDF from Template" onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') close(); if (e.key === 'Enter' && !renaming && cur) createFrom(); }}>
        <div className="modal-title">New PDF from Template</div>
        <div className="scale-dialog">
          <div className="keys-list" role="listbox" aria-label="Templates" style={{ maxHeight: 260, overflow: 'auto' }}>
            {!loaded && <p className="muted">Loading…</p>}
            {loaded && !list.length && <p className="muted">No templates yet. Add a PDF file, or the current document.</p>}
            {list.map((t) => (
              <div key={t.id} role="option" aria-selected={cur?.id === t.id} className={`form-row ${cur?.id === t.id ? 'selected' : ''}`} onClick={() => setSel(t.id)} onDoubleClick={() => setRenaming(t.id)}>
                {renaming === t.id ? (
                  <input autoFocus aria-label="Template name" defaultValue={t.name} onFocus={(e) => e.currentTarget.select()}
                    onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { e.currentTarget.value = t.name; e.currentTarget.blur(); } }}
                    onBlur={(e) => { const v = e.currentTarget.value.trim(); if (v && v !== t.name) void renameTemplate(t.id, v); setRenaming(null); }} />
                ) : <span>{t.name}</span>}
                <span className="muted small">{t.pages} page{t.pages === 1 ? '' : 's'} · {Math.round(t.size / 1024)} KB</span>
              </div>
            ))}
          </div>
          <div className="modal-actions">
            <button onClick={addFile}>Add PDF…</button>
            <button disabled={!d} onClick={addCurrent}>Add Current Document</button>
            <button disabled={!cur} onClick={() => cur && setRenaming(cur.id)}>Rename</button>
            <button disabled={!cur} onClick={() => { if (cur) { void deleteTemplate(cur.id); setSel(null); } }}>Delete</button>
            <span className="spacer" />
            <button className="primary" disabled={!cur} onClick={createFrom}>Create</button>
            <button onClick={close}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}
