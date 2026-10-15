// Revu's page operations (Document menu): Insert, Delete, Extract, Rotate,
// Replace, Flatten, Split. One dialog with a page range and per-operation options.
import { useState } from 'react';
import { PDFDict, PDFName, PDFRef } from 'pdf-lib';
import { readLayers, writeLayers } from '../pdf/layers';
import { create } from 'zustand';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { attachFile } from '../pdf/docInfo';
import { captureSummaryPdf } from './captureExport';
import { serialize, useApp, useActiveDoc } from '../model/store';
import { parsePageRange } from '../model/measure';
import {
  deletePages, extractPages, flattenPage, flattenedPages, unflattenPage, insertBlankPage, insertPages, replacePage, rotatePages, insertRevisedPage,
} from '../pdf/pages';
import { pickFile } from './toolActions';
import { openPdf } from '../pdf/document';
import { OCR_LANGUAGES, addTextLayer, ocrPages } from './ocr';
import { FilesRow, batchHint, targets } from './filesRow';
import { detectSheetNumbers } from './Sheets';
import { slipPlan, slipReportRows, supersededIndex, type SlipMatch } from '../model/slipSheet';
import { batchReportCsv } from '../model/batchPairs';
import { partFileName, splitParts, type SplitMode } from '../model/split';
import type { DocState } from '../model/store';
import type { Markup, MarkupType } from '../model/types';
import { toolById } from '../tools/tools';

export type PagesOp = 'insert' | 'insert-blank' | 'delete' | 'extract' | 'rotate' | 'replace' | 'flatten' | 'split' | 'slip-sheet' | 'ocr';
export const usePagesDialog = create<{ op: PagesOp | null; /** Flatten opened from a layer: Assign Layer preset to it. */ layer?: string }>(() => ({ op: null }));
export const openPagesDialog = (op: PagesOp, layer?: string) => usePagesDialog.setState({ op, layer });

const TITLES: Record<PagesOp, string> = {
  insert: 'Insert Pages', 'insert-blank': 'Insert Blank Page', delete: 'Delete Pages', extract: 'Extract Pages',
  rotate: 'Rotate Pages', replace: 'Replace Pages', flatten: 'Flatten Markups', split: 'Split Document', 'slip-sheet': 'Slip Sheet', ocr: 'OCR',
};

