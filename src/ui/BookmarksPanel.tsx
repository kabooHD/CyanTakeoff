// Bookmarks panel (Alt+B), as in Revu: click to jump; Add Bookmark (Ctrl+B)
// at the current view, before / after / as child of the selected one;
// rename (double-click or F2), delete (Delete), drag to reorder or nest
// (Ctrl+drag copies), Set to Current View, Properties (title, colour, bold,
// italic), Action (jump to a page or Place, open a web address or another
// file), expand/collapse, Create Bookmarks from page labels, Audit
// Bookmarks and Export Bookmarks (CSV).
import { useEffect, useRef, useState } from 'react';
import { useApp, type DocState } from '../model/store';
import type { Bookmark } from '../pdf/bookmarks';
import { buildBookmarksPdf, type BookmarkReportSection } from '../pdf/bookmarksReport';
import { findBookmark, flatten, insertBookmarks, moveBookmarks, removeBookmarks, updateBookmark, type Where } from '../model/bookmarkTree';
import { ContextMenu, type MenuItem } from './ContextMenu';
import { viewerApi } from './Viewer';
import { openAutoMark } from './AutoMark';

const active = () => { const s = useApp.getState(); return s.docs.find((d) => d.id === s.activeId); };

/** Jump to a bookmark's destination. */
export function goToBookmark(d: DocState, b: Bookmark) {
  const s = useApp.getState();
  if (b.action?.uri) { window.open(b.action.uri, '_blank', 'noopener'); return; }
  if (b.action?.file) { s.setStatus(`This bookmark opens ${b.action.file} (page ${(b.action.page ?? 0) + 1}): open that file to follow it.`); return; }
  if (b.page === null) return;
  const page = d.loaded.pages[b.page];
  if (!page) return;
  s.setPage(b.page);
  const [a0, a1, a2] = b.args ?? [];
  const toPage = (x: number | null, y: number | null) => {
    const [px, py] = page.viewport.convertToViewportPoint(x ?? 0, y ?? page.viewport.viewBox[3]);
    return { x: x === null ? viewerApi.topLeft().x : px, y: y === null ? viewerApi.topLeft().y : py };
  };
  const later = (fn: () => void) => requestAnimationFrame(() => requestAnimationFrame(fn));
  if (b.fit === 'XYZ') {
    if (a2) s.setZoom(a2);
    later(() => viewerApi.showAt(toPage(a0 ?? null, a1 ?? null)));
  } else if (b.fit === 'FitH' || b.fit === 'FitBH') {
    later(() => { viewerApi.fitWidth(); later(() => viewerApi.showAt(toPage(null, a0 ?? null))); });
  } else if (b.fit === 'FitR') {
    later(() => viewerApi.fitPage());
  } else {
    later(() => viewerApi.fitPage());
  }
}

/** A new bookmark to the current view of the active page, named after the page label. */
function currentView(d: DocState): Pick<Bookmark, 'page' | 'fit' | 'args' | 'destEdited'> {
  const page = d.loaded.pages[d.page];
  const tl = viewerApi.topLeft();
  const [x, y] = page.viewport.convertToPdfPoint(tl.x, tl.y);
  return { page: d.page, fit: 'XYZ', args: [Math.round(x * 100) / 100, Math.round(y * 100) / 100, d.zoom || null], destEdited: true };
}

export function addBookmark(where: Where = 'after', target?: string | null): string | null {
  const d = active();
  if (!d) return null;
  const b: Bookmark = { id: crypto.randomUUID(), title: d.loaded.pages[d.page]?.label ?? String(d.page + 1), open: false, kids: [], ...currentView(d) };
  useApp.getState().setBookmarks(insertBookmarks(d.bookmarks, [b], target ?? bookmarkUi.selected.at(-1) ?? null, where));
  bookmarkUi.selected = [b.id];
  useApp.getState().setPanels({ left: 'bookmarks' });
  setTimeout(() => bookmarkUi.rename?.(b.id), 50); // type the name right away, as in Revu
  return b.id;
}

