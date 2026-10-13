import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { createField, deleteField, readFields, renameField, setFieldOptions, uniqueFieldName, writeFields } from '../src/pdf/forms';

describe('PDF forms', () => {
  it('reads fields with widgets and writes values back', async () => {
    const doc = await PDFDocument.load(readFileSync('tests/fixtures/form.pdf'));
    const f = readFields(doc);
    expect(f.map((x) => `${x.name}:${x.type}`)).toEqual(['inspector:text', 'passed:checkbox', 'trade:dropdown', 'priority:radio']);
    expect(f.find((x) => x.name === 'priority')!.widgets.map((w) => w.option)).toEqual(['low', 'high']);
    const [x0, y0, x1, y1] = f[0].widgets[0].rect;
    expect(f[0].widgets[0].page).toBe(0);
    expect(Math.abs(x1 - x0 - 200) < 2 && Math.abs(y1 - y0 - 22) < 2).toBe(true);
    expect(Math.abs(x0 - 150) < 2 && Math.abs(y0 - 690) < 2).toBe(true);
    writeFields(doc, { inspector: 'Sam', passed: true, trade: 'Plumbing', priority: 'high' }, await doc.embedFont(StandardFonts.Helvetica));
    const again = readFields(await PDFDocument.load(await doc.save()));
    expect(Object.fromEntries(again.map((x) => [x.name, x.value]))).toEqual({ inspector: 'Sam', passed: true, trade: 'Plumbing', priority: 'high' });
  });

  it('creates, renames and deletes fields (Forms editor)', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    createField(doc, { type: 'text', name: 'Name', page: 0, rect: [72, 700, 272, 722], multiline: true });
    createField(doc, { type: 'checkbox', name: 'Agree', page: 0, rect: [72, 660, 86, 674] });
    createField(doc, { type: 'radio', name: 'Size', page: 0, rect: [72, 620, 86, 634], option: 'S' });
    createField(doc, { type: 'radio', name: 'Size', page: 0, rect: [100, 620, 114, 634], option: 'L' });
    createField(doc, { type: 'dropdown', name: 'Trade', page: 0, rect: [72, 580, 200, 600], options: ['Electrical', 'Plumbing'] });
    createField(doc, { type: 'signature', name: 'Sign', page: 0, rect: [72, 500, 272, 540] });
    expect(() => createField(doc, { type: 'text', name: 'Agree', page: 0, rect: [0, 0, 10, 10] })).toThrow();
    let f = readFields(await PDFDocument.load(await doc.save()));
    expect(f.map((x) => `${x.name}:${x.type}`)).toEqual(['Name:text', 'Agree:checkbox', 'Size:radio', 'Trade:dropdown', 'Sign:signature']);
    expect(f[0].multiline).toBe(true);
    expect(f[2].widgets.map((w) => w.option)).toEqual(['S', 'L']);
    expect(f[4].widgets[0].rect).toEqual([72, 500, 272, 540]);
    renameField(doc, 'Name', 'Inspector');
    setFieldOptions(doc, 'Trade', ['HVAC']);
    deleteField(doc, 'Agree');
    f = readFields(await PDFDocument.load(await doc.save()));
    expect(f.map((x) => x.name)).toEqual(['Inspector', 'Size', 'Trade', 'Sign']);
    expect(f[2].options).toEqual(['HVAC']);
    expect(doc.getPage(0).node.Annots()!.size()).toBe(5);
    expect(uniqueFieldName(['Text1', 'Text2'], 'Text')).toBe('Text3');
  });
});
