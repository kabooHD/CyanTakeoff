// Document > Color Processing, Archive as PDF/A and Repair PDF (Revu).
import { useState } from 'react';
import { create } from 'zustand';
import { PDFDocument } from 'pdf-lib';
import { serialize, useApp, type DocState } from '../model/store';
import { parsePageRange } from '../model/measure';
import { hexToRgb01, pageJpegs, processPagesVector, transformPixels, type ColorMode, type ColorOptions } from '../pdf/colorProcess';
import { replaceJpeg } from '../pdf/reduce';
import { archivePdfA } from '../pdf/pdfa';
import { repairPdf } from '../pdf/repair';
import { FilesRow, batchHint, targets } from './filesRow';
import { selectedPages } from './Panels';

type Mode = 'color' | 'repair';
export const useColorProcess = create<{ open: Mode | null }>(() => ({ open: null }));
const close = () => useColorProcess.setState({ open: null });

type Range = 'all' | 'current' | 'selected' | 'custom';
const pagesOf = (d: DocState, range: Range, custom: string): number[] => {
  const n = d.loaded.pages.length;
  return range === 'all' ? Array.from({ length: n }, (_, i) => i) : range === 'current' ? [d.page] : range === 'selected' ? selectedPages(d) : parsePageRange(custom, n);
};
function PagesRow({ d, range, setRange, custom, setCustom }: { d: DocState; range: Range; setRange: (r: Range) => void; custom: string; setCustom: (v: string) => void }) {
  const sel = selectedPages(d);
  return (
    <div className="form-row"><span>Pages</span>
      <select aria-label="Pages" value={range} onChange={(e) => setRange(e.target.value as Range)}>
        <option value="all">All Pages</option><option value="current">Current ({d.loaded.pages[d.page]?.label})</option>
        {sel.length > 0 && <option value="selected">Selected ({sel.length})</option>}
        <option value="custom">Custom</option>
      </select>
      {range === 'custom' && <input aria-label="Custom pages" value={custom} placeholder="1-3, 5, 9" onChange={(e) => setCustom(e.target.value)} style={{ width: 100 }} />}
    </div>
  );
}

/** Recolour the JPEG images of `pages` (browser decode, re-encode). */
async function processImages(lib: PDFDocument, pages: number[], o: ColorOptions): Promise<number> {
  let n = 0;
  for (const { ref, stream } of pageJpegs(lib, pages)) {
    try {
      const bmp = await createImageBitmap(new Blob([stream.contents as BlobPart], { type: 'image/jpeg' }));
      const c = document.createElement('canvas');
      c.width = bmp.width; c.height = bmp.height;
      const ctx = c.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(bmp, 0, 0); bmp.close();
      const img = ctx.getImageData(0, 0, c.width, c.height);
      transformPixels(img.data, o);
      ctx.putImageData(img, 0, 0);
      const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.9));
      c.width = c.height = 0;
      if (blob) { replaceJpeg(lib, ref, stream, new Uint8Array(await blob.arrayBuffer()), img.width, img.height); n++; }
    } catch { /* undecodable image: left as it is */ }
  }
  return n;
}

export function ColorProcessDialogs() {
  const open = useColorProcess((x) => x.open);
  const d = useApp((s) => s.docs.find((x) => x.id === s.activeId));
  if (!open || !d) return null;
  return open === 'color' ? <ColorForm d={d} /> : <RepairForm d={d} />;
}

function Frame({ title, children, onOk, okDisabled, okLabel = 'OK' }: { title: string; children: React.ReactNode; onOk: () => void; okDisabled?: boolean; okLabel?: string }) {
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal" role="dialog" aria-label={title} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') close(); if (e.key === 'Enter' && !okDisabled) onOk(); }}>
        <div className="modal-title">{title}</div>
        <div className="scale-dialog">
          {children}
          <div className="modal-actions"><span className="spacer" /><button className="primary" disabled={okDisabled} onClick={onOk}>{okLabel}</button><button onClick={close}>Cancel</button></div>
        </div>
      </div>
    </div>
  );
}