/** Shared with the shortcut handler: the panel's selection and its rename hook. */
export const bookmarkUi: { selected: string[]; rename?: (id: string) => void } = { selected: [] };

function csvCell(v: string) { return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; }

/** The bookmark trees of the open documents (those that have any) as report sections. */
function reportSections(docs: DocState[]): BookmarkReportSection[] {
  return docs.filter((d) => d.bookmarks.length).map((d) => ({
    name: d.name, rows: flatten(d.bookmarks).map(({ b, depth }) => ({ depth, title: b.title, page: b.page === null ? '' : d.loaded.pages[b.page]?.label ?? '' })),
  }));
}

/** Export Bookmarks (PDF): one section per open document. */
async function exportPdf(d: DocState, docs: DocState[]) {
  const bytes = await buildBookmarksPdf(reportSections(docs));
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
  Object.assign(document.createElement('a'), { href: url, download: d.name.replace(/\.pdf$/i, '') + ' - Bookmarks.pdf' }).click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function exportCsv(d: DocState) {
  const rows = flatten(d.bookmarks).map(({ b, depth }) => [String(depth + 1), b.title, b.page === null ? '' : d.loaded.pages[b.page]?.label ?? ''].map(csvCell).join(','));
  const csv = ['Level,Title,Page', ...rows].join('\r\n');
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
  Object.assign(document.createElement('a'), { href: url, download: d.name.replace(/\.pdf$/i, '') + ' - Bookmarks.csv' }).click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function BookmarksPanel({ doc }: { doc: DocState }) {
  const s = useApp();
  const [sel, setSel] = useState<string[]>([]);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [props, setProps] = useState<string[] | null>(null);
  const [action, setAction] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; where: Where } | null>(null);
  const dragging = useRef<string[]>([]);
  const list = doc.bookmarks;
  const rows = flatten(list, true);

  useEffect(() => { bookmarkUi.selected = sel; }, [sel]);
  useEffect(() => {
    bookmarkUi.rename = (id) => { setSel([id]); setRenaming(id); };
    return () => { bookmarkUi.rename = undefined; };
  }, []);

  const edit = (next: Bookmark[]) => s.setBookmarks(next);
  const remove = (ids: string[]) => { edit(removeBookmarks(list, new Set(ids))); setSel([]); };
  const click = (e: React.MouseEvent, b: Bookmark) => {
    if (e.ctrlKey || e.metaKey) { setSel(sel.includes(b.id) ? sel.filter((x) => x !== b.id) : [...sel, b.id]); return; }
    if (e.shiftKey && sel.length) {
      const ids = rows.map((r) => r.b.id), a = ids.indexOf(sel[0]), z = ids.indexOf(b.id);
      setSel(ids.slice(Math.min(a, z), Math.max(a, z) + 1));
      return;
    }
    setSel([b.id]);
    goToBookmark(doc, b);
  };
  const toggleOpen = (b: Bookmark) => s.setBookmarks(updateBookmark(list, b.id, { open: !b.open }), false);
  const setAll = (open: boolean) => {
    const walk = (l: Bookmark[]): Bookmark[] => l.map((b) => ({ ...b, open: b.kids.length ? open : b.open, kids: walk(b.kids) }));
    s.setBookmarks(walk(list), false);
  };
  const audit = () => {
    const broken = flatten(list).filter((x) => x.b.broken).length;
    s.setStatus(broken ? `Audit Bookmarks: ${broken} broken bookmark${broken === 1 ? '' : 's'} (marked ⚠)` : 'Audit Bookmarks: no broken bookmarks');
  };
  const add = (where: Where) => addBookmark(where, sel.at(-1) ?? null);
  const items = (b?: Bookmark): MenuItem[] => {
    const ids = b && !sel.includes(b.id) ? [b.id] : sel;
    return [
      { label: 'Add Before', action: () => addBookmark('before', b?.id ?? null) },
      { label: 'Add After', action: () => addBookmark('after', b?.id ?? null) },
      { label: 'Add Child', disabled: !b, action: () => b && addBookmark('child', b.id) },
      { sep: true },
      { label: 'Rename', shortcut: 'F2', disabled: !b, action: () => b && setRenaming(b.id) },
      { label: 'Delete', shortcut: 'Del', disabled: !ids.length, action: () => remove(ids) },
      { label: 'Set to Current View', disabled: !b, action: () => b && edit(updateBookmark(list, b.id, { ...currentView(doc), broken: false })) },
      { label: 'Action…', disabled: !b, action: () => b && setAction(b.id) },
      { label: 'Properties…', disabled: !ids.length, action: () => setProps(ids) },
    ];
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (renaming) return;
    if (e.key === 'Delete' && sel.length) { e.preventDefault(); e.stopPropagation(); remove(sel); }
    else if (e.key === 'F2' && sel.length === 1) { e.preventDefault(); e.stopPropagation(); setRenaming(sel[0]); }
  };
  const whereAt = (e: React.DragEvent): Where => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect(), f = (e.clientY - r.top) / r.height;
    return f < 0.3 ? 'before' : f > 0.7 ? 'after' : 'child';
  };

  return (
    <div className="bookmarks-panel" tabIndex={0} onKeyDown={onKey} aria-label="Bookmarks list">
      <div className="layers-toolbar">
        <button onClick={(e) => setMenu({ x: e.clientX, y: e.clientY, items: [
          { label: 'Expand All', action: () => setAll(true) },
          { label: 'Collapse All', action: () => setAll(false) },
          // Save Collapse State (Revu): the open/closed layout becomes the file's default (kept when the file is saved).
          { label: 'Save Collapse State', disabled: !list.length, action: () => { s.setBookmarks(list, true); s.setStatus('Bookmark collapse state saved: save the file to keep it.'); } },
          { sep: true },
          { label: 'Create Bookmarks…', action: openAutoMark },
          { label: 'Audit Bookmarks', disabled: !list.length, action: audit },
          { label: 'Export Bookmarks (CSV)', disabled: !list.length, action: () => exportCsv(doc) },
          { label: 'Export Bookmarks (PDF)', disabled: !s.docs.some((d) => d.bookmarks.length), action: () => void exportPdf(doc, s.docs) },
        ] })}>Bookmarks ▾</button>
        <button title="Add Bookmark (Ctrl+B)" onClick={() => add('after')}>+ Bookmark</button>
        <button aria-label="Add bookmark options" onClick={(e) => setMenu({ x: e.clientX, y: e.clientY, items: [
          { label: 'Add Before', action: () => add('before') },
          { label: 'Add After', action: () => add('after') },
          { label: 'Add Child', disabled: !sel.length, action: () => add('child') },
        ] })}>▾</button>
      </div>
      {!list.length && <p className="muted pad">This document has no bookmarks. Add Bookmark (Ctrl+B) marks the current view.</p>}
      <div role="tree" onContextMenu={(e) => { if (e.target === e.currentTarget) { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, items: items() }); } }}>
        {rows.map(({ b, depth }) => (
          <div key={b.id} role="treeitem" aria-selected={sel.includes(b.id)} aria-expanded={b.kids.length ? b.open : undefined}
            className={`bookmark-row ${sel.includes(b.id) ? 'selected' : ''} ${drop?.id === b.id ? `drop-${drop.where}` : ''}`}
            style={{ paddingLeft: 4 + depth * 14 }} draggable={renaming !== b.id}
            onDragStart={(e) => { dragging.current = sel.includes(b.id) ? sel : [b.id]; e.dataTransfer.effectAllowed = 'copyMove'; e.dataTransfer.setData('text/plain', b.title); }}
            onDragOver={(e) => { if (!dragging.current.length) return; e.preventDefault(); e.dataTransfer.dropEffect = e.ctrlKey ? 'copy' : 'move'; setDrop({ id: b.id, where: whereAt(e) }); }}
            onDragLeave={() => setDrop(null)}
            onDrop={(e) => { e.preventDefault(); const w = whereAt(e); setDrop(null); edit(moveBookmarks(list, dragging.current, b.id, w, e.ctrlKey)); dragging.current = []; }}
            onDragEnd={() => { dragging.current = []; setDrop(null); }}
            onContextMenu={(e) => { e.preventDefault(); if (!sel.includes(b.id)) setSel([b.id]); setMenu({ x: e.clientX, y: e.clientY, items: items(b) }); }}>
            <span className="bm-toggle" onClick={() => b.kids.length && toggleOpen(b)}>{b.kids.length ? (b.open ? '▾' : '▸') : ''}</span>
            {b.broken && <span className="bm-broken" title="Broken: the page it points to is not in this file">⚠</span>}
            {renaming === b.id ? (
              <input autoFocus className="bm-rename" aria-label="Bookmark name" defaultValue={b.title}
                onFocus={(e) => e.currentTarget.select()}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') e.currentTarget.blur();
                  if (e.key === 'Escape') { e.currentTarget.value = b.title; e.currentTarget.blur(); }
                }}
                onBlur={(e) => { const t = e.currentTarget.value.trim(); if (t && t !== b.title) edit(updateBookmark(list, b.id, { title: t })); setRenaming(null); }} />
            ) : (
              <span className="bm-title" onClick={(e) => click(e, b)} onDoubleClick={() => setRenaming(b.id)}
                style={{ color: b.color, fontWeight: b.bold ? 700 : undefined, fontStyle: b.italic ? 'italic' : undefined }}>{b.title || '(untitled)'}</span>
            )}
            {b.page === doc.page && <span className="bm-here" title="On the current page">◂</span>}
          </div>
        ))}
      </div>
      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
      {props && <PropsDialog doc={doc} ids={props} onClose={() => setProps(null)} />}
      {action && <ActionDialog doc={doc} id={action} onClose={() => setAction(null)} />}
    </div>
  );
}

