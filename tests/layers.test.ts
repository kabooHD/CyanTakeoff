import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFString, StandardFonts, type PDFStream } from 'pdf-lib';
import { addLayerFromPage, layerIds, readLayers, stripLayerContent, writeLayers } from '../src/pdf/layers';
import { streamBytes } from '../src/pdf/redactContent';
import { latin1 } from '../src/pdf/content';

/** A one-page PDF with layers "Walls" (child "Doors") and "Notes" (off, locked, no print), each with content. */
async function layered() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([400, 400]);
  const ctx = doc.context;
  const walls = ctx.register(ctx.obj({ Type: 'OCG', Name: PDFString.of('Walls') }));
  const doors = ctx.register(ctx.obj({ Type: 'OCG', Name: PDFString.of('Doors') }));
  const notes = ctx.register(ctx.obj({ Type: 'OCG', Name: PDFString.of('Notes'), Usage: { Print: { PrintState: 'OFF' } } }));
  doc.catalog.set(PDFName.of('OCProperties'), ctx.obj({
    OCGs: [walls, doors, notes],
    D: { Name: 'Default', Order: [walls, [doors], ctx.obj([PDFString.of('Annotations'), notes] as never)], OFF: [notes], Locked: [notes],
      Configs: [{ Name: PDFString.of('Plan only'), OFF: [doors, notes] }] },
  }));
  page.node.set(PDFName.of('Resources'), ctx.obj({ Font: { F1: font.ref }, Properties: { MC0: walls, MC1: doors, MC2: notes } }));
  page.node.set(PDFName.of('Contents'), ctx.register(ctx.flateStream(
    '/OC /MC0 BDC 0 0 m 100 0 l S EMC /OC /MC1 BDC 10 10 m 20 20 l S EMC /OC /MC2 BDC BT /F1 12 Tf 50 50 Td (NOTE) Tj ET EMC 300 300 m 310 310 l S',
  )));
  return { doc, walls, doors, notes };
}

const contentOf = (doc: PDFDocument) => latin1(streamBytes(doc.getPage(0).node.Contents() as PDFStream));

describe('layers (optional content)', () => {
  it('reads the tree, default states, locks, print usage and configurations', async () => {
    const { doc, walls, doors, notes } = await layered();
    const set = readLayers(doc)!;
    const id = (r: { objectNumber: number }) => `${r.objectNumber}R`;
    expect(set.order).toEqual([{ id: id(walls), kids: [{ id: id(doors), kids: [] }] }, { label: 'Annotations', kids: [{ id: id(notes), kids: [] }] }]);
    expect(set.layers[id(notes)]).toMatchObject({ name: 'Notes', on: false, locked: true, print: false });
    expect(set.layers[id(walls)]).toMatchObject({ name: 'Walls', on: true, locked: false, print: true });
    expect(set.configs).toEqual([{ name: 'Plan only', off: [id(doors), id(notes)] }]);
  });

  it('writes renames, new layers, order and configurations back', async () => {
    const { doc, walls } = await layered();
    const set = readLayers(doc)!;
    const wid = `${walls.objectNumber}R`;
    set.layers[wid].name = 'Walls (rev B)';
    set.layers['new:x'] = { id: 'new:x', name: 'Markups', on: true, locked: false, print: true };
    set.order.push({ id: 'new:x', kids: [] });
    set.configs.push({ name: 'Markups off', off: ['new:x'] });
    const refs = writeLayers(doc, set);
    expect(refs.get('new:x')).toBeTruthy();
    const again = readLayers(await PDFDocument.load(await doc.save()))!;
    const names = layerIds(again.order).map((i) => again.layers[i].name);
    expect(names).toEqual(['Walls (rev B)', 'Doors', 'Notes', 'Markups']);
    expect(again.configs.map((c) => c.name)).toEqual(['Plan only', 'Markups off']);
  });

  it('deleting a layer removes its content, or moves it to the base PDF', async () => {
    const a = await layered();
    stripLayerContent(a.doc, new Set([`${a.notes.objectNumber}R`]), true);
    const c1 = contentOf(a.doc);
    expect(c1).not.toContain('NOTE');
    expect(c1).toContain('/MC0');
    expect(c1).toContain('300 300 m');
    const b = await layered();
    stripLayerContent(b.doc, new Set([`${b.notes.objectNumber}R`]), false);
    const c2 = contentOf(b.doc);
    expect(c2).toContain('NOTE');
    expect(c2).not.toContain('/MC2');
  });

  it('Add Layer from Page draws another page as a new layer', async () => {
    const { doc } = await layered();
    const src = await PDFDocument.create();
    src.addPage([400, 400]).drawLine({ start: { x: 0, y: 0 }, end: { x: 400, y: 400 } });
    const ref = await addLayerFromPage(doc, 0, src, 0, 'Revision B', [1, 0, 0, 1, 5, 7]);
    const set = readLayers(doc)!;
    set.layers[`${ref.objectNumber}R`] = { id: `${ref.objectNumber}R`, name: 'Revision B', on: true, locked: false, print: true };
    set.order.push({ id: `${ref.objectNumber}R`, kids: [] });
    writeLayers(doc, set);
    const again = await PDFDocument.load(await doc.save());
    expect(Object.values(readLayers(again)!.layers).map((l) => l.name)).toContain('Revision B');
    const all = again.getPage(0).node.Contents()!.toString();
    expect(all).toMatch(/R/);
  });
});

