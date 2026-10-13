import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFString, PDFDict } from 'pdf-lib';
import { readBookmarks, writeBookmarks, type Bookmark } from '../src/pdf/bookmarks';
import { flatten, insertBookmarks, moveBookmarks, removeBookmarks } from '../src/model/bookmarkTree';

/** Three pages; outline: "Plans" (p1, open) > "Level 1" (p2, via named dest), then "Web" (a URI action). */
async function withOutline() {
  const doc = await PDFDocument.create();
  const [p1, p2] = [doc.addPage([600, 400]), doc.addPage([600, 400]), doc.addPage([600, 400])];
  const ctx = doc.context;
  const root = ctx.nextRef(), plans = ctx.nextRef(), l1 = ctx.nextRef(), web = ctx.nextRef();
  doc.catalog.set(PDFName.of('Names'), ctx.obj({ Dests: { Names: [PDFString.of('lvl1'), ctx.obj([p2.ref, 'Fit'])] } }));
  ctx.assign(l1, ctx.obj({ Title: PDFString.of('Level 1'), Parent: plans, Dest: PDFString.of('lvl1') }));
  ctx.assign(plans, ctx.obj({ Title: PDFString.of('Plans'), Parent: root, Next: web, First: l1, Last: l1, Count: 1, F: 2, C: [1, 0, 0],
    A: { S: 'GoTo', D: [p1.ref, 'XYZ', 0, 400, 0] } }));
  ctx.assign(web, ctx.obj({ Title: PDFString.of('Web'), Parent: root, Prev: plans, A: { S: 'URI', URI: PDFString.of('https://example.com') }, Foo: 'Bar' }));
  ctx.assign(root, ctx.obj({ Type: 'Outlines', First: plans, Last: web, Count: 3 }));
  doc.catalog.set(PDFName.of('Outlines'), root);
  return { doc, web };
}

describe('bookmarks in the PDF', () => {
  it('reads titles, targets (direct, GoTo, named), style and open state', async () => {
    const { doc } = await withOutline();
    const bm = readBookmarks(doc);
    expect(bm.map((b) => b.title)).toEqual(['Plans', 'Web']);
    expect(bm[0]).toMatchObject({ page: 0, fit: 'XYZ', args: [0, 400, 0], bold: true, color: '#ff0000', open: true });
    expect(bm[0].kids[0]).toMatchObject({ title: 'Level 1', page: 1, fit: 'Fit' });
    expect(bm[1]).toMatchObject({ page: null, broken: false });
  });

  it('writes edits back, keeping untouched items and their actions', async () => {
    const { doc, web } = await withOutline();
    let bm = readBookmarks(doc);
    bm = insertBookmarks(bm, [{ id: 'n1', title: 'Sheet 3', page: 2, fit: 'Fit', args: [], open: false, kids: [] }], bm[0].id, 'after');
    bm[0] = { ...bm[0], title: 'Plans (rev)', bold: false };
    writeBookmarks(doc, bm);
    const again = await PDFDocument.load(await doc.save());
    const r = readBookmarks(again);
    expect(flatten(r).map((x) => x.b.title)).toEqual(['Plans (rev)', 'Level 1', 'Sheet 3', 'Web']);
    expect(r[1]).toMatchObject({ page: 2 });
    expect(r[0].bold).toBeFalsy();
    // The web link keeps its ref, its URI action and the key we do not know.
    const w = again.context.lookup(web) as PDFDict;
    expect(w.lookup(PDFName.of('A'))?.toString()).toContain('example.com');
    expect(String(w.get(PDFName.of('Foo')))).toBe('/Bar');
    const root = again.catalog.lookup(PDFName.of('Outlines')) as PDFDict;
    expect(root.get(PDFName.of('Count'))?.toString()).toBe('4');
  });

  it('deleting every bookmark removes the outline', async () => {
    const { doc } = await withOutline();
    writeBookmarks(doc, []);
    expect(doc.catalog.get(PDFName.of('Outlines'))).toBeUndefined();
    expect(readBookmarks(doc)).toEqual([]);
  });

  it('flags bookmarks to pages no longer in the file', async () => {
    const { doc } = await withOutline();
    doc.removePage(0);
    expect(readBookmarks(doc)[0].broken).toBe(true);
  });
});

describe('bookmark tree edits', () => {
  const b = (id: string, kids: Bookmark[] = []): Bookmark => ({ id, title: id, page: 0, open: true, kids });
  const tree = () => [b('A', [b('A1'), b('A2')]), b('B')];
  const ids = (l: Bookmark[]) => flatten(l).map((x) => `${'-'.repeat(x.depth)}${x.b.id}`);
  it('adds before, after and as child', () => {
    expect(ids(insertBookmarks(tree(), [b('N')], 'A1', 'after'))).toEqual(['A', '-A1', '-N', '-A2', 'B']);
    expect(ids(insertBookmarks(tree(), [b('N')], 'B', 'child'))).toEqual(['A', '-A1', '-A2', 'B', '-N']);
    expect(ids(insertBookmarks(tree(), [b('N')], null, 'after'))).toEqual(['A', '-A1', '-A2', 'B', 'N']);
  });
  it('moves (with children), copies, and refuses to move into itself', () => {
    expect(ids(moveBookmarks(tree(), ['A'], 'B', 'child'))).toEqual(['B', '-A', '--A1', '--A2']);
    expect(moveBookmarks(tree(), ['A'], 'A2', 'after')).toEqual(tree());
    const c = moveBookmarks(tree(), ['A2', 'B'], 'A1', 'before', true);
    expect(flatten(c).map((x) => x.b.title)).toEqual(['A', 'A2', 'B', 'A1', 'A2', 'B']);
    expect(ids(removeBookmarks(tree(), new Set(['A1', 'B'])))).toEqual(['A', '-A2']);
  });
});

describe('AutoMark', async () => {
  const { textInRegion } = await import('../src/model/sheets');
  const box = (str: string, x0: number, y0: number, w = 40, h = 10) => ({ str, x0, y0, x1: x0 + w, y1: y0 + h });
  it('reads the text in a page region, line by line', () => {
    const boxes = [box('FLOOR', 800, 700), box('PLAN', 845, 701), box('LEVEL 1', 800, 714), box('A-101', 900, 760), box('elsewhere', 10, 10)];
    expect(textInRegion(boxes, { x0: 0.75, y0: 0.8, x1: 0.95, y1: 0.87 }, 1000, 850)).toBe('FLOOR PLAN LEVEL 1');
    expect(textInRegion(boxes, { x0: 0.88, y0: 0.88, x1: 1, y1: 1 }, 1000, 850)).toBe('A-101');
  });
});
