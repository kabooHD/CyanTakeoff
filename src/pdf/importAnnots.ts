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
import { CURVABLE, closedType, fromPdfPath } from '../model/curves';
import { refId } from './layers';
import { PDFArray, PDFDict, PDFHexString, PDFName, PDFString, PDFNumber, PDFRawStream, PDFRef, decodePDFRawStream, type PDFDocument } from 'pdf-lib';
import type { CustomColumn, Markup, MarkupStatus, MarkupStyle, MarkupType, Pt, Reply, Scale } from '../model/types';
import { DEFAULT_STYLES, toolById } from '../tools/tools';
import { MEASURE_TYPES } from '../model/measure';
import { DEFAULT_LINE_HEIGHT, alignOfQuadding, parseDS } from '../model/textStyle';
import { symbolOfCountStyle } from '../model/count';
import { LINE_END_TYPES, defaultEnds, lineEndOfName } from '../model/lineEnds';
import { blendOfName, defaultBlend } from '../model/blend';

/** /LE (an array for lines, a name for callouts) as lineStart/lineEnd, only when they differ from the type's defaults. */
function readLineEnds(doc: PDFDocument, dict: PDFDict, type: MarkupType): Pick<MarkupStyle, 'lineStart' | 'lineEnd'> {
  if (!LINE_END_TYPES.has(type)) return {};
  const le = dict.get(PDFName.of('LE'));
  const arr = getArray(doc, dict, 'LE');
  const names = arr ? [0, 1].map((i) => String(lookup(doc, arr.get(i)) ?? '')) : le instanceof PDFName ? ['None', le.toString()] : [];
  if (!names.length) return {};
  const d = defaultEnds(type);
  const start = lineEndOfName(names[0]), end = lineEndOfName(names[1]);
  return { ...(start && start !== d.start ? { lineStart: start } : {}), ...(end && end !== d.end ? { lineEnd: end } : {}) };
}
import {
  N, colorToHex, getArray, getDict, getName, getNumber, getText, lookup, numbers,
  parsePdfDate, readMeasure,
} from './pdfutil';

