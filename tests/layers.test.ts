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
