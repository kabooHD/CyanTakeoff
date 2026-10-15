// Form data exchange (Revu Tools > Form > Import / Export / Merge Data):
// field values as FDF (ISO 32000 12.7.7), XFDF <fields> XML, or CSV; and
// Migrate Typewritten Text (Typewriter markups inside a field become its
// value).
import { PDFArray, PDFContext, PDFDict, PDFHexString, PDFName, PDFObjectParser, PDFString } from 'pdf-lib';
import type { FieldValue, FormField } from '../pdf/forms';
import type { Markup, Pt } from './types';
import { parseXml, type XNode } from '../pdf/xfdf';

export type Values = Record<string, FieldValue>;

/** The values to export: edits over the file's own values. */
export function currentValues(fields: FormField[], edits: Values): Values {
  const out: Values = {};
  for (const f of fields) if (f.type !== 'button' && f.type !== 'signature') out[f.name] = f.name in edits ? edits[f.name] : f.value;
  return out;
}

const pdfString = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? `(${s.replace(/[\\()]/g, (c) => `\\${c}`)})` : `<${PDFHexString.fromText(s).toString().slice(1, -1)}>`);

/** FDF text for the values (checkboxes as /Yes and /Off). */
export function toFdf(values: Values, fileName: string): string {
  const fields = Object.entries(values).map(([name, v]) => `<< /T ${pdfString(name)} /V ${typeof v === 'boolean' ? (v ? '/Yes' : '/Off') : pdfString(String(v))} >>`);
  return `%FDF-1.2\n1 0 obj\n<< /FDF << /F ${pdfString(fileName)} /Fields [ ${fields.join(' ')} ] >> >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n`;
}

const text = (o: unknown): string | undefined => (o instanceof PDFString || o instanceof PDFHexString ? o.decodeText() : o instanceof PDFName ? o.decodeText() : undefined);

/** Values from an FDF file (fields nested in /Kids get dotted names). */
export function parseFdf(data: string): Values {
  const out: Values = {};
  const m = /obj\s*(<<[\s\S]*?>>)\s*endobj/.exec(data);
  if (!m) throw new Error('Not an FDF file');
  const ctx = PDFContext.create();
  const root = PDFObjectParser.forBytes(new TextEncoder().encode(m[1]), ctx).parseObject();
  const fdf = root instanceof PDFDict ? root.lookup(PDFName.of('FDF')) : undefined;
  const fields = fdf instanceof PDFDict ? fdf.lookup(PDFName.of('Fields')) : undefined;
  const walk = (arr: unknown, prefix: string) => {
    if (!(arr instanceof PDFArray)) return;
    for (const item of arr.asArray()) {
      const d = item instanceof PDFDict ? item : ctx.lookup(item);
      if (!(d instanceof PDFDict)) continue;
      const name = prefix + (text(d.lookup(PDFName.of('T'))) ?? '');
      const v = d.lookup(PDFName.of('V'));
      if (v !== undefined) {
        const val = v instanceof PDFArray ? text(v.lookup(0)) : text(v);
        if (val !== undefined) out[name] = v instanceof PDFName ? (val !== 'Off') : val;
      }
      walk(d.lookup(PDFName.of('Kids')), `${name}.`);
    }
  };
  walk(fields, '');
  return out;
}

const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]!));

/** XFDF form-data XML. */
export function toXfdfFields(values: Values, fileName: string): string {
  const rows = Object.entries(values).map(([n, v]) => `<field name="${esc(n)}"><value>${esc(typeof v === 'boolean' ? (v ? 'Yes' : 'Off') : String(v))}</value></field>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<xfdf xmlns="http://ns.adobe.com/xfdf/" xml:space="preserve"><f href="${esc(fileName)}"/><fields>${rows.join('')}</fields></xfdf>\n`;
}

/** Values from XFDF (or any XML with <field name><value>) — nested fields get dotted names. */
export function parseXfdfFields(xml: string): Values {
  const out: Values = {};
  const local = (n: string) => n.slice(n.indexOf(':') + 1);
  const walk = (n: XNode, prefix: string) => {
    for (const c of n.children) {
      if (local(c.name) === 'field') {
        const name = prefix + (c.attrs.name ?? '');
        const v = c.children.find((x) => local(x.name) === 'value');
        if (v) out[name] = v.text;
        walk(c, `${name}.`);
      } else walk(c, prefix);
    }
  };
  walk(parseXml(xml), '');
  return out;
}

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const csvText = (v: FieldValue) => (typeof v === 'boolean' ? (v ? 'Yes' : 'Off') : String(v));

/** CSV: a header of field names and one row per document (Merge Data joins several). */
export function toCsv(docs: { file: string; values: Values }[]): string {
  const names = [...new Set(docs.flatMap((d) => Object.keys(d.values)))];
  const lines = [['File', ...names].map(csvCell).join(',')];
  for (const d of docs) lines.push([d.file, ...names.map((n) => (n in d.values ? csvText(d.values[n]) : ''))].map(csvCell).join(','));
  return lines.join('\r\n') + '\r\n';
}

/** Values from our CSV (first data row). */
export function parseCsv(data: string): Values {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < data.length; i++) {
    const c = data[i];
    if (q) { if (c === '"') { if (data[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && data[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, first] = rows.filter((r) => r.some((x) => x));
  const out: Values = {};
  if (!head || !first) return out;
  head.forEach((n, i) => { if (n && n !== 'File' && first[i] !== undefined) out[n] = first[i]; });
  return out;
}

/** Imported values typed for the fields they fill (unknown names dropped). */
export function applyValues(fields: FormField[], values: Values): Values {
  const out: Values = {};
  for (const f of fields) {
    if (!(f.name in values) || f.type === 'button' || f.type === 'signature') continue;
    const v = values[f.name];
    if (f.type === 'checkbox') out[f.name] = typeof v === 'boolean' ? v : !['', 'Off', 'false', '0', 'No'].includes(String(v));
    else out[f.name] = typeof v === 'boolean' ? (v ? 'Yes' : '') : String(v);
  }
  return out;
}

/** Cleared values: text, lists and buttons empty, boxes unchecked. */
export function resetValues(fields: FormField[]): Values {
  const out: Values = {};
  for (const f of fields) if (f.type !== 'button' && f.type !== 'signature') out[f.name] = f.type === 'checkbox' ? false : '';
  return out;
}

/**
 * Migrate Typewritten Text: Typewriter markups whose box centre lies in a
 * text field's widget become the field's value (several join with
 * newlines). `toPage` turns a PDF-space point into page space.
 */
export function migrateTypewriter(fields: FormField[], markups: Markup[], toPage: (page: number, x: number, y: number) => Pt): { values: Values; used: string[] } {
  const values: Values = {};
  const used: string[] = [];
  for (const f of fields) {
    if (f.type !== 'text') continue;
    const texts: string[] = [];
    for (const w of f.widgets) {
      const a = toPage(w.page, w.rect[0], w.rect[1]), b = toPage(w.page, w.rect[2], w.rect[3]);
      const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
      for (const m of markups) {
        if (m.type !== 'typewriter' || m.page !== w.page || !m.text?.trim() || m.points.length < 2) continue;
        const cx = (m.points[0].x + m.points[1].x) / 2, cy = (m.points[0].y + m.points[1].y) / 2;
        if (cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1) { texts.push(m.text.trim()); used.push(m.id); }
      }
    }
    if (texts.length) values[f.name] = texts.join('\n');
  }
  return { values, used };
}
