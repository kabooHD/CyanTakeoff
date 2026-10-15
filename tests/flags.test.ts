import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { describeAction, flagRows, flaggedPages, flagTitle, type UnlinkedFlag } from '../src/model/flags';
import { readFlags, writeFlags } from '../src/pdf/flags';
import type { Markup } from '../src/model/types';

const mk = (id: string, page: number, extra: Partial<Markup> = {}): Markup => ({
  id, type: 'flag', page, points: [{ x: 10, y: 10 }], subject: 'Flag', label: '', comment: '', author: 'A', created: '', modified: '', status: 'None',
  style: { color: '#ff0000', fill: null, width: 1, opacity: 1, fillOpacity: 1, lineStyle: 'solid', fontSize: 10 }, ...extra,
} as Markup);

describe('Flags panel rows', () => {
  const unlinked: UnlinkedFlag[] = [{ id: 'u1', title: '3', page: 2, color: '#000', action: { kind: 'page', page: 2 } }, { id: 'u0', title: 'Cover', page: 0, color: '#000', bold: true, action: { kind: 'uri', uri: 'https://x' } }];
  it('merges linked Flag markups and unlinked flags in page order, linked first on a page', () => {
    const rows = flagRows([mk('m2', 2, { label: 'Detail' }), mk('m0', 0, { comment: 'Front door\nmore' }), mk('r', 1, { type: 'rectangle' } as never), mk('h', 0, { hidden: true })], unlinked);
    expect(rows.map((r) => `${r.page}:${r.title}`)).toEqual(['0:Front door', '0:Cover', '2:Detail', '2:3']);
    expect(rows[1].bold).toBe(true);
    expect(rows[0].markup?.id).toBe('m0');
  });
  it('titles a flag from its label, comment or subject', () => {
    expect(flagTitle(mk('a', 0))).toBe('Flag');
    expect(flagTitle(mk('a', 0, { label: 'L', comment: 'C' }))).toBe('L');
  });
  it('lists the flagged pages and describes actions', () => {
    expect([...flaggedPages([mk('a', 4)], unlinked)].sort()).toEqual([0, 2, 4]);
    expect(describeAction({ kind: 'page', page: 1, zoom: 2 }, (p) => `A-${p}`)).toBe('Page A-1 at 200%');
    expect(describeAction({ kind: 'file', file: 'x.pdf', page: 1 }, String)).toBe('x.pdf, page 2');
  });
  it('round-trips unlinked flags through the PDF catalog', async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    writeFlags(doc, unlinked);
    const again = await PDFDocument.load(await doc.save());
    expect(readFlags(again)).toEqual(unlinked);
    writeFlags(again, []);
    expect(readFlags(await PDFDocument.load(await again.save()))).toEqual([]);
  });
});