function download(bytes: Uint8Array, name: string) {
  const href = URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' }));
  Object.assign(document.createElement('a'), { href, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

const base = (name: string) => name.replace(/\.pdf$/i, '');

/** Document > Unflatten (Ctrl+Shift+U): put back markups flattened with recovery. */
export async function unflattenMarkups() {
  const s = useApp.getState();
  let back = 0, blocked = 0, pagesN = 0;
  const ok = await s.transformDoc((lib) => {
    for (const i of flattenedPages(lib)) {
      const n = unflattenPage(lib, lib.getPage(i));
      if (n < 0) blocked++; else { back += n; pagesN++; }
    }
    if (!pagesN && !blocked) throw new Error('nothing to unflatten: no markups were flattened with recovery');
  }, 'Unflattened');
  if (ok) s.setStatus(`Unflattened ${back} markup${back === 1 ? '' : 's'} on ${pagesN} page${pagesN === 1 ? '' : 's'}${blocked ? `; ${blocked} page(s) were edited after flattening and cannot be unflattened` : ''}`);
}

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
  // Split Document (Revu): by page count, page ranges, top-level bookmarks or file size.
  const [splitMode, setSplitMode] = useState<SplitMode>('count');
  const [splitRanges, setSplitRanges] = useState('');
  const [splitMb, setSplitMb] = useState('10');
  const [langs, setLangs] = useState<string[]>(() => {
    try { const l = JSON.parse(localStorage.getItem('cyantakeoff:ocr-langs') ?? '[]'); return Array.isArray(l) && l.length ? l : ['eng']; } catch { return ['eng']; }
  });
  const [file, setFile] = useState<{ name: string; doc: PDFDocument; bytes: Uint8Array } | null>(null);
  const [appendNew, setAppendNew] = useState(true);
  // Slip Sheet options (Revu): replace or insert in front, copy the markups, stamp the superseded pages, how pages match, a report.
  const [slipMode, setSlipMode] = useState<'replace' | 'insert'>('replace');
  const [slipCopy, setSlipCopy] = useState(true);
  const [slipStamp, setSlipStamp] = useState(false);
  const [slipBy, setSlipBy] = useState<SlipMatch>('label');
  const [slipFilter, setSlipFilter] = useState('');
  const [slipReport, setSlipReport] = useState(false);
  const [all, setAll] = useState(() => batchHint.take());
  // Flatten > Assign Layer (Revu): an existing layer's name, or a new one ("Markups" when the file has none).
  const presetLayer = usePagesDialog((x) => x.layer);
  const [assign, setAssign] = useState(!!presetLayer);
  const [recover, setRecover] = useState(true);
  // Flatten Markups (Revu): which markup types, and all of them or only the selected ones.
  const typesPresent = [...new Set((doc?.markups ?? []).map((m) => m.type))].sort((a, b) => toolById(a).name.localeCompare(toolById(b).name));
  const [flatTypes, setFlatTypes] = useState<Set<MarkupType>>(() => new Set(typesPresent));
  const [flatScope, setFlatScope] = useState<'all' | 'selected' | 'unfiltered'>('all');
  // Overlay Text (with Assign Layer): the layer's name next to each flattened markup.
  const [overlay, setOverlay] = useState(false);
  const [overlaySize, setOverlaySize] = useState(8);
  const [overlayPos, setOverlayPos] = useState<'tl' | 'tr' | 'bl' | 'br'>('tr');
  // Flatten Capture Media as Attachment: the Capture Summary PDF attached to the file.
  const [flatCapture, setFlatCapture] = useState(false);
  const [captureTitle, setCaptureTitle] = useState(() => `${(doc?.name ?? '').replace(/\.pdf$/i, '')} - Capture Summary`);
  const listVisible = useApp((st) => st.listVisible);
  const [layerName, setLayerName] = useState(() => presetLayer ?? (doc?.layers ? Object.values(doc.layers.layers)[0]?.name : undefined) ?? 'Markups');
  if (!doc) return null;
  const close = () => usePagesDialog.setState({ op: null, layer: undefined });
  const pages = scope === 'current' ? [doc.page] : scope === 'all' ? doc.loaded.pages.map((p) => p.index) : parsePageRange(range, n);
  const pagesIn = (t: DocState) => (scope === 'current' ? [t.page] : scope === 'all' ? t.loaded.pages.map((p) => p.index) : parsePageRange(range, t.loaded.pages.length));
  const atIndex = Math.max(0, Math.min(n, (Number(at) || 1) - (where === 'before' ? 1 : 0)));

  const choose = async () => {
    const f = await pickFile('.pdf,application/pdf');
    if (!f) return;
    try { const bytes = new Uint8Array(await f.arrayBuffer()); setFile({ name: f.name, bytes, doc: await PDFDocument.load(bytes.slice(), { updateMetadata: false }) }); }
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
        for (const t of targets(doc, all)) { const tp = pagesIn(t); if (tp.length) await s.transformDoc((lib) => rotatePages(lib, tp, Number(dir) as 90), `Rotated ${tp.length} page(s)`, undefined, undefined, t.id); }
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
        await s.transformDoc(async (lib) => {
          let target: PDFRef | undefined;
          if (assign && layerName.trim()) {
            const set = readLayers(lib) ?? { layers: {}, order: [], configs: [] };
            let l = Object.values(set.layers).find((x) => x.name === layerName.trim());
            if (!l) {
              l = { id: 'new:flatten', name: layerName.trim(), on: true, locked: false, print: true };
              set.layers[l.id] = l;
              set.order.push({ id: l.id, kids: [] });
            }
            target = writeLayers(lib, set).get(l.id);
          }
          // Markups go to the assigned layer, else stay on the layer they were on.
          const layerOf = (a: PDFDict) => target ?? (a.get(PDFName.of('OC')) instanceof PDFRef ? a.get(PDFName.of('OC')) as PDFRef : undefined);
          // Only the chosen types (and only the selection, when asked) are flattened; the rest stays as markups.
          const everything = flatScope === 'all' && typesPresent.every((t) => flatTypes.has(t));
          const inScope = (m: Markup) => (flatScope === 'all' ? true : flatScope === 'selected' ? doc.selection.includes(m.id) : !listVisible || listVisible.has(m.id));
          const chosen = doc.markups.filter((m) => flatTypes.has(m.type) && inScope(m));
          const ids = new Set(chosen.map((m) => m.id));
          const refs = new Set(chosen.filter((m) => m.source).map((m) => `${m.source!.objectNumber} ${m.source!.generation}`));
          const keep = everything ? () => false : (a: PDFDict) => {
            const nm = a.get(PDFName.of('NM'));
            const id = nm && 'decodeText' in nm ? (nm as { decodeText(): string }).decodeText() : '';
            const ref = lib.context.getObjectRef(a);
            return !(ids.has(id) || (ref ? refs.has(`${ref.objectNumber} ${ref.generationNumber}`) : false));
          };
          const ov = assign && overlay ? { text: () => layerName.trim(), font: await lib.embedFont(StandardFonts.Helvetica), size: overlaySize, position: overlayPos } : undefined;
          for (const p of pages) flattenPage(lib, lib.getPage(p), keep, layerOf, recover, ov);
          if (flatCapture) {
            const bytes = await captureSummaryPdf(doc, chosen.filter((m) => pages.includes(m.page)), captureTitle.trim() || 'Capture Summary');
            if (bytes) await attachFile(lib, `${captureTitle.trim() || 'Capture Summary'}.pdf`, bytes, 'application/pdf');
          }
        }, `Flattened markups on ${pages.length} page(s)${assign ? ` to layer "${layerName.trim()}"` : ''}`);
        break;
      case 'ocr': {
        try {
          try { localStorage.setItem('cyantakeoff:ocr-langs', JSON.stringify(langs)); } catch { /* storage unavailable */ }
          for (const t of targets(doc, all)) {
            const tp = pagesIn(t);
            if (!tp.length) continue;
            const words = await ocrPages(t, tp, (msg) => s.setStatus(msg), langs);
            const total = [...words.values()].reduce((tt, ls) => tt + ls.reduce((nn, l) => nn + l.text.split(' ').length, 0), 0);
            await s.transformDoc(async (lib) => { for (const [p, w] of words) await addTextLayer(lib, p, w); }, `OCR: ${total} word(s) recognised on ${tp.length} page(s) of ${t.name}; the text is now searchable`, undefined, undefined, t.id);
          }
        } catch (e) { s.setStatus(`OCR failed: ${(e as Error).message}`); }
        break;
      }
      case 'slip-sheet': {
        if (!file) return;
        // Match the new revision's sheets to this document's by page label (sheet number).
        s.setStatus('Slip Sheet: reading sheet numbers…');
        const rev = await openPdf(file.bytes.slice());
        const tmp = { ...doc, loaded: rev } as DocState;
        const found = await detectSheetNumbers(tmp);
        const newLabels = rev.pages.map((p, i) => (/^\d+$/.test(p.label) && found[i] ? found[i]! : p.label));
        rev.pdf.loadingTask.destroy();
        const oldLabels = doc.loaded.pages.map((p) => p.label);
        const plan = slipPlan(oldLabels, newLabels, slipBy, slipFilter);
        const { matched, extra } = plan;
        const insert = slipMode === 'insert';
        const docId = doc.id;
        const done = await s.transformDoc(async (lib) => {
          if (insert) {
            // Front to back from the end, so the positions still to come stay valid.
            for (const { src, at: i } of [...matched].sort((a, b) => b.at - a.at)) await insertRevisedPage(lib, i, file.doc, src, slipCopy, s.prefs.redirectOnSlipSheet);
          } else for (const { src, at: i } of matched) await replacePage(lib, i, file.doc, src, slipCopy);
          if (appendNew && extra.length) await insertPages(lib, file.doc, lib.getPageCount(), extra);
        }, `Slip Sheet: ${matched.length} sheet(s) ${insert ? 'inserted in front of the current ones' : 'replaced'}${slipCopy ? ' with markups carried forward' : ''}${appendNew && extra.length ? `, ${extra.length} new sheet(s) added` : ''}`);
        if (done && insert && slipStamp && matched.length) {
          // Stamp Current Pages 'Superseded': in the middle of each page that was slipped over.
          const app = useApp.getState();
          const d2 = app.docs.find((x) => x.id === docId);
          if (d2) {
            const now = new Date().toISOString();
            app.addMarkups(matched.map(({ at }) => {
              const pg = supersededIndex(at, matched), info = d2.loaded.pages[pg];
              return { id: crypto.randomUUID(), type: 'stamp' as const, page: pg, points: [{ x: info.width / 2, y: info.height / 2 }], style: app.toolDefaults.stamp, subject: 'Stamp', text: 'SUPERSEDED', author: app.author, created: now, modified: now, status: 'None' as const, label: '', comment: '' };
            }), docId);
          }
        }
        if (done && slipReport) {
          const csv = batchReportCsv(slipReportRows(oldLabels, newLabels, plan, slipMode), 'Slip Sheet');
          download(new TextEncoder().encode(csv), `${base(doc.name)} - Slip Sheet report.csv`);
        }
        break;
      }
      case 'split': {
        let made = 0;
        for (const t of targets(doc, all)) {
          const bytes = await serialize(t);
          const lib = await PDFDocument.load(bytes, { updateMetadata: false });
          const parts = splitParts(lib.getPageCount(), { mode: splitMode, every: Math.max(1, Number(every) || 1), ranges: splitRanges, maxMb: Math.max(0.1, Number(splitMb) || 10) }, t.loaded.bookmarks, bytes.length);
          for (const part of parts) download(await (await extractPages(lib, part.pages)).save(), partFileName(base(t.name), part));
          made += parts.length;
        }
        s.setStatus(`Split into ${made} file(s)`);
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
  const ready = (op !== 'insert' && op !== 'replace' && op !== 'slip-sheet') || !!file;
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal" role="dialog" aria-label={TITLES[op]} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') close(); }}>
        <div className="modal-title">{TITLES[op]}</div>
        <div className="scale-dialog">
          {op === 'insert' && <>{fileRow}{position}</>}
          {op === 'insert-blank' && <>{position}<div className="form-row"><span>Count</span><input aria-label="Count" type="number" min={1} value={count} onChange={(e) => setCount(e.target.value)} style={{ width: 60 }} /></div></>}
          {(op === 'delete' || op === 'extract' || op === 'rotate' || op === 'flatten' || op === 'ocr') && range_}
          {(op === 'rotate' || op === 'ocr' || op === 'split') && <FilesRow all={all} setAll={setAll} />}
          {op === 'ocr' && (
            <>
              <div className="form-row ocr-langs"><span>Languages</span>
                {OCR_LANGUAGES.map((l) => (
                  <label key={l.code}><input type="checkbox" checked={langs.includes(l.code)}
                    onChange={(e) => setLangs(e.target.checked ? [...langs, l.code] : langs.filter((x) => x !== l.code))} /> {l.name}</label>
                ))}
              </div>
              <p className="muted small">Recognises text on scanned pages and adds it as invisible text, so Search, text markups and copying work. Pick the languages on the drawings (fewer is faster). Runs in your browser; large sheets take a while.</p>
            </>
          )}
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
          {op === 'flatten' && <>
            <div className="form-row"><span>Markups</span>
              <select aria-label="Flatten scope" value={flatScope} onChange={(e) => setFlatScope(e.target.value as 'all' | 'selected')}>
                <option value="all">All Markups</option>
                {listVisible && <option value="unfiltered">Exclude Filtered Markups</option>}
                {doc.selection.length > 0 && <option value="selected">Currently Selected Markups ({doc.selection.length})</option>}
              </select>
            </div>
            {typesPresent.length > 0 && (
              <div className="form-row flatten-types"><span>Types</span>
                <span className="flatten-type-list" aria-label="Markup types to flatten">
                  {typesPresent.map((t) => (
                    <label key={t}><input type="checkbox" aria-label={`Flatten ${toolById(t).name}`} checked={flatTypes.has(t)} onChange={(e) => { const n = new Set(flatTypes); if (e.target.checked) n.add(t); else n.delete(t); setFlatTypes(n); }} /> {toolById(t).name}</label>
                  ))}
                  <button type="button" className="link-btn" onClick={() => setFlatTypes(new Set(typesPresent))}>All</button>
                  <button type="button" className="link-btn" onClick={() => setFlatTypes(new Set())}>None</button>
                </span>
              </div>
            )}
            <div className="form-row"><label><input type="checkbox" checked={assign} onChange={(e) => setAssign(e.target.checked)} /> Assign Layer</label>
              <input aria-label="Flatten to layer" list="flatten-layers" value={layerName} disabled={!assign} onChange={(e) => setLayerName(e.target.value)} />
              <datalist id="flatten-layers">{Object.values(doc.layers?.layers ?? {}).map((l) => <option key={l.id} value={l.name} />)}</datalist>
            </div>
            {assign && (
              <div className="form-row"><label><input type="checkbox" checked={overlay} onChange={(e) => setOverlay(e.target.checked)} /> Overlay Text</label>
                <input aria-label="Overlay font size" type="number" min={4} max={48} value={overlaySize} disabled={!overlay} onChange={(e) => setOverlaySize(Math.max(4, Math.min(48, Number(e.target.value) || 8)))} style={{ width: 50 }} /> pt
                <select aria-label="Overlay position" value={overlayPos} disabled={!overlay} onChange={(e) => setOverlayPos(e.target.value as typeof overlayPos)}>
                  <option value="tl">Top Left</option><option value="tr">Top Right</option><option value="bl">Bottom Left</option><option value="br">Bottom Right</option>
                </select>
              </div>
            )}
            <div className="form-row"><label><input type="checkbox" checked={recover} onChange={(e) => setRecover(e.target.checked)} /> Allow markup recovery (Document &gt; Unflatten, Ctrl+Shift+U)</label></div>
            {doc.markups.some((m) => m.capture?.length) && (
              <div className="form-row"><label><input type="checkbox" checked={flatCapture} onChange={(e) => setFlatCapture(e.target.checked)} /> Flatten Capture Media as Attachment</label>
                <input aria-label="Capture summary title" value={captureTitle} disabled={!flatCapture} onChange={(e) => setCaptureTitle(e.target.value)} />
              </div>
            )}
            <p className="muted small">Markups become part of the page content{recover ? '; Unflatten brings them back as long as the page content is not edited (Edit Text, Erase Content, redaction)' : ' and can no longer be edited'}. With Assign Layer they go on that layer (a new name creates it); otherwise a markup on a layer stays on its layer.</p>
          </>}
          {op === 'slip-sheet' && <>{fileRow}
            <div className="form-row"><span>Match by</span>
              <select aria-label="Match pages by" value={slipBy} onChange={(e) => setSlipBy(e.target.value as SlipMatch)}><option value="label">Page Label (sheet number)</option><option value="index">File name, page index</option></select>
              {slipBy === 'label' && <input aria-label="Match filter" placeholder="Filter: * any, # number, ? letter" value={slipFilter} onChange={(e) => setSlipFilter(e.target.value)} style={{ width: 150 }} />}
            </div>
            <div className="form-row"><span>Options</span>
              <select aria-label="Slip sheet mode" value={slipMode} onChange={(e) => setSlipMode(e.target.value as 'replace' | 'insert')}><option value="replace">Replace Current Pages with Revised Pages</option><option value="insert">Insert Revised Pages before Current Pages</option></select>
            </div>
            <div className="form-row"><label><input type="checkbox" checked={slipCopy} onChange={(e) => setSlipCopy(e.target.checked)} /> Copy Markups from Current Pages to Revised Pages</label></div>
            {slipMode === 'insert' && <div className="form-row"><label><input type="checkbox" checked={slipStamp} onChange={(e) => setSlipStamp(e.target.checked)} /> Stamp Current Pages 'Superseded'</label></div>}
            <div className="form-row"><label><input type="checkbox" checked={slipReport} onChange={(e) => setSlipReport(e.target.checked)} /> Save a report (CSV)</label></div>
            <div className="form-row"><label><input type="checkbox" checked={appendNew} onChange={(e) => setAppendNew(e.target.checked)} /> Add sheets that are not in this document</label></div>
            <p className="muted small">Each sheet of the new revision replaces the sheet with the same number (page label), keeping its markups, scale and Spaces.</p></>}
          {op === 'split' && <>
            <div className="form-row"><span>Split by</span>
              <select aria-label="Split by" value={splitMode} onChange={(e) => setSplitMode(e.target.value as SplitMode)}>
                <option value="count">Page Count</option><option value="ranges">Page Ranges</option><option value="bookmarks">Top-Level Bookmarks</option><option value="size">File Size</option>
              </select>
            </div>
            {splitMode === 'count' && <div className="form-row"><span>Every</span><input aria-label="Pages per file" type="number" min={1} value={every} onChange={(e) => setEvery(e.target.value)} style={{ width: 60 }} /> page(s) per file</div>}
            {splitMode === 'ranges' && <div className="form-row"><span>Ranges</span><input aria-label="Page ranges" placeholder="1-3, 4, 7-9" value={splitRanges} onChange={(e) => setSplitRanges(e.target.value)} /></div>}
            {splitMode === 'size' && <div className="form-row"><span>Maximum</span><input aria-label="Maximum file size" type="number" min={0.1} step={0.5} value={splitMb} onChange={(e) => setSplitMb(e.target.value)} style={{ width: 60 }} /> MB per file (estimated from the average page)</div>}
            {splitMode === 'bookmarks' && <p className="muted small">One file per top-level bookmark{doc.loaded.bookmarks.length ? '' : ' (this file has none: it stays whole)'}; pages before the first bookmark make a file of their own.</p>}
            <p className="muted small">Each part is downloaded as "{base(doc.name)} - part N.pdf" (ranges and bookmarks name the parts).</p>
          </>}
          <div className="modal-actions">
            <span className="spacer" />
            <button className="primary" disabled={!ready || (op === 'ocr' && !langs.length) || (op !== 'insert' && op !== 'insert-blank' && op !== 'split' && op !== 'slip-sheet' && !pages.length)} onClick={ok}>OK</button>
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
