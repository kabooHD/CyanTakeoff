import {
  PDFArray, PDFDict, PDFHexString, PDFName, PDFNumber, PDFRef, PDFString,
  type PDFDocument, type PDFObject,
} from 'pdf-lib';
import type { LengthUnit, Scale } from '../model/types';

export const N = (s: string) => PDFName.of(s);

export function lookup(doc: PDFDocument, o: PDFObject | undefined): PDFObject | undefined {
  return o instanceof PDFRef ? doc.context.lookup(o) : o;
}

export function getDict(doc: PDFDocument, d: PDFDict, key: string): PDFDict | undefined {
  const v = lookup(doc, d.get(N(key)));
  return v instanceof PDFDict ? v : undefined;
}

export function getArray(doc: PDFDocument, d: PDFDict, key: string): PDFArray | undefined {
  const v = lookup(doc, d.get(N(key)));
  return v instanceof PDFArray ? v : undefined;
}

export function getNumber(doc: PDFDocument, d: PDFDict, key: string): number | undefined {
  const v = lookup(doc, d.get(N(key)));
  return v instanceof PDFNumber ? v.asNumber() : undefined;
}

export function getName(doc: PDFDocument, d: PDFDict, key: string): string | undefined {
  const v = lookup(doc, d.get(N(key)));
  return v instanceof PDFName ? v.decodeText() : undefined;
}

export function getText(doc: PDFDocument, d: PDFDict, key: string): string | undefined {
  const v = lookup(doc, d.get(N(key)));
  if (v instanceof PDFString || v instanceof PDFHexString) return v.decodeText();
  return undefined;
}

export function numbers(doc: PDFDocument, a: PDFArray | undefined): number[] {
  if (!a) return [];
  const out: number[] = [];
  for (let i = 0; i < a.size(); i++) {
    const v = lookup(doc, a.get(i));
    if (v instanceof PDFNumber) out.push(v.asNumber());
  }
  return out;
}

export function colorToHex(c: number[]): string | null {
  let rgb: number[];
  if (c.length === 1) rgb = [c[0], c[0], c[0]];
  else if (c.length === 3) rgb = c;
  else if (c.length === 4) rgb = [0, 1, 2].map((i) => (1 - c[i]) * (1 - c[3]));
  else return null;
  return '#' + rgb.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('');
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** PDF date string D:YYYYMMDDHHmmSS */
export function pdfDate(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

export function parsePdfDate(s: string | undefined): string | undefined {
  const m = s?.match(/^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?/);
  if (!m) return undefined;
  const [, y, mo = '01', d = '01', h = '00', mi = '00', se = '00'] = m;
  return new Date(`${y}-${mo}-${d}T${h}:${mi}:${se}Z`).toISOString();
}

// ---------- measure dictionaries (ISO 32000 12.9) ----------

const UNIT_STRINGS: Record<string, LengthUnit> = {
  in: 'in', '"': 'in', ft: 'ft', "'": 'ft', yd: 'yd', mm: 'mm', cm: 'cm', m: 'm',
};

/** Read a /Measure dictionary into a Scale (first /X number format). */
export function readMeasure(doc: PDFDocument, measure: PDFDict): Scale | undefined {
  const x = getArray(doc, measure, 'X');
  if (!x || x.size() === 0) return undefined;
  const f0 = lookup(doc, x.get(0));
  if (!(f0 instanceof PDFDict)) return undefined;
  const c = getNumber(doc, f0, 'C');
  const u = (getText(doc, f0, 'U') ?? '').trim().toLowerCase();
  if (!c) return undefined;
  let unit = UNIT_STRINGS[u];
  if (!unit) return undefined;
  if (unit === 'ft' && x.size() > 1) {
    const f1 = lookup(doc, x.get(1));
    if (f1 instanceof PDFDict && (getText(doc, f1, 'U') ?? '').trim().toLowerCase() === 'in') unit = 'ft-in';
  }
  const label = getText(doc, measure, 'R') ?? '';
  return { factor: c, unit, label };
}

/** Build a /Measure dictionary for a scale. */
export function writeMeasure(doc: PDFDocument, s: Scale): PDFDict {
  const ctx = doc.context;
  const fmt = (u: string, c: number, extra: Record<string, unknown> = {}) =>
    ctx.obj({ Type: 'NumberFormat', U: PDFString.of(u), C: c, D: 100, ...extra });
  const baseUnit = s.unit === 'ft-in' ? 'ft' : s.unit;
  const x = s.unit === 'ft-in'
    ? [fmt('ft', s.factor, { F: 'F' }), fmt('in', 12, { F: 'F', D: 16 })]
    : [fmt(baseUnit, s.factor)];
  return ctx.obj({
    Type: 'Measure',
    Subtype: 'RL',
    R: PDFString.of(s.label),
    X: x,
    D: [fmt(baseUnit, 1)],
    A: [fmt(`sq ${baseUnit}`, 1)],
  }) as PDFDict;
}
