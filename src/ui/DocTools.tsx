// File > New PDF (blank pages or images), Document > Crop Pages
// (Shift+Alt+O), Deskew (Ctrl+Alt+D), File > Email (Ctrl+E) and Publish as
// Compressed (Ctrl+Shift+P).
import { useState } from 'react';
import { create } from 'zustand';
import { PDFDocument } from 'pdf-lib';
import { activeDoc, serialize, useApp, type DocState } from '../model/store';
import { parsePageRange } from '../model/measure';
import { estimateSkew } from '../model/deskew';
import { PAPER, blankPdf, cropPages, imagesToPdf, rotateContent } from '../pdf/docTools';
import { hasSignatures } from '../pdf/incremental';
import { DEFAULT_REDUCE } from '../pdf/reduce';
import { reduceLib } from './ReduceSize';
import { pickRect } from './pickRect';
import type { Pt } from '../model/types';

export const useDocTools = create<{ open: 'new' | 'crop' | 'deskew' | null; cropRect?: { page: number; a: Pt; b: Pt } }>(() => ({ open: null }));

const base = (name: string) => name.replace(/\.pdf$/i, '');
function download(bytes: Uint8Array, name: string) {
  const href = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
  Object.assign(document.createElement('a'), { href, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

function Frame({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label={title} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') onClose(); }}>
        <div className="modal-title">{title}</div>
        <div className="scale-dialog">{children}</div>
      </div>
    </div>
  );
}

type Range = 'current' | 'all' | 'custom';
function PageRange({ d, range, setRange, custom, setCustom }: { d: DocState; range: Range; setRange: (r: Range) => void; custom: string; setCustom: (s: string) => void }) {
  return (
    <div className="form-row"><span>Pages</span>
      <select aria-label="Page range" value={range} onChange={(e) => setRange(e.target.value as Range)}>
        <option value="current">Current page ({d.loaded.pages[d.page].label})</option><option value="all">All pages</option><option value="custom">Pages…</option>
      </select>
      {range === 'custom' && <input aria-label="Custom pages" placeholder="1-3, 5" value={custom} onChange={(e) => setCustom(e.target.value)} style={{ width: 90 }} />}
    </div>
  );
}
const pagesOf = (d: DocState, range: Range, custom: string) =>
  range === 'current' ? [d.page] : range === 'all' ? d.loaded.pages.map((_, i) => i) : parsePageRange(custom, d.loaded.pages.length);

export function DocToolsDialogs() {
  const open = useDocTools((x) => x.open);
  const d = useApp((s) => s.docs.find((x) => x.id === s.activeId));
  if (open === 'new') return <NewPdfDialog />;
  if (!d) return null;
  if (open === 'crop') return <CropDialog d={d} />;
  if (open === 'deskew') return <DeskewDialog d={d} />;
  return null;
}

// ---------- New PDF ----------

async function readImage(f: File): Promise<{ bytes: Uint8Array; type: 'jpg' | 'png'; w: number; h: number } | null> {
  try {
    const bmp = await createImageBitmap(f);
    const w = bmp.width, h = bmp.height;
    let bytes = new Uint8Array(await f.arrayBuffer());
    let type: 'jpg' | 'png' = /jpe?g/i.test(f.type) ? 'jpg' : 'png';
    if (!/jpe?g|png/i.test(f.type)) {
      // Other formats (WebP, GIF, BMP...) go through a canvas as PNG.
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d')!.drawImage(bmp, 0, 0);
      bytes = new Uint8Array(await (await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/png'))).arrayBuffer());
      type = 'png';
    }
    bmp.close();
    return { bytes, type, w, h };
  } catch { return null; }
}

function NewPdfDialog() {
  const [paper, setPaper] = useState('ARCH D (24×36)');
  const [landscape, setLandscape] = useState(true);
  const [count, setCount] = useState(1);
  const [dpi, setDpi] = useState(150);
  const [files, setFiles] = useState<File[]>([]);
  const close = () => useDocTools.setState({ open: null });
  const create_ = async (fromImages: boolean) => {
    const s = useApp.getState();
    close();
    if (fromImages) {
      const imgs = (await Promise.all(files.map(readImage))).filter((x) => x !== null);
      if (!imgs.length) { s.setStatus('None of the images could be read.'); return; }
      await s.openBytes(await imagesToPdf(imgs, dpi), files.length === 1 ? `${files[0].name.replace(/\.[^.]+$/, '')}.pdf` : 'Images.pdf');
    } else {
      const [w, h] = PAPER[paper];
      await s.openBytes(await blankPdf(count, landscape ? Math.max(w, h) : Math.min(w, h), landscape ? Math.min(w, h) : Math.max(w, h)), 'Untitled.pdf');
    }
    const d = activeDoc();
    if (d) useApp.setState((st) => ({ docs: st.docs.map((x) => (x.id === d.id ? { ...x, dirty: true } : x)) }));
  };
  return (
    <Frame title="New PDF" onClose={close}>
      <div className="links-head">Blank pages</div>
      <div className="form-row"><span>Size</span><select aria-label="Paper size" value={paper} onChange={(e) => setPaper(e.target.value)}>{Object.keys(PAPER).map((k) => <option key={k}>{k}</option>)}</select></div>
      <div className="form-row"><span>Orientation</span><select aria-label="Orientation" value={landscape ? 'l' : 'p'} onChange={(e) => setLandscape(e.target.value === 'l')}><option value="l">Landscape</option><option value="p">Portrait</option></select></div>
      <div className="form-row"><span>Pages</span><input type="number" aria-label="Number of pages" min={1} max={500} value={count} onChange={(e) => setCount(Math.max(1, Number(e.target.value) || 1))} style={{ width: 70 }} /></div>
      <div className="modal-actions"><span className="spacer" /><button className="primary" onClick={() => create_(false)}>Create Blank PDF</button></div>
      <div className="links-head">From images</div>
      <div className="form-row"><input type="file" aria-label="Images" accept="image/*" multiple onChange={(e) => setFiles(Array.from(e.target.files ?? []))} /></div>
      <div className="form-row"><span>Resolution</span><input type="number" aria-label="Image resolution" min={36} max={1200} value={dpi} onChange={(e) => setDpi(Number(e.target.value) || 150)} style={{ width: 70 }} /> dpi (sets the page size)</div>
      <div className="modal-actions"><span className="spacer" /><button className="primary" disabled={!files.length} onClick={() => create_(true)}>Create from {files.length || ''} Image{files.length === 1 ? '' : 's'}</button><button onClick={close}>Cancel</button></div>
    </Frame>
  );
}

// ---------- Crop Pages ----------

function CropDialog({ d }: { d: DocState }) {
  const rect = useDocTools((x) => x.cropRect);
  const [range, setRange] = useState<Range>('current');
  const [custom, setCustom] = useState('');
  const [mode, setMode] = useState<'rect' | 'margins'>(rect ? 'rect' : 'margins');
  const [m, setM] = useState({ left: 0.5, bottom: 0.5, right: 0.5, top: 0.5 });
  const close = () => useDocTools.setState({ open: null, cropRect: undefined });
  const pages = pagesOf(d, range, custom);
  const draw = () => {
    useDocTools.setState({ open: null });
    pickRect('Crop Pages: drag the area to keep', (_doc, page, a, b) => useDocTools.setState({ open: 'crop', cropRect: { page, a, b } }));
  };
  const run = async (remove = false) => {
    const s = useApp.getState();
    let n = 0;
    let how: Parameters<typeof cropPages>[2] = null;
    if (!remove && mode === 'rect' && rect) {
      const vp = d.loaded.pages[rect.page].viewport;
      const [x0, y0] = vp.convertToPdfPoint(rect.a.x, rect.a.y), [x1, y1] = vp.convertToPdfPoint(rect.b.x, rect.b.y);
      how = { rect: [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)] };
    } else if (!remove) how = { margins: [m.left * 72, m.bottom * 72, m.right * 72, m.top * 72] };
    close();
    await s.transformDoc((lib) => { n = cropPages(lib, pages, how); }, remove ? 'Crop removed' : 'Pages cropped');
    s.setStatus(remove ? `Crop removed from ${n} page${n === 1 ? '' : 's'}` : `Cropped ${n} page${n === 1 ? '' : 's'}`);
  };
  const num = (k: keyof typeof m, label: string) => (
    <label className="inline">{label} <input type="number" aria-label={`Crop ${label}`} step={0.125} min={0} value={m[k]} onChange={(e) => { setM({ ...m, [k]: Number(e.target.value) || 0 }); setMode('margins'); }} style={{ width: 60 }} /></label>
  );
  return (
    <Frame title="Crop Pages" onClose={close}>
      <PageRange d={d} range={range} setRange={setRange} custom={custom} setCustom={setCustom} />
      <div className="form-row"><label><input type="radio" checked={mode === 'rect'} disabled={!rect} onChange={() => setMode('rect')} /> Rectangle{rect ? ` drawn on ${d.loaded.pages[rect.page]?.label}` : ''}</label><button onClick={draw}>Draw Rectangle</button></div>
      <div className="form-row"><label><input type="radio" checked={mode === 'margins'} onChange={() => setMode('margins')} /> Trim margins (in)</label></div>
      <div className="form-row crop-margins">{num('left', 'Left')}{num('right', 'Right')}{num('top', 'Top')}{num('bottom', 'Bottom')}</div>
      <p className="muted small">Cropping hides what is outside; nothing is deleted, and Remove Crop shows it again.</p>
      <div className="modal-actions"><button onClick={() => run(true)} disabled={!pages.length}>Remove Crop</button><span className="spacer" /><button className="primary" disabled={!pages.length} onClick={() => run()}>Crop</button><button onClick={close}>Cancel</button></div>
    </Frame>
  );
}

// ---------- Deskew ----------

async function pageSkew(d: DocState, index: number): Promise<number> {
  const p = await d.loaded.pdf.getPage(index + 1);
  const v1 = p.getViewport({ scale: 1 });
  const vp = p.getViewport({ scale: Math.min(1200 / Math.max(v1.width, v1.height), 2) });
  const c = document.createElement('canvas');
  c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  await p.render({ canvas: c, viewport: vp, annotationMode: 0 }).promise;
  const px = ctx.getImageData(0, 0, c.width, c.height).data;
  const dark = new Uint8Array(c.width * c.height);
  for (let i = 0; i < dark.length; i++) dark[i] = px[i * 4] + px[i * 4 + 1] + px[i * 4 + 2] < 384 ? 1 : 0;
  c.width = c.height = 0;
  p.cleanup();
  return estimateSkew(dark, vp.width | 0, vp.height | 0);
}

function DeskewDialog({ d }: { d: DocState }) {
  const [range, setRange] = useState<Range>('all');
  const [custom, setCustom] = useState('');
  const close = () => useDocTools.setState({ open: null });
  const pages = pagesOf(d, range, custom);
  const run = async () => {
    const s = useApp.getState();
    close();
    s.setStatus('Deskew: measuring…');
    const angles: [number, number][] = [];
    for (const i of pages) {
      const a = await pageSkew(d, i);
      if (Math.abs(a) >= 0.1 && Math.abs(a) < 10) angles.push([i, a]);
    }
    if (!angles.length) { s.setStatus('Deskew: the pages are already straight'); return; }
    await s.transformDoc((lib) => { for (const [i, a] of angles) rotateContent(lib, i, a); }, 'Deskewed');
    s.setStatus(`Deskewed ${angles.length} page${angles.length === 1 ? '' : 's'} (${angles.map(([i, a]) => `${d.loaded.pages[i].label}: ${a.toFixed(1)}°`).join(', ')})`);
  };
  return (
    <Frame title="Deskew" onClose={close}>
      <PageRange d={d} range={range} setRange={setRange} custom={custom} setCustom={setCustom} />
      <p className="muted small">Straightens scanned pages whose lines of text or drawing are tilted (up to 10°). Run it before adding markups.</p>
      <div className="modal-actions"><span className="spacer" /><button className="primary" disabled={!pages.length} onClick={run}>Deskew</button><button onClick={close}>Cancel</button></div>
    </Frame>
  );
}

// ---------- Email, Publish ----------

/** Send the document: the system share sheet with the file where the browser has one, else download and an email draft. */
export async function emailDocument() {
  const s = useApp.getState(), d = activeDoc();
  if (!d) return;
  const bytes = await serialize(d);
  const file = new File([bytes as BlobPart], d.name, { type: 'application/pdf' });
  const nav = navigator as Navigator & { canShare?: (x: object) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: d.name }); return; } catch (e) { if ((e as Error).name === 'AbortError') return; }
  }
  download(bytes, d.name);
  location.href = `mailto:?subject=${encodeURIComponent(d.name)}&body=${encodeURIComponent(`Please find ${d.name} attached.`)}`;
  s.setStatus(`${d.name} was downloaded; attach it to the email that opened.`);
}

/** Save a compressed copy (images resampled to 150 dpi, unused data removed); the open document is unchanged. */
export async function publishCompressed() {
  const s = useApp.getState(), d = activeDoc();
  if (!d) return;
  s.setStatus('Publishing a compressed copy…');
  const bytes = await serialize(d);
  const lib = await PDFDocument.load(bytes, { updateMetadata: false });
  if (hasSignatures(lib)) { s.setStatus('This file is digitally signed; a compressed copy would invalidate the signatures.'); return; }
  const out = await reduceLib(lib, { ...DEFAULT_REDUCE, removeThumbnails: true, removePrivateData: true, imageDpi: 150, quality: 0.7 });
  const best = out.length < bytes.length ? out : bytes;
  download(best, `${base(d.name)} (compressed).pdf`);
  s.setStatus(`Published ${base(d.name)} (compressed).pdf: ${Math.round(bytes.length / 1024)} KB → ${Math.round(best.length / 1024)} KB`);
}
