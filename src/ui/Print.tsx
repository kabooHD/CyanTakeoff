// Revu's Print dialog (File > Print, Ctrl+P). The browser owns the printer
// itself, so this prepares the sheets: the document with its markups written
// in (as saved), laid out per the options, rendered page by page and handed
// to the browser's print dialog. Layers print when they are shown and their
// Print usage is on; markups on hidden layers stay off the paper too.
import { useEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import { PDFDocument, PDFName } from 'pdf-lib';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { serialize, useApp, type DocState } from '../model/store';
import { parsePageRange } from '../model/measure';
import { DEFAULT_PRINT, PAPER_SIZES, layoutSheets, printOrder, renderScale, type PrintOptions, type Sheet } from '../model/print';
import { loadForRender } from '../pdf/document';
import { layerShown } from './layersView';
import { PERM, allowed } from '../pdf/crypt';
import { deviceMemoryGB } from '../model/device';
import { selectedPages, useThumbSel } from './Panels';
import { FilesRow, batchHint, targets } from './filesRow';

type Range = 'all' | 'current' | 'selected' | 'custom';
type Content = 'both' | 'document' | 'markups';
export interface PrintSettings extends PrintOptions { content: Content; dim: boolean; dpi: number }
const DEFAULTS: PrintSettings = { ...DEFAULT_PRINT, content: 'both', dim: false, dpi: 150 };
const LS = 'cyantakeoff:print';

export const usePrintDialog = create<{ open: boolean }>(() => ({ open: false }));
export const openPrint = () => {
  const s = useApp.getState(), d = s.docs.find((x) => x.id === s.activeId);
  if (d && !allowed(d.security, PERM.print)) { s.setStatus('Printing is not allowed by this file\'s security settings.'); return; }
  usePrintDialog.setState({ open: true });
};

function loadSettings(): PrintSettings {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(LS) ?? '{}') }; } catch { return DEFAULTS; }
}

/** The PDFs to render: the document as saved, and (for Markups Only / Dim) a copy without page content. */
interface Sources { full: PDFDocumentProxy; markupsOnly?: PDFDocumentProxy; destroy(): void }

async function prepare(d: DocState, needMarkupsOnly: boolean): Promise<Sources> {
  const bytes = await serialize(d);
  const full = await loadForRender(bytes);
  let markupsOnly: PDFDocumentProxy | undefined;
  if (needMarkupsOnly) {
    const lib = await PDFDocument.load(bytes, { updateMetadata: false });
    for (const p of lib.getPages()) p.node.set(PDFName.of('Contents'), lib.context.register(lib.context.stream('')));
    markupsOnly = await loadForRender(await lib.save());
  }
  return { full, markupsOnly, destroy: () => { void full.cleanup(); void full.loadingTask.destroy(); void markupsOnly?.loadingTask.destroy(); } };
}

/** Optional content for printing: a layer prints when it is shown and its Print usage is on. */
async function printConfig(d: DocState, pdf: PDFDocumentProxy) {
  const cfg = await pdf.getOptionalContentConfig({ intent: 'print' });
  const byName = new Map(Object.values(d.layers?.layers ?? {}).map((l) => [l.name, l]));
  for (const [id, g] of cfg as unknown as Iterable<[string, { name: string | null }]>) {
    const l = d.layers?.layers[id] ?? (g.name ? byName.get(g.name) : undefined);
    if (!l) continue;
    try { cfg.setVisibility(id, layerShown(d, l.id, 1) && l.print, false); } catch { /* radio groups */ }
  }
  return cfg;
}

