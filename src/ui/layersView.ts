// Layer visibility in rendering: pdf.js draws the drawing's own layers
// through an optional content configuration; our markups are hidden when
// their layer is hidden. A layer with a zoom range (Layer Properties >
// Zoom) only shows while the view's zoom is inside it.
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { DocState } from '../model/store';
import type { Markup } from '../model/types';

type OCConfig = Awaited<ReturnType<PDFDocumentProxy['getOptionalContentConfig']>>;
const configs = new WeakMap<PDFDocumentProxy, Promise<OCConfig>>();

/** Whether a layer shows at `zoom` (1 = 100%): its box is ticked and the zoom is in its range. */
export function layerShown(doc: DocState, id: string, zoom: number): boolean {
  if (doc.layerVisible?.[id] === false) return false;
  const z = doc.layers?.layers[id]?.zoom;
  return !z || (zoom >= z.min - 1e-9 && zoom <= z.max + 1e-9);
}

/** The optional content configuration with the document's current visibility, for page.render(). */
export function ocConfig(doc: DocState, zoom = 1): Promise<OCConfig> | undefined {
  if (!doc.layers) return undefined;
  const pdf = doc.loaded.pdf;
  let p = configs.get(pdf);
  if (!p) { p = pdf.getOptionalContentConfig(); configs.set(pdf, p); }
  const ids = Object.keys(doc.layers.layers).filter((id) => !id.startsWith('new:')); // new layers only hold our markups until saved
  const shown = ids.map((id) => layerShown(doc, id, zoom));
  return p.then((cfg) => {
    ids.forEach((id, i) => { try { cfg.setVisibility(id, shown[i], false); } catch { /* not in this file */ } });
    return cfg;
  });
}

/** Changes whenever what is shown changes (for render effect dependencies). */
export const visibilityKey = (doc: DocState, zoom = 1) =>
  Object.keys(doc.layers?.layers ?? {}).filter((id) => !layerShown(doc, id, zoom)).sort().join(',');

export const markupShown = (doc: DocState, m: Markup, zoom = 1) => !m.layer || layerShown(doc, m.layer, zoom);
