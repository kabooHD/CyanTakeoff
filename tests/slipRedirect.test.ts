import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { insertRevisedPage } from '../src/pdf/pages';
import { readBookmarks, writeBookmarks, type Bookmark } from '../src/pdf/bookmarks';

const bm = (title: string, page: number): Bookmark => ({ id: title, title, page, open: false, kids: [] });

async function docs() {
  const doc = await PDFDocument.create();
  doc.addPage([600, 400]); doc.addPage([600, 400]);
  writeBookmarks(doc, [bm('Sheet 2', 1)]);
  const src = await PDFDocument.create();
  src.addPage([600, 400]);
  return { doc, src };
}

describe('Slip Sheet: Redirect Links and Bookmarks', () => {
  it('points the bookmark at the revised page when on', async () => {
    const { doc, src } = await docs();
    await insertRevisedPage(doc, 1, src, 0, true, true);
    expect(doc.getPageCount()).toBe(3);
    expect(readBookmarks(doc)[0].page).toBe(1);
  });
  it('leaves the bookmark on the old page when off', async () => {
    const { doc, src } = await docs();
    await insertRevisedPage(doc, 1, src, 0, true, false);
    expect(readBookmarks(doc)[0].page).toBe(2);
  });
});
