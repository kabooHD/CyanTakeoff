// Sets > Tags and Sets > Publish > Export Drawing Log (Revu). The Set is
// the open documents; tag values are kept in the browser (localStorage)
// per file name and page, so they come back when the files are reopened.
import { useEffect, useMemo, useState } from 'react';
import { create } from 'zustand';
import { useApp, type DocState } from '../model/store';
import { DEFAULT_TAGS, LOG_BUILTINS, STANDARD_TAGS, autoTags, drawingLogCsv, drawingLogRows, logTitle, sheetKey, type LogSheet, type TagDef, type TagType, type TagValues } from '../model/tags';
import { textInRegion } from '../model/sheets';
import { pageText } from './toolActions';
import { pickRect } from './pickRect';
import { buildSummaryPdf } from '../pdf/summary';

const LS = 'ct-set-tags';
interface TagState { tags: TagDef[]; values: TagValues }
const load = (): TagState => {
  try {
    const v = JSON.parse(localStorage.getItem(LS) ?? 'null');
    if (v && Array.isArray(v.tags) && v.values) return v;
  } catch { /* fresh */ }
  return { tags: DEFAULT_TAGS, values: {} };
};
export const useTags = create<TagState>(() => (typeof localStorage === 'undefined' ? { tags: DEFAULT_TAGS, values: {} } : load()));
function setTags(p: Partial<TagState>) {
  useTags.setState(p);
  try { localStorage.setItem(LS, JSON.stringify(useTags.getState())); } catch { /* private mode */ }
}

export const useTagDialogs = create<{ open: 'tags' | 'log' | null }>(() => ({ open: null }));

/** Every sheet of the Set (the open documents) with its tag values; Sheet Number defaults to the page label. */
export function setSheets(docs: DocState[], values: TagValues, tags: TagDef[]): LogSheet[] {
  return docs.flatMap((d) => d.loaded.pages.map((p, i) => {
    const v = { ...(values[sheetKey(d.name, i)] ?? {}) };
    if (!v['Sheet Number'] && p.label && p.label !== String(i + 1)) v['Sheet Number'] = p.label;
    return { docName: d.name, page: i, label: p.label, values: autoTags(v, tags) };
  }));
}

export function TagDialogs() {
  const open = useTagDialogs((x) => x.open);
  if (open === 'tags') return <TagsDialog />;
  if (open === 'log') return <DrawingLogDialog />;
  return null;
}

function Frame({ title, children }: { title: string; children: React.ReactNode }) {
  const close = () => useTagDialogs.setState({ open: null });
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal tags-dialog" role="dialog" aria-label={title} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') close(); }}>
        <div className="modal-title">{title}</div>
        {children}
      </div>
    </div>
  );
}

// ---------- Tags dialog ----------

