import { describe, expect, it } from 'vitest';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFStream } from 'pdf-lib';
import { savePdf } from '../src/pdf/save';
import { importAnnotations } from '../src/pdf/importAnnots';
import { streamBytes } from '../src/pdf/redactContent';

// Text formatting survives save and reopen: /DS, /RC, /Q, the font resource, and our extras in CTData.
describe('text formatting in the saved PDF', () => {
  it('writes DS/RC/Q and the bold Times font, and reads the style back', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([600, 600]);
    const identity = { convertToPdfPoint: (x: number, y: number) => [x, 600 - y] };
    const pages = [{ index: 0, label: '1', width: 600, height: 600, viewport: identity }] as never;
    const base = { subject: 'Text Box', label: '', comment: '', author: 'A', created: new Date().toISOString(), modified: new Date().toISOString(), status: 'None', page: 0 };
    const style = { color: '#000000', fill: '#ffffff', width: 1, opacity: 1, fillOpacity: 1, lineStyle: 'solid', fontSize: 14, font: 'Times', bold: true, underline: true, align: 'center', valign: 'middle', lineHeight: 1.5, margin: 6, textColor: '#0000ff', shape: 'hexagon' };
    const markups = [{ ...base, id: 't', type: 'textbox', text: 'Hello\nWorld', points: [{ x: 100, y: 100 }, { x: 300, y: 200 }], style }];
    const out = await savePdf({ original: await doc.save(), pages, markups: markups as never, importedRefs: new Set(), calibrations: [null], dirtyCalibrations: new Set() });
    const again = await PDFDocument.load(out);
    const annot = again.context.lookup(again.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray).asArray()[0]) as PDFDict;
    const text = (o: unknown) => (o as { decodeText: () => string }).decodeText();
    expect(text(annot.get(PDFName.of('DS')))).toBe('font: Times 14pt; text-align:center; line-height:21pt; color:#0000FF; font-weight:bold; text-decoration:underline');
    expect(text(annot.get(PDFName.of('RC')))).toContain('<p>Hello</p><p>World</p>');
    expect(text(annot.get(PDFName.of('DA')))).toContain('/TiBo 14 Tf');
    expect(annot.get(PDFName.of('Q'))?.toString()).toBe('1');
    const ap = (annot.lookup(PDFName.of('AP')) as PDFDict).lookup(PDFName.of('N')) as PDFStream;
    const fonts = (ap.dict.lookup(PDFName.of('Resources')) as PDFDict).lookup(PDFName.of('Font')) as PDFDict;
    expect(fonts.has(PDFName.of('TiBo'))).toBe(true);
    const ops = new TextDecoder('latin1').decode(streamBytes(ap as never));
    expect(ops).toContain('/TiBo 14 Tf');
    expect((ops.match(/ l S Q/g) ?? []).length).toBe(2); // one underline per line
    const st = importAnnotations(again).raws[0].markup.style;
    expect(st).toMatchObject({ font: 'Times', bold: true, underline: true, align: 'center', valign: 'middle', lineHeight: 1.5, margin: 6, textColor: '#0000ff', shape: 'hexagon', fontSize: 14, color: '#000000' });
    expect(st.italic).toBeUndefined();
  });
});
