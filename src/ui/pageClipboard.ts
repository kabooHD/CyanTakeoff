// Thumbnails > Cut / Copy / Paste Pages (Revu): pages travel between the
// open documents with their markups. The clipboard holds a PDF of the
// copied pages (markups written as annotations), so a paste is an insert.
import { PDFDocument } from 'pdf-lib';
import { serialize, useApp, type DocState } from '../model/store';
import { deletePages, extractPages, insertPages } from '../pdf/pages';

let clip: { bytes: Uint8Array; count: number; from: string } | null = null;

export const hasPageClipboard = () => !!clip;

/** Copy `pages` of `d` (markups included) to the page clipboard; `cut` deletes them afterwards. */
export async function copyPages(d: DocState, pages: number[], cut = false) {
  const s = useApp.getState();
  if (!pages.length) return;
  const lib = await PDFDocument.load(await serialize(d), { updateMetadata: false });
  clip = { bytes: await (await extractPages(lib, pages)).save(), count: pages.length, from: d.name };
  if (cut) {
    if (pages.length >= d.loaded.pages.length) { s.setStatus('A document keeps at least one page: the pages were copied, not cut.'); return; }
    await s.transformDoc((l) => deletePages(l, pages), `Cut ${pages.length} page${pages.length === 1 ? '' : 's'}`);
  } else s.setStatus(`Copied ${pages.length} page${pages.length === 1 ? '' : 's'}`);
}

/** Paste the clipboard pages after page `after` of the active document. */
export async function pastePages(after: number) {
  const s = useApp.getState();
  if (!clip) { s.setStatus('No pages on the clipboard: Copy or Cut pages first.'); return; }
  const src = await PDFDocument.load(clip.bytes, { updateMetadata: false });
  const n = clip.count;
  await s.transformDoc((lib) => insertPages(lib, src, after + 1), `Pasted ${n} page${n === 1 ? '' : 's'} from ${clip!.from}`, after + 1);
}
