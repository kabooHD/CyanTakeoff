// Text and picture commands: copy the Select Text selection, Select All
// Text (Ctrl+Shift+A), search for selected text, and Copy Page to Snapshot
// (Ctrl+Alt+C: the whole page with its markups, ready to paste).
import { activeDoc, useApp } from '../model/store';
import type { Markup } from '../model/types';
import { selectText } from '../model/textSelect';
import { pageText, snapshot } from './toolActions';
import { markupShown } from './layersView';
import { runSearch, useSearch } from './Search';

/** Copy the selected text to the system clipboard. */
export async function copyText() {
  const s = useApp.getState(), t = s.textSel;
  if (!t) return false;
  try { await navigator.clipboard.writeText(t.text); s.setStatus(`Copied ${t.text.length} characters`); }
  catch { s.setStatus('The browser did not allow copying to the clipboard.'); }
  return true;
}

export async function selectAllText() {
  const d = activeDoc();
  if (!d) return;
  const p = await d.loaded.pdf.getPage(d.page + 1);
  const sel = selectText(await pageText(p, d.loaded.pages[d.page].viewport));
  useApp.setState({ textSel: sel.text ? { docId: d.id, page: d.page, ...sel } : null });
  useApp.getState().setStatus(sel.text ? 'All text on this page selected (Ctrl+C copies, right-click for more)' : 'This page has no text (scanned sheets need OCR first).');
}

export function searchFor(text: string) {
  const d = activeDoc();
  if (!d || !text.trim()) return;
  useApp.getState().setPanels({ left: 'search' });
  useSearch.setState({ query: text.trim(), mode: 'text' });
  runSearch(d);
}

/** The current page, with its markups, as an image on the clipboard. */
export async function copyPageToSnapshot() {
  const s = useApp.getState(), d = activeDoc();
  if (!d) return;
  const info = d.loaded.pages[d.page];
  const p = await d.loaded.pdf.getPage(d.page + 1);
  const markups = d.markups.filter((m) => m.page === d.page && markupShown(d, m));
  const url = await snapshot(p, { x: 0, y: 0 }, { x: info.width, y: info.height }, 2, markups);
  const t = new Date().toISOString();
  const m: Markup = {
    id: crypto.randomUUID(), type: 'image', page: d.page, points: [{ x: 0, y: 0 }, { x: info.width, y: info.height }],
    style: s.toolDefaults.image, subject: 'Snapshot', label: '', comment: '', author: s.author, created: t, modified: t, status: 'None', image: url,
  };
  useApp.setState({ clipboard: [m] });
  try {
    const blob = await (await fetch(url)).blob();
    await navigator.clipboard?.write?.([new ClipboardItem({ 'image/png': blob })]);
  } catch { /* the system clipboard is optional */ }
  s.setStatus('Page copied as a snapshot. Paste with Ctrl+V.');
}