/** Render one page (at `scale` px per point, rotated `rotate` more degrees) to a canvas. */
async function renderPage(d: DocState, src: Sources, page: number, scale: number, rotate: number, o: PrintSettings): Promise<HTMLCanvasElement> {
  const draw = async (pdf: PDFDocumentProxy, annots: boolean, transparent = false) => {
    const p = await pdf.getPage(page + 1);
    const vp = p.getViewport({ scale, rotation: (p.rotate + rotate) % 360 });
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(vp.width)); c.height = Math.max(1, Math.round(vp.height));
    await p.render({
      canvas: c, viewport: vp, intent: 'print', annotationMode: annots ? 1 : 0,
      optionalContentConfigPromise: printConfig(d, pdf),
      ...(transparent ? { background: 'rgba(0,0,0,0)' } : {}),
    }).promise;
    return c;
  };
  if (o.content === 'document') return draw(src.full, false);
  if (o.content === 'markups') return draw(src.markupsOnly!, true);
  if (!o.dim) return draw(src.full, true);
  // Dim Page Content: faded page, markups at full strength on top.
  const base = await draw(src.full, false), top = await draw(src.markupsOnly!, true, true);
  const ctx = base.getContext('2d')!;
  ctx.globalAlpha = 0.65; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, base.width, base.height);
  ctx.globalAlpha = 1; ctx.drawImage(top, 0, 0);
  top.width = top.height = 0;
  return base;
}

export function pagesToPrint(d: DocState, range: Range, custom: string): number[] {
  const n = d.loaded.pages.length;
  if (range === 'current') return [d.page];
  if (range === 'selected') return selectedPages(d);
  if (range === 'custom') return parsePageRange(custom, n);
  return Array.from({ length: n }, (_, i) => i);
}

export function sheetsFor(d: DocState, pages: number[], o: PrintSettings): Sheet[] {
  const sizes = d.loaded.pages.map((p) => ({ w: p.width, h: p.height }));
  return layoutSheets(sizes, printOrder(pages, o), o);
}

const pt = (v: number) => `${Math.round(v * 1000) / 1000}pt`;

function cleanup() {
  const root = document.getElementById('print-root');
  root?.querySelectorAll('img').forEach((img) => URL.revokeObjectURL(img.src));
  root?.remove();
  document.getElementById('print-page-style')?.remove();
}

/** A document and its laid-out sheets; Batch > Print prints several in one job. */
export interface PrintJob { d: DocState; sheets: Sheet[] }

/** Build the print sheets in the page and open the browser's print dialog. */
export async function printSheets(jobs: PrintJob[], o: PrintSettings) {
  const s = useApp.getState();
  cleanup();
  useApp.setState({ busy: true });
  const sources: Sources[] = [];
  try {
    const root = document.createElement('div');
    root.id = 'print-root';
    // One named @page per sheet size, so Auto paper keeps each sheet's own size.
    const allSheets = jobs.flatMap((j) => j.sheets);
    const sizes = [...new Set(allSheets.map((sh) => `${pt(sh.w)} ${pt(sh.h)}`))];
    const style = document.createElement('style');
    style.id = 'print-page-style';
    style.textContent = sizes.map((sz, i) => `@page cts${i} { size: ${sz}; margin: 0 }`).join('\n') + `\n@page { margin: 0 }`;
    let k = 0;
    const total = allSheets.reduce((n, sh) => n + sh.items.length, 0);
    for (const { d, sheets } of jobs) {
      const src = await prepare(d, o.content === 'markups' || (o.content === 'both' && o.dim));
      sources.push(src);
      const done = new Map<string, string>(); // page@scale/rotation -> image URL (copies reuse it)
      for (const sh of sheets) {
        const el = document.createElement('div');
        el.className = 'print-sheet';
        Object.assign(el.style, { width: pt(sh.w), height: pt(sh.h), page: `cts${sizes.indexOf(`${pt(sh.w)} ${pt(sh.h)}`)}` });
        for (const it of sh.items) {
          s.setStatus(`Preparing page ${++k} of ${total} for printing…`);
          const page = d.loaded.pages[it.page];
          const [w, h] = it.rotate ? [page.height, page.width] : [page.width, page.height];
          const rs = renderScale(w, h, it.scale, o.dpi, deviceMemoryGB() <= 4 ? 8_000_000 : 16_777_216);
          const key = `${it.page}@${rs}/${it.rotate}`;
          let url = done.get(key);
          if (!url) {
            const c = await renderPage(d, src, it.page, rs, it.rotate, o);
            const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Page too large to print'))), 'image/png'));
            c.width = c.height = 0;
            url = URL.createObjectURL(blob);
            done.set(key, url);
          }
          const img = document.createElement('img');
          img.src = url;
          img.alt = `Page ${page.label}`;
          Object.assign(img.style, { left: pt(it.x), top: pt(it.y), width: pt(it.w), height: pt(it.h) });
          el.appendChild(img);
        }
        root.appendChild(el);
      }
    }
    document.head.appendChild(style);
    document.body.appendChild(root);
    await Promise.all([...root.querySelectorAll('img')].map((img) => img.decode().catch(() => undefined)));
    s.setStatus(`Printing ${allSheets.length} sheet${allSheets.length === 1 ? '' : 's'}${jobs.length > 1 ? ` from ${jobs.length} documents` : ''}`);
    window.addEventListener('afterprint', cleanup, { once: true });
    window.print();
  } finally {
    for (const src of sources) src.destroy();
    useApp.setState({ busy: false });
  }
}

