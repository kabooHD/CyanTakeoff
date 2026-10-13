import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { readFields, writeFields } from '../src/pdf/forms';

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
});