function TagsDialog() {
  const docs = useApp((s) => s.docs);
  const { tags, values } = useTags();
  const sheets = useMemo(() => setSheets(docs, values, tags), [docs, values, tags]);
  const [sel, setSel] = useState<{ key: string; tag: string }[]>([]);
  const [field, setField] = useState('');
  const [newTag, setNewTag] = useState('');
  const [newType, setNewType] = useState<TagType>('text');
  const close = () => useTagDialogs.setState({ open: null });
  const write = (cells: { key: string; tag: string }[], v: string) => {
    const next: TagValues = { ...values };
    for (const c of cells) next[c.key] = { ...(next[c.key] ?? {}), [c.tag]: v };
    setTags({ values: next });
  };
  const selected = (key: string, tag: string) => sel.some((c) => c.key === key && c.tag === tag);
  const clickCell = (e: React.MouseEvent, key: string, tag: string, v: string) => {
    if (e.ctrlKey || e.metaKey) setSel(selected(key, tag) ? sel.filter((c) => !(c.key === key && c.tag === tag)) : [...sel, { key, tag }]);
    else setSel([{ key, tag }]);
    setField(e.ctrlKey || e.metaKey ? '' : v);
  };
  useEffect(() => { if (sel.length > 1) setField(''); }, [sel.length]);
  const addTag = () => {
    const name = newTag.trim();
    if (!name || tags.some((t) => t.name.toLowerCase() === name.toLowerCase())) return;
    const std = STANDARD_TAGS.find((t) => t.name.toLowerCase() === name.toLowerCase());
    setTags({ tags: [...tags, std ?? { name, type: newType }] });
    setNewTag('');
  };
  const removeTag = (name: string) => {
    const next: TagValues = {};
    for (const [k, v] of Object.entries(values)) { const { [name]: _gone, ...rest } = v; next[k] = rest; }
    setTags({ tags: tags.filter((t) => t.name !== name), values: next });
    setSel(sel.filter((c) => c.tag !== name));
  };
  const move = (name: string, dir: -1 | 1) => {
    const i = tags.findIndex((t) => t.name === name), j = i + dir;
    if (i < 0 || j < 0 || j >= tags.length) return;
    const next = [...tags]; [next[i], next[j]] = [next[j], next[i]];
    setTags({ tags: next });
  };
  // AutoMark: read the tag from a region of every sheet (same place on each page).
  const autoMark = (tag: string) => {
    useTagDialogs.setState({ open: null });
    pickRect(`Tags: drag a rectangle around the ${tag} on this sheet; the same spot is read on every sheet.`, async (docId, page, a, b) => {
      const s = useApp.getState();
      const d = s.docs.find((x) => x.id === docId);
      if (!d) return;
      const { width: w, height: h } = d.loaded.pages[page];
      const r = { x0: Math.min(a.x, b.x) / w, y0: Math.min(a.y, b.y) / h, x1: Math.max(a.x, b.x) / w, y1: Math.max(a.y, b.y) / h };
      const next: TagValues = { ...useTags.getState().values };
      let n = 0;
      for (const doc of s.docs) {
        for (const p of doc.loaded.pages) {
          const text = textInRegion(await pageText(await doc.loaded.pdf.getPage(p.index + 1), p.viewport), r, p.width, p.height);
          if (!text) continue;
          const k = sheetKey(doc.name, p.index);
          next[k] = { ...(next[k] ?? {}), [tag]: text };
          n++;
        }
      }
      setTags({ values: next });
      s.setStatus(`Tags: ${tag} read on ${n} sheet${n === 1 ? '' : 's'}`);
      useTagDialogs.setState({ open: 'tags' });
    });
  };
  return (
    <Frame title="Tags">
      <div className="scale-dialog">
        <div className="form-row">
          <span>{sel.length > 1 ? `${sel.length} cells` : sel.length ? `${sel[0].tag}` : 'Select a cell'}</span>
          <input aria-label="Tag value" value={field} disabled={!sel.length} placeholder={sel.length > 1 ? 'Value for every selected cell' : ''}
            onChange={(e) => { setField(e.target.value); write(sel, e.target.value); }} />
          <span className="muted small">Ctrl+click selects several cells.</span>
        </div>
        <div className="tags-table-wrap">
          <table className="tags-table">
            <thead><tr><th>Sheet</th>{tags.map((t) => (
              <th key={t.name}>{t.name}
                <span className="tag-head-actions">
                  <button title="Read this tag from a region of every sheet (AutoMark)" onClick={() => autoMark(t.name)}>⌖</button>
                  <button title="Move left" onClick={() => move(t.name, -1)}>‹</button>
                  <button title="Move right" onClick={() => move(t.name, 1)}>›</button>
                  <button title="Remove this tag from every sheet" aria-label={`Remove tag ${t.name}`} onClick={() => removeTag(t.name)}>×</button>
                </span>
              </th>))}</tr></thead>
            <tbody>
              {sheets.map((sh) => {
                const k = sheetKey(sh.docName, sh.page);
                return (
                  <tr key={k}>
                    <td title={sh.docName}>{sh.label}{docs.length > 1 ? <span className="muted small"> {sh.docName}</span> : null}</td>
                    {tags.map((t) => (
                      <td key={t.name} className={selected(k, t.name) ? 'selected' : ''} aria-label={`${t.name} of ${sh.label}`}
                        onClick={(e) => clickCell(e, k, t.name, sh.values[t.name] ?? '')}>{sh.values[t.name] ?? ''}</td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="form-row"><span>Add tag</span>
          <input aria-label="New tag name" list="std-tags" placeholder="Name (or a standard tag)" value={newTag} onChange={(e) => setNewTag(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addTag()} />
          <datalist id="std-tags">{STANDARD_TAGS.filter((t) => !tags.some((x) => x.name === t.name)).map((t) => <option key={t.name} value={t.name} />)}</datalist>
          <select aria-label="New tag type" value={newType} onChange={(e) => setNewType(e.target.value as TagType)}>
            <option value="text">Text</option><option value="number">Number</option><option value="date">Date</option>
          </select>
          <button onClick={addTag} disabled={!newTag.trim()}>Add</button>
        </div>
        <p className="muted small">Sheet Number defaults to the page label; Discipline and Sheet Type are filled from it when empty. Values are kept in this browser by file name and page.</p>
        <div className="modal-actions"><span className="spacer" /><button className="primary" onClick={close}>Close</button></div>
      </div>
    </Frame>
  );
}

// ---------- Export Drawing Log ----------

function DrawingLogDialog() {
  const s = useApp();
  const docs = s.docs;
  const { tags, values } = useTags();
  const all = [...tags.map((t) => t.name), ...LOG_BUILTINS];
  const [elements, setElements] = useState<string[]>(() => all.filter((e) => e !== 'Page Index'));
  const [format, setFormat] = useState<'csv' | 'pdf'>('csv');
  const [title, setTitle] = useState('Drawing Log');
  const [prependSet, setPrependSet] = useState(true);
  const [appendDate, setAppendDate] = useState(false);
  const [addToSet, setAddToSet] = useState(false);
  const setName = docs.length === 1 ? docs[0].name.replace(/\.pdf$/i, '') : 'Set';
  const close = () => useTagDialogs.setState({ open: null });
  const toggle = (e: string) => setElements(elements.includes(e) ? elements.filter((x) => x !== e) : [...elements, e]);
  const move = (e: string, dir: -1 | 1) => {
    const i = elements.indexOf(e), j = i + dir;
    if (i < 0 || j < 0 || j >= elements.length) return;
    const next = [...elements]; [next[i], next[j]] = [next[j], next[i]];
    setElements(next);
  };
  const run = async () => {
    close();
    const sheets = setSheets(docs, values, tags);
    const rows = drawingLogRows(sheets, elements);
    const name = logTitle(title || 'Drawing Log', setName, prependSet, appendDate);
    if (format === 'csv') {
      const href = URL.createObjectURL(new Blob([drawingLogCsv(elements, rows)], { type: 'text/csv' }));
      Object.assign(document.createElement('a'), { href, download: `${name}.csv` }).click();
      setTimeout(() => URL.revokeObjectURL(href), 10_000);
    } else {
      const bytes = await buildSummaryPdf({ title: name, subtitle: `${rows.length} sheet${rows.length === 1 ? '' : 's'}, ${new Date().toLocaleDateString()}, CyanTakeoff`, header: elements, rows, numeric: elements.map(() => false) });
      if (addToSet) await s.openBytes(bytes, `${name}.pdf`);
      else {
        const href = URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' }));
        Object.assign(document.createElement('a'), { href, download: `${name}.pdf` }).click();
        setTimeout(() => URL.revokeObjectURL(href), 10_000);
      }
    }
    useApp.getState().setStatus(`Drawing log: ${rows.length} sheet${rows.length === 1 ? '' : 's'} exported as ${format.toUpperCase()}`);
  };
  return (
    <Frame title="Export Drawing Log">
      <div className="scale-dialog">
        <div className="form-row" style={{ alignItems: 'flex-start' }}><span>Data</span>
          <div className="log-elements">
            {[...elements, ...all.filter((e) => !elements.includes(e))].map((e) => (
              <div key={e} className="log-element">
                <label><input type="checkbox" checked={elements.includes(e)} onChange={() => toggle(e)} /> {e}</label>
                {elements.includes(e) && <span className="tag-head-actions"><button title="Up" onClick={() => move(e, -1)}>▲</button><button title="Down" onClick={() => move(e, 1)}>▼</button></span>}
              </div>
            ))}
          </div>
        </div>
        <div className="form-row"><span>Export as</span>
          <select aria-label="Export as" value={format} onChange={(e) => setFormat(e.target.value as 'csv' | 'pdf')}><option value="csv">CSV</option><option value="pdf">PDF</option></select>
        </div>
        <div className="form-row"><span>Title</span><input aria-label="Log title" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
        <div className="form-row"><label><input type="checkbox" checked={prependSet} onChange={(e) => setPrependSet(e.target.checked)} /> Prepend Set name to title</label></div>
        <div className="form-row"><label><input type="checkbox" checked={appendDate} onChange={(e) => setAppendDate(e.target.checked)} /> Append date to title</label></div>
        {format === 'pdf' && <div className="form-row"><label><input type="checkbox" checked={addToSet} onChange={(e) => setAddToSet(e.target.checked)} /> Add drawing log to Set (open it as a document)</label></div>}
        <p className="muted small">File: {logTitle(title || 'Drawing Log', setName, prependSet, appendDate)}.{format}</p>
        <div className="modal-actions"><span className="spacer" /><button className="primary" disabled={!elements.length || !docs.length} onClick={run}>Done</button><button onClick={close}>Cancel</button></div>
      </div>
    </Frame>
  );
}