export function PrintDialog() {
  const open = usePrintDialog((x) => x.open);
  const d = useApp((s) => s.docs.find((x) => x.id === s.activeId));
  return open && d ? <PrintForm d={d} /> : null;
}

function PrintForm({ d }: { d: DocState }) {
  const [o, setO] = useState<PrintSettings>(loadSettings);
  const [range, setRange] = useState<Range>('all');
  const [custom, setCustom] = useState(`1-${d.loaded.pages.length}`);
  const [sheet, setSheet] = useState(0);
  const thumbSel = useThumbSel((x) => x.sel[d.id]);
  const [all, setAll] = useState(() => batchHint.take());
  const [unit, setUnit] = useState<'in' | 'mm'>(() => /^(en-US|en-CA)/.test(navigator.language) ? 'in' : 'mm');
  const set = (p: Partial<PrintSettings>) => { setO((x) => ({ ...x, ...p })); setSheet(0); };
  const close = () => usePrintDialog.setState({ open: false });
  const pages = useMemo(() => pagesToPrint(d, range, custom), [d, range, custom, thumbSel]); // eslint-disable-line react-hooks/exhaustive-deps
  const sheets = useMemo(() => sheetsFor(d, pages, o), [d, pages, o]);
  const fixedPaper = o.paper !== 'auto';
  const ok = async () => {
    try { localStorage.setItem(LS, JSON.stringify(o)); } catch { /* storage unavailable */ }
    close();
    const jobs: PrintJob[] = targets(d, all).map((t) => ({ d: t, sheets: t === d ? sheets : sheetsFor(t, pagesToPrint(t, range === 'selected' ? 'all' : range, custom), o) }));
    try { await printSheets(jobs, o); } catch (e) { useApp.getState().setStatus(`Print failed: ${(e as Error).message}`); }
  };
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal print-dialog" role="dialog" aria-label="Print" onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') close(); if (e.key === 'Enter' && pages.length) ok(); }}>
        <div className="modal-title">Print</div>
        <div className="print-body">
          <div className="print-preview">
            <Preview d={d} sheet={sheets[Math.min(sheet, sheets.length - 1)]} margins={fixedPaper && (o.scaling === 'fitMargins' || o.scaling === 'reduceMargins') ? o.margins : undefined} />
            <div className="print-nav">
              <button aria-label="Previous sheet" disabled={sheet <= 0} onClick={() => setSheet(sheet - 1)}>‹</button>
              <span>{sheets.length ? `Sheet ${Math.min(sheet, sheets.length - 1) + 1} of ${sheets.length}` : 'No pages'}</span>
              <button aria-label="Next sheet" disabled={sheet >= sheets.length - 1} onClick={() => setSheet(sheet + 1)}>›</button>
            </div>
          </div>
          <div className="scale-dialog">
            <div className="form-row"><span>Printer</span><span className="muted">Chosen in the browser's print dialog</span></div>
            <div className="form-row"><span>Page Range</span>
              <select aria-label="Page range" value={range} onChange={(e) => { setRange(e.target.value as Range); setSheet(0); }}>
                <option value="all">All Pages</option>
                <option value="current">Current ({d.loaded.pages[d.page]?.label})</option>
                <option value="selected" disabled={!selectedPages(d).length}>Selected ({selectedPages(d).length})</option>
                <option value="custom">Custom</option>
              </select>
              {range === 'custom' && <input aria-label="Custom pages" value={custom} onChange={(e) => { setCustom(e.target.value); setSheet(0); }} placeholder="1-3, 5, 9" style={{ width: 110 }} />}
            </div>
            <FilesRow all={all} setAll={setAll} />
            <div className="form-row"><span>Print</span>
              <select aria-label="Print content" value={o.content} onChange={(e) => set({ content: e.target.value as Content })}>
                <option value="both">Document &amp; Markups</option>
                <option value="document">Document Only</option>
                <option value="markups">Markups Only</option>
              </select>
            </div>
            <div className="form-row"><span>Size</span>
              <select aria-label="Paper size" value={o.paper} onChange={(e) => set({ paper: e.target.value })}>
                <option value="auto">Auto (page size)</option>
                {PAPER_SIZES.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
              </select>
              <select aria-label="Orientation" disabled={!fixedPaper} value={o.orientation} onChange={(e) => set({ orientation: e.target.value as PrintOptions['orientation'] })}>
                <option value="portrait">Portrait</option>
                <option value="landscape">Landscape</option>
              </select>
            </div>
            <div className="form-row"><span>Page Scaling</span>
              <select aria-label="Page scaling" disabled={!fixedPaper} value={o.scaling} onChange={(e) => set({ scaling: e.target.value as PrintOptions['scaling'] })}>
                <option value="none">None</option>
                <option value="fit">Fit to Paper</option>
                <option value="reduce">Reduce to Paper</option>
                <option value="fitMargins">Fit to Margins</option>
                <option value="reduceMargins">Reduce to Margins</option>
                <option value="custom">Custom Scale</option>
              </select>
              {o.scaling === 'custom' && fixedPaper && <><input aria-label="Custom scale" type="number" min={1} max={1000} value={o.customScale} onChange={(e) => set({ customScale: Number(e.target.value) || 100 })} style={{ width: 64 }} />%</>}
            </div>
            <div className="form-row"><span>Pages per Sheet</span>
              <select aria-label="Pages per sheet" disabled={!fixedPaper} value={o.perSheet} onChange={(e) => set({ perSheet: Number(e.target.value) })}>
                {[1, 2, 4, 6, 9, 16].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
              <label><input type="checkbox" disabled={!fixedPaper} checked={o.autoRotate} onChange={(e) => set({ autoRotate: e.target.checked })} /> Auto-rotate</label>
              <label><input type="checkbox" disabled={!fixedPaper} checked={o.center} onChange={(e) => set({ center: e.target.checked })} /> Center</label>
            </div>
            <div className="form-row"><span>Margins</span>
              <Margins value={o.margins} unit={unit} disabled={!fixedPaper} onChange={(margins) => set({ margins })} />
              <select aria-label="Margin unit" value={unit} onChange={(e) => setUnit(e.target.value as 'in' | 'mm')}><option value="in">in</option><option value="mm">mm</option></select>
            </div>
            <div className="form-row"><span>Copies</span>
              <input aria-label="Copies" type="number" min={1} max={99} value={o.copies} onChange={(e) => set({ copies: Math.max(1, Math.min(99, Number(e.target.value) || 1)) })} style={{ width: 56 }} />
              <label><input type="checkbox" disabled={o.copies < 2} checked={o.collate} onChange={(e) => set({ collate: e.target.checked })} /> Collate</label>
              <label><input type="checkbox" checked={o.reverse} onChange={(e) => set({ reverse: e.target.checked })} /> Reverse</label>
            </div>
            <div className="form-row"><span>Options</span>
              <label><input type="checkbox" disabled={o.content !== 'both'} checked={o.dim} onChange={(e) => set({ dim: e.target.checked })} /> Dim Page Content</label>
            </div>
            <div className="form-row"><span>Quality</span>
              <select aria-label="Print quality" value={o.dpi} onChange={(e) => set({ dpi: Number(e.target.value) })}>
                <option value={150}>Standard (150 dpi)</option>
                <option value={300}>High (300 dpi)</option>
              </select>
            </div>
            <p className="muted small">Hidden layers, and layers whose Print setting is off, are not printed. Set the browser dialog's margins to None for true-scale prints.</p>
            <div className="modal-actions">
              <button onClick={() => { setO(DEFAULTS); setRange('all'); setSheet(0); }}>Defaults</button>
              <span className="spacer" />
              <button className="primary" disabled={!pages.length} onClick={ok}>Print</button>
              <button onClick={close}>Cancel</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Top/right/bottom/left margin fields, shown in inches or millimetres, kept in points. */
function Margins({ value, unit, disabled, onChange }: { value: [number, number, number, number]; unit: 'in' | 'mm'; disabled: boolean; onChange: (m: [number, number, number, number]) => void }) {
  const k = unit === 'in' ? 72 : 72 / 25.4, step = unit === 'in' ? 0.05 : 1;
  const names = ['Top', 'Right', 'Bottom', 'Left'];
  return (
    <span className="print-margins">
      {value.map((v, i) => (
        <input key={names[i]} aria-label={`${names[i]} margin`} title={names[i]} type="number" min={0} step={step} disabled={disabled}
          value={Math.round((v / k) * 100) / 100}
          onChange={(e) => { const m = [...value] as [number, number, number, number]; m[i] = Math.max(0, Number(e.target.value) || 0) * k; onChange(m); }}
          style={{ width: 52 }} />
      ))}
    </span>
  );
}

/** The sheet as it will print: paper, and each page's thumbnail in its place. */
function Preview({ d, sheet, margins }: { d: DocState; sheet?: Sheet; margins?: [number, number, number, number] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c || !sheet) return;
    let stop = false;
    const box = 220, k = box / Math.max(sheet.w, sheet.h);
    c.width = Math.round(sheet.w * k); c.height = Math.round(sheet.h * k);
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    (async () => {
      for (const it of sheet.items) {
        const p = await d.loaded.pdf.getPage(it.page + 1);
        if (stop) return;
        const vp = p.getViewport({ scale: it.scale * k, rotation: (p.rotate + it.rotate) % 360 });
        const t = document.createElement('canvas');
        t.width = Math.max(1, Math.round(vp.width)); t.height = Math.max(1, Math.round(vp.height));
        await p.render({ canvas: t, viewport: vp, annotationMode: 1 }).promise.catch(() => undefined);
        if (stop) return;
        ctx.save();
        ctx.beginPath(); ctx.rect(0, 0, c.width, c.height); ctx.clip();
        ctx.drawImage(t, it.x * k, it.y * k);
        ctx.strokeStyle = '#c00'; ctx.lineWidth = 1; ctx.strokeRect(it.x * k, it.y * k, it.w * k, it.h * k);
        ctx.restore();
      }
      if (margins) {
        const [mt, mr, mb, ml] = margins;
        ctx.setLineDash([3, 3]); ctx.strokeStyle = '#999'; ctx.lineWidth = 1;
        ctx.strokeRect(ml * k, mt * k, (sheet.w - ml - mr) * k, (sheet.h - mt - mb) * k);
        ctx.setLineDash([]);
      }
    })();
    return () => { stop = true; };
  }, [d, sheet, margins]);
  return <canvas ref={ref} className="print-canvas" aria-label="Print preview" />;
}
