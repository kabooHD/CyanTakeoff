import {
  PDFArray, PDFDict, PDFHexString, PDFName, PDFNumber, PDFRef, PDFString,
  type PDFDocument, type PDFObject,
} from 'pdf-lib';
import type { LengthUnit, Scale } from '../model/types';
import { resolveFormat } from '../model/measure';

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
  in: 'in', '"': 'in', ft: 'ft', "'": 'ft', "ft'": 'ft', yd: 'yd', mm: 'mm', cm: 'cm', m: 'm',
};

const unitOf = (doc: PDFDocument, a: PDFArray | undefined, i: number) => {
  const f = a && a.size() > i ? lookup(doc, a.get(i)) : undefined;
  return f instanceof PDFDict ? (getText(doc, f, 'U') ?? '').trim().toLowerCase() : undefined;
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
  // Feet-inches display: a second number format in inches, in /X or (as Revu writes it) /D.
  if (unit === 'ft') {
    const second = unitOf(doc, x, 1) ?? unitOf(doc, getArray(doc, measure, 'D'), 1);
    if (second === 'in' || second === '"') unit = 'ft-in';
  }
  const label = getText(doc, measure, 'R') ?? '';
  const fmtAt = (key: string, i = 0) => {
    const a = getArray(doc, measure, key);
    const f = a && a.size() > i ? lookup(doc, a.get(i)) : undefined;
    return f instanceof PDFDict ? f : undefined;
  };
  const dArr = getArray(doc, measure, 'D');
  const lastD = fmtAt('D', Math.max(0, (dArr?.size() ?? 1) - 1));
  const area = fmtAt('A');
  const vol = fmtAt('V');
  const decimalsOf = (f?: PDFDict) => {
    const d = f && getNumber(doc, f, 'D');
    return d && d >= 1 ? Math.round(Math.log10(d)) : undefined;
  };
  const fd = area ? lookup(doc, area.get(N('FD'))) : undefined;
  const format = {
    den: unit === 'ft-in' ? getNumber(doc, lastD ?? measure, 'D') : undefined,
    decimals: decimalsOf(area) ?? decimalsOf(fmtAt('D')),
    trim: fd ? String(fd) === 'true' : undefined,
    areaLabel: area ? getText(doc, area, 'U') : undefined,
    volumeLabel: vol ? getText(doc, vol, 'U') : undefined,
  };
  return { factor: c, unit, label, format };
}

/**
 * Build a /Measure dictionary for a scale, laid out the way Revu writes it:
 * feet as ' with the feet-inch split in /D, plus area (/A), angle (/T) and
 * volume (/V) number formats.
 */
export function writeMeasure(doc: PDFDocument, s: Scale): PDFDict {
  const ctx = doc.context;
  const f = resolveFormat(s);
  const prec = 10 ** f.decimals;
  const fmt = (u: string, c: number, extra: Record<string, unknown> = {}) =>
    ctx.obj({ Type: 'NumberFormat', U: PDFString.of(u), C: c, D: prec, FD: f.trim, SS: PDFString.of(''), ...extra });
  const feet = s.unit === 'ft' || s.unit === 'ft-in';
  const base = feet ? "'" : s.unit;
  const d = s.unit === 'ft-in'
    ? [fmt("'", 1, { F: 'F', D: f.den, SS: PDFString.of('-'), PS: PDFString.of('') }), fmt('"', 12, { F: 'F', D: f.den, PS: PDFString.of('') })]
    : [fmt(base, 1)];
  return ctx.obj({
    Type: 'Measure',
    Subtype: 'RL',
    R: PDFString.of(s.label),
    X: [fmt(base, s.factor, s.unit === 'ft-in' ? { F: 'F', D: f.den } : {})],
    D: d,
    A: [fmt(f.areaLabel, 1)],
    T: [fmt('\u00b0', 1)],
    V: [fmt(f.volumeLabel, 1)],
  }) as PDFDict;
}
