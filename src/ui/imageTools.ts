// Image markup settings (Revu: Properties on an Image): Mask Color with a
// tolerance, and the encoding the picture is stored with (ZIP = PNG for
// graphics, JPEG for photos). The untouched picture is kept so the mask
// can be changed or removed.
import { applyMask, type ImageMask } from '../model/imageMask';
import { useApp } from '../model/store';
import type { Markup } from '../model/types';

const load = (url: string) => new Promise<HTMLImageElement>((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error('image')); img.src = url; });

/** The picture drawn on a canvas. */
async function canvasOf(url: string): Promise<HTMLCanvasElement> {
  const img = await load(url);
  const c = document.createElement('canvas');
  c.width = img.naturalWidth || 1; c.height = img.naturalHeight || 1;
  c.getContext('2d')!.drawImage(img, 0, 0);
  return c;
}

/** The picture with the mask applied, as a PNG data URL (PNG keeps the transparency). */
export async function maskedImage(url: string, mask: ImageMask): Promise<string> {
  const c = await canvasOf(url);
  const ctx = c.getContext('2d')!;
  const data = ctx.getImageData(0, 0, c.width, c.height);
  applyMask(data.data, mask);
  ctx.putImageData(data, 0, 0);
  return c.toDataURL('image/png');
}

/** The picture re-encoded: JPEG (photos, no transparency) or PNG ("ZIP", graphics). */
export async function encodedImage(url: string, encoding: 'zip' | 'jpeg'): Promise<string> {
  if (encoding === 'jpeg' && url.startsWith('data:image/jpeg')) return url;
  if (encoding === 'zip' && url.startsWith('data:image/png')) return url;
  const c = await canvasOf(url);
  if (encoding === 'jpeg') {
    // JPEG has no alpha: transparent pixels become white.
    const flat = document.createElement('canvas');
    flat.width = c.width; flat.height = c.height;
    const ctx = flat.getContext('2d')!;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, flat.width, flat.height); ctx.drawImage(c, 0, 0);
    return flat.toDataURL('image/jpeg', 0.9);
  }
  return c.toDataURL('image/png');
}

/** Apply new image settings to a markup: the displayed picture is rebuilt from the untouched source. */
export async function setImageSettings(id: string, patch: { mask?: ImageMask | null; imageEncoding?: 'zip' | 'jpeg' }) {
  const s = useApp.getState();
  const d = s.docs.find((x) => x.id === s.activeId);
  const m = d?.markups.find((x) => x.id === id);
  if (!m || !m.image) return;
  const source = m.imageSource ?? m.image;
  const mask = patch.mask === undefined ? m.mask : patch.mask ?? undefined;
  const encoding = patch.imageEncoding ?? m.imageEncoding ?? (source.startsWith('data:image/jpeg') ? 'jpeg' : 'zip');
  // The settings show at once (one undo step); the rebuilt picture follows.
  s.updateMarkups([id], () => ({ mask, imageEncoding: patch.imageEncoding ?? m.imageEncoding }));
  let image = source;
  if (mask) image = await maskedImage(source, mask);
  else image = await encodedImage(source, encoding);
  const next: Partial<Markup> = { image, imageSource: mask || (encoding !== (source.startsWith('data:image/jpeg') ? 'jpeg' : 'zip')) ? source : undefined };
  useApp.getState().updateMarkups([id], () => next, { history: false });
}
