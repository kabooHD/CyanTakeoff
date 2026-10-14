// Capture (Revu): photos embedded in a markup. Added from a file or the
// camera in Properties, listed as a Capture column, previewed on double-click.
import { useEffect } from 'react';
import { create } from 'zustand';
import { useApp, type DocState } from '../model/store';
import type { Markup } from '../model/types';
import type { MenuItem } from './ContextMenu';

export interface CaptureItem { name: string; data: string }
export const useCapturePreview = create<{ item: CaptureItem | null; items: CaptureItem[]; index: number; markupId?: string }>(() => ({ item: null, items: [], index: 0 }));

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
  attachCapture(m.id, item);
  void doc;
}

/** Attach a photo to a markup; Revu names media after the markup's Subject, numbered. */
export function attachCapture(markupId: string, item: CaptureItem) {
  const s = useApp.getState();
  const d = s.docs.find((x) => x.id === s.activeId);
  const m = d?.markups.find((x) => x.id === markupId);
  if (!m) return;
  const n = (m.capture?.length ?? 0) + 1;
  const ext = /\.(jpe?g|png|gif|webp)$/i.exec(item.name)?.[0]?.toLowerCase() ?? '.jpg';
  const name = `${m.subject || 'Markup'}${n > 1 ? ` ${n}` : ''}${ext}`;
  s.updateMarkups([markupId], (x) => ({ capture: [...(x.capture ?? []), { name, data: item.data }] }));
  s.setStatus(`Capture: ${name} attached to ${m.subject}`);
  const pv = useCapturePreview.getState();
  if (pv.item && pv.markupId === markupId) openCapturePreview([...pv.items, { name, data: item.data }], pv.items.length, markupId);
}

/** Right-click > Capture > From File: pick an image for the markup. */
export async function captureFromFile(markupId: string) {
  const input = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*' });
  const f = await new Promise<File | null>((resolve) => { input.onchange = () => resolve(input.files?.[0] ?? null); input.oncancel = () => resolve(null); input.click(); });
  if (!f) return;
  try { attachCapture(markupId, await shrinkPhoto(f)); } catch { useApp.getState().setStatus('That image could not be read.'); }
}

/** Right-click > Capture menu items (Revu: From Camera, From File; the viewer when there are photos). */
export function captureMenuItems(m: Markup, openCamera: (forMarkup: string) => void): MenuItem[] {
  return [
    { label: 'Capture › From Camera…', action: () => openCamera(m.id) },
    { label: 'Capture › From File…', action: () => captureFromFile(m.id) },
    ...(m.capture?.length ? [{ label: `Capture › View (${m.capture.length})`, action: () => openCapturePreview(m.capture!, 0, m.id) }] : []),
  ];
}

export function openCapturePreview(items: CaptureItem[], index = 0, markupId?: string) {
  if (items[index]) useCapturePreview.setState({ item: items[index], items, index, markupId });
  else useCapturePreview.setState({ item: null, items: [], index: 0, markupId });
}

/** Save every photo of a markup (one download per photo). */
function exportAll(items: CaptureItem[]) {
  for (const it of items) {
    const a = Object.assign(document.createElement('a'), { href: it.data, download: it.name });
    document.body.appendChild(a); a.click(); a.remove();
  }
}

export function CapturePreview() {
  const { item, items, index, markupId } = useCapturePreview();
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
  const remove = () => {
    if (!markupId) return;
    useApp.getState().updateMarkups([markupId], (x) => ({ capture: x.capture?.filter((_, k) => k !== index) }));
    const rest = items.filter((_, k) => k !== index);
    openCapturePreview(rest, Math.min(index, rest.length - 1), markupId);
  };
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal" role="dialog" aria-label="Capture" tabIndex={-1} ref={(el) => el?.focus()} onKeyDown={(e) => e.stopPropagation()}>
        <div className="modal-title">{item.name} {items.length > 1 ? `(${index + 1} of ${items.length})` : ''}</div>
        <div className="scale-dialog">
          <img src={item.data} alt={item.name} style={{ maxWidth: '80vw', maxHeight: '70vh' }} />
          <div className="modal-actions">
            {items.length > 1 && <><button onClick={() => go(-1)}>‹ Previous</button><button onClick={() => go(1)}>Next ›</button></>}
            <span className="spacer" />
            {markupId && <button onClick={() => captureFromFile(markupId)}>Add from File…</button>}
            {markupId && <button onClick={remove}>Delete</button>}
            <a className="button" href={item.data} download={item.name}>Export</a>
            {items.length > 1 && <button onClick={() => exportAll(items)}>Export All</button>}
            <button onClick={close}>Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}
