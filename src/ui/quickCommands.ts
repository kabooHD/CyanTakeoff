// Small Revu commands: Autosize Text Box (Alt+Z), Remove Selected from Group,
// Save All, Refresh (F5), Full Screen (F11), Balance (Shift+F12).
import { activeDoc, useApp } from '../model/store';
import { autosizedBox, withBox } from '../model/textBox';
import { removeFromGroup } from '../model/arrange';

let measureCtx: CanvasRenderingContext2D | null = null;
/** Width of a line of text in Helvetica at `size` points. */
export function textWidth(text: string, size: number): number {
  measureCtx ??= document.createElement('canvas').getContext('2d');
  if (!measureCtx) return text.length * size * 0.55;
  measureCtx.font = `${size}px Helvetica, Arial, sans-serif`;
  return measureCtx.measureText(text).width;
}

export function autosizeTextBoxes() {
  const s = useApp.getState(), d = activeDoc();
  if (!d) return;
  const ids = d.markups.filter((m) => d.selection.includes(m.id) && (m.type === 'textbox' || m.type === 'callout')).map((m) => m.id);
  if (!ids.length) { s.setStatus('Autosize Text Box: select a text box or callout.'); return; }
  s.updateMarkups(ids, (m) => {
    const box = autosizedBox(m, textWidth);
    return box ? { points: withBox(m, box) } : {};
  });
}

/** Take the selected markups out of their groups (the rest of each group stays grouped). */
export function removeSelectedFromGroup() {
  const s = useApp.getState(), d = activeDoc();
  if (!d?.selection.length) return;
  if (!d.markups.some((m) => d.selection.includes(m.id) && m.groupId)) { s.setStatus('The selection is not in a group.'); return; }
  s.arrange(removeFromGroup);
}

/** Save every open document that has changes. */
export async function saveAll() {
  const s = useApp.getState();
  const first = s.activeId;
  const dirty = s.docs.filter((d) => d.dirty);
  for (const d of dirty) {
    useApp.getState().setActive(d.id);
    await useApp.getState().save();
  }
  if (first) useApp.getState().setActive(first);
  useApp.getState().setStatus(dirty.length ? `Saved ${dirty.length} document${dirty.length === 1 ? '' : 's'}` : 'Nothing to save');
}

/** Reload the document from its file (changes made elsewhere show up). */
export async function refreshDocument() {
  const s = useApp.getState(), d = activeDoc();
  if (!d) return;
  if (!d.fileHandle) { s.setStatus('Refresh: this file was not opened with file access (open it with File > Open in Chrome or Edge).'); return; }
  if (d.dirty && !confirm(`Discard the unsaved changes in ${d.name} and reload it from disk?`)) return;
  const f = await d.fileHandle.getFile();
  const bytes = new Uint8Array(await f.arrayBuffer());
  const page = d.page;
  useApp.setState((st) => ({ docs: st.docs.map((x) => (x.id === d.id ? { ...x, dirty: false } : x)) }));
  s.closeDoc(d.id);
  await useApp.getState().openBytes(bytes, f.name, d.fileHandle);
  useApp.getState().setPage(page);
}

export function toggleFullScreen() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else document.documentElement.requestFullscreen?.().catch(() => useApp.getState().setStatus('Full screen is not available here.'));
}

/** Edit Action (Ctrl+Shift+E): what clicking the selected markups does (Revu). */
export function editAction(ids?: string[]) {
  const d = activeDoc();
  const sel = ids ?? d?.selection ?? [];
  const m = d?.markups.find((x) => x.id === sel[0]);
  if (!d || !m) { useApp.getState().setStatus('Edit Action: select a markup first.'); return; }
  useApp.setState({ linkDialog: { page: m.page, rect: [m.points[0], m.points[1] ?? m.points[0]], ids: sel } });
}

export const balanceSplit = () => useApp.setState({ splitRatio: 0.5 });
