// Apply Redactions (Revu Shift+A): the content under the redaction marks is
// removed from the page itself (src/pdf/redactContent.ts): text, lines,
// fills, images and nested drawings; everything else stays vector and
// searchable. Images under a mark are re-encoded with the marked pixels
// blacked out. Annotations overlapping a redacted area are removed; the
// redaction marks themselves go away. A page whose content cannot be
// rewritten falls back to being replaced by an image of itself.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PDFArray, PDFBool, PDFDict, PDFDocument, PDFName, PDFNumber, PDFObjectCopier, PDFRef, PDFStream } from 'pdf-lib';
import { zlibSync } from 'fflate';
import { rectPairs, bounds } from '../model/measure';
import type { DocState } from '../model/store';
import { apply, invert, redactPage, type M, type Rect } from '../pdf/redactContent';

const N = (s: string) => PDFName.of(s);
const numOf = (lib: PDFDocument, o: unknown) => { const v = o instanceof PDFRef ? lib.context.lookup(o) : o; return v instanceof PDFNumber ? v.asNumber() : 0; };

/** Render an image XObject on its own (through pdf.js, so every image format works) at w × h pixels. */
async function renderImage(lib: PDFDocument, img: PDFStream, w: number, h: number): Promise<HTMLCanvasElement> {
  const tmp = await PDFDocument.create();
  const copy = PDFObjectCopier.for(lib.context, tmp.context).copy(img) as PDFStream;
  copy.dict.delete(N('SMask')); copy.dict.delete(N('Mask'));
  const page = tmp.addPage([w, h]);
  page.node.set(N('Resources'), tmp.context.obj({ XObject: { Im: tmp.context.register(copy) } }));
  page.node.set(N('Contents'), tmp.context.register(tmp.context.stream(`q ${w} 0 0 ${h} 0 0 cm /Im Do Q`)));
  const pdf = await pdfjs.getDocument({ data: await tmp.save() }).promise;
  try {
    const p = await pdf.getPage(1);
    const canvas = Object.assign(document.createElement('canvas'), { width: w, height: h });
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
    await p.render({ canvas, viewport: p.getViewport({ scale: 1 }), annotationMode: 0 }).promise;
    return canvas;
  } finally { await pdf.loadingTask.destroy(); }
}

/** Fill the parts of the canvas (image pixels) that lie under the page rectangles. */
function paintRects(canvas: HTMLCanvasElement, ctm: M, rects: Rect[], color: string) {
  const ctx = canvas.getContext('2d')!;
  const inv = invert(ctm);
  ctx.fillStyle = color;
  for (const r of rects) {
    // Image space: unit square, (0,0) at the bottom-left of the image; canvas rows go down.
    const pts = [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]].map(([x, y]) => apply(inv, x, y)).map(([u, v]) => [u * canvas.width, (1 - v) * canvas.height]);
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fill();
    // Grow by a pixel so anti-aliased edges cannot leak.
    ctx.lineWidth = 2; ctx.strokeStyle = color; ctx.stroke();
  }
}

/** A copy of image `ref` with the pixels under `rects` blacked out (masks: cleared). */
async function redactImage(lib: PDFDocument, ref: PDFRef, ctm: M, rects: Rect[]): Promise<PDFRef | null> {
  const img = lib.context.lookup(ref);
  if (!(img instanceof PDFStream)) return null;
  const W = numOf(lib, img.dict.get(N('Width'))), H = numOf(lib, img.dict.get(N('Height')));
  if (!W || !H) return null;
  const k = Math.min(1, Math.sqrt(25e6 / (W * H)));
  const w = Math.max(1, Math.round(W * k)), h = Math.max(1, Math.round(H * k));
  const isMask = img.dict.get(N('ImageMask')) === PDFBool.True;
  const canvas = await renderImage(lib, img, w, h);
  // A stencil mask's marked pixels become unpainted; colour images get black.
  paintRects(canvas, ctm, rects, isMask ? '#fff' : '#000');
  const px = canvas.getContext('2d')!.getImageData(0, 0, w, h).data;
  let out: PDFStream;
  if (isMask) {
    const row = Math.ceil(w / 8);
    const bits = new Uint8Array(row * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (px[i] + px[i + 1] + px[i + 2] > 382) bits[y * row + (x >> 3)] |= 0x80 >> (x & 7); // 1 = not painted
    }
    out = lib.context.stream(zlibSync(bits), { Type: 'XObject', Subtype: 'Image', Width: w, Height: h, ImageMask: true, BitsPerComponent: 1, Filter: 'FlateDecode' });
  } else {
    const rgb = new Uint8Array(w * h * 3);
    for (let i = 0, j = 0; i < px.length; i += 4, j += 3) { rgb[j] = px[i]; rgb[j + 1] = px[i + 1]; rgb[j + 2] = px[i + 2]; }
    out = lib.context.stream(zlibSync(rgb), { Type: 'XObject', Subtype: 'Image', Width: w, Height: h, ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Filter: 'FlateDecode' });
    const smask = img.dict.lookup(N('SMask'));
    if (smask instanceof PDFStream) {
      // The soft mask is redacted too (made transparent under the marks).
      const m = await renderImage(lib, smask, w, h);
      paintRects(m, ctm, rects, '#000');
      const a = m.getContext('2d')!.getImageData(0, 0, w, h).data;
      const gray = new Uint8Array(w * h);
      for (let i = 0; i < gray.length; i++) gray[i] = a[i * 4];
      out.dict.set(N('SMask'), lib.context.register(lib.context.stream(zlibSync(gray), { Type: 'XObject', Subtype: 'Image', Width: w, Height: h, ColorSpace: 'DeviceGray', BitsPerComponent: 8, Filter: 'FlateDecode' })));
    }
  }
  const interp = img.dict.get(N('Interpolate'));
  if (interp) out.dict.set(N('Interpolate'), interp);
  return lib.context.register(out);
}