/** Private data CyanTakeoff stores on its own annotations. */
export interface CTData {
  v: 1;
  type: MarkupType;
  label?: string;
  /** Stamp subtitle as placed. */
  subtitle?: string;
  stampBorder?: Markup['stampBorder'];
  status?: MarkupStatus;
  statusModel?: string;
  statusBy?: string;
  statusDate?: string;
  depth?: number;
  fillOpacity?: number;
  lineStyle?: MarkupStyle['lineStyle'];
  lineDef?: MarkupStyle['lineDef']; // copy of a custom line style
  hatch?: MarkupStyle['hatch'];
  hatchScale?: number;
  points?: number[]; // PDF-space points for types whose geometry is not standard (count)
  comment?: string; // measurement comments (/Contents holds the value, as in Revu)
  cutouts?: { kind: 'polygon' | 'ellipse'; points: number[]; handles?: (number[] | null)[] }[]; // PDF-space holes in an area/volume
  text?: string; // stamp label, Cloud+ text
  slope?: Markup['slope'];
  rise?: number;
  custom?: Markup['custom'];
  legend?: Markup['legend'];
  checked?: boolean;
  rotation?: number; // box shapes turned about their centre (degrees, counter-clockwise)
  groupId?: string; // Revu-style markup group
  seq?: Markup['seq']; // Sequence member
  display?: Markup['display']; // caption, segment values, centroid, units
  capture?: Markup['capture']; // Capture photos
  valign?: MarkupStyle['valign']; margin?: number; autoSize?: boolean; shape?: MarkupStyle['shape']; // text box extras
  countSymbol?: MarkupStyle['countSymbol']; countScale?: number; // Count appearance
  handles?: (number[] | null)[]; // curved segments: PDF-space [inX, inY, outX, outY] offsets per vertex
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
  const blend = readBlend(doc, dict);
  const stroke = colorToHex(numbers(doc, getArray(doc, dict, 'C')));
  const fill = colorToHex(numbers(doc, getArray(doc, dict, 'IC')));
  const ca = getNumber(doc, dict, 'CA');
  const bs = getDict(doc, dict, 'BS');
  const width = (bs && getNumber(doc, bs, 'W')) ?? numbers(doc, getArray(doc, dict, 'Border'))[2] ?? defaults.width;
  const dashed = bs && getName(doc, bs, 'S') === 'D';
  const da = getText(doc, dict, 'DA') ?? getText(doc, dict, 'DS') ?? '';
  const ds = parseDS(getText(doc, dict, 'DS') ?? '');
  const fontSize = ds.fontSize || Number(da.match(/([\d.]+)\s*(?:Tf|pt)/)?.[1]) || defaults.fontSize;
  const textColor = da.match(/([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+rg/);
  const textual = type === 'textbox' || type === 'callout';
  const textTypes = textual || type === 'typewriter' || type === 'cloudplus';
  // Text formatting: /DS, /Q and the DA font name (ours or Revu's), plus our extras.
  const daFont = /\/(He|Ti|Co|Helv|Cour|Arial|Times)[A-Za-z]*/.exec(da)?.[0] ?? '';
  const text: Partial<MarkupStyle> = textTypes ? {
    ...ds,
    font: ds.font ?? (/^\/(Ti|Times)/.test(daFont) ? 'Times' : /^\/(Co|Cour)/.test(daFont) ? 'Courier' : undefined),
    bold: ds.bold ?? (/^\/(HeBo|HeBO|TiBo|TiBI|CoBo|CoBO)/.test(daFont) || undefined),
    italic: ds.italic ?? (/^\/(HeOb|HeBO|TiIt|TiBI|CoOb|CoBO)/.test(daFont) || undefined),
    align: ds.align ?? alignOfQuadding(getNumber(doc, dict, 'Q')),
    valign: ct?.valign, margin: ct?.margin, autoSize: ct?.autoSize || undefined, shape: ct?.shape,
  } : {};
  if (text.lineHeight === DEFAULT_LINE_HEIGHT) delete text.lineHeight;
  for (const k of Object.keys(text) as (keyof MarkupStyle)[]) if (text[k] === undefined || text[k] === false) delete text[k];
  // Polylines/lines: Revu writes /IC as the arrowhead fill, not a shape fill.
  const fillable = !['line', 'arrow', 'length', 'polyline', 'polylength', 'perimeter', 'pen'].includes(type);
  return {
    ...defaults,
    color: textual ? stroke ?? (textColor ? colorToHex(textColor.slice(1, 4).map(Number))! : defaults.color) : stroke ?? defaults.color,
    fill: type === 'highlight' ? stroke ?? defaults.fill : fillable ? fill : null,
    opacity: ca ?? 1,
    fillOpacity: ct?.fillOpacity ?? getNumber(doc, dict, 'FillOpacity') ?? ca ?? defaults.fillOpacity,
    width,
    lineStyle: ct?.lineStyle ?? (dashed ? 'dashed' : 'solid'),
    ...(ct?.lineDef ? { lineDef: ct.lineDef } : {}),
    ...(ct?.hatch ? { hatch: ct.hatch, hatchScale: ct.hatchScale } : {}),
    ...(blend && blend !== defaultBlend(type) ? { blend } : {}),
    fontSize,
    ...readLineEnds(doc, dict, type),
    ...(type === 'count' ? { countSymbol: ct?.countSymbol ?? symbolOfCountStyle(getName(doc, dict, 'CountStyle')), countScale: ct?.countScale } : {}),
    ...text,
    ...(textTypes && (ds.textColor ?? (textColor ? colorToHex(textColor.slice(1, 4).map(Number)) : undefined)) ? { textColor: ds.textColor ?? colorToHex(textColor!.slice(1, 4).map(Number))! } : {}),
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
    comment: ct?.comment ?? (['textbox', 'callout', 'typewriter', 'cloudplus'].includes(type) || isMeasure ? '' : contents),
    author: getText(doc, dict, 'T') ?? '',
    created,
    modified: parsePdfDate(getText(doc, dict, 'M')) ?? created,
    status: ct?.status ?? 'None',
    statusModel: ct?.statusModel, statusBy: ct?.statusBy, statusDate: ct?.statusDate,
    scale: measureDict ? readMeasure(doc, measureDict) : undefined,
    depth: ct?.depth ?? getNumber(doc, dict, 'Depth'),
    source: { ...toRef(ref), dirty: false },
    groupId: ct?.groupId,
    slope: ct?.slope,
    rise: ct?.rise,
    custom: ct?.custom,
    legend: ct?.legend,
    checked: ct?.checked,
    rotation: ct?.rotation,
    seq: ct?.seq,
    display: ct?.display,
    capture: ct?.capture,
    locked: ((getNumber(doc, dict, 'F') ?? 0) & 128) !== 0 || undefined,
    hidden: ((getNumber(doc, dict, 'F') ?? 0) & 2) !== 0 || undefined,
    layer: dict.get(PDFName.of('OC')) instanceof PDFRef ? refId(dict.get(PDFName.of('OC')) as PDFRef) : undefined,
    link: type === 'link' ? undefined : readAction(doc, dict),
  } satisfies Omit<Markup, 'points'>;
}

/** The action of a markup (Revu Edit Action): web address, page, Place, or page of another file. */
function readAction(doc: PDFDocument, dict: PDFDict): Markup['link'] {
  const a = lookup(doc, dict.get(N('A')));
  if (!(a instanceof PDFDict)) return undefined;
  const kind = getName(doc, a, 'S');
  if (kind === 'URI') { const uri = getText(doc, a, 'URI'); return uri ? { uri } : undefined; }
  const d = lookup(doc, a.get(N('D')));
  if (kind === 'GoTo') {
    if (d instanceof PDFName || d instanceof PDFString || d instanceof PDFHexString) return { dest: d.decodeText() };
    const p = d instanceof PDFArray ? d.get(0) : undefined;
    const i = p instanceof PDFRef ? doc.getPages().findIndex((pg) => pg.ref === p) : -1;
    return i >= 0 ? { page: i } : undefined;
  }
  if (kind === 'GoToR') {
    const fs = lookup(doc, a.get(N('F')));
    const file = fs instanceof PDFDict ? getText(doc, fs, 'UF') ?? getText(doc, fs, 'F') : getText(doc, a, 'F');
    const pg = d instanceof PDFArray ? lookup(doc, d.get(0)) : undefined;
    return file ? { file, page: pg instanceof PDFNumber ? pg.asNumber() : 0 } : undefined;
  }
  return undefined;
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

  // Unknown measurement intents are left as-is.
  if (intent && /Dimension|Volume|Count|Radius|Angle|Arc/.test(intent) && !MEASURE_INTENTS[intent] && !ct) return null;

  let type: MarkupType | null = null;
  let pts: Pt[] = [];
  let text: string | undefined;
  let extra: Partial<Markup> = {};
  /** QuadPoints as rectangle corner pairs (text markups, highlights). */
  const quadRects = () => {
    const q = numbers(doc, getArray(doc, dict, 'QuadPoints'));
    const out: Pt[] = [];
    for (let i = 0; i + 7 < q.length; i += 8) {
      const xs = [q[i], q[i + 2], q[i + 4], q[i + 6]], ys = [q[i + 1], q[i + 3], q[i + 5], q[i + 7]];
      out.push({ x: Math.min(...xs), y: Math.max(...ys) }, { x: Math.max(...xs), y: Math.min(...ys) });
    }
    return out;
  };
  switch (subtype) {
    case 'Line': {
      pts = pairs(numbers(doc, getArray(doc, dict, 'L')));
      const le = getArray(doc, dict, 'LE');
      const ends = le ? [0, 1].map((i) => String(lookup(doc, le.get(i)) ?? '')) : [];
      type = intent === 'LineDimension' ? (/^dimension/i.test(subj) ? 'dimension' : 'length') : ends.some((e) => /Arrow/.test(e)) ? 'arrow' : 'line';
      break;
    }
    case 'Redact':
      pts = quadRects();
      if (!pts.length && rect.length === 4) pts = rectPts(rect);
      type = 'redaction';
      break;
    case 'Caret':
      if (rect.length !== 4) return null;
      pts = rectPts(rect);
      type = 'caret';
      break;
    case 'StrikeOut': case 'Underline': case 'Squiggly':
      pts = quadRects();
      type = subtype === 'StrikeOut' ? 'strikeout' : subtype === 'Underline' ? 'underline' : 'squiggly';
      break;
    case 'Stamp': {
      // Only CyanTakeoff's own stamps and images are editable; other stamps keep their artwork untouched.
      if (!inner || (ct?.type !== 'stamp' && ct?.type !== 'image' && ct?.type !== 'legend')) return null;
      pts = rectPts(inner);
      if (ct.type === 'image') {
        const image = readImage(doc, dict);
        if (!image) return null;
        extra = { image };
      } else {
        text = ct.text ?? '';
        if (ct.subtitle !== undefined) extra = { subtitle: ct.subtitle };
        if (ct.stampBorder) extra = { ...extra, stampBorder: ct.stampBorder };
      }
      break;
    }
    case 'Link': {
      if (rect.length !== 4) return null;
      const a = getDict(doc, dict, 'A');
      const uri = a && getName(doc, a, 'S') === 'URI' ? getText(doc, a, 'URI') : undefined;
      // Link to a page of another file (Revu Batch Link across a set).
      if (a && getName(doc, a, 'S') === 'GoToR') {
        const fs = lookup(doc, a.get(N('F')));
        const file = fs instanceof PDFDict ? getText(doc, fs, 'UF') ?? getText(doc, fs, 'F') : getText(doc, a, 'F');
        const d = lookup(doc, a.get(N('D')));
        const pg = d instanceof PDFArray ? lookup(doc, d.get(0)) : undefined;
        if (!file || rect.length !== 4) return null;
        pts = rectPts(rect);
        type = 'link';
        extra = { link: { file, page: typeof (pg as { asNumber?: () => number })?.asNumber === 'function' ? (pg as unknown as { asNumber: () => number }).asNumber() : 0 } };
        break;
      }
      const rawDest = dict.get(N('Dest')) ?? (a && getName(doc, a, 'S') === 'GoTo' ? a.get(N('D')) : undefined);
      const dest = lookup(doc, rawDest);
      // A jump to a Place (named destination) keeps the name, so the link follows the Place if it moves.
      if (dest instanceof PDFName || dest instanceof PDFString || dest instanceof PDFHexString) {
        pts = rectPts(rect);
        type = 'link';
        extra = { link: { dest: dest.decodeText() } };
        break;
      }
      const pageRef = dest instanceof PDFArray ? dest.get(0) : undefined;
      const target = pageRef instanceof PDFRef ? doc.getPages().findIndex((pg) => pg.ref === pageRef) : -1;
      if (!uri && target < 0) return null; // named destinations, JavaScript, etc. stay as-is
      pts = rectPts(rect);
      type = 'link';
      extra = { link: uri ? { uri } : { page: target } };
      break;
    }
    case 'FileAttachment': {
      if (rect.length !== 4) return null;
      const file = readAttachment(doc, dict);
      if (!file) return null;
      pts = [{ x: rect[0], y: rect[3] }];
      type = 'attachment';
      extra = { file };
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
        // Revu: [arc start (on the circle), center, arc end]; a full circle ends where it starts.
        if (pts.length !== 3) return null;
        const [start, center, end] = pts;
        pts = Math.hypot(end.x - start.x, end.y - start.y) <= 1 ? [center, start] : [center, start, end];
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
      if (intent === 'FreeTextTypeWriter' || intent === 'FreeTextTypewriter') {
        pts = rectPts(inner);
        type = 'typewriter';
      } else if (intent === 'FreeTextCallout') {
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
      type = getName(doc, dict, 'Name') === 'Flag' ? 'flag' : 'note';
      break;
    case 'Highlight': {
      pts = quadRects();
      if (!pts.length) return null;
      type = 'highlight';
      break;
    }
    default:
      return null;
  }
  if (ct?.type) type = ct.type;
  if (ct?.points) pts = pairs(ct.points);
  if (type === 'cloudplus') text = getText(doc, dict, 'Contents') ?? ct?.text ?? '';
  if (!type || pts.length === 0) return null;
  // Curved segments: ours from CTData, else a PDF 2.0 /Path from another app.
  let handles: Markup['handles'] = ct?.handles?.map((h) => (h ? { in: { x: h[0], y: h[1] }, out: { x: h[2], y: h[3] } } : null));
  const path = dict.lookup(PDFName.of('Path'));
  if (CURVABLE.has(type) && path instanceof PDFArray) {
    // /Vertices of a curved markup is a flattened copy: the vertices come from /Path.
    const ops = path.asArray().map((a) => { const v = a instanceof PDFRef ? doc.context.lookup(a) : a; return v instanceof PDFArray ? v.asArray().map((n) => (n instanceof PDFNumber ? n.asNumber() : 0)) : []; });
    const read = fromPdfPath(ops, (x, y) => ({ x, y }), closedType(type));
    if (read.points.length >= 2 && (read.handles || handles)) { pts = read.points; handles ??= read.handles; }
  }
  if (handles && handles.length !== pts.length) handles = undefined;
  const markup = {
    ...baseMarkup(doc, dict, ref, page, type, ct), text, ...extra,
    cutouts: ct?.cutouts?.map((c) => ({ kind: c.kind, points: pairs(c.points), handles: c.handles?.map((h) => (h && h.length === 4 ? { in: { x: h[0], y: h[1] }, out: { x: h[2], y: h[3] } } : null)) })),
    handles,
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

export interface RawSpace { title: string; path: Pt[]; color: string; opacity: number }

/** Revu Spaces: page /BSISpaces, each /Space with /Title, /Path [[x y]...], /C, /CA and nested /Kids. */
function readSpaces(doc: PDFDocument, p: number): RawSpace[] {
  const out: RawSpace[] = [];
  const walk = (arr: unknown, depth: number) => {
    if (!(arr instanceof PDFArray) || depth > 32) return;
    for (let i = 0; i < arr.size(); i++) {
      const sp = lookup(doc, arr.get(i));
      if (!(sp instanceof PDFDict)) continue;
      const path = getArray(doc, sp, 'Path');
      const pts: Pt[] = [];
      for (let j = 0; path && j < path.size(); j++) {
        const xy = numbers(doc, lookup(doc, path.get(j)) as PDFArray);
        if (xy.length >= 2) pts.push({ x: xy[0], y: xy[1] });
      }
      if (pts.length >= 3) {
        out.push({
          title: getText(doc, sp, 'Title') ?? '',
          path: pts,
          color: colorToHex(numbers(doc, getArray(doc, sp, 'C'))) ?? '#0000ff',
          opacity: getNumber(doc, sp, 'CA') ?? 0.1,
        });
      }
      walk(lookup(doc, sp.get(N('Kids'))), depth + 1);
    }
  };
  walk(lookup(doc, doc.getPage(p).node.get(N('BSISpaces'))), 0);
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
  /** Revu Spaces (/BSISpaces), flattened, per page; paths in PDF space. */
  pageSpaces: RawSpace[][];
  /** refKeys of annotations represented by markups, per page. */
  imported: Set<string>[];
}

export function importAnnotations(doc: PDFDocument): ImportResult {
  const raws: RawImport[] = [];
  const pageScales: (Scale | null)[] = [];
  const pageViewports: RawViewport[][] = [];
  const pageSpaces: RawSpace[][] = [];
  const imported: Set<string>[] = [];
  for (let p = 0; p < doc.getPageCount(); p++) {
    const taken = new Set<string>();
    const counts: { ref: PDFRef; dict: PDFDict }[] = [];
    const groupHeads = new Set<string>();
    const pageRaws: RawImport[] = [];
    const replies: { parent: string; ref: PDFRef; reply: Reply }[] = [];
    for (const a of pageAnnots(doc, p)) {
      try {
        const ct = readCT(doc, a.dict);
        // Replies: /Text annotations pointing at their markup with /IRT (reply type /R, the default).
        const irt0 = a.dict.get(N('IRT'));
        if (irt0 instanceof PDFRef && getName(doc, a.dict, 'Subtype') === 'Text' && (getName(doc, a.dict, 'RT') ?? 'R') === 'R') {
          const date = parsePdfDate(getText(doc, a.dict, 'M')) ?? parsePdfDate(getText(doc, a.dict, 'CreationDate')) ?? new Date().toISOString();
          replies.push({ parent: refKey(irt0), ref: a.ref, reply: { id: crypto.randomUUID(), author: getText(doc, a.dict, 'T') ?? '', date, text: getText(doc, a.dict, 'Contents') ?? '' } });
          continue;
        }
        if (getName(doc, a.dict, 'IT') === 'PolygonCount' || ct?.type === 'count') { counts.push(a); continue; }
        const r = readAnnot(doc, a.dict, a.ref, p);
        if (r) {
          // Revu markup groups: /IRT to the group's first markup with /RT /Group.
          const irt = a.dict.get(N('IRT'));
          if (irt instanceof PDFRef && getName(doc, a.dict, 'RT') === 'Group') {
            r.markup.groupId ??= `g${refKey(irt)}`;
            groupHeads.add(refKey(irt));
          }
          raws.push(r); pageRaws.push(r); taken.add(refKey(a.ref));
        }
      } catch (e) {
        console.warn('Skipping annotation', refKey(a.ref), e);
      }
    }
    for (const r of pageRaws) {
      const key = refKey(r.markup.source as Ref);
      if (groupHeads.has(key)) r.markup.groupId ??= `g${key}`;
      // Attach replies; they are rewritten with their markup.
      const mine = replies.filter((x) => x.parent === key);
      if (mine.length) {
        r.markup.replies = mine.map((x) => x.reply).sort((a, b) => a.date.localeCompare(b.date));
        const src = r.markup.source as Ref & { extraRefs?: Ref[] };
        src.extraRefs = [...(src.extraRefs ?? []), ...mine.map((x) => toRef(x.ref))];
        for (const x of mine) taken.add(refKey(x.ref));
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
    pageSpaces.push(readSpaces(doc, p));
  }
  return { raws, pageScales, pageViewports, pageSpaces, imported };
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

/** Bytes of a (possibly compressed) stream. */
function streamBytes(s: unknown): Uint8Array | undefined {
  if (s instanceof PDFRawStream) {
    try { return decodePDFRawStream(s).decode(); } catch { return undefined; }
  }
  return undefined;
}

const toBase64 = (b: Uint8Array) => {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};

/** The blend mode (/BM) of the first graphics state in the annotation's appearance. */
export function readBlend(doc: PDFDocument, dict: PDFDict): ReturnType<typeof blendOfName> {
  const ap = getDict(doc, dict, 'AP');
  const n = ap && lookup(doc, ap.get(N('N')));
  if (!(n instanceof PDFRawStream)) return undefined;
  const res = getDict(doc, n.dict, 'Resources');
  const gss = res && getDict(doc, res, 'ExtGState');
  if (!gss) return undefined;
  for (const key of gss.keys()) {
    const gs = lookup(doc, gss.get(key));
    const bm = gs instanceof PDFDict ? gs.get(N('BM')) : undefined;
    const name = bm instanceof PDFName ? bm.decodeText() : bm instanceof PDFArray ? (bm.get(0) as PDFName | undefined)?.decodeText?.() : undefined;
    if (name) return blendOfName(name);
  }
  return undefined;
}

/** The picture of a CyanTakeoff image stamp, from its appearance (/Im0), as a data: URL. */
function readImage(doc: PDFDocument, dict: PDFDict): string | undefined {
  const ap = getDict(doc, dict, 'AP');
  const n = ap && lookup(doc, ap.get(N('N')));
  if (!(n instanceof PDFRawStream)) return undefined;
  const res = getDict(doc, n.dict, 'Resources');
  const xo = res && getDict(doc, res, 'XObject');
  const im = xo && lookup(doc, xo.get(N('Im0')));
  if (!(im instanceof PDFRawStream)) return undefined;
  const filter = getName(doc, im.dict, 'Filter');
  if (filter === 'DCTDecode') return `data:image/jpeg;base64,${toBase64(im.contents)}`;
  // pdf-lib writes PNGs as 8-bit RGB with an /SMask for alpha.
  const w = getNumber(doc, im.dict, 'Width') ?? 0, h = getNumber(doc, im.dict, 'Height') ?? 0;
  const rgb = streamBytes(im);
  const smask = lookup(doc, im.dict.get(N('SMask')));
  const alpha = smask ? streamBytes(smask) : undefined;
  if (!rgb || !w || !h || typeof document === 'undefined') return undefined;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  const comps = rgb.length / (w * h) >= 3 ? 3 : 1;
  for (let i = 0; i < w * h; i++) {
    img.data[i * 4] = rgb[i * comps]; img.data[i * 4 + 1] = rgb[i * comps + (comps === 3 ? 1 : 0)]; img.data[i * 4 + 2] = rgb[i * comps + (comps === 3 ? 2 : 0)];
    img.data[i * 4 + 3] = alpha ? alpha[i] : 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL('image/png');
}

/** The embedded file of a /FileAttachment annotation. */
function readAttachment(doc: PDFDocument, dict: PDFDict): Markup['file'] | undefined {
  const fs = getDict(doc, dict, 'FS');
  const ef = fs && getDict(doc, fs, 'EF');
  const stream = ef && lookup(doc, ef.get(N('F')));
  const bytes = streamBytes(stream);
  if (!fs || !bytes) return undefined;
  return { name: getText(doc, fs, 'UF') ?? getText(doc, fs, 'F') ?? 'attachment', mime: 'application/octet-stream', data: toBase64(bytes) };
}

/** Catalog key holding CyanTakeoff's custom column definitions (JSON). */
export const COLUMNS_KEY = 'CTColumns';

export function readColumns(doc: PDFDocument): CustomColumn[] {
  try {
    const t = getText(doc, doc.catalog, COLUMNS_KEY);
    const v = t ? JSON.parse(t) : [];
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}
