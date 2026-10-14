// Properties panel with nothing selected (Revu): File Properties (title,
// author, subject, keywords, editable), Custom Properties (add/delete
// rows) and File Attachments (Open, Add New, Delete) of the active PDF.
import { useEffect, useState } from 'react';
import { useApp, type DocState } from '../model/store';
import { attachFile, removeEmbeddedFile, writeCustomProps } from '../pdf/docInfo';
import { pickFile } from './toolActions';

type Info = Record<string, unknown> & { Custom?: Record<string, unknown> };
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const STD = ['Title', 'Author', 'Subject', 'Keywords'] as const;

export function DocumentProps({ doc }: { doc: DocState }) {
  const s = useApp();
  const [info, setInfo] = useState<Info | null>(null);
  const [std, setStd] = useState<Record<string, string>>({});
  const [custom, setCustom] = useState<[string, string][]>(() => Object.entries(doc.loaded.customProps));
  const [newKey, setNewKey] = useState('');
  const [newVal, setNewVal] = useState('');
  const attachments = doc.loaded.embeddedFiles;
  useEffect(() => {
    let alive = true;
    setCustom(Object.entries(doc.loaded.customProps));
    doc.loaded.pdf.getMetadata().then((m) => {
      if (!alive) return;
      const i = (m.info ?? {}) as Info;
      setInfo(i);
      setStd(Object.fromEntries(STD.map((k) => [k, str(i[k])])));
    }).catch(() => alive && setInfo({}));
    return () => { alive = false; };
  }, [doc.loaded]);
  if (!info) return <p className="muted pad">Reading the document's properties…</p>;
  const commitStd = () => {
    if (STD.every((k) => std[k] === str(info[k]))) return;
    s.transformDoc((lib) => {
      lib.setTitle(std.Title); lib.setAuthor(std.Author); lib.setSubject(std.Subject); lib.setKeywords(std.Keywords ? [std.Keywords] : []);
      lib.setModificationDate(new Date());
    }, 'Document properties changed');
  };
  const saveCustom = (rows: [string, string][]) => {
    setCustom(rows);
    s.transformDoc((lib) => writeCustomProps(lib, Object.fromEntries(rows.filter(([k]) => k.trim()))), 'Custom properties changed');
  };
  const addCustom = () => {
    const k = newKey.trim();
    if (!k || custom.some(([x]) => x === k)) return;
    saveCustom([...custom, [k, newVal]]);
    setNewKey(''); setNewVal('');
  };
  const open = async (name: string) => {
    // The bytes come from pdf.js (a Map in newer builds, an object in older ones).
    const raw = await doc.loaded.pdf.getAttachments().catch(() => null) as unknown as Map<string, { filename: string; content: Uint8Array }> | Record<string, { filename: string; content: Uint8Array }> | null;
    const list = !raw ? [] : raw instanceof Map ? [...raw.values()] : Object.values(raw);
    const a = list.find((x) => x.filename === name) ?? list[0];
    if (!a) { s.setStatus(`${name} could not be read from the file.`); return; }
    const href = URL.createObjectURL(new Blob([a.content as unknown as BlobPart]));
    Object.assign(document.createElement('a'), { href, download: name }).click();
    setTimeout(() => URL.revokeObjectURL(href), 10_000);
  };
  const addNew = async () => {
    const f = await pickFile('*/*');
    if (!f) return;
    const bytes = new Uint8Array(await f.arrayBuffer());
    await s.transformDoc((lib) => attachFile(lib, f.name, bytes, f.type || 'application/octet-stream'), `Attached ${f.name}`);
  };
  const del = (name: string) => s.transformDoc((lib) => { removeEmbeddedFile(lib, name); }, `Removed attachment ${name}`);
  return (
    <div className="props doc-props">
      <div className="prop-title">{doc.name}</div>
      <div className="prop-section">File Properties</div>
      {STD.map((k) => (
        <label key={k} className="prop-row"><span>{k}</span>
          <input aria-label={`Document ${k.toLowerCase()}`} value={std[k] ?? ''} onChange={(e) => setStd({ ...std, [k]: e.target.value })} onBlur={commitStd}
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
        </label>
      ))}
      <div className="prop-row"><span>Pages</span><span>{doc.loaded.pages.length}</span></div>
      <div className="prop-row"><span>Producer</span><span className="muted small">{str(info.Producer) || '—'}</span></div>
      <div className="prop-section">Custom Properties</div>
      {custom.map(([k, v], i) => (
        <label key={k} className="prop-row"><span title={k}>{k}</span>
          <input aria-label={`Custom property ${k}`} value={v} onChange={(e) => setCustom(custom.map((r, j) => (j === i ? [k, e.target.value] : r)))} onBlur={() => saveCustom(custom)}
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
          <button className="tool-remove" title="Delete this property" aria-label={`Delete property ${k}`} onClick={() => saveCustom(custom.filter((_, j) => j !== i))}>×</button>
        </label>
      ))}
      <div className="prop-row custom-add">
        <input aria-label="New property name" placeholder="Name" value={newKey} onChange={(e) => setNewKey(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
        <input aria-label="New property value" placeholder="Value" value={newVal} onChange={(e) => setNewVal(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') addCustom(); }} />
        <button disabled={!newKey.trim()} onClick={addCustom}>Add</button>
      </div>
      <div className="prop-section">File Attachments</div>
      {attachments.map((a) => (
        <div key={a.name} className="prop-row attachment-row">
          <span title={a.name}>{a.name}</span>
          <span className="muted small">{a.size > 1024 ? `${Math.round(a.size / 1024)} KB` : `${a.size} B`}</span>
          <button onClick={() => open(a.name)} title="Save the file">Open</button>
          <button className="tool-remove" title="Delete this attachment" aria-label={`Delete attachment ${a.name}`} onClick={() => del(a.name)}>×</button>
        </div>
      ))}
      {!attachments.length && <p className="muted small pad">No files attached to the document.</p>}
      <div className="prop-actions"><button onClick={addNew}>Add New…</button></div>
    </div>
  );
}
