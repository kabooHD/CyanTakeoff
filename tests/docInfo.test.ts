import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { attachFile, listEmbeddedFiles, readCustomProps, removeEmbeddedFile, writeCustomProps } from '../src/pdf/docInfo';

describe('document properties', () => {
  it('reads and writes custom Info entries, keeping the standard ones', async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    doc.setTitle('Tower');
    expect(readCustomProps(doc)).toEqual({});
    writeCustomProps(doc, { Project: 'P-12', 'Site Address': 'Rue Émile' });
    const again = await PDFDocument.load(await doc.save(), { updateMetadata: false });
    expect(readCustomProps(again)).toEqual({ Project: 'P-12', 'Site Address': 'Rue Émile' });
    expect(again.getTitle()).toBe('Tower');
    writeCustomProps(again, { Project: 'P-13' });
    expect(readCustomProps(await PDFDocument.load(await again.save(), { updateMetadata: false }))).toEqual({ Project: 'P-13' });
  });
  it('lists, adds and removes embedded files', async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    expect(listEmbeddedFiles(doc)).toEqual([]);
    await attachFile(doc, 'notes.txt', new TextEncoder().encode('hello'), 'text/plain');
    await attachFile(doc, 'spec.csv', new TextEncoder().encode('a,b,c'), 'text/csv');
    const again = await PDFDocument.load(await doc.save(), { updateMetadata: false });
    expect(listEmbeddedFiles(again).map((f) => [f.name, f.size])).toEqual([['notes.txt', 5], ['spec.csv', 5]]);
    expect(removeEmbeddedFile(again, 'notes.txt')).toBe(true);
    expect(removeEmbeddedFile(again, 'missing')).toBe(false);
    const third = await PDFDocument.load(await again.save(), { updateMetadata: false });
    expect(listEmbeddedFiles(third).map((f) => f.name)).toEqual(['spec.csv']);
    expect(removeEmbeddedFile(third, 'spec.csv')).toBe(true);
    expect(listEmbeddedFiles(await PDFDocument.load(await third.save(), { updateMetadata: false }))).toEqual([]);
  });
});
