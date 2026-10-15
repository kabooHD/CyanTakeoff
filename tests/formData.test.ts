import { describe, expect, it } from 'vitest';
import { applyValues, migrateTypewriter, parseCsv, parseFdf, parseXfdfFields, resetValues, toCsv, toFdf, toXfdfFields } from '../src/model/formData';
import type { FormField } from '../src/pdf/forms';
import type { Markup } from '../src/model/types';

const fields: FormField[] = [
  { name: 'Name', type: 'text', value: '', widgets: [{ page: 0, rect: [10, 10, 110, 30] }] },
  { name: 'Done', type: 'checkbox', value: false, widgets: [] },
  { name: 'Sign', type: 'signature', value: '', widgets: [] },
];

describe('form data', () => {
  const values = { Name: 'Ana (Lead) \\ é', Done: true, 'Parent.Kid': 'x' };
  it('FDF round-trips strings, escapes and check boxes', () => {
    const fdf = toFdf(values, 'form.pdf');
    expect(fdf).toContain('%FDF-1.2');
    expect(fdf).toContain('/V /Yes');
    expect(parseFdf(fdf)).toEqual(values);
  });
  it('reads nested FDF fields with dotted names', () => {
    const fdf = '%FDF-1.2\n1 0 obj\n<< /FDF << /Fields [ << /T (A) /Kids [ << /T (B) /V (v) >> ] >> << /T (C) /V /Off >> ] >> >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF';
    expect(parseFdf(fdf)).toEqual({ 'A.B': 'v', C: false });
  });
  it('XFDF fields round-trip', () => {
    const xml = toXfdfFields({ Name: 'a<b', Done: true }, 'f.pdf');
    expect(parseXfdfFields(xml)).toEqual({ Name: 'a<b', Done: 'Yes' });
  });
  it('CSV has a header and one row per document, and reads back', () => {
    const csv = toCsv([{ file: 'a.pdf', values: { Name: 'x, "y"', Done: true } }, { file: 'b.pdf', values: { Name: 'z' } }]);
    expect(csv.split('\r\n')[0]).toBe('File,Name,Done');
    expect(csv.split('\r\n')[2]).toBe('b.pdf,z,');
    expect(parseCsv(csv)).toEqual({ Name: 'x, "y"', Done: 'Yes' });
  });
  it('typed values for the fields; reset clears them', () => {
    expect(applyValues(fields, { Name: 'Bob', Done: 'Yes', Sign: 'x', Other: 'y' })).toEqual({ Name: 'Bob', Done: true });
    expect(applyValues(fields, { Done: 'Off' })).toEqual({ Done: false });
    expect(resetValues(fields)).toEqual({ Name: '', Done: false });
  });
  it('migrates typewriter markups inside a text field', () => {
    const tw = (id: string, x: number, y: number, text: string): Markup => ({ id, type: 'typewriter', page: 0, points: [{ x, y }, { x: x + 40, y: y + 10 }], text, style: {} as Markup['style'], subject: 'Typewriter', label: '', comment: '', author: '', created: '', modified: '', status: 'None' });
    const toPage = (_p: number, x: number, y: number) => ({ x, y: 200 - y });
    const r = migrateTypewriter(fields, [tw('a', 20, 175, 'Ana'), tw('b', 300, 175, 'elsewhere')], toPage);
    expect(r).toEqual({ values: { Name: 'Ana' }, used: ['a'] });
  });
});
