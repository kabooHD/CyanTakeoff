// Helpers for tools that need the page's text, a rendered snapshot or files.
import type { PDFPageProxy, PageViewport } from 'pdfjs-dist';
import type { Markup, Pt } from '../model/types';

export interface TextBox { x0: number; y0: number; x1: number; y1: number; str: string; /** Font family (pdf.js style). */ font?: string }

const textCache = new WeakMap<PDFPageProxy, Promise<TextBox[]>>();

/** Text runs on a page with their boxes in page space (cached). */
export function pageText(page: PDFPageProxy, vp: PageViewport): Promise<TextBox[]> {
  let p = textCache.get(page);
  if (!p) {
    p = page.getTextContent().then((tc) => tc.items.flatMap((it) => {
      if (!('str' in it) || !it.str.trim()) return [];
      const [a, b, , , e, f] = it.transform as number[];
      const size = Math.hypot(a, b) || it.height || 10;
      const angle = Math.atan2(b, a);
      // Box along the baseline (handles rotated text by its corners).
      const ux = Math.cos(angle), uy = Math.sin(angle);
      const corners = [[0, -0.22], [it.width, -0.22], [it.width, 0.9], [0, 0.9]].map(([u, v]) => {
        const x = e + ux * u - uy * v * size, y = f + uy * u + ux * v * size;
        return vp.convertToViewportPoint(x, y);
      });
      const xs = corners.map((c) => c[0]), ys = corners.map((c) => c[1]);
      return [{ x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys), str: it.str, font: `${it.fontName} ${tc.styles[it.fontName]?.fontFamily ?? ''}` }];
    }));
    textCache.set(page, p);
  }
  return p;
}

/**
 * Rectangles (as point pairs) covering the text runs a drag from `a` to `b`
 * touches; runs on the same line are merged, as in Revu's text markups.
 */
export function textRectsIn(boxes: TextBox[], a: Pt, b: Pt): Pt[] {
  const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
  const hit = boxes.filter((t) => t.x1 >= x0 && t.x0 <= x1 && t.y1 >= y0 && t.y0 <= y1)
    .sort((p, q) => p.y0 - q.y0 || p.x0 - q.x0);
  const lines: TextBox[] = [];
  for (const t of hit) {
    const l = lines.find((q) => Math.abs((q.y0 + q.y1) / 2 - (t.y0 + t.y1) / 2) < (t.y1 - t.y0) * 0.5 && t.x0 - q.x1 < (t.y1 - t.y0) * 2);
    if (l) { l.x0 = Math.min(l.x0, t.x0); l.x1 = Math.max(l.x1, t.x1); l.y0 = Math.min(l.y0, t.y0); l.y1 = Math.max(l.y1, t.y1); }
    else lines.push({ ...t });
  }
  return lines.flatMap((l) => [{ x: l.x0, y: l.y0 }, { x: l.x1, y: l.y1 }]);
}

/**
 * Render a region of the page (page space) to a PNG data URL, at `scale` px
 * per point, with `markups` drawn on top (Snapshot). `null`: the drawing's
 * content only, without any annotations (Snapshot Content).
 */
export async function snapshot(page: PDFPageProxy, a: Pt, b: Pt, scale = 3, markups: Markup[] | null = []): Promise<string> {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
  const k = Math.min(scale, Math.sqrt(16e6 / Math.max(1, w * h)));
  const vp = page.getViewport({ scale: k, offsetX: -x * k, offsetY: -y * k });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * k)); canvas.height = Math.max(1, Math.round(h * k));
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, viewport: vp, annotationMode: markups ? 1 : 0 }).promise;
  if (markups?.length) await (await import('./markupRaster')).drawMarkups(canvas, markups, x, y, w, h);
  return canvas.toDataURL('image/png');
}

/** Ask the user for a file. */
export function pickFile(accept?: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: accept ?? '' });
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

export const readAsDataUrl = (f: Blob) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result as string);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(f);
});

/** An image file as a PNG or JPEG data URL with its natural size. */
export async function loadImage(f: Blob): Promise<{ url: string; w: number; h: number }> {
  let url = await readAsDataUrl(f);
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
  if (!/^data:image\/(png|jpeg);/.test(url)) {
    // Other formats (GIF, WebP, SVG...) are converted to PNG for the PDF.
    const c = Object.assign(document.createElement('canvas'), { width: img.naturalWidth, height: img.naturalHeight });
    c.getContext('2d')!.drawImage(img, 0, 0);
    url = c.toDataURL('image/png');
  }
  return { url, w: img.naturalWidth, h: img.naturalHeight };
}

export function downloadBase64(name: string, mime: string, b64: string) {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const href = URL.createObjectURL(new Blob([bytes], { type: mime }));
  Object.assign(document.createElement('a'), { href, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

export const STAMPS = ['APPROVED', 'NOT APPROVED', 'REJECTED', 'REVIEWED', 'REVISE AND RESUBMIT', 'DRAFT', 'VOID', 'FOR CONSTRUCTION', 'AS BUILT', 'CONFIDENTIAL'];