/** Fallback: replace the page by an image of itself with the marked areas blacked out. */
async function rasterisePage(d: DocState, lib: PDFDocument, pageIdx: number, rects: Rect[]) {
  const page = await d.loaded.pdf.getPage(pageIdx + 1);
  const base = page.getViewport({ scale: 1, rotation: 0 });
  const k = Math.min(200 / 72, Math.sqrt(24e6 / (base.width * base.height)));
  const vp = page.getViewport({ scale: k, rotation: 0 });
  const canvas = Object.assign(document.createElement('canvas'), { width: Math.ceil(vp.width), height: Math.ceil(vp.height) });
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, viewport: vp, annotationMode: 0 }).promise;
  ctx.fillStyle = '#000';
  for (const r of rects) {
    const [x0, y0] = vp.convertToViewportPoint(r[0], r[1]), [x1, y1] = vp.convertToViewportPoint(r[2], r[3]);
    ctx.fillRect(Math.min(x0, x1) - 1, Math.min(y0, y1) - 1, Math.abs(x1 - x0) + 2, Math.abs(y1 - y0) + 2);
  }
  const jpg = await new Promise<Blob>((res) => canvas.toBlob((b) => res(b!), 'image/jpeg', 0.92));
  const img = await lib.embedJpg(new Uint8Array(await jpg.arrayBuffer()));
  const p = lib.getPage(pageIdx);
  const [vx0, vy0, vx1, vy1] = (page.view as number[]);
  p.node.set(N('Resources'), lib.context.obj({ XObject: { RedactedPage: img.ref } }));
  p.node.set(N('Contents'), lib.context.register(lib.context.flateStream(`q ${vx1 - vx0} 0 0 ${vy1 - vy0} ${vx0} ${vy0} cm /RedactedPage Do Q`)));
}

export interface RedactResult { pages: number; glyphs: number; images: number; rasterised: number }

export async function applyRedactions(d: DocState, lib: PDFDocument): Promise<RedactResult> {
  const byPage = new Map<number, Rect[]>();
  for (const m of d.markups.filter((x) => x.type === 'redaction')) {
    const vp = d.loaded.pages[m.page].viewport;
    for (const [a, b] of rectPairs(m.points)) {
      const [ax, ay] = vp.convertToPdfPoint(a.x, a.y), [bx, by] = vp.convertToPdfPoint(b.x, b.y);
      const list = byPage.get(m.page) ?? [];
      list.push([Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)]);
      byPage.set(m.page, list);
    }
  }
  const result: RedactResult = { pages: byPage.size, glyphs: 0, images: 0, rasterised: 0 };
  for (const [pageIdx, rects] of byPage) {
    try {
      const s = await redactPage(lib, pageIdx, { rects, redactImage: (ref, ctm) => redactImage(lib, ref, ctm, rects) });
      result.glyphs += s.glyphs; result.images += s.images;
    } catch (e) {
      console.warn('Content redaction failed, rasterising the page', e);
      await rasterisePage(d, lib, pageIdx, rects);
      result.rasterised++;
    }
    // Drop redaction marks and any annotation overlapping a redacted area.
    const p = lib.getPage(pageIdx);
    const annots = p.node.lookup(N('Annots'));
    if (annots instanceof PDFArray) {
      const keep = annots.asArray().filter((ref) => {
        const a = lib.context.lookup(ref);
        if (!(a instanceof PDFDict)) return true;
        if (String(a.get(N('Subtype'))) === '/Redact') return false;
        const rr = a.lookup(N('Rect'));
        if (!(rr instanceof PDFArray)) return true;
        const [x0, y0, x1, y1] = rr.asArray().map((v) => numOf(lib, v));
        const b = bounds([{ x: x0, y: y0 }, { x: x1, y: y1 }]);
        return !rects.some((r) => b.minX < r[2] && b.maxX > r[0] && b.minY < r[3] && b.maxY > r[1]);
      });
      p.node.set(N('Annots'), lib.context.obj(keep));
    }
  }
  return result;
}
