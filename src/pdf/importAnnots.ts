// Reads markup annotations from a PDF (pdf-lib only, no rendering), including
// the structures Bluebeam Revu writes. Geometry stays in PDF user space; the
// caller converts it to page space.
//
// Revu conventions (observed in Revu-authored files, see tests/fixtures/revu):
// - Measurements carry /IT (intent) and a standard /Measure dictionary whose
//   /X[0] converts points to the base unit; units may be written as ' and ".
// - /Contents holds the displayed value (e.g. 5'-5", 56.37 sf).
// - Perimeter is a /PolyLine with /IT /PolyLineDimension and is closed.
// - Counts are one /Polygon per item with /IT /PolygonCount and /BBMeasure;
//   items in a count group point to the first via /IRT with /RT /Group.
// - /FillOpacity holds fill opacity; /Label holds the markup label.
// - Page /VP: the page scale is a /Viewport covering the whole page with no
//   /Name; viewports (regions with their own scale) carry a /Name and BBox.
import { PDFArray, PDFDict, PDFRef, type PDFDocument } from 'pdf-lib';
import type { Markup, MarkupStatus, MarkupStyle, MarkupType, Pt, Scale } from '../model/types';
import { DEFAULT_STYLES, toolById } from '../tools/tools';
import { MEASURE_TYPES } from '../model/measure';
import {
  N, colorToHex, getArray, getDict, getName, getNumber, getText, lookup, numbers,
  parsePdfDate, readMeasure,
} from './pdfutil';

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
  comment?: string; // measurement comments (/Contents holds the value, as in Revu)
  cutouts?: { kind: 'polygon' | 'ellipse'; points: number[] }[]; // PDF-space holes in an area/volume
}

export const CT_KEY = 'CTData';

export interface RawImport {
  markup: Omit<Markup, 'points'>;
  pdfPoints: Pt[];
  /** The value text the authoring app displayed (Revu writes it to /Contents). */
  displayed?: string;
}

type Ref = { objectNumber: number; generation: number };

export const refKey = (r: { objectNumber: number; generationNumber?: number; generation?: number }) =>
  `${r.objectNumber} ${r.generationNumber ?? r.generation ?? 0}`;

const toRef = (r: PDFRef): Ref => ({ objectNumber: r.objectNumber, generation: r.generationNumber });

/** Measurement intents CyanTakeoff can edit, by /IT. Others are preserved untouched. */
const MEASURE_INTENTS: Record<string, MarkupType> = {
  LineDimension: 'length',
  PolyLineDimension: 'polylength',
  PolygonDimension: 'area',
  PolygonVolume: 'volume',
  PolygonCount: 'count',
  PolyLineAngle: 'angle',
  PolygonRadius: 'radius',
  CircleDimension: 'diameter',
};

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
  const annots = doc.getPage(pageIndex).node.lookup(N('Annots'));
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

const pairs = (a: number[]) => {
  const out: Pt[] = [];
  for (let i = 0; i + 1 < a.length; i += 2) out.push({ x: a[i], y: a[i + 1] });
  return out;
};

function readCT(doc: PDFDocument, dict: PDFDict): CTData | undefined {
  const t = getText(doc, dict, CT_KEY);
  if (!t) return undefined;
  try { return JSON.parse(t) as CTData; } catch { return undefined; }
}

