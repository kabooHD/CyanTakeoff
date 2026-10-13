import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PDFArray, PDFDocument, PDFName } from 'pdf-lib';
import { deletePages, extractPages, flattenPage, insertBlankPage, insertPages, movePage, replacePage, rotatePages, splitDocument } from '../src/pdf/pages';

const load = (f: string) => PDFDocument.load(readFileSync(f), { updateMetadata: false });
const annots = (d: PDFDocument, i: number) => d.getPage(i).node.lookup(PDFName.of('Annots'), PDFArray)?.size() ?? 0;

describe('page operations', () => {
  it('insert, delete, move and rotate', async () => {
    const d = await load('public/sample-floorplan.pdf');
    const w = d.getPage(1).getWidth();
    insertBlankPage(d, 1);
    expect(d.getPageCount()).toBe(3);
    expect(d.getPage(1).getWidth()).toBe(w);
    movePage(d, 2, 0);
    expect(d.getPage(0).getWidth()).toBe(w);
    rotatePages(d, [0], 90);
    rotatePages(d, [0], 90);
    expect(d.getPage(0).getRotation().angle).toBe(180);
    deletePages(d, [1]);
    expect(d.getPageCount()).toBe(2);
    expect(() => deletePages(d, [0, 1])).toThrow();
  });
  it('insert and extract pages keep markups', async () => {
    const d = await load('public/sample-floorplan.pdf');
    const revu = await load('tests/fixtures/revu/measure.pdf');
    await insertPages(d, revu, 1);
    expect(d.getPageCount()).toBe(3);
    expect(annots(d, 1)).toBe(annots(revu, 0));
    const x = await extractPages(d, [1]);
    expect(annots(x, 0)).toBe(annots(revu, 0));
    expect((await splitDocument(d, 2)).map((s) => s.getPageCount())).toEqual([2, 1]);
  });
  it('replace page keeps the old page markups, scale and spaces', async () => {
    const d = await load('tests/fixtures/revu/markup-space.pdf');
    const n = annots(d, 0);
    const sheet = await load('public/sample-floorplan.pdf');
    await replacePage(d, 0, sheet, 0);
    expect(d.getPageCount()).toBe(1);
    expect(d.getPage(0).getWidth()).toBe(sheet.getPage(0).getWidth());
    expect(annots(d, 0)).toBe(n);
    expect(d.getPage(0).node.get(PDFName.of('BSISpaces'))).toBeTruthy();
  });
  it('flatten draws appearances into the page and removes the annotations', async () => {
    const d = await load('tests/fixtures/revu/measure.pdf');
    const before = annots(d, 0);
    const n = flattenPage(d, d.getPage(0));
    expect(n).toBe(before);
    expect(annots(d, 0)).toBe(0);
    const again = await PDFDocument.load(await d.save());
    expect(again.getPageCount()).toBe(1);
  });
});