const MODES: [ColorMode, string][] = [['grayscale', 'Grayscale'], ['bw', 'Black and White'], ['colorize', 'Colorize'], ['lsh', 'Luminosity, Saturation and Hue'], ['modify', 'Modify Colors']];

function ColorForm({ d }: { d: DocState }) {
  const [mode, setMode] = useState<ColorMode>('grayscale');
  const [images, setImages] = useState(false);
  const [from, setFrom] = useState('#1a4d8f');
  const [to, setTo] = useState('#ffffff');
  const [scale, setScale] = useState(true);
  const [l, setL] = useState(0);
  const [sat, setSat] = useState(0);
  const [h, setH] = useState(0);
  const [pairs, setPairs] = useState<{ from: string; to: string; tolerance: number }[]>([{ from: '#ff0000', to: '#000000', tolerance: 10 }]);
  const [range, setRange] = useState<Range>('all');
  const [custom, setCustom] = useState('');
  const [all, setAll] = useState(() => batchHint.take());
  const pages = pagesOf(d, range, custom);
  const opts = (): ColorOptions => ({
    mode, processImages: images, from: hexToRgb01(from), to: hexToRgb01(to), scale, l, s: sat, h,
    pairs: pairs.map((p) => ({ from: hexToRgb01(p.from), to: hexToRgb01(p.to), tolerance: p.tolerance / 100 })),
  });
  const ok = async () => {
    close();
    const s = useApp.getState();
    const o = opts();
    let vec = 0, img = 0;
    for (const t of targets(d, all)) {
      const tp = t === d ? pages : pagesOf(t, range, custom);
      if (!tp.length) continue;
      await s.transformDoc(async (lib) => {
        vec += processPagesVector(lib, tp, o);
        if (o.processImages) img += await processImages(lib, tp, o);
      }, 'Colors processed', undefined, undefined, t.id);
    }
    s.setStatus(`Color Processing: ${vec} colour${vec === 1 ? '' : 's'} changed${o.processImages ? `, ${img} image${img === 1 ? '' : 's'}` : ''}`);
  };
  const color = (label: string, v: string, set: (x: string) => void) => <label>{label} <input type="color" aria-label={label} value={v} onChange={(e) => set(e.target.value)} /></label>;
  const slider = (label: string, v: number, set: (x: number) => void, min: number, max: number) => (
    <div className="form-row"><span>{label}</span><input aria-label={label} type="range" min={min} max={max} value={v} onChange={(e) => set(Number(e.target.value))} /> {v}</div>
  );
  return (
    <Frame title="Color Processing" onOk={ok} okDisabled={!pages.length}>
      <div className="form-row"><span>Process Type</span>
        <select aria-label="Process type" value={mode} onChange={(e) => setMode(e.target.value as ColorMode)}>{MODES.map(([m, n]) => <option key={m} value={m}>{n}</option>)}</select>
      </div>
      {mode === 'colorize' && (
        <>
          <div className="form-row"><span>Colors</span>{color('Select Color', from, setFrom)}{scale && color('To', to, setTo)}</div>
          <div className="form-row"><label><input type="checkbox" checked={scale} onChange={(e) => setScale(e.target.checked)} /> Scale Color (dark to light)</label></div>
        </>
      )}
      {mode === 'lsh' && <>{slider('Luminosity', l, setL, -100, 100)}{slider('Saturation', sat, setSat, -100, 100)}{slider('Hue', h, setH, -180, 180)}</>}
      {mode === 'modify' && (
        <>
          {pairs.map((p, i) => (
            <div className="form-row" key={i}><span>{i ? '' : 'Source Color'}</span>
              {color(`Source ${i + 1}`, p.from, (x) => setPairs(pairs.map((q, k) => (k === i ? { ...q, from: x } : q))))}
              {color(`To ${i + 1}`, p.to, (x) => setPairs(pairs.map((q, k) => (k === i ? { ...q, to: x } : q))))}
              <label>Tolerance <input aria-label={`Tolerance ${i + 1}`} type="number" min={0} max={100} value={p.tolerance} onChange={(e) => setPairs(pairs.map((q, k) => (k === i ? { ...q, tolerance: Number(e.target.value) || 0 } : q)))} style={{ width: 56 }} />%</label>
            </div>
          ))}
          <div className="form-row"><span /><button onClick={() => setPairs([...pairs, { from: '#000000', to: '#000000', tolerance: 10 }])}>Add New</button><button disabled={pairs.length < 2} onClick={() => setPairs(pairs.slice(0, -1))}>Remove</button></div>
        </>
      )}
      {mode !== 'modify' && <div className="form-row"><label><input type="checkbox" checked={images} onChange={(e) => setImages(e.target.checked)} /> Process Images (JPEG)</label></div>}
      <PagesRow d={d} range={range} setRange={setRange} custom={custom} setCustom={setCustom} />
      <FilesRow all={all} setAll={setAll} />
      <p className="muted small">Vector drawings and text are recoloured in the file; undo with Ctrl+Z. {mode === 'lsh' ? 'Luminosity and Saturation in percent, Hue in degrees.' : ''}</p>
    </Frame>
  );
}

