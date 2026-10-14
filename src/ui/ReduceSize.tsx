// File > Reduce File Size: options dialog; runs as an undoable document
// change and reports the size before and after.
import { useState } from 'react';
import type { PDFDocument } from 'pdf-lib';
import { create } from 'zustand';
import { useApp } from '../model/store';
import { hasSignatures } from '../pdf/incremental';
import { DEFAULT_REDUCE, compressStreams, oversizedJpegs, removeExtras, removeUnused, replaceJpeg, type ReduceOptions } from '../pdf/reduce';

export const useReduceDialog = create<{ open: boolean }>(() => ({ open: false }));
const LS = 'cyantakeoff:reduce';
const fmt = (n: number) => (n > 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Resample a JPEG in the browser. */
async function resample(jpeg: Uint8Array, w: number, h: number, quality: number): Promise<Uint8Array | null> {
  try {
    const bmp = await createImageBitmap(new Blob([jpeg as BlobPart], { type: 'image/jpeg' }), { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d')!.drawImage(bmp, 0, 0);
    bmp.close();
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', quality));
    c.width = c.height = 0;
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  } catch { return null; }
}

/** Apply the reduce options to a document and save it compactly. */
export async function reduceLib(lib: PDFDocument, o: ReduceOptions): Promise<Uint8Array> {
  removeExtras(lib, o);
  if (o.imageDpi > 0) {
    for (const im of oversizedJpegs(lib, o.imageDpi)) {
      const out = await resample(im.stream.contents, im.targetW, im.targetH, o.quality);
      if (out && out.length < im.stream.contents.length) replaceJpeg(lib, im.ref, im.stream, out, im.targetW, im.targetH);
    }
  }
  if (o.removeUnused) removeUnused(lib);
  if (o.compress) compressStreams(lib);
  return lib.save({ useObjectStreams: true });
}

export async function reduceFileSize(o: ReduceOptions) {
  const s = useApp.getState();
  const d = s.docs.find((x) => x.id === s.activeId);
  if (!d) return;
  const before = d.bytes.length;
  let after = before;
  await s.transformDoc(async (lib) => {
    if (hasSignatures(lib)) throw new Error('this file is digitally signed; reducing it would invalidate the signatures');
    const bytes = await reduceLib(lib, o);
    after = bytes.length;
    // Never make it bigger.
    return bytes.length < before ? bytes : d.bytes;
  }, 'File size reduced');
  s.setStatus(after < before ? `Reduced ${d.name}: ${fmt(before)} → ${fmt(after)} (save to keep it)` : `${d.name} is already compact (${fmt(before)})`);
}

export function ReduceDialog() {
  const open = useReduceDialog((x) => x.open);
  const [o, setO] = useState<ReduceOptions>(() => { try { return { ...DEFAULT_REDUCE, ...JSON.parse(localStorage.getItem(LS) ?? '{}') }; } catch { return DEFAULT_REDUCE; } });
  if (!open) return null;
  const close = () => useReduceDialog.setState({ open: false });
  const check = (k: keyof ReduceOptions, label: string) => (
    <div className="form-row"><label><input type="checkbox" checked={!!o[k]} onChange={(e) => setO({ ...o, [k]: e.target.checked })} /> {label}</label></div>
  );
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal" role="dialog" aria-label="Reduce File Size" onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') close(); }}>
        <div className="modal-title">Reduce File Size</div>
        <div className="scale-dialog">
          {check('removeUnused', 'Remove unused objects')}
          {check('compress', 'Compress uncompressed content')}
          {check('removeThumbnails', 'Remove page thumbnails')}
          {check('removePrivateData', 'Remove private application data')}
          {check('removeMetadata', 'Remove document metadata (XMP)')}
          <div className="form-row"><span>JPEG images</span>
            <select aria-label="Image resolution" value={o.imageDpi} onChange={(e) => setO({ ...o, imageDpi: +e.target.value })}>
              <option value={0}>Keep as they are</option>
              {[300, 200, 150, 100, 72].map((v) => <option key={v} value={v}>Downsample above {v} dpi</option>)}
            </select>
          </div>
          {o.imageDpi > 0 && (
            <div className="form-row"><span>Quality</span>
              <select aria-label="JPEG quality" value={o.quality} onChange={(e) => setO({ ...o, quality: +e.target.value })}>
                <option value={0.9}>High</option><option value={0.75}>Medium</option><option value={0.6}>Low</option>
              </select>
            </div>
          )}
          <p className="muted small">Vector drawings are never rasterised. Undo with Ctrl+Z; save to keep the smaller file.</p>
          <div className="modal-actions"><span className="spacer" />
            <button className="primary" onClick={() => { try { localStorage.setItem(LS, JSON.stringify(o)); } catch { /* storage unavailable */ } close(); reduceFileSize(o); }}>OK</button>
            <button onClick={close}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}
