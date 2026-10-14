import { describe, expect, it } from 'vitest';
import { PDFArray, PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import { savePdf } from '../src/pdf/save';
import { importAnnotations } from '../src/pdf/importAnnots';

// Line ends and extra callout leaders survive save and reopen.
describe('line ends and callout leaders in the saved PDF', () => {
  it('writes /LE from the style and keeps extra leaders in CTData', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([600, 600]);
    const identity = { convertToPdfPoint: (x: number, y: number) => [x, 600 - y] };
    const pages = [{ index: 0, label: '1', width: 600, height: 600, viewport: identity }] as never;
    const base = { label: '', comment: '', author: 'A', created: new Date().toISOString(), modified: new Date().toISOString(), status: 'None', page: 0 };
    const style = { color: '#ff0000', fill: '#ffffff', width: 1, opacity: 1, fillOpacity: 1, lineStyle: 'solid', fontSize: 12 };
    const markups = [
      { ...base, id: 'c', type: 'callout', subject: 'Callout', text: 'Hi', points: [{ x: 50, y: 50 }, { x: 100, y: 100 }, { x: 200, y: 150 }, { x: 250, y: 60 }], style: { ...style, lineEnd: 'closedArrow' } },
      { ...base, id: 'a', type: 'arrow', subject: 'Arrow', points: [{ x: 300, y: 300 }, { x: 400, y: 300 }], style: { ...style, lineStart: 'circle' } },
      { ...base, id: 'l', type: 'line', subject: 'Line', points: [{ x: 300, y: 400 }, { x: 400, y: 400 }], style },
    ];
    const out = await savePdf({ original: await doc.save(), pages, markups: markups as never, importedRefs: new Set(), calibrations: [null], dirtyCalibrations: new Set() });
    const again = await PDFDocument.load(out);
    const annots = again.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray).asArray().map((r) => again.context.lookup(r) as PDFDict);
    expect(annots[0].get(PDFName.of('LE'))?.toString()).toBe('/ClosedArrow');
    expect((annots[0].lookup(PDFName.of('CL')) as PDFArray).asArray()).toHaveLength(4); // one leader in the PDF
    expect(annots[1].lookup(PDFName.of('LE'))?.toString()).toBe('[ /Circle /OpenArrow ]');
    expect(annots[2].lookup(PDFName.of('LE'))?.toString()).toBe('[ /None /None ]');
    const raws = importAnnotations(again).raws;
    const callout = raws.find((r) => r.markup.subject === 'Callout')!;
    expect(callout.pdfPoints).toHaveLength(4); // the extra leader comes back
    expect(callout.markup.style.lineEnd).toBe('closedArrow');
    const arrow = raws.find((r) => r.markup.subject === 'Arrow')!.markup.style;
    expect(arrow.lineStart).toBe('circle');
    expect(arrow.lineEnd).toBeUndefined(); // the default end is not stored
    expect(raws.find((r) => r.markup.subject === 'Line')!.markup.style.lineEnd).toBeUndefined();
  });
});
