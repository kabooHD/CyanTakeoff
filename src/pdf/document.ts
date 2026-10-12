// The legacy build includes polyfills, so older (e.g. managed corporate) browsers work.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { PDFDocument } from 'pdf-lib';
import type { PDFDocumentProxy, PageViewport } from 'pdfjs-dist';
import type { Markup, Scale } from '../model/types';
import { importAnnotations, removeAnnots } from './importAnnots';

export { refKey, removeAnnots, type CTData } from './importAnnots';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export interface PageInfo {
  index: number;
  label: string;
  width: number;
  height: number;
  /** pdf.js viewport at scale 1: maps page space <-> PDF user space. */
  viewport: PageViewport;
}

export interface LoadedDoc {
  pdf: PDFDocumentProxy;
  pages: PageInfo[];
  markups: Markup[];
  calibrations: (Scale | null)[];
  /** refKeys of every annotation represented by a markup. */
  importedRefs: Set<string>;
  /** True when pdf-lib could not parse the file; markups cannot be saved into it. */
  readOnly: boolean;
}

export async function openPdf(bytes: Uint8Array): Promise<LoadedDoc> {
  let lib: PDFDocument | null = null;
  try {
    lib = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (e) {
    console.warn('pdf-lib could not parse file; opening read-only', e);
  }

  const result = lib ? importAnnotations(lib) : { raws: [], pageScales: [], imported: [] };
  let displayBytes = bytes;
  if (lib && result.raws.length) {
    // Render a copy without the annotations we draw ourselves, so that the
    // ones we don't support (stamps, images, form fields) still display.
    result.imported.forEach((refs, p) => removeAnnots(lib!, p, refs));
    displayBytes = await lib.save({ useObjectStreams: false });
  }

  const pdf = await pdfjs.getDocument({ data: displayBytes.slice() }).promise;
  const labels = await pdf.getPageLabels().catch(() => null);
  const pages: PageInfo[] = [];
  for (let i = 0; i < pdf.numPages; i++) {
    const page = await pdf.getPage(i + 1);
    const viewport = page.getViewport({ scale: 1 });
    pages.push({ index: i, label: labels?.[i] || String(i + 1), width: viewport.width, height: viewport.height, viewport });
  }

  const markups: Markup[] = result.raws.map(({ markup, pdfPoints }) => {
    const vp = pages[markup.page].viewport;
    return {
      ...markup,
      points: pdfPoints.map((p) => {
        const [x, y] = vp.convertToViewportPoint(p.x, p.y);
        return { x, y };
      }),
    };
  });

  return {
    pdf,
    pages,
    markups,
    calibrations: pages.map((_, i) => result.pageScales[i] ?? null),
    importedRefs: new Set(result.imported.flatMap((s) => [...s])),
    readOnly: !lib,
  };
}
