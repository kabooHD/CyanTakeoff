// The legacy build includes polyfills, so older (e.g. managed corporate) browsers work.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { PDFArray, PDFDict, PDFDocument, PDFRef } from 'pdf-lib';
import type { PDFDocumentProxy, PageViewport } from 'pdfjs-dist';
import type { Markup, MarkupStatus, MarkupStyle, MarkupType, Pt, Scale } from '../model/types';
import { DEFAULT_STYLES, toolById } from '../tools/tools';
import {
  N, colorToHex, getArray, getDict, getName, getNumber, getText, lookup, numbers,
  parsePdfDate, readMeasure,
} from './pdfutil';

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
  /** True when pdf-lib could not parse the file; markups cannot be saved into it. */
  readOnly: boolean;
}

/** Private data CyanTakeoff stores on its own annotations. */
export interface CTData {
  v: 1;
  type: MarkupType;
  label?: string;
  status?: MarkupStatus;
  depth?: number;
  fillOpacity?: number;
  lineStyle?: MarkupStyle['lineStyle'];
  points?: number[]; // PDF-space points for types whose geometry is not standard (count)
}

const CT_KEY = 'CTData';

const id = () => crypto.randomUUID();

interface RawImport {
  markup: Omit<Markup, 'points'>;
  pdfPoints: Pt[];
}