describe('layer tree edits', async () => {
  const { insertNode, moveNode, removeNodes, withoutLayers, idsUnder, findNode } = await import('../src/model/layerTree');
  const tree = () => [{ id: 'A', kids: [{ id: 'A1', kids: [] }] }, { id: 'B', kids: [] }];
  it('adds before, after and as child', () => {
    expect(insertNode(tree(), { id: 'N', kids: [] }, 'B', 'before').map((n) => n.id)).toEqual(['A', 'N', 'B']);
    expect(insertNode(tree(), { id: 'N', kids: [] }, 'A1', 'after')[0].kids.map((n) => n.id)).toEqual(['A1', 'N']);
    expect(insertNode(tree(), { id: 'N', kids: [] }, 'B', 'child')[1].kids.map((n) => n.id)).toEqual(['N']);
    expect(insertNode(tree(), { id: 'N', kids: [] }, null, 'before')[0].id).toBe('N');
  });
  it('moves, but never into its own children', () => {
    expect(moveNode(tree(), 'B', 'A', 'child')[0].kids.map((n) => n.id)).toEqual(['A1', 'B']);
    expect(moveNode(tree(), 'A', 'A1', 'child')).toEqual(tree());
    expect(idsUnder(findNode(tree(), 'A')!)).toEqual(['A', 'A1']);
    expect(removeNodes(tree(), new Set(['A'])).map((n) => n.id)).toEqual(['B']);
  });
  it('removing a layer lifts its children and cleans configurations', () => {
    const set = { layers: { A: { id: 'A', name: 'A', on: true, locked: false, print: true }, A1: { id: 'A1', name: 'A1', on: true, locked: false, print: true } }, order: tree(), configs: [{ name: 'c', off: ['A', 'A1'] }] };
    const out = withoutLayers(set as never, new Set(['A']));
    expect(out.order.map((n) => n.id)).toEqual(['A1', 'B']);
    expect(out.configs[0].off).toEqual(['A1']);
  });
});