function RepairForm({ d }: { d: DocState }) {
  const [range, setRange] = useState<Range>('all');
  const [custom, setCustom] = useState('');
  const [all, setAll] = useState(() => batchHint.take());
  const pages = pagesOf(d, range, custom);
  const ok = async () => {
    close();
    const s = useApp.getState();
    const notes: string[] = [];
    for (const t of targets(d, all)) {
      const tp = t === d ? pages : pagesOf(t, range, custom);
      if (!tp.length) continue;
      await s.transformDoc(async (lib) => {
        const st = repairPdf(lib, tp);
        notes.push(`${t.name}: ${st.annotsDropped} broken annotation${st.annotsDropped === 1 ? '' : 's'}, ${st.statesClosed} open graphics state${st.statesClosed === 1 ? '' : 's'} fixed, structure rebuilt`);
        return lib.save({ useObjectStreams: false });
      }, 'PDF repaired', undefined, undefined, t.id);
    }
    s.setStatus(`Repair PDF: ${notes.join('; ')}`);
  };
  return (
    <Frame title="Repair PDF" onOk={ok} okDisabled={!pages.length}>
      <p className="muted small">Rebuilds the file structure, drops broken entries from page annotation and content lists and closes graphics states left open, which cures most display problems. Markups flattened on these pages can no longer be unflattened (as in Revu).</p>
      <PagesRow d={d} range={range} setRange={setRange} custom={custom} setCustom={setCustom} />
      <FilesRow all={all} setAll={setAll} />
    </Frame>
  );
}

/** Document > Archive as PDF/A: a copy marked PDF/A-1b is downloaded; the status says what may still fail a validator. */
export async function archiveAsPdfA() {
  const s = useApp.getState();
  const d = s.docs.find((x) => x.id === s.activeId);
  if (!d) return;
  if (d.security || d.securityChange) { s.setStatus('Archive as PDF/A: remove the password security first (PDF/A files cannot be encrypted).'); return; }
  s.setStatus('Archive as PDF/A: preparing…');
  try {
    const lib = await PDFDocument.load(await serialize(d), { updateMetadata: false });
    const rep = archivePdfA(lib, d.name.replace(/\.pdf$/i, ''));
    const bytes = await lib.save({ useObjectStreams: false });
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
    Object.assign(document.createElement('a'), { href: url, download: `${d.name.replace(/\.pdf$/i, '')} (PDF-A).pdf` }).click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    const warn = [
      rep.fontsNotEmbedded.length ? `${rep.fontsNotEmbedded.length} font${rep.fontsNotEmbedded.length === 1 ? '' : 's'} not embedded (${rep.fontsNotEmbedded.slice(0, 3).join(', ')})` : '',
      rep.transparency ? `${rep.transparency} transparency item${rep.transparency === 1 ? '' : 's'}` : '',
      rep.javascript ? 'JavaScript' : '',
    ].filter(Boolean);
    s.setStatus(`Archived as PDF/A-1b${warn.length ? `; a strict validator may object to: ${warn.join(', ')}` : ''}`);
  } catch (e) { s.setStatus(`Archive as PDF/A failed: ${(e as Error).message}`); }
}