function readStyle(doc: PDFDocument, dict: PDFDict, type: MarkupType, ct?: CTData): MarkupStyle {
  const defaults = DEFAULT_STYLES[type];
  const stroke = colorToHex(numbers(doc, getArray(doc, dict, 'C')));
  const fill = colorToHex(numbers(doc, getArray(doc, dict, 'IC')));
  const ca = getNumber(doc, dict, 'CA');
  const bs = getDict(doc, dict, 'BS');
  const width = (bs && getNumber(doc, bs, 'W')) ?? numbers(doc, getArray(doc, dict, 'Border'))[2] ?? defaults.width;
  const dashed = bs && getName(doc, bs, 'S') === 'D';
  const da = getText(doc, dict, 'DA') ?? getText(doc, dict, 'DS') ?? '';
  const fontSize = Number(da.match(/([\d.]+)\s*(?:Tf|pt)/)?.[1]) || defaults.fontSize;
  const textColor = da.match(/([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+rg/);
  const textual = type === 'textbox' || type === 'callout';
  // Polylines/lines: Revu writes /IC as the arrowhead fill, not a shape fill.
  const fillable = !['line', 'arrow', 'length', 'polyline', 'polylength', 'perimeter', 'pen'].includes(type);
  return {
    ...defaults,
    color: textual && textColor ? colorToHex(textColor.slice(1, 4).map(Number))! : stroke ?? defaults.color,
    fill: type === 'highlight' ? stroke ?? defaults.fill : fillable ? fill : null,
    opacity: ca ?? 1,
    fillOpacity: ct?.fillOpacity ?? getNumber(doc, dict, 'FillOpacity') ?? ca ?? defaults.fillOpacity,
    width,
    lineStyle: ct?.lineStyle ?? (dashed ? 'dashed' : 'solid'),
    fontSize,
  };
}

function baseMarkup(doc: PDFDocument, dict: PDFDict, ref: PDFRef, page: number, type: MarkupType, ct?: CTData) {
  const created = parsePdfDate(getText(doc, dict, 'CreationDate'))
    ?? parsePdfDate(getText(doc, dict, 'M')) ?? new Date().toISOString();
  const measureDict = getDict(doc, dict, 'Measure') ?? getDict(doc, dict, 'BBMeasure');
  const isMeasure = MEASURE_TYPES.has(type);
  const contents = getText(doc, dict, 'Contents') ?? '';
  return {
    id: crypto.randomUUID(),
    type,
    page,
    style: readStyle(doc, dict, type, ct),
    subject: getText(doc, dict, 'Subj') || toolById(type).subject,
    label: ct?.label ?? getText(doc, dict, 'Label') ?? '',
    // For measurements, Revu's /Contents is the displayed value, not a comment.
    comment: ct?.comment ?? (type === 'textbox' || type === 'callout' || isMeasure ? '' : contents),
    author: getText(doc, dict, 'T') ?? '',
    created,
    modified: parsePdfDate(getText(doc, dict, 'M')) ?? created,
    status: ct?.status ?? 'None',
    scale: measureDict ? readMeasure(doc, measureDict) : undefined,
    depth: ct?.depth ?? getNumber(doc, dict, 'Depth'),
    source: { ...toRef(ref), dirty: false },
  } satisfies Omit<Markup, 'points'>;
}

/** Read one supported annotation (not a count) into a markup. */
function readAnnot(doc: PDFDocument, dict: PDFDict, ref: PDFRef, page: number): RawImport | null {
  const subtype = getName(doc, dict, 'Subtype');
  if (!subtype) return null;
  const ct = readCT(doc, dict);
  const rect = numbers(doc, getArray(doc, dict, 'Rect'));
  const rd = numbers(doc, getArray(doc, dict, 'RD'));
  const inner = rect.length === 4
    ? (rd.length === 4 ? [rect[0] + rd[0], rect[1] + rd[1], rect[2] - rd[2], rect[3] - rd[3]] : rect)
    : null;
  const rectPts = (r: number[]) => [{ x: r[0], y: r[3] }, { x: r[2], y: r[1] }];
  const intent = getName(doc, dict, 'IT');
  const subj = getText(doc, dict, 'Subj') ?? '';
  const be = getDict(doc, dict, 'BE');
  const cloudy = !!be && getName(doc, be, 'S') === 'C';

  // Unknown measurement intents (radius, diameter, angle, ...) are left as-is.
  if (intent && /Dimension|Volume|Count|Radius|Angle|Arc/.test(intent) && !MEASURE_INTENTS[intent] && !ct) return null;

  let type: MarkupType | null = null;
  let pts: Pt[] = [];
  let text: string | undefined;
  switch (subtype) {
    case 'Line': {
      pts = pairs(numbers(doc, getArray(doc, dict, 'L')));
      const le = getArray(doc, dict, 'LE');
      const ends = le ? [0, 1].map((i) => String(lookup(doc, le.get(i)) ?? '')) : [];
      type = intent === 'LineDimension' ? 'length' : ends.some((e) => /Arrow/.test(e)) ? 'arrow' : 'line';
      break;
    }
    case 'PolyLine':
      pts = pairs(numbers(doc, getArray(doc, dict, 'Vertices')));
      if (intent === 'PolyLineAngle') {
        if (pts.length !== 3) return null;
        type = 'angle';
        break;
      }
      type = intent === 'PolyLineDimension' ? (/perimeter/i.test(subj) ? 'perimeter' : 'polylength') : 'polyline';
      break;
    case 'Polygon':
      pts = pairs(numbers(doc, getArray(doc, dict, 'Vertices')));
      if (intent === 'PolygonRadius') {
        // [center, edge, arc end]; only full circles (arc end back at the center) are editable
        if (pts.length !== 3 || Math.hypot(pts[2].x - pts[0].x, pts[2].y - pts[0].y) > 1) return null;
        pts = [pts[0], pts[1]];
        type = 'radius';
        break;
      }
      type = intent === 'PolygonDimension' ? (/perimeter/i.test(subj) ? 'perimeter' : 'area')
        : intent === 'PolygonVolume' ? 'volume'
          : cloudy ? 'cloud' : 'polygon';
      break;
    case 'Square':
      if (!inner) return null;
      pts = rectPts(inner);
      type = cloudy ? 'cloud' : 'rectangle';
      if (cloudy) pts = [pts[0], { x: pts[1].x, y: pts[0].y }, pts[1], { x: pts[0].x, y: pts[1].y }];
      break;
    case 'Circle':
      if (!inner) return null;
      if (intent === 'CircleDimension') {
        const cy = (inner[1] + inner[3]) / 2;
        pts = [{ x: inner[0], y: cy }, { x: inner[2], y: cy }];
        type = 'diameter';
        break;
      }
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
  const markup = {
    ...baseMarkup(doc, dict, ref, page, type, ct), text,
    cutouts: ct?.cutouts?.map((c) => ({ kind: c.kind, points: pairs(c.points) })),
  };
  if (type === 'volume' && markup.depth === undefined) markup.depth = 0;
  return { markup, pdfPoints: pts, displayed: getText(doc, dict, 'Contents') };
}

/** Revu count groups: one annotation per item, grouped via /IRT + /RT /Group. */
function readCounts(doc: PDFDocument, items: { ref: PDFRef; dict: PDFDict }[], page: number): RawImport[] {
  const groups = new Map<string, { head?: { ref: PDFRef; dict: PDFDict }; members: { ref: PDFRef; dict: PDFDict }[] }>();
  for (const it of items) {
    const irt = it.dict.get(N('IRT'));
    const grouped = irt instanceof PDFRef && getName(doc, it.dict, 'RT') === 'Group';
    const key = grouped ? refKey(irt) : refKey(it.ref);
    const g = groups.get(key) ?? { members: [] };
    if (grouped) g.members.push(it); else g.head = it;
    groups.set(key, g);
  }
  const out: RawImport[] = [];
  for (const g of groups.values()) {
    const all = [g.head, ...g.members].filter(Boolean) as { ref: PDFRef; dict: PDFDict }[];
    const head = all[0];
    const ct = readCT(doc, head.dict);
    const pts = ct?.points ? pairs(ct.points) : all.map(({ dict }) => {
      const r = numbers(doc, getArray(doc, dict, 'Rect'));
      return { x: (r[0] + r[2]) / 2, y: (r[1] + r[3]) / 2 };
    });
    const markup = baseMarkup(doc, head.dict, head.ref, page, 'count', ct);
    markup.source = { ...markup.source, extraRefs: all.slice(1).map((x) => toRef(x.ref)) } as never;
    out.push({ markup, pdfPoints: pts, displayed: String(getNumber(doc, head.dict, 'NumCounts') ?? '') });
  }
  return out;
}

/** A /VP viewport with its own scale; `bbox` is in PDF user space. */
export interface RawViewport { id: string; name: string; bbox: [number, number, number, number]; scale: Scale }

export interface ImportResult {
  raws: RawImport[];
  /** Page scale: the /VP viewport that covers the whole page and has no /Name. */
  pageScales: (Scale | null)[];
  /** Named /VP viewports (regions with their own scale), per page. */
  pageViewports: RawViewport[][];
  /** refKeys of annotations represented by markups, per page. */
  imported: Set<string>[];
}

export function importAnnotations(doc: PDFDocument): ImportResult {
  const raws: RawImport[] = [];
  const pageScales: (Scale | null)[] = [];
  const pageViewports: RawViewport[][] = [];
  const imported: Set<string>[] = [];
  for (let p = 0; p < doc.getPageCount(); p++) {
    const taken = new Set<string>();
    const counts: { ref: PDFRef; dict: PDFDict }[] = [];
    for (const a of pageAnnots(doc, p)) {
      try {
        const ct = readCT(doc, a.dict);
        if (getName(doc, a.dict, 'IT') === 'PolygonCount' || ct?.type === 'count') { counts.push(a); continue; }
        const r = readAnnot(doc, a.dict, a.ref, p);
        if (r) { raws.push(r); taken.add(refKey(a.ref)); }
      } catch (e) {
        console.warn('Skipping annotation', refKey(a.ref), e);
      }
    }
    for (const r of readCounts(doc, counts, p)) {
      raws.push(r);
      const src = r.markup.source as Ref & { extraRefs?: Ref[] };
      for (const x of [src, ...(src.extraRefs ?? [])]) taken.add(refKey(x));
    }
    imported.push(taken);

    const { scale, viewports } = readViewports(doc, p);
    pageScales.push(scale);
    pageViewports.push(viewports);
  }
  return { raws, pageScales, pageViewports, imported };
}

/** True for a /VP entry that holds a ruler (/RL) scale. */
export function isRulerViewport(doc: PDFDocument, v: PDFDict): boolean {
  const m = getDict(doc, v, 'Measure');
  return !!m && (getName(doc, m, 'Subtype') ?? 'RL') === 'RL';
}

function readViewports(doc: PDFDocument, p: number): { scale: Scale | null; viewports: RawViewport[] } {
  let scale: Scale | null = null;
  const viewports: RawViewport[] = [];
  const page = doc.getPage(p);
  const vp = page.node.lookup(N('VP'));
  if (!(vp instanceof PDFArray)) return { scale, viewports };
  const box = page.getCropBox();
  for (let i = 0; i < vp.size(); i++) {
    const v = lookup(doc, vp.get(i));
    if (!(v instanceof PDFDict) || !isRulerViewport(doc, v)) continue;
    const s = readMeasure(doc, getDict(doc, v, 'Measure')!);
    const b = numbers(doc, getArray(doc, v, 'BBox'));
    if (!s || b.length !== 4) continue;
    const bbox: RawViewport['bbox'] = [Math.min(b[0], b[2]), Math.min(b[1], b[3]), Math.max(b[0], b[2]), Math.max(b[1], b[3])];
    const name = getText(doc, v, 'Name');
    const whole = bbox[0] <= box.x + 1 && bbox[1] <= box.y + 1
      && bbox[2] >= box.x + box.width - 1 && bbox[3] >= box.y + box.height - 1;
    // Earlier CyanTakeoff builds named the page scale "CyanTakeoff".
    if (whole && (!name || name === 'CyanTakeoff') && !scale) { scale = s; continue; }
    viewports.push({ id: getText(doc, v, 'NM') || crypto.randomUUID(), name: name ?? '', bbox, scale: s });
  }
  return { scale, viewports };
}