function PropsDialog({ doc, ids, onClose }: { doc: DocState; ids: string[]; onClose: () => void }) {
  const first = findBookmark(doc.bookmarks, ids[0]);
  const [title, setTitle] = useState(first?.title ?? '');
  const [color, setColor] = useState(first?.color ?? '#000000');
  const [bold, setBold] = useState(!!first?.bold);
  const [italic, setItalic] = useState(!!first?.italic);
  const ok = () => {
    let next = doc.bookmarks;
    for (const id of ids) {
      next = updateBookmark(next, id, { ...(ids.length === 1 && title.trim() ? { title: title.trim() } : {}), color: color === '#000000' ? undefined : color, bold, italic });
    }
    useApp.getState().setBookmarks(next);
    onClose();
  };
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label="Bookmark Properties" onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') onClose(); if (e.key === 'Enter') ok(); }}>
        <div className="modal-title">Bookmark Properties</div>
        <div className="scale-dialog">
          {ids.length === 1 && <div className="form-row"><span>Title</span><input aria-label="Title" value={title} onChange={(e) => setTitle(e.target.value)} /></div>}
          <div className="form-row"><span>Color</span><input type="color" aria-label="Color" value={color} onChange={(e) => setColor(e.target.value)} /></div>
          <div className="form-row"><span>Style</span>
            <label><input type="checkbox" checked={bold} onChange={(e) => setBold(e.target.checked)} /> Bold</label>
            <label><input type="checkbox" checked={italic} onChange={(e) => setItalic(e.target.checked)} /> Italic</label>
          </div>
          <div className="modal-actions"><span className="spacer" /><button className="primary" onClick={ok}>OK</button><button onClick={onClose}>Cancel</button></div>
        </div>
      </div>
    </div>
  );
}

