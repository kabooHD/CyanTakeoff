import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { fileRevisions, revisionBytes } from '../src/pdf/fileRevisions';
import { incrementalUpdate, loadForUpdate } from '../src/pdf/incremental';

describe('file revisions (Maintain Revisions / Revert As)', () => {
  it('finds one revision in a plain save and one more per incremental update', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    const v1 = await doc.save({ useObjectStreams: false });
    expect(fileRevisions(v1).map((r) => r.n)).toEqual([1]);
    const d2 = await loadForUpdate(v1);
    d2.addPage([300, 300]);
    const v2 = await incrementalUpdate(v1, d2);
    const revs = fileRevisions(v2);
    expect(revs.length).toBe(2);
    expect(revs[1].end).toBe(v2.length);
    const old = await PDFDocument.load(revisionBytes(v2, revs[0]));
    expect(old.getPageCount()).toBe(1);
    expect((await PDFDocument.load(v2)).getPageCount()).toBe(2);
  });
  it('ignores %%EOF-like bytes inside streams only when followed by more content', () => {
    const text = new TextEncoder().encode('%PDF-1.4\n%%EOF\n');
    expect(fileRevisions(text)).toEqual([{ n: 1, end: text.length }]);
  });
});

import { savePdf } from '../src/pdf/save';

describe('Save Mode', () => {
  async function original() {
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    return doc.save({ useObjectStreams: false });
  }
  const input = (orig: Uint8Array, saveMode: 'revisions' | 'publish' | 'compressed') => ({
    original: orig, pages: [], markups: [], importedRefs: new Set<string>(), calibrations: [null], dirtyCalibrations: new Set<number>(),
    bookmarks: [{ id: 'b', title: 'Start', page: 0, open: false, kids: [] }], saveMode,
  });
  it('Maintain Revisions appends to the file; the others rewrite it', async () => {
    const orig = await original();
    const rev = await savePdf(input(orig, 'revisions'));
    expect(rev.length).toBeGreaterThan(orig.length);
    expect(Array.from(rev.slice(0, orig.length))).toEqual(Array.from(orig));
    expect(fileRevisions(rev).length).toBe(2);
    const pub = await savePdf(input(orig, 'publish'));
    expect(fileRevisions(pub).length).toBe(1);
    const text = (b: Uint8Array) => new TextDecoder('latin1').decode(b);
    expect(text(pub)).not.toContain('/ObjStm');
    expect(text(await savePdf(input(orig, 'compressed')))).toContain('/ObjStm');
  });
});
