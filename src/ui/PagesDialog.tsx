// Revu's page operations (Document menu): Insert, Delete, Extract, Rotate,
// Replace, Flatten, Split. One dialog with a page range and per-operation options.
import { useState } from 'react';
import { create } from 'zustand';
import { PDFDocument } from 'pdf-lib';
import { serialize, useApp, useActiveDoc } from '../model/store';
import { parsePageRange } from '../model/measure';
import {
  deletePages, extractPages, flattenPage, insertBlankPage, insertPages, replacePage, rotatePages, splitDocument,
} from '../pdf/pages';
import { pickFile } from './toolActions';

export type PagesOp = 'insert' | 'insert-blank' | 'delete' | 'extract' | 'rotate' | 'replace' | 'flatten' | 'split';
export const usePagesDialog = create<{ op: PagesOp | null }>(() => ({ op: null }));
export const openPagesDialog = (op: PagesOp) => usePagesDialog.setState({ op });

const TITLES: Record<PagesOp, string> = {
  insert: 'Insert Pages', 'insert-blank': 'Insert Blank Page', delete: 'Delete Pages', extract: 'Extract Pages',
  rotate: 'Rotate Pages', replace: 'Replace Pages', flatten: 'Flatten Markups', split: 'Split Document',
};

function download(bytes: Uint8Array, name: string) {
  const href = URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' }));
  Object.assign(document.createElement('a'), { href, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

const base = (name: string) => name.replace(/\.pdf$/i, '');

export function PagesDialog() {
  const op = usePagesDialog((x) => x.op);
  return op ? <PagesForm key={op} op={op} /> : null;
}

function PagesForm({ op }: { op: PagesOp }) {
  const s = useApp();
  const doc = useActiveDoc();
  const n = doc?.loaded.pages.length ?? 0;
  const cur = (doc?.page ?? 0) + 1;
  const [scope, setScope] = useState<'current' | 'all' | 'custom'>(op === 'flatten' || op === 'split' ? 'all' : 'current');
  const [range, setRange] = useState(String(cur));
  const [where, setWhere] = useState<'after' | 'before'>('after');
  const [at, setAt] = useState(String(cur));
  const [count, setCount] = useState('1');
  const [dir, setDir] = useState<'90' | '-90' | '180'>('90');
  const [delAfter, setDelAfter] = useState(false);
  const [keep, setKeep] = useState(true);
  const [every, setEvery] = useState('1');
  const [file, setFile] = useState<{ name: string; doc: PDFDocument } | null>(null);
  if (!doc) return null;
  const close = () => usePagesDialog.setState({ op: null });
  const pages = scope === 'current' ? [doc.page] : scope === 'all' ? doc.loaded.pages.map((p) => p.index) : parsePageRange(range, n);
  const atIndex = Math.max(0, Math.min(n, (Number(at) || 1) - (where === 'before' ? 1 : 0)));

  const choose = async () => {
    const f = await pickFile('.pdf,application/pdf');
    if (!f) return;
    try { setFile({ name: f.name, doc: await PDFDocument.load(new Uint8Array(await f.arrayBuffer()), { updateMetadata: false }) }); }
    catch { s.setStatus(`${f.name} could not be read as a PDF`); }
  };

  const ok = async () => {
    close();
    switch (op) {
      case 'insert-blank':
        await s.transformDoc((lib) => { for (let i = 0; i < Math.max(1, Number(count) || 1); i++) insertBlankPage(lib, atIndex); }, 'Blank page inserted', atIndex);
        break;
      case 'insert':
        if (!file) return;
        await s.transformDoc((lib) => insertPages(lib, file.doc, atIndex), `Inserted ${file.doc.getPageCount()} page(s) from ${file.name}`, atIndex);
        break;
      case 'delete':
        if (pages.length >= n) { s.setStatus('A document must keep at least one page.'); return; }
        await s.transformDoc((lib) => deletePages(lib, pages), `Deleted ${pages.length} page(s)`);
        break;
      case 'rotate':
        await s.transformDoc((lib) => rotatePages(lib, pages, Number(dir) as 90), `Rotated ${pages.length} page(s)`);
        break;
      case 'extract': {
        const lib = await PDFDocument.load(await serialize(doc), { updateMetadata: false });
        download(await (await extractPages(lib, pages)).save(), `${base(doc.name)} - pages ${pages.map((p) => p + 1).join(',')}.pdf`.slice(0, 120));
        if (delAfter && pages.length < n) await s.transformDoc((l) => deletePages(l, pages), `Extracted and deleted ${pages.length} page(s)`);
        else s.setStatus(`Extracted ${pages.length} page(s)`);
        break;
      }
      case 'replace':
        if (!file) return;
        await s.transformDoc(async (lib) => {
          for (let k = 0; k < pages.length && k < file.doc.getPageCount(); k++) await replacePage(lib, pages[k], file.doc, k, keep);
        }, `Replaced ${Math.min(pages.length, file.doc.getPageCount())} page(s)${keep ? ', markups kept' : ''}`);
        break;
      case 'flatten':
        await s.transformDoc((lib) => { for (const p of pages) flattenPage(lib, lib.getPage(p)); }, `Flattened markups on ${pages.length} page(s)`);
        break;
      case 'split': {
        const lib = await PDFDocument.load(await serialize(doc), { updateMetadata: false });
        const parts = await splitDocument(lib, Math.max(1, Number(every) || 1));
        for (let i = 0; i < parts.length; i++) download(await parts[i].save(), `${base(doc.name)} - part ${i + 1}.pdf`);
        s.setStatus(`Split into ${parts.length} file(s)`);
        break;
      }
    }
  };

  const range_ = (
    <div className="form-row">
      <span>Pages</span>
      <select aria-label="Page range" value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}>
        <option value="current">Current ({doc.loaded.pages[doc.page]?.label})</option>
        <option value="all">All Pages</option>
        <option value="custom">Custom</option>
      </select>
      {scope === 'custom' && <input aria-label="Custom pages" placeholder="1-3, 5" value={range} onChange={(e) => setRange(e.target.value)} style={{ width: 110 }} />}
    </div>
  );
  const position = (
    <div className="form-row">
      <span>Position</span>
      <select aria-label="Position" value={where} onChange={(e) => setWhere(e.target.value as 'after')}><option value="after">After</option><option value="before">Before</option></select>
      page <input aria-label="Page number" type="number" min={1} max={n} value={at} onChange={(e) => setAt(e.target.value)} style={{ width: 60 }} /> of {n}
    </div>
  );
  const fileRow = (
    <div className="form-row"><span>File</span><button onClick={choose}>Choose PDF…</button> <span className="muted">{file ? `${file.name} (${file.doc.getPageCount()} pages)` : 'none'}</span></div>
  );
  const ready = (op !== 'insert' && op !== 'replace') || !!file;
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal" role="dialog" aria-label={TITLES[op]} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') close(); }}>
        <div className="modal-title">{TITLES[op]}</div>
        <div className="scale-dialog">
          {op === 'insert' && <>{fileRow}{position}</>}
          {op === 'insert-blank' && <>{position}<div className="form-row"><span>Count</span><input aria-label="Count" type="number" min={1} value={count} onChange={(e) => setCount(e.target.value)} style={{ width: 60 }} /></div></>}
          {(op === 'delete' || op === 'extract' || op === 'rotate' || op === 'flatten') && range_}
          {op === 'rotate' && (
            <div className="form-row"><span>Direction</span>
              <select aria-label="Direction" value={dir} onChange={(e) => setDir(e.target.value as '90')}>
                <option value="90">Clockwise 90°</option><option value="-90">Counterclockwise 90°</option><option value="180">180°</option>
              </select>
            </div>
          )}
          {op === 'extract' && <div className="form-row"><label><input type="checkbox" checked={delAfter} onChange={(e) => setDelAfter(e.target.checked)} /> Delete pages after extracting</label></div>}
          {op === 'replace' && <>{range_}{fileRow}<div className="form-row"><label><input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} /> Keep markups, page scale and Spaces</label></div>
            <p className="muted small">Replaces the chosen pages, in order, with the new file's pages from page 1.</p></>}
          {op === 'flatten' && <p className="muted small">Markups become part of the page content and can no longer be edited.</p>}
          {op === 'split' && <div className="form-row"><span>Every</span><input aria-label="Pages per file" type="number" min={1} value={every} onChange={(e) => setEvery(e.target.value)} style={{ width: 60 }} /> page(s) per file</div>}
          <div className="modal-actions">
            <span className="spacer" />
            <button className="primary" disabled={!ready || (op !== 'insert' && op !== 'insert-blank' && op !== 'split' && !pages.length)} onClick={ok}>OK</button>
            <button onClick={close}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** File > Combine: several PDFs into one new document (markups kept). */
export async function combineFiles() {
  const files = await new Promise<File[]>((resolve) => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.pdf,application/pdf', multiple: true });
    input.onchange = () => resolve(Array.from(input.files ?? []));
    input.oncancel = () => resolve([]);
    input.click();
  });
  if (!files.length) return;
  const out = await PDFDocument.create();
  for (const f of files) {
    const src = await PDFDocument.load(new Uint8Array(await f.arrayBuffer()), { updateMetadata: false });
    await insertPages(out, src, out.getPageCount());
  }
  await useApp.getState().openBytes(await out.save(), 'Combined.pdf');
  const d = useApp.getState().docs.find((x) => x.name === 'Combined.pdf');
  if (d) useApp.setState({ docs: useApp.getState().docs.map((x) => (x.id === d.id ? { ...x, dirty: true } : x)) });
}
