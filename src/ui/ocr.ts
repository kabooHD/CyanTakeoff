// OCR (Revu Ctrl+Shift+O): recognise text on scanned pages and add it to
// the PDF as invisible text, so the drawing becomes searchable and its text
// selectable. Uses tesseract.js with assets served from /ocr/.
import { StandardFonts, type PDFDocument } from 'pdf-lib';
import type { DocState } from '../model/store';

/** Languages whose data is served under /ocr/lang (see vite.config.ts). */
export const OCR_LANGUAGES: { code: string; name: string }[] = [
  { code: 'eng', name: 'English' }, { code: 'fra', name: 'French' }, { code: 'deu', name: 'German' }, { code: 'spa', name: 'Spanish' },
  { code: 'ita', name: 'Italian' }, { code: 'por', name: 'Portuguese' }, { code: 'nld', name: 'Dutch' },
];

export interface OcrWord { text: string; x0: number; y0: number; x1: number; y1: number; confidence: number }

/** Recognise one page; word boxes in PDF space. */
async function recognisePage(d: DocState, pageIdx: number, langs: string[], onProgress: (p: number) => void): Promise<OcrWord[]> {
  const page = await d.loaded.pdf.getPage(pageIdx + 1);
  const base = page.getViewport({ scale: 1, rotation: 0 });
  // About 300 dpi, capped for large sheets.
  const k = Math.min(300 / 72, Math.sqrt(40e6 / (base.width * base.height)));
  const vp = page.getViewport({ scale: k, rotation: 0 });
  const canvas = Object.assign(document.createElement('canvas'), { width: Math.ceil(vp.width), height: Math.ceil(vp.height) });
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, viewport: vp, annotationMode: 0 }).promise;
  const { createWorker } = await import('tesseract.js');
  const base_ = import.meta.env.BASE_URL;
  // Several languages at once ('eng+fra'): each language's data downloads once, when first used.
  const worker = await createWorker(langs.length ? langs.join('+') : 'eng', 1, {
    workerPath: `${base_}ocr/worker.min.js`, corePath: `${base_}ocr/core`, langPath: `${base_}ocr/lang`,
    logger: (m: { status: string; progress: number }) => { if (m.status === 'recognizing text') onProgress(m.progress); },
  });
  try {
    const { data } = await worker.recognize(canvas, {}, { blocks: true });
    const words: OcrWord[] = [];
    // One text run per recognised line, so phrases are searchable and selectable together.
    for (const b of data.blocks ?? []) for (const p of b.paragraphs) for (const l of p.lines) {
      const good = l.words.filter((w) => w.text.trim() && w.confidence >= 40);
      if (!good.length) continue;
      const bx0 = Math.min(...good.map((w) => w.bbox.x0)), bx1 = Math.max(...good.map((w) => w.bbox.x1));
      const by0 = Math.min(...good.map((w) => w.bbox.y0)), by1 = Math.max(...good.map((w) => w.bbox.y1));
      const [x0, y0] = vp.convertToPdfPoint(bx0, by1);
      const [x1, y1] = vp.convertToPdfPoint(bx1, by0);
      words.push({
        text: good.map((w) => w.text).join(' '), confidence: Math.min(...good.map((w) => w.confidence)),
        x0: Math.min(x0, x1), y0: Math.min(y0, y1), x1: Math.max(x0, x1), y1: Math.max(y0, y1),
      });
    }
    return words;
  } finally {
    await worker.terminate();
  }
}

/** Add recognised words to `lib` as invisible, searchable text (fitted to each word box). */
export async function addTextLayer(lib: PDFDocument, pageIdx: number, words: OcrWord[]) {
  const font = await lib.embedFont(StandardFonts.Helvetica);
  const page = lib.getPage(pageIdx);
  for (const w of words) {
    const text = w.text.replace(/[^\x20-\x7e -ÿ]/g, '');
    if (!text) continue;
    const h = w.y1 - w.y0;
    // Size so the word spans its box (Helvetica is narrower or wider than the scan's font).
    const atH = Math.max(1, h * 0.95);
    const size = Math.max(1, Math.min(atH * 1.6, (atH * (w.x1 - w.x0)) / Math.max(1e-6, font.widthOfTextAtSize(text, atH))));
    // Invisible but selectable and searchable: fully transparent fill.
    page.drawText(text, { x: w.x0, y: w.y0 + h * 0.15, size, font, opacity: 0 });
  }
}

/** OCR the given pages; returns the words per page. */
export async function ocrPages(d: DocState, pages: number[], onProgress: (msg: string) => void, langs: string[] = ['eng']): Promise<Map<number, OcrWord[]>> {
  const out = new Map<number, OcrWord[]>();
  for (const [i, p] of pages.entries()) {
    onProgress(`OCR: page ${i + 1} of ${pages.length}…`);
    out.set(p, await recognisePage(d, p, langs, (f) => onProgress(`OCR: page ${i + 1} of ${pages.length}, ${Math.round(f * 100)}%`)));
  }
  return out;
}
