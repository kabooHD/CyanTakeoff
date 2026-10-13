// Layer visibility in rendering: pdf.js draws the drawing's own layers
// through an optional content configuration; our markups are hidden when
// their layer is hidden.
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { DocState } from '../model/store';
import type { Markup } from '../model/types';

type OCConfig = Awaited<ReturnType<PDFDocumentProxy['getOptionalContentConfig']>>;
const configs = new WeakMap<PDFDocumentProxy, Promise<OCConfig>>();

/** The optional content configuration with the document's current visibility, for page.render(). */
export function ocConfig(doc: DocState): Promise<OCConfig> | undefined {
  if (!doc.layers) return undefined;
  const pdf = doc.loaded.pdf;
  let p = configs.get(pdf);
  if (!p) { p = pdf.getOptionalContentConfig(); configs.set(pdf, p); }
  return p.then((cfg) => {
    for (const [id, v] of Object.entries(doc.layerVisible)) {
      if (id.startsWith('new:')) continue; // only in our markups until saved
      try { cfg.setVisibility(id, v, false); } catch { /* not in this file */ }
    }
    return cfg;
  });
}

/** Changes whenever what is shown changes (for render effect dependencies). */
export const visibilityKey = (doc: DocState) => Object.entries(doc.layerVisible ?? {}).filter(([, v]) => !v).map(([k]) => k).sort().join(',');

export const markupShown = (doc: DocState, m: Markup) => !m.layer || doc.layerVisible?.[m.layer] !== false;
