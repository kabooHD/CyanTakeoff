// Capture (Revu): photos embedded in a markup. Added from a file or the
// camera in Properties, listed as a Capture column, previewed on double-click.
import { useEffect } from 'react';
import { create } from 'zustand';
import { useApp, type DocState } from '../model/store';
import type { Markup } from '../model/types';

export interface CaptureItem { name: string; data: string }
export const useCapturePreview = create<{ item: CaptureItem | null; items: CaptureItem[]; index: number }>(() => ({ item: null, items: [], index: 0 }));

/** A photo as a JPEG data URL no larger than `max` px on its long side. */
export async function shrinkPhoto(file: File, max = 1600): Promise<CaptureItem> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  const data = c.toDataURL('image/jpeg', 0.82);
  c.width = c.height = 0;
  return { name: file.name, data };
}

export async function addCapture(doc: DocState, m: Markup, file: File) {
  const item = await shrinkPhoto(file);
  useApp.getState().updateMarkups([m.id], (x) => ({ capture: [...(x.capture ?? []), item] }));
  useApp.getState().setStatus(`Capture: ${file.name} attached to ${m.subject}`);
  void doc;
}

export function openCapturePreview(items: CaptureItem[], index = 0) {
  if (items[index]) useCapturePreview.setState({ item: items[index], items, index });
}

export function CapturePreview() {
  const { item, items, index } = useCapturePreview();
  const close = () => useCapturePreview.setState({ item: null });
  const go = (d: number) => { const i = (index + d + items.length) % items.length; useCapturePreview.setState({ item: items[i], index: i }); };
  // Keys work wherever the focus is (the preview opens from a double-click in the list).
  useEffect(() => {
    if (!item) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(); else if (e.key === 'ArrowRight') go(1); else if (e.key === 'ArrowLeft') go(-1); else return;
      e.preventDefault(); e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });
  if (!item) return null;
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal" role="dialog" aria-label="Capture" tabIndex={-1} ref={(el) => el?.focus()} onKeyDown={(e) => e.stopPropagation()}>
        <div className="modal-title">{item.name} {items.length > 1 ? `(${index + 1} of ${items.length})` : ''}</div>
        <div className="scale-dialog">
          <img src={item.data} alt={item.name} style={{ maxWidth: '80vw', maxHeight: '70vh' }} />
          <div className="modal-actions">
            {items.length > 1 && <><button onClick={() => go(-1)}>‹ Previous</button><button onClick={() => go(1)}>Next ›</button></>}
            <span className="spacer" />
            <a className="button" href={item.data} download={item.name}>Save…</a>
            <button onClick={close}>Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}