/** Revu's bookmark Action dialog: jump to a page (optionally the current view), a Place, a web address or a page of another file. */
function ActionDialog({ doc, id, onClose }: { doc: DocState; id: string; onClose: () => void }) {
  const b = findBookmark(doc.bookmarks, id);
  const act = b?.action;
  const places = doc.loaded.places;
  const n = doc.loaded.pages.length;
  const [kind, setKind] = useState<'page' | 'view' | 'place' | 'uri' | 'file'>(act?.uri ? 'uri' : act?.file ? 'file' : act?.dest ? 'place' : 'page');
  const [pageNo, setPageNo] = useState(String((b?.page ?? doc.page) + 1));
  const [place, setPlace] = useState(act?.dest ?? places[0]?.name ?? '');
  const [uri, setUri] = useState(act?.uri ?? 'https://');
  const [file, setFile] = useState(act?.file ?? '');
  const [filePage, setFilePage] = useState(String((act?.file ? act.page ?? 0 : 0) + 1));
  if (!b) return null;
  const pageOk = Number(pageNo) >= 1 && Number(pageNo) <= n;
  const valid = kind === 'page' ? pageOk : kind === 'view' ? true : kind === 'place' ? !!place : kind === 'uri' ? /^[a-z]+:\/\/./i.test(uri) || /^mailto:/i.test(uri) : !!file.trim() && Number(filePage) >= 1;
  const ok = () => {
    if (!valid) return;
    const patch: Partial<Bookmark> = { destEdited: true, broken: false, action: undefined };
    if (kind === 'page') Object.assign(patch, { page: Number(pageNo) - 1, fit: 'Fit', args: [] });
    else if (kind === 'view') Object.assign(patch, currentView(doc));
    else if (kind === 'place') Object.assign(patch, { action: { dest: place }, page: doc.loaded.places.find((p) => p.name === place)?.page ?? b.page });
    else if (kind === 'uri') Object.assign(patch, { action: { uri: uri.trim() }, page: null });
    else Object.assign(patch, { action: { file: file.trim(), page: Number(filePage) - 1 }, page: null });
    useApp.getState().setBookmarks(updateBookmark(doc.bookmarks, id, patch));
    onClose();
  };
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label="Bookmark Action" onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') onClose(); if (e.key === 'Enter') ok(); }}>
        <div className="modal-title">Action: {b.title}</div>
        <div className="scale-dialog">
          <div className="form-row">
            <label><input type="radio" checked={kind === 'page'} onChange={() => setKind('page')} /> Jump to page</label>
            <input aria-label="Page number" type="number" min={1} max={n} value={pageNo} onChange={(e) => setPageNo(e.target.value)} onFocus={() => setKind('page')} style={{ width: 70 }} /> of {n}
          </div>
          <div className="form-row"><label><input type="radio" checked={kind === 'view'} onChange={() => setKind('view')} /> Jump to the current view (page {doc.loaded.pages[doc.page]?.label})</label></div>
          <div className="form-row">
            <label><input type="radio" checked={kind === 'place'} disabled={!places.length} onChange={() => setKind('place')} /> Jump to Place</label>
            <select aria-label="Place" value={place} disabled={!places.length} onChange={(e) => { setPlace(e.target.value); setKind('place'); }}>
              {!places.length && <option value="">(no Places: add one in the Links panel)</option>}
              {places.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
            </select>
          </div>
          <div className="form-row">
            <label><input type="radio" checked={kind === 'uri'} onChange={() => setKind('uri')} /> Open web address</label>
            <input aria-label="Web address" value={uri} onChange={(e) => setUri(e.target.value)} onFocus={() => setKind('uri')} style={{ width: 240 }} />
          </div>
          <div className="form-row">
            <label><input type="radio" checked={kind === 'file'} onChange={() => setKind('file')} /> Open file</label>
            <input aria-label="File name" placeholder="other.pdf" value={file} onChange={(e) => setFile(e.target.value)} onFocus={() => setKind('file')} style={{ width: 160 }} />
            page <input aria-label="File page" type="number" min={1} value={filePage} onChange={(e) => setFilePage(e.target.value)} onFocus={() => setKind('file')} style={{ width: 60 }} />
          </div>
          <div className="modal-actions"><span className="spacer" /><button className="primary" disabled={!valid} onClick={ok}>OK</button><button onClick={onClose}>Cancel</button></div>
        </div>
      </div>
    </div>
  );
}
