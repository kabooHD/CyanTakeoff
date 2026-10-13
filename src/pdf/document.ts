// The legacy build includes polyfills, so older (e.g. managed corporate) browsers work.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { PDFDocument } from 'pdf-lib';
import type { PDFDocumentProxy, PageViewport } from 'pdfjs-dist';
import type { CustomColumn, Markup, Pt, Scale, Space, Viewport } from '../model/types';
import { importAnnotations, readColumns, removeAnnots } from './importAnnots';
import { readFields, type FormField } from './forms';
import { layersOnPages, readLayers, type LayerSet } from './layers';

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
  /** Regions with their own scale, per page (page space). */
  viewports: Viewport[][];
  /** Revu Spaces, per page (page space). */
  spaces: Space[][];
  /** Custom columns saved with the document. */
  columns: CustomColumn[];
  /** Form fields (AcroForm), widget rectangles in page space. */
  fields: FormField[];
  /** refKeys of every annotation represented by a markup. */
  importedRefs: Set<string>;
  /** True when pdf-lib could not parse the file; markups cannot be saved into it. */
  readOnly: boolean;
  /** PDF layers (optional content), or null when the file has none. */
  layers: LayerSet | null;
  /** Layer ids used by each page's content. */
  pageLayers: string[][];
}

export async function openPdf(bytes: Uint8Array): Promise<LoadedDoc> {
  let lib: PDFDocument | null = null;
  try {
    lib = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (e) {
    console.warn('pdf-lib could not parse file; opening read-only', e);
  }

  const result = lib ? importAnnotations(lib) : { raws: [], pageScales: [], pageViewports: [], pageSpaces: [], imported: [] };
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
    const toPage = (p: Pt) => {
      const [x, y] = vp.convertToViewportPoint(p.x, p.y);
      return { x, y };
    };
    return {
      ...markup,
      points: pdfPoints.map(toPage),
      cutouts: markup.cutouts?.map((c) => ({ ...c, points: c.points.map(toPage) })),
      // Handle offsets: convert the control points, then take them relative to the vertex again.
      handles: markup.handles?.map((h, i) => {
        if (!h) return null;
        const v = pdfPoints[i], pv = toPage(v);
        const rel = (d: Pt) => { const q = toPage({ x: v.x + d.x, y: v.y + d.y }); return { x: q.x - pv.x, y: q.y - pv.y }; };
        return { in: rel(h.in), out: rel(h.out) };
      }),
    };
  });

  const viewports = pages.map((pg, i) => (result.pageViewports[i] ?? []).map(({ bbox, ...v }): Viewport => {
    const [ax, ay] = pg.viewport.convertToViewportPoint(bbox[0], bbox[1]);
    const [bx, by] = pg.viewport.convertToViewportPoint(bbox[2], bbox[3]);
    return { ...v, rect: [{ x: Math.min(ax, bx), y: Math.min(ay, by) }, { x: Math.max(ax, bx), y: Math.max(ay, by) }] };
  }));

  const spaces = pages.map((pg, i) => (result.pageSpaces[i] ?? []).map((sp): Space => ({
    id: crypto.randomUUID(), title: sp.title, color: sp.color, opacity: sp.opacity,
    points: sp.path.map((q) => { const [x, y] = pg.viewport.convertToViewportPoint(q.x, q.y); return { x, y }; }),
  })));

  return {
    pdf,
    pages,
    markups,
    spaces,
    columns: lib ? readColumns(lib) : [],
    fields: lib ? readFields(lib).map((f) => ({
      ...f,
      widgets: f.widgets.filter((w) => pages[w.page]).map((w) => {
        const vp = pages[w.page].viewport;
        const [ax, ay] = vp.convertToViewportPoint(w.rect[0], w.rect[1]);
        const [bx, by] = vp.convertToViewportPoint(w.rect[2], w.rect[3]);
        return { ...w, rect: [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)] as [number, number, number, number] };
      }),
    })) : [],
    calibrations: pages.map((_, i) => result.pageScales[i] ?? null),
    viewports,
    importedRefs: new Set(result.imported.flatMap((s) => [...s])),
    readOnly: !lib,
    layers: lib ? readLayers(lib) : null,
    pageLayers: lib ? layersOnPages(lib) : [],
  };
}
