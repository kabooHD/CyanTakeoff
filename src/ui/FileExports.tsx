// File > Export as Image (PNG/JPEG per page), Export Text, Publish as
// Flattened / Uncompressed (Revu's Publish As).
import { useState } from 'react';
import { create } from 'zustand';
import { PDFDocument } from 'pdf-lib';
import { serialize, useApp, type DocState } from '../model/store';
import { parsePageRange } from '../model/measure';
import { flattenPage } from '../pdf/pages';
import { hasSignatures } from '../pdf/incremental';
import { pageText, snapshot } from './toolActions';
import { markupShown } from './layersView';

const active = () => { const s = useApp.getState(); return s.docs.find((d) => d.id === s.activeId); };
const stem = (d: DocState) => d.name.replace(/\.pdf$/i, '');
function download(name: string, data: Blob | string, type = 'application/octet-stream') {
  const url = URL.createObjectURL(typeof data === 'string' ? new Blob([data], { type }) : data);
  Object.assign(document.createElement('a'), { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const useExportImage = create<{ open: boolean }>(() => ({ open: false }));

export function ExportImageDialog() {
  const open = useExportImage((x) => x.open);
  const d = useApp((s) => s.docs.find((x) => x.id === s.activeId));
  const [format, setFormat] = useState<'png' | 'jpeg'>('png');
  const [dpi, setDpi] = useState('150');
  const [range, setRange] = useState<'all' | 'current' | 'custom'>('current');
  const [custom, setCustom] = useState('1');
  const [withMarkups, setWithMarkups] = useState(true);
  if (!open || !d) return null;
  const close = () => useExportImage.setState({ open: false });
  const n = d.loaded.pages.length;
  const pages = range === 'all' ? Array.from({ length: n }, (_, i) => i) : range === 'current' ? [d.page] : parsePageRange(custom, n);
  const ok = async () => {
    close();
    const s = useApp.getState();
    const k = Math.max(36, Math.min(600, Number(dpi) || 150)) / 72;
    let done = 0;
    for (const p of pages) {
      const info = d.loaded.pages[p];
      s.setStatus(`Exporting page ${info.label} as ${format.toUpperCase()}…`);
      const pdfPage = await d.loaded.pdf.getPage(p + 1);
      const url = await snapshot(pdfPage, { x: 0, y: 0 }, { x: info.width, y: info.height }, k, withMarkups ? d.markups.filter((m) => m.page === p && markupShown(d, m)) : null);
      const blob = await (await fetch(url)).blob();
      const out = format === 'png' ? blob : await new Promise<Blob>((res) => { const im = new Image(); im.onload = () => { const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const cx = c.getContext('2d')!; cx.fillStyle = '#fff'; cx.fillRect(0, 0, c.width, c.height); cx.drawImage(im, 0, 0); c.toBlob((b) => res(b ?? blob), 'image/jpeg', 0.9); }; im.src = url; });
      download(`${stem(d)} - ${info.label}.${format === 'png' ? 'png' : 'jpg'}`, out);
      done++;
      await new Promise((r) => setTimeout(r, 300)); // browsers throttle rapid downloads
    }
    s.setStatus(`Exported ${done} page${done === 1 ? '' : 's'} as ${format.toUpperCase()}`);
  };
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal" role="dialog" aria-label="Export as Image" onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') close(); if (e.key === 'Enter') ok(); }}>
        <div className="modal-title">Export as Image</div>
        <div className="scale-dialog">
          <div className="form-row"><span>Format</span>
            <select aria-label="Image format" value={format} onChange={(e) => setFormat(e.target.value as 'png')}><option value="png">PNG</option><option value="jpeg">JPEG</option></select>
            <label>Resolution <input aria-label="Resolution" type="number" min={36} max={600} value={dpi} onChange={(e) => setDpi(e.target.value)} style={{ width: 64 }} /> dpi</label>
          </div>
          <div className="form-row"><label><input type="checkbox" checked={withMarkups} onChange={(e) => setWithMarkups(e.target.checked)} /> Include markups</label></div>
          <div className="form-row"><span>Pages</span>
            <select aria-label="Pages" value={range} onChange={(e) => setRange(e.target.value as typeof range)}>
              <option value="all">All Pages</option><option value="current">Current ({d.loaded.pages[d.page]?.label})</option><option value="custom">Custom</option>
            </select>
            {range === 'custom' && <input aria-label="Custom pages" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="1-3, 5, 9" style={{ width: 100 }} />}
          </div>
          <p className="muted small">One image file per page.</p>
          <div className="modal-actions"><span className="spacer" /><button className="primary" disabled={!pages.length} onClick={ok}>Export</button><button onClick={close}>Cancel</button></div>
        </div>
      </div>
    </div>
  );
}

/** File > Export > Text: the text of every page, pages separated by a form feed line. */
export async function exportText() {
  const d = active();
  if (!d) return;
  const s = useApp.getState();
  const parts: string[] = [];
  for (const info of d.loaded.pages) {
    const boxes = await pageText(await d.loaded.pdf.getPage(info.index + 1), info.viewport);
    // Runs in reading order: top to bottom, then left to right; a new line when the baseline moves.
    const sorted = [...boxes].sort((p, q) => (Math.abs(p.y0 - q.y0) > (p.y1 - p.y0) * 0.5 ? p.y0 - q.y0 : p.x0 - q.x0));
    let line = '', lastY = NaN, lastX = 0;
    const lines: string[] = [];
    for (const b of sorted) {
      if (!Number.isNaN(lastY) && Math.abs(b.y0 - lastY) > (b.y1 - b.y0) * 0.5) { lines.push(line); line = ''; }
      else if (line && b.x0 - lastX > (b.y1 - b.y0) * 0.3) line += ' ';
      line += b.str; lastY = b.y0; lastX = b.x1;
    }
    if (line) lines.push(line);
    parts.push(`--- Page ${info.label} ---\n${lines.join('\n')}`);
  }
  download(`${stem(d)}.txt`, parts.join('\n\n'), 'text/plain');
  s.setStatus(`Exported the text of ${d.loaded.pages.length} page${d.loaded.pages.length === 1 ? '' : 's'}`);
}

/** File > Publish As > Flattened: a copy with every markup merged into the page content. */
export async function publishFlattened() {
  const d = active();
  if (!d) return;
  const s = useApp.getState();
  s.setStatus('Publishing a flattened copy…');
  try {
    const lib = await PDFDocument.load(await serialize(d), { updateMetadata: false });
    if (hasSignatures(lib)) { s.setStatus('This file is digitally signed; flattening would invalidate the signatures.'); return; }
    let n = 0;
    for (const p of lib.getPages()) n += flattenPage(lib, p);
    download(`${stem(d)} (flattened).pdf`, new Blob([await lib.save({ useObjectStreams: false }) as BlobPart], { type: 'application/pdf' }));
    s.setStatus(`Published ${stem(d)} (flattened).pdf: ${n} markup${n === 1 ? '' : 's'} flattened`);
  } catch (e) { s.setStatus(`Publish failed: ${(e as Error).message}`); }
}

/** File > Publish As > Uncompressed: a copy saved as a plain PDF (no object streams, earlier revisions merged). */
export async function publishUncompressed() {
  const d = active();
  if (!d) return;
  const s = useApp.getState();
  try {
    const lib = await PDFDocument.load(await serialize(d), { updateMetadata: false });
    if (hasSignatures(lib)) { s.setStatus('This file is digitally signed; rewriting it would invalidate the signatures.'); return; }
    download(`${stem(d)} (uncompressed).pdf`, new Blob([await lib.save({ useObjectStreams: false }) as BlobPart], { type: 'application/pdf' }));
    s.setStatus(`Published ${stem(d)} (uncompressed).pdf`);
  } catch (e) { s.setStatus(`Publish failed: ${(e as Error).message}`); }
}
