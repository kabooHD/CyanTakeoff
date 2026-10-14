import { describe, expect, it } from 'vitest';

// Capture photos ride along in CTData and come back on reopen.
describe('Capture photos in the saved PDF', () => {
  it('writes the photos into CTData and reads them back', async () => {
    const { PDFDocument } = await import('pdf-lib');
    const { savePdf } = await import('../src/pdf/save');
    const { importAnnotations } = await import('../src/pdf/importAnnots');
    const doc = await PDFDocument.create();
    doc.addPage([600, 600]);
    const identity = { convertToPdfPoint: (x: number, y: number) => [x, 600 - y] };
    const pages = [{ index: 0, label: '1', width: 600, height: 600, viewport: identity }] as never;
    const base = { subject: '', label: '', comment: '', author: 'A', created: new Date().toISOString(), modified: new Date().toISOString(), status: 'None', page: 0 };
    const style = { color: '#ff0000', fill: null, width: 1, opacity: 1, fillOpacity: 1, lineStyle: 'solid', fontSize: 10 };
    const photo = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
    const markups = [
      { ...base, id: 'a', type: 'rectangle', points: [{ x: 100, y: 100 }, { x: 300, y: 200 }], style, capture: [{ name: 'site.jpg', data: photo }, { name: 'detail.jpg', data: photo }] },
      { ...base, id: 'b', type: 'rectangle', points: [{ x: 100, y: 300 }, { x: 300, y: 400 }], style, capture: [] },
    ];
    const out = await savePdf({ original: await doc.save(), pages, markups: markups as never, importedRefs: new Set(), calibrations: [null], dirtyCalibrations: new Set() });
    const imp = importAnnotations(await PDFDocument.load(out)).raws.map((r) => r.markup);
    expect(imp[0].capture?.map((c) => c.name)).toEqual(['site.jpg', 'detail.jpg']);
    expect(imp[0].capture?.[0].data).toBe(photo);
    expect(imp[1].capture).toBeUndefined(); // an empty list is not written
  });
});