/** Read a supported annotation into a markup (points still in PDF space). */
function readAnnot(doc: PDFDocument, dict: PDFDict, ref: PDFRef, page: number): RawImport | null {
  const subtype = getName(doc, dict, 'Subtype');
  if (!subtype) return null;
  const rect = numbers(doc, getArray(doc, dict, 'Rect'));
  const rd = numbers(doc, getArray(doc, dict, 'RD'));
  const inner = rect.length === 4
    ? (rd.length === 4
      ? [rect[0] + rd[0], rect[1] + rd[1], rect[2] - rd[2], rect[3] - rd[3]]
      : rect)
    : null;
  const pairs = (a: number[]) => {
    const out: Pt[] = [];
    for (let i = 0; i + 1 < a.length; i += 2) out.push({ x: a[i], y: a[i + 1] });
    return out;
  };
  const rectPts = (r: number[]) => [{ x: r[0], y: r[3] }, { x: r[2], y: r[1] }];

  let ct: CTData | undefined;
  const ctText = getText(doc, dict, CT_KEY);
  if (ctText) {
    try { ct = JSON.parse(ctText) as CTData; } catch { /* ignore */ }
  }

  const intent = getName(doc, dict, 'IT');
  const measureDict = getDict(doc, dict, 'Measure');
  const scale = measureDict ? readMeasure(doc, measureDict) : undefined;
  const be = getDict(doc, dict, 'BE');
  const cloudy = !!be && getName(doc, be, 'S') === 'C';
  const subj = getText(doc, dict, 'Subj') ?? '';

  let type: MarkupType | null = null;
  let pts: Pt[] = [];
  let text: string | undefined;

  switch (subtype) {
    case 'Line': {
      pts = pairs(numbers(doc, getArray(doc, dict, 'L')));
      const le = getArray(doc, dict, 'LE');
      const ends = le ? [0, 1].map((i) => (lookup(doc, le.get(i)) ?? '').toString()) : [];
      type = intent === 'LineDimension' || scale ? 'length'
        : ends.some((e) => /Arrow/.test(e)) ? 'arrow' : 'line';
      break;
    }
    case 'PolyLine':
      pts = pairs(numbers(doc, getArray(doc, dict, 'Vertices')));
      type = intent === 'PolyLineDimension' || scale ? 'polylength' : 'polyline';
      break;
    case 'Polygon':
      pts = pairs(numbers(doc, getArray(doc, dict, 'Vertices')));
      if (intent === 'PolygonDimension' || scale) {
        type = /perimeter/i.test(subj) ? 'perimeter' : /volume/i.test(subj) ? 'volume' : 'area';
      } else type = cloudy ? 'cloud' : 'polygon';
      break;
    case 'Square':
      if (!inner) return null;
      pts = rectPts(inner);
      type = cloudy ? 'cloud' : 'rectangle';
      if (cloudy) pts = [pts[0], { x: pts[1].x, y: pts[0].y }, pts[1], { x: pts[0].x, y: pts[1].y }];
      break;
    case 'Circle':
      if (!inner) return null;
      pts = rectPts(inner);
      type = 'ellipse';
      break;
    case 'Ink': {
      const ink = getArray(doc, dict, 'InkList');
      if (!ink || ink.size() !== 1) return null; // multi-stroke ink stays as-is in the file
      pts = pairs(numbers(doc, lookup(doc, ink.get(0)) as PDFArray));
      type = 'pen';
      break;
    }
    case 'FreeText': {
      if (!inner) return null;
      text = getText(doc, dict, 'Contents') ?? '';
      if (intent === 'FreeTextCallout') {
        const cl = pairs(numbers(doc, getArray(doc, dict, 'CL')));
        if (!cl.length) return null;
        pts = [cl[0], ...rectPts(inner)];
        type = 'callout';
      } else {
        pts = rectPts(inner);
        type = 'textbox';
      }
      break;
    }
    case 'Text':
      if (!rect.length) return null;
      pts = [{ x: rect[0], y: rect[3] }];
      type = 'note';
      break;
    case 'Highlight': {
      const q = numbers(doc, getArray(doc, dict, 'QuadPoints'));
      if (q.length !== 8) return null;
      const xs = [q[0], q[2], q[4], q[6]], ys = [q[1], q[3], q[5], q[7]];
      pts = [{ x: Math.min(...xs), y: Math.max(...ys) }, { x: Math.max(...xs), y: Math.min(...ys) }];
      type = 'highlight';
      break;
    }
    default:
      return null;
  }
  if (ct?.type) type = ct.type;
  if (ct?.points) pts = pairs(ct.points);
  if (!type || pts.length === 0) return null;

  const defaults = DEFAULT_STYLES[type];
  const stroke = colorToHex(numbers(doc, getArray(doc, dict, 'C')));
  const fill = colorToHex(numbers(doc, getArray(doc, dict, 'IC')));
  const ca = getNumber(doc, dict, 'CA');
  const bs = getDict(doc, dict, 'BS');
  const width = (bs && getNumber(doc, bs, 'W')) ?? numbers(doc, getArray(doc, dict, 'Border'))[2] ?? defaults.width;
  const dashed = bs && getName(doc, bs, 'S') === 'D';
  const da = getText(doc, dict, 'DA') ?? '';
  const fontSize = Number(da.match(/([\d.]+)\s+Tf/)?.[1]) || defaults.fontSize;
  const textColor = da.match(/([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+rg/);

  const style: MarkupStyle = {
    ...defaults,
    color: (type === 'textbox' || type === 'callout') && textColor
      ? colorToHex(textColor.slice(1, 4).map(Number))!
      : stroke ?? defaults.color,
    fill: type === 'highlight' ? stroke ?? defaults.fill : fill,
    opacity: ca ?? 1,
    fillOpacity: ct?.fillOpacity ?? ca ?? defaults.fillOpacity,
    width,
    lineStyle: ct?.lineStyle ?? (dashed ? 'dashed' : 'solid'),
    fontSize,
  };
  const created = parsePdfDate(getText(doc, dict, 'CreationDate'))
    ?? parsePdfDate(getText(doc, dict, 'M')) ?? new Date().toISOString();

  return {
    markup: {
      id: id(),
      type,
      page,
      style,
      subject: subj || toolById(type).subject,
      label: ct?.label ?? '',
      comment: type === 'textbox' || type === 'callout' ? '' : getText(doc, dict, 'Contents') ?? '',
      author: getText(doc, dict, 'T') ?? '',
      created,
      modified: parsePdfDate(getText(doc, dict, 'M')) ?? created,
      status: ct?.status ?? 'None',
      text,
      scale,
      depth: ct?.depth,
      source: { objectNumber: ref.objectNumber, generation: ref.generationNumber, dirty: false },
    },
    pdfPoints: pts,
  };
}

/** Annotation refs on a page, resolved. */
export function pageAnnots(doc: PDFDocument, pageIndex: number) {
  const page = doc.getPage(pageIndex);
  const annots = page.node.lookup(N('Annots'));
  const out: { ref: PDFRef; dict: PDFDict }[] = [];
  if (!(annots instanceof PDFArray)) return out;
  for (let i = 0; i < annots.size(); i++) {
    const ref = annots.get(i);
    if (!(ref instanceof PDFRef)) continue;
    const dict = doc.context.lookup(ref);
    if (dict instanceof PDFDict) out.push({ ref, dict });
  }
  return out;
}

/** Remove the given annotation refs (and their popups) from a page. */
export function removeAnnots(doc: PDFDocument, pageIndex: number, remove: Set<string>) {
  const page = doc.getPage(pageIndex);
  const annots = page.node.lookup(N('Annots'));
  if (!(annots instanceof PDFArray)) return;
  const drop = new Set(remove);
  for (const { ref, dict } of pageAnnots(doc, pageIndex)) {
    if (!remove.has(refKey(ref))) continue;
    const popup = dict.get(N('Popup'));
    if (popup instanceof PDFRef) drop.add(refKey(popup));
  }
  for (let i = annots.size() - 1; i >= 0; i--) {
    const r = annots.get(i);
    if (r instanceof PDFRef && drop.has(refKey(r))) annots.remove(i);
  }
}

export const refKey = (r: { objectNumber: number; generationNumber?: number; generation?: number }) =>
  `${r.objectNumber} ${r.generationNumber ?? r.generation ?? 0}`;

export async function openPdf(bytes: Uint8Array): Promise<LoadedDoc> {
  let lib: PDFDocument | null = null;
  try {
    lib = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (e) {
    console.warn('pdf-lib could not parse file; opening read-only', e);
  }

  const raws: RawImport[] = [];
  const pageScales: (Scale | null)[] = [];
  let displayBytes = bytes;
  if (lib) {
    for (let p = 0; p < lib.getPageCount(); p++) {
      const remove = new Set<string>();
      for (const { ref, dict } of pageAnnots(lib, p)) {
        try {
          const r = readAnnot(lib, dict, ref, p);
          if (r) { raws.push(r); remove.add(refKey(ref)); }
        } catch (e) {
          console.warn('Skipping annotation', refKey(ref), e);
        }
      }
      removeAnnots(lib, p, remove);
      // Page calibration from the first viewport (/VP) with a measure dictionary.
      let scale: Scale | null = null;
      const vp = lib.getPage(p).node.lookup(N('VP'));
      if (vp instanceof PDFArray) {
        for (let i = 0; i < vp.size() && !scale; i++) {
          const v = lookup(lib, vp.get(i));
          const m = v instanceof PDFDict ? getDict(lib, v, 'Measure') : undefined;
          if (m) scale = readMeasure(lib, m) ?? null;
        }
      }
      pageScales.push(scale);
    }
    // Render a copy without the annotations we draw ourselves, so that the
    // ones we don't support (stamps, images, form fields) still display.
    if (raws.length) displayBytes = await lib.save({ useObjectStreams: false });
  }

  const pdf = await pdfjs.getDocument({ data: displayBytes.slice() }).promise;
  const labels = await pdf.getPageLabels().catch(() => null);
  const pages: PageInfo[] = [];
  for (let i = 0; i < pdf.numPages; i++) {
    const page = await pdf.getPage(i + 1);
    const viewport = page.getViewport({ scale: 1 });
    pages.push({ index: i, label: labels?.[i] || String(i + 1), width: viewport.width, height: viewport.height, viewport });
  }

  const markups: Markup[] = raws.map(({ markup, pdfPoints }) => {
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
    calibrations: pages.map((_, i) => pageScales[i] ?? null),
    readOnly: !lib,
  };
}