describe('layer usage, export, transform, flatten', async () => {
  const { keepOnlyLayers, transformLayer } = await import('../src/pdf/layers');
  const { flattenPage } = await import('../src/pdf/pages');

  it('reads and writes Export usage and a zoom range', async () => {
    const { doc, walls } = await layered();
    const set = readLayers(doc)!;
    const id = `${walls.objectNumber}R`;
    set.layers[id] = { ...set.layers[id], export: false, zoom: { min: 0.5, max: Infinity } };
    writeLayers(doc, set);
    const again = readLayers(await PDFDocument.load(await doc.save()))!;
    expect(again.layers[id]).toMatchObject({ export: false, print: true, zoom: { min: 0.5, max: Infinity } });
    expect(again.layers[`${(await layered()).notes.objectNumber}R`]).toBeDefined();
  });

  it('moves a layer\'s content in page space, also when it sits under a transform', async () => {
    const { doc, walls } = await layered();
    transformLayer(doc, `${walls.objectNumber}R`, [1, 0, 0, 1, 10, 20]);
    const c = contentOf(doc);
    expect(c).toMatch(/\/OC \/MC0 BDC\nq\n1 0 0 1 10 20 cm[\s\S]*?Q\nEMC/);
    // Under "2 0 0 2 0 0 cm" the same page-space move is half as far in local units.
    const d2 = await PDFDocument.create();
    const pg = d2.addPage([400, 400]);
    const ocg = d2.context.register(d2.context.obj({ Type: 'OCG', Name: PDFString.of('L') }));
    pg.node.set(PDFName.of('Resources'), d2.context.obj({ Properties: { MC0: ocg } }));
    pg.node.set(PDFName.of('Contents'), d2.context.register(d2.context.flateStream('q 2 0 0 2 0 0 cm /OC /MC0 BDC 0 0 m 10 10 l S EMC Q')));
    transformLayer(d2, `${ocg.objectNumber}R`, [1, 0, 0, 1, 10, 20]);
    expect(contentOf(d2)).toContain('1 0 0 1 5 10 cm');
  });

  it('Export Layer to Page keeps only the chosen layers', async () => {
    const { doc, notes } = await layered();
    keepOnlyLayers(doc, new Set([`${notes.objectNumber}R`]));
    const c = contentOf(doc);
    expect(c).toContain('(NOTE) Tj');
    expect(c).not.toContain('100 0 l');
    expect(c).not.toContain('310 310 l');
  });

  it('flattens a markup onto a layer', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 200]);
    const ctx = doc.context;
    const ap = ctx.register(ctx.stream('0 0 m 10 10 l S', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 10, 10] }));
    const annot = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Square', Rect: [20, 20, 30, 30], AP: { N: ap } }));
    page.node.set(PDFName.of('Annots'), ctx.obj([annot]));
    const ocg = ctx.register(ctx.obj({ Type: 'OCG', Name: PDFString.of('Markups') }));
    expect(flattenPage(doc, page, () => false, () => ocg)).toBe(1);
    const all = (page.node.Contents() as unknown as { asArray(): unknown[] }).asArray().map((r) => latin1(streamBytes(ctx.lookup(r as never) as PDFStream))).join('\n');
    expect(all).toMatch(/\/OC \/CTFlat1 BDC q .* Do Q EMC/);
  });
});

describe('layer move / rotate / scale matrix', async () => {
  const { layerMatrix } = await import('../src/model/layerTree');
  const ap = (m: number[], x: number, y: number) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]].map((v) => Math.round(v * 1e6) / 1e6);
  it('rotates and scales about the base point, then moves', () => {
    expect(ap(layerMatrix(0, 0, 90, 1, 100, 100), 200, 100)).toEqual([100, 200]);
    expect(ap(layerMatrix(0, 0, 0, 2, 100, 100), 150, 100)).toEqual([200, 100]);
    expect(ap(layerMatrix(10, -5, 0, 1, 0, 0), 1, 1)).toEqual([11, -4]);
    expect(ap(layerMatrix(0, 0, 0, 1, 50, 50), 50, 50)).toEqual([50, 50]);
  });
});

describe('Create Layered PDF', () => {
  it('puts page N of every file on page N as one layer per file', async () => {
    const { PDFDocument } = await import('pdf-lib');
    const { buildLayeredPdf, readLayers, layersOnPages } = await import('../src/pdf/layers');
    const a = await PDFDocument.create(); a.addPage([300, 200]).drawLine({ start: { x: 0, y: 0 }, end: { x: 300, y: 200 } }); a.addPage([300, 200]); // page 2 blank
    const b = await PDFDocument.create(); b.addPage([400, 400]).drawLine({ start: { x: 0, y: 0 }, end: { x: 400, y: 400 } });
    const { out, n } = await buildLayeredPdf([{ name: 'Arch', doc: a }, { name: 'Mech', doc: b }]);
    expect(n).toBe(2);
    expect(out.getPage(0).getWidth()).toBe(300);
    const again = await PDFDocument.load(await out.save());
    const set = readLayers(again)!;
    expect(Object.values(set.layers).map((l) => l.name)).toEqual(['Arch', 'Mech']);
    const used = layersOnPages(again);
    expect(used[0]).toHaveLength(2); // both files on page 1
    expect(used[1]).toHaveLength(0); // Arch's page 2 is blank: nothing to embed
  });
});
