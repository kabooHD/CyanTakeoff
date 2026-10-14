import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFDict, PDFName } from 'pdf-lib';
import { readPlaces, writePlaces } from '../src/pdf/places';

async function doc3() {
  const d = await PDFDocument.create();
  for (let i = 0; i < 3; i++) d.addPage([600, 400]);
  return d;
}

describe('Places (named destinations)', () => {
  it('writes a sorted name tree and reads it back', async () => {
    const d = await doc3();
    writePlaces(d, [
      { name: 'Sheet B', page: 2, fit: 'Fit', args: [] },
      { name: 'Detail (3)', page: 1, fit: 'FitR', args: [10, 20, 110, 220] },
      { name: 'Ä view', page: 0, fit: 'XYZ', args: [0, 400, null] },
    ]);
    const back = readPlaces(await PDFDocument.load(await d.save()));
    expect(back.map((p) => p.name)).toEqual(['Detail (3)', 'Sheet B', 'Ä view']);
    expect(back[0]).toEqual({ name: 'Detail (3)', page: 1, fit: 'FitR', args: [10, 20, 110, 220] });
    expect(back[2].args).toEqual([0, 400, null]);
  });
  it('reads old-style /Dests and keeps it in step when writing', async () => {
    const d = await doc3();
    d.catalog.set(PDFName.of('Dests'), d.context.obj({ Old: [d.getPage(1).ref, PDFName.of('Fit')] }));
    expect(readPlaces(d)).toEqual([{ name: 'Old', page: 1, fit: 'Fit', args: [] }]);
    writePlaces(d, [{ name: 'Old', page: 2, fit: 'Fit', args: [] }]);
    const dests = d.catalog.lookup(PDFName.of('Dests'), PDFDict);
    expect(dests.has(PDFName.of('Old'))).toBe(true);
    expect(readPlaces(d)).toEqual([{ name: 'Old', page: 2, fit: 'Fit', args: [] }]);
  });
  it('removes the tree when no Places are left', async () => {
    const d = await doc3();
    writePlaces(d, [{ name: 'A', page: 0, fit: 'Fit', args: [] }]);
    writePlaces(d, []);
    expect(readPlaces(d)).toEqual([]);
  });
});

describe('hyperlinks to Places', () => {
  it('save as a GoTo to the named destination and import with the name', async () => {
    const { savePdf } = await import('../src/pdf/save');
    const { importAnnotations } = await import('../src/pdf/importAnnots');
    const doc = await doc3();
    writePlaces(doc, [{ name: 'Door schedule', page: 2, fit: 'Fit', args: [] }]);
    const identity = { convertToPdfPoint: (x: number, y: number) => [x, 400 - y] };
    const pages = [0, 1, 2].map((i) => ({ index: i, label: String(i + 1), width: 600, height: 400, viewport: identity })) as never;
    const t = new Date().toISOString();
    const link = { id: 'l', type: 'link', page: 0, points: [{ x: 10, y: 10 }, { x: 100, y: 40 }], link: { dest: 'Door schedule' },
      style: { color: '#0000ff', fill: null, width: 1, opacity: 1, fillOpacity: 1, lineStyle: 'solid', fontSize: 10 },
      subject: 'Hyperlink', label: '', comment: '', author: 'A', created: t, modified: t, status: 'None' };
    const out = await savePdf({ original: await doc.save(), pages, markups: [link] as never, importedRefs: new Set(), calibrations: [null, null, null], dirtyCalibrations: new Set() });
    const again = await PDFDocument.load(out);
    const imp = importAnnotations(again).raws.map((r) => r.markup);
    expect(imp).toHaveLength(1);
    expect(imp[0].link).toEqual({ dest: 'Door schedule' });
    expect(readPlaces(again)[0].page).toBe(2);
  });
});
