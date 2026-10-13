import { create } from 'zustand';
import { PDFDocument } from 'pdf-lib';
import type { LoadedDoc } from '../pdf/document';
import { openPdf } from '../pdf/document';
import { savePdf } from '../pdf/save';
import { DEFAULT_STYLES, toolById } from '../tools/tools';
import { MEASURE_TYPES, scaleAt } from './measure';
import { translated } from './markup';
import { expandGroups } from './arrange';
import { columnDefaults } from './columns';
import type {
  CustomColumn, Markup, MarkupStyle, MarkupType, Pt, Scale, Space, ToolId, ToolPreset, Toggles, Viewport,
} from './types';

export type LeftPanel = 'thumbnails' | 'bookmarks' | 'spaces' | 'search' | 'sets' | null;
export type RightPanel = 'properties' | 'toolchest' | 'measurements' | null;

/** Page scales and viewports, for undoing scale changes. */
export interface ScaleSnapshot { markups: Markup[]; calibrations: (Scale | null)[]; viewports: Viewport[][]; spaces?: Space[][] }
/** An undo step: markups only, or markups with page scales and viewports. */
export type UndoEntry = Markup[] | ScaleSnapshot;

export interface DocState {
  id: string;
  name: string;
  bytes: Uint8Array;
  fileHandle?: FileSystemFileHandle;
  loaded: LoadedDoc;
  markups: Markup[];
  importedRefs: Set<string>;
  calibrations: (Scale | null)[];
  /** Regions with their own scale, per page. */
  viewports: Viewport[][];
  /** Pages whose scale or viewports changed (their /VP is rewritten on save). */
  dirtyCalibrations: Set<number>;
  /** Revu Spaces, per page. */
  spaces: Space[][];
  /** Pages whose Spaces changed (their /BSISpaces is rewritten on save). */
  dirtySpaces: Set<number>;
  /** Custom columns of the Markups List (saved with the document). */
  columns: CustomColumn[];
  dirtyColumns: boolean;
  page: number;
  zoom: number;
  selection: string[];
  undo: UndoEntry[];
  redo: UndoEntry[];
  dirty: boolean;
}

/**
 * Apply Scale dialog state. `pagePts` is set after calibrating (distance
 * between the two picked points); `then` is the measure tool to resume;
 * `viewport` switches it to "Apply Scale to Viewport".
 */
export interface ScaleDialogState {
  page: number;
  pagePts?: number;
  then?: ToolId;
  reuse?: boolean;
  viewport?: { rect: [Pt, Pt]; id?: string; name?: string };
  /** Calibrating the Y scale (Separate Y Scale); `xScale` is the X scale chosen before. */
  calibrateY?: boolean;
  xScale?: Scale;
}

interface AppState {
  docs: DocState[];
  activeId: string | null;
  tool: ToolId;
  toolLocked: boolean;
  preset: ToolPreset | null;
  toolDefaults: Record<MarkupType, MarkupStyle>;
  toggles: Toggles;
  left: LeftPanel;
  right: RightPanel;
  markupsList: boolean;
  author: string;
  toolChest: ToolPreset[];
  recentTools: ToolPreset[];
  /**
   * Apply Scale to Pages dialog. `pagePts` is set after calibrating (distance
   * between the two picked points); `then` is the measure tool to resume.
   */
  scaleDialog: ScaleDialogState | null;
  /** The dialog to reopen once the Calibrate tool has picked two points. */
  calibrateFor: ScaleDialogState | null;
  /** Markup the Markups List is taking a reply for. */
  replyTo: string | null;
  /** Markup kinds the next Legend lists (from a selection or a tool set). */
  legendKeys: string[] | null;
  /** Stamp placed by the Stamp tool. */
  stampName: string;
  /** Hyperlink dialog for a new (or existing, by id) link rectangle. */
  linkDialog: { page: number; rect: [Pt, Pt]; id?: string } | null;
  /** Shift+Alt+U picks the radius tool used last (Revu). */
  radiusTool: 'radius' | 'radius-3pt';
  /** Viewport highlighted from the Measurements panel. */
  activeViewport: string | null;
  /** Scales saved with "+ Add Preset", listed first among presets. */
  savedScales: Scale[];
  status: string;
  busy: boolean;
  clipboard: Markup[];

  openBytes(bytes: Uint8Array, name: string, handle?: FileSystemFileHandle): Promise<void>;
  closeDoc(id: string): void;
  setActive(id: string): void;
  /** Page / zoom of the active view (split pane aware). */
  setPage(page: number): void;
  setZoom(zoom: number): void;
  /** Page / zoom of a given view pane. */
  setViewPage(pane: 0 | 1, page: number): void;
  setViewZoom(pane: 0 | 1, zoom: number): void;
  /** Split view (Revu: Split Horizontal Ctrl+H, Split Vertical Ctrl+2, Unsplit, Switch Ctrl+1). */
  split: { dir: 'h' | 'v'; mainDocId: string; docId: string; page: number; zoom: number } | null;
  activePane: 0 | 1;
  splitView(dir: 'h' | 'v'): void;
  unsplit(): void;
  focusPane(pane: 0 | 1): void;
  setTool(tool: ToolId, opts?: { locked?: boolean; preset?: ToolPreset | null }): void;
  addMarkup(m: Omit<Markup, 'id' | 'author' | 'created' | 'modified' | 'status' | 'label' | 'comment'> & Partial<Markup>): Markup;
  updateMarkups(ids: string[], fn: (m: Markup) => Partial<Markup>, opts?: { history?: boolean }): void;
  pushUndo(snapshot: Markup[]): void;
  deleteMarkups(ids: string[]): void;
  /** Apply an arrangement command (group, order, align, flip...) to the selection. */
  arrange(fn: (markups: Markup[], ids: string[]) => Markup[]): void;
  /** Toggle Lock on the selection. */
  toggleLock(): void;
  /** Format Painter: the style picked up with Ctrl+Shift+C, applied to the next markup clicked. */
  painter: { style: MarkupStyle } | null;
  /** Replace the document's markups (tools that rewrite several at once). */
  setMarkups(markups: Markup[], opts?: { history?: boolean }): void;
  select(ids: string[], add?: boolean): void;
  undo(): void;
  redo(): void;
  copy(): void;
  /** Paste; `inPlace` keeps the original position (Paste in Place). */
  paste(inPlace?: boolean): void;
  setCalibration(page: number, scale: Scale | null, allPages?: boolean): void;
  /** Set (or clear) the scale of several pages; re-scales their measurements. */
  setScale(pages: number[], scale: Scale | null): void;
  addSavedScale(scale: Scale): void;
  removeSavedScale(label: string): void;
  setToolDefault(type: MarkupType, patch: Partial<MarkupStyle>): void;
  toggle(key: keyof Toggles): void;
  setPanels(p: Partial<Pick<AppState, 'left' | 'right' | 'markupsList'>>): void;
  setAuthor(a: string): void;
  addToToolChest(m: Markup): void;
  removeFromToolChest(id: string): void;
  openScaleDialog(d: AppState['scaleDialog']): void;
  /** Start the Calibrate tool; the dialog `d` reopens with the picked length. */
  startCalibrate(d?: ScaleDialogState | null): void;
  /** Add a viewport, or replace the one with the same id; re-scales measurements inside. */
  setViewport(page: number, v: Viewport): void;
  /** Delete viewports by id, or all on `pages`. */
  deleteViewports(pages: number[], ids?: string[]): void;
  /**
   * Restructure the document's PDF (page operations): changes so far are
   * written in, `fn` edits the pdf-lib document, and the result is reloaded.
   * Returns false if it failed (the status bar says why).
   */
  transformDoc(fn: (lib: PDFDocument) => Promise<void> | void, done: string, page?: number): Promise<boolean>;
  /** Replace the document's custom columns. */
  setColumns(cols: CustomColumn[]): void;
  /** Add a Space, or replace the one with the same id. */
  setSpace(page: number, sp: Space): void;
  deleteSpaces(page: number, ids: string[]): void;
  /** Naming dialog for a Space just drawn (or being edited). */
  spaceDialog: { page: number; points: Pt[]; id?: string } | null;
  /** Spaces panel: Highlight Spaces toggle and the selected Space. */
  spacesHighlight: boolean;
  activeSpace: string | null;
  setActiveViewport(id: string | null): void;
  save(saveAs?: boolean): Promise<void>;
  setStatus(s: string): void;
}

// ---------- persistence (per-viewer preferences) ----------

const LS = 'cyantakeoff:prefs';
function loadPrefs(): Partial<AppState> {
  try { return JSON.parse(localStorage.getItem(LS) ?? '{}'); } catch { return {}; }
}
function savePrefs(s: AppState) {
  try {
    localStorage.setItem(LS, JSON.stringify({
      toolDefaults: s.toolDefaults, toggles: s.toggles, author: s.author,
      toolChest: s.toolChest, recentTools: s.recentTools, savedScales: s.savedScales,
      left: s.left, right: s.right, markupsList: s.markupsList,
    }));
  } catch { /* storage unavailable */ }
}

const preset = (name: string, type: MarkupType, style: Partial<MarkupStyle>, extra: Partial<ToolPreset> = {}): ToolPreset => ({
  id: crypto.randomUUID(), name, type, style: { ...DEFAULT_STYLES[type], ...style }, subject: name, ...extra,
});

export const SAMPLE_TOOL_CHEST: ToolPreset[] = [
  preset('Concrete Slab', 'volume', { color: '#808080', fill: '#a0a0a0' }, { depth: 0.5 }),
  preset('Flooring', 'area', { color: '#c08000', fill: '#ffcc33' }),
  preset('Drywall', 'polylength', { color: '#cc0000', width: 3 }),
  preset('Base Trim', 'polylength', { color: '#008855', width: 2 }),
  preset('Doors', 'count', { color: '#0055ff', fill: '#0055ff' }),
  preset('Windows', 'count', { color: '#00aa66', fill: '#00aa66' }),
  preset('Revision Cloud', 'cloud', { color: '#ff0000' }),
];

const prefs = loadPrefs();

const now = () => new Date().toISOString();

/** Viewport id, in the style of Revu's /NM (16 capital letters). */
export const newViewportId = () => Array.from({ length: 16 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join('');

/** The document with all its changes written into the PDF. */
export function serialize(d: DocState): Promise<Uint8Array> {
  return savePdf({
    original: d.bytes, pages: d.loaded.pages, markups: d.markups,
    importedRefs: d.importedRefs, calibrations: d.calibrations, viewports: d.viewports,
    dirtyCalibrations: d.dirtyCalibrations, spaces: d.spaces, dirtySpaces: d.dirtySpaces,
    columns: d.dirtyColumns ? d.columns : undefined,
  });
}

/** State after applying an undo entry, plus the entry that reverses it. */
function restore(d: DocState, e: UndoEntry): [Partial<DocState>, UndoEntry] {
  if (Array.isArray(e)) return [{ markups: e }, d.markups];
  const dirtyCalibrations = new Set(d.dirtyCalibrations);
  const dirtySpaces = new Set(d.dirtySpaces);
  const spaces = e.spaces ?? d.spaces;
  d.loaded.pages.forEach((_, p) => {
    if (e.calibrations[p] !== d.calibrations[p] || e.viewports[p] !== d.viewports[p]) dirtyCalibrations.add(p);
    if (spaces[p] !== d.spaces[p]) dirtySpaces.add(p);
  });
  return [
    { markups: e.markups, calibrations: e.calibrations, viewports: e.viewports, spaces, dirtyCalibrations, dirtySpaces },
    { markups: d.markups, calibrations: d.calibrations, viewports: d.viewports, spaces: d.spaces },
  ];
}

/**
 * Apply new page scales/viewports to `pages`, re-scaling the measurements
 * whose governing scale changed (as Revu does). Other markups are untouched,
 * so unchanged imported annotations are not rewritten.
 */
function rescoped(d: DocState, pages: number[], calibrations: (Scale | null)[], viewports: Viewport[][]): Partial<DocState> {
  const target = new Set(pages);
  const key = (s: Scale | null) => JSON.stringify(s);
  const markups = d.markups.map((m) => {
    if (!target.has(m.page) || !MEASURE_TYPES.has(m.type)) return m;
    const before = scaleAt(d.calibrations[m.page], d.viewports[m.page], m.points[0]);
    const after = scaleAt(calibrations[m.page], viewports[m.page], m.points[0]);
    if (key(before) === key(after)) return m;
    return { ...m, scale: after ?? undefined, modified: now(), source: m.source ? { ...m.source, dirty: true } : undefined };
  });
  const dirtyCalibrations = new Set(d.dirtyCalibrations);
  pages.forEach((p) => dirtyCalibrations.add(p));
  const snap: ScaleSnapshot = { markups: d.markups, calibrations: d.calibrations, viewports: d.viewports };
  return { calibrations, viewports, dirtyCalibrations, markups, undo: [...d.undo, snap], redo: [], dirty: true };
}

export const useApp = create<AppState>((set, get) => {
  /** Mutate the active document. */
  const withDoc = (fn: (d: DocState) => Partial<DocState>) => {
    const { docs, activeId } = get();
    set({ docs: docs.map((d) => (d.id === activeId ? { ...d, ...fn(d) } : d)) });
  };

  return {
    docs: [],
    activeId: null,
    tool: 'select',
    toolLocked: false,
    preset: null,
    toolDefaults: { ...DEFAULT_STYLES, ...(prefs.toolDefaults ?? {}) },
    toggles: { snap: false, grid: false, content: true, markup: true, reuse: false, sync: false, ...(prefs.toggles ?? {}) },
    left: prefs.left === undefined ? 'thumbnails' : prefs.left,
    right: prefs.right === undefined ? 'properties' : prefs.right,
    markupsList: prefs.markupsList ?? true,
    author: prefs.author ?? 'User',
    toolChest: prefs.toolChest ?? SAMPLE_TOOL_CHEST,
    recentTools: prefs.recentTools ?? [],
    scaleDialog: null,
    calibrateFor: null,
    radiusTool: 'radius',
    stampName: 'APPROVED',
    legendKeys: null,
    replyTo: null,
    linkDialog: null,
    activeViewport: null,
    savedScales: prefs.savedScales ?? [],
    status: 'Ready',
    busy: false,
    clipboard: [],

    async openBytes(bytes, name, handle) {
      set({ busy: true, status: `Opening ${name}…` });
      try {
        const loaded = await openPdf(bytes);
        const markups = loaded.markups.map((m) =>
          MEASURE_TYPES.has(m.type) && !m.scale
            ? { ...m, scale: scaleAt(loaded.calibrations[m.page], loaded.viewports[m.page], m.points[0]) ?? undefined }
            : m);
        const doc: DocState = {
          id: crypto.randomUUID(),
          name, bytes, fileHandle: handle, loaded, markups,
          importedRefs: loaded.importedRefs,
          calibrations: loaded.calibrations,
          viewports: loaded.viewports,
          dirtyCalibrations: new Set(),
          spaces: loaded.spaces,
          dirtySpaces: new Set(),
          columns: loaded.columns,
          dirtyColumns: false,
          page: 0, zoom: 0, selection: [], undo: [], redo: [], dirty: false,
        };
        set((s) => ({ docs: [...s.docs, doc], activeId: doc.id, status: loaded.readOnly ? `${name} opened read-only (file could not be parsed for editing)` : `Opened ${name}` }));
      } catch (e) {
        console.error(e);
        set({ status: `Could not open ${name}: ${(e as Error).message}` });
      } finally {
        set({ busy: false });
      }
    },

    closeDoc(id) {
      const d = get().docs.find((x) => x.id === id);
      if (d?.dirty && !confirm(`Close ${d.name} without saving changes?`)) return;
      const sp = get().split;
      if (sp && (sp.docId === id || sp.mainDocId === id)) set({ split: null, activePane: 0 });
      d?.loaded.pdf.loadingTask.destroy();
      set((s) => {
        const docs = s.docs.filter((x) => x.id !== id);
        return { docs, activeId: s.activeId === id ? docs[docs.length - 1]?.id ?? null : s.activeId };
      });
    },
    setActive(id) {
      const { split, activePane } = get();
      if (split) set({ split: activePane ? { ...split, docId: id, page: split.docId === id ? split.page : 0, zoom: split.docId === id ? split.zoom : 0 } : { ...split, mainDocId: id } });
      set({ activeId: id });
    },
    setPage: (page) => get().setViewPage(get().split ? get().activePane : 0, page),
    setZoom: (zoom) => get().setViewZoom(get().split ? get().activePane : 0, zoom),
    setViewPage(pane, page) {
      const { split, docs } = get();
      if (pane === 1 && split) {
        const d = docs.find((x) => x.id === split.docId);
        if (d) set({ split: { ...split, page: Math.max(0, Math.min(d.loaded.pages.length - 1, page)) } });
        withDoc(() => ({ selection: [] }));
        return;
      }
      const id = split ? split.mainDocId : get().activeId;
      set({ docs: docs.map((d) => (d.id === id ? { ...d, page: Math.max(0, Math.min(d.loaded.pages.length - 1, page)), selection: [] } : d)) });
    },
    setViewZoom(pane, zoom) {
      const z = Math.max(0.02, Math.min(64, zoom));
      const { split, docs } = get();
      if (pane === 1 && split) { set({ split: { ...split, zoom: z } }); return; }
      const id = split ? split.mainDocId : get().activeId;
      set({ docs: docs.map((d) => (d.id === id ? { ...d, zoom: z } : d)) });
    },
    split: null,
    activePane: 0,
    splitView(dir) {
      const { activeId, split, docs } = get();
      if (!activeId) return;
      if (split) { set({ split: { ...split, dir } }); return; }
      const d = docs.find((x) => x.id === activeId)!;
      set({ split: { dir, mainDocId: activeId, docId: activeId, page: d.page, zoom: 0 }, activePane: 1 });
    },
    unsplit() {
      const { split } = get();
      if (!split) return;
      set({ split: null, activePane: 0, activeId: split.mainDocId });
    },
    focusPane(pane) {
      const { split } = get();
      if (!split) return;
      set({ activePane: pane, activeId: pane ? split.docId : split.mainDocId });
    },

    setTool(tool, opts = {}) {
      set({ tool, toolLocked: opts.locked ?? false, preset: opts.preset ?? null, calibrateFor: null });
      if (tool === 'radius' || tool === 'radius-3pt') set({ radiusTool: tool });
      if (tool !== 'select') withDoc(() => ({ selection: [] }));
    },

    addMarkup(partial) {
      const s = get();
      const d = s.docs.find((x) => x.id === s.activeId)!;
      const t = now();
      const m: Markup = {
        id: crypto.randomUUID(),
        author: s.author,
        created: t,
        modified: t,
        status: 'None',
        label: '',
        comment: '',
        ...partial,
      } as Markup;
      if (MEASURE_TYPES.has(m.type) && !m.scale) m.scale = scaleAt(d.calibrations[m.page], d.viewports[m.page], m.points[0]) ?? undefined;
      if (!m.custom) m.custom = columnDefaults(d.columns);
      withDoc((doc) => ({
        markups: [...doc.markups, m], undo: [...doc.undo, doc.markups], redo: [], dirty: true,
      }));
      // Recent Tools, like Revu: newest first, unique by type+subject+colour.
      const p: ToolPreset = { id: crypto.randomUUID(), name: m.subject, type: m.type, style: m.style, subject: m.subject, depth: m.depth };
      const key = (x: ToolPreset) => `${x.type}|${x.subject}|${x.style.color}|${x.style.fill}`;
      set((st) => ({ recentTools: [p, ...st.recentTools.filter((r) => key(r) !== key(p))].slice(0, 12) }));
      savePrefs(get());
      return m;
    },

    updateMarkups(ids, fn, opts = { history: true }) {
      const set_ = new Set(ids);
      withDoc((d) => ({
        markups: d.markups.map((m) => {
          if (!set_.has(m.id)) return m;
          const patch = fn(m);
          return {
            ...m, ...patch, modified: now(),
            source: m.source ? { ...m.source, dirty: true } : undefined,
          };
        }),
        undo: opts.history ? [...d.undo, d.markups] : d.undo,
        redo: opts.history ? [] : d.redo,
        dirty: true,
      }));
    },
    pushUndo: (snapshot) => withDoc((d) => ({ undo: [...d.undo, snapshot], redo: [] })),
    arrange(fn) {
      const d = activeDoc();
      if (!d?.selection.length) return;
      const next = fn(d.markups, d.selection);
      if (next !== d.markups) get().setMarkups(next);
    },
    toggleLock() {
      const d = activeDoc();
      if (!d?.selection.length) return;
      const lock = !d.markups.find((m) => m.id === d.selection[0])?.locked;
      get().updateMarkups(d.selection, () => ({ locked: lock || undefined }));
      set({ status: lock ? 'Locked' : 'Unlocked' });
    },
    painter: null,
    setMarkups(markups, opts = {}) {
      withDoc((d) => ({ markups, dirty: true, ...(opts.history === false ? {} : { undo: [...d.undo, d.markups], redo: [] }) }));
    },
    deleteMarkups(ids) {
      const d0 = activeDoc();
      // Locked markups cannot be deleted (Revu).
      ids = ids.filter((id) => !d0?.markups.find((m) => m.id === id)?.locked);
      if (!ids.length) return;
      const set_ = new Set(ids);
      withDoc((d) => ({
        markups: d.markups.filter((m) => !set_.has(m.id)),
        selection: d.selection.filter((x) => !set_.has(x)),
        undo: [...d.undo, d.markups], redo: [], dirty: true,
      }));
    },
    select(ids, add) {
      // Grouped markups select together (Revu).
      withDoc((d) => {
        const all = expandGroups(d.markups, ids);
        return { selection: add ? [...new Set([...d.selection, ...all])] : all };
      });
    },
    undo() {
      withDoc((d) => {
        if (!d.undo.length) return {};
        const [state, current] = restore(d, d.undo[d.undo.length - 1]);
        return { ...state, undo: d.undo.slice(0, -1), redo: [...d.redo, current], selection: [], dirty: true };
      });
    },
    redo() {
      withDoc((d) => {
        if (!d.redo.length) return {};
        const [state, current] = restore(d, d.redo[d.redo.length - 1]);
        return { ...state, redo: d.redo.slice(0, -1), undo: [...d.undo, current], selection: [], dirty: true };
      });
    },
    copy() {
      const d = activeDoc();
      if (!d) return;
      set({ clipboard: d.markups.filter((m) => d.selection.includes(m.id)) });
    },
    paste(inPlace) {
      const d = activeDoc();
      const clip = get().clipboard;
      if (!d || !clip.length) return;
      const off = inPlace ? 0 : 18;
      const t = now();
      const copies = clip.map((m) => ({
        ...m, id: crypto.randomUUID(), page: d.page, created: t, modified: t, source: undefined,
        ...translated(m, off, off),
      }));
      withDoc((doc) => ({
        markups: [...doc.markups, ...copies], selection: copies.map((c) => c.id),
        undo: [...doc.undo, doc.markups], redo: [], dirty: true,
      }));
      set({ clipboard: copies });
    },

    setCalibration(page, scale, allPages) {
      const d = activeDoc();
      if (!d) return;
      get().setScale(allPages ? d.loaded.pages.map((p) => p.index) : [page], scale);
    },
    setScale(pages, scale) {
      withDoc((d) => {
        const calibrations = [...d.calibrations];
        for (const p of pages) calibrations[p] = scale;
        return rescoped(d, pages, calibrations, d.viewports);
      });
      const n = pages.length;
      set({ scaleDialog: null, status: scale ? `Scale set to ${scale.label} on ${n} page${n === 1 ? '' : 's'}` : 'Scale cleared' });
    },
    setViewport(page, v) {
      withDoc((d) => {
        const viewports = [...d.viewports];
        const list = viewports[page] ?? [];
        viewports[page] = list.some((x) => x.id === v.id) ? list.map((x) => (x.id === v.id ? v : x)) : [...list, v];
        return rescoped(d, [page], d.calibrations, viewports);
      });
      set({ scaleDialog: null, activeViewport: v.id, status: `Viewport ${v.name || '(unnamed)'}: ${v.scale.label}` });
    },
    deleteViewports(pages, ids) {
      withDoc((d) => {
        const viewports = [...d.viewports];
        for (const p of pages) viewports[p] = ids ? (viewports[p] ?? []).filter((x) => !ids.includes(x.id)) : [];
        return rescoped(d, pages, d.calibrations, viewports);
      });
    },
    setActiveViewport: (activeViewport) => set({ activeViewport }),
    async transformDoc(fn, done, page) {
      const d = activeDoc();
      if (!d) return false;
      if (d.loaded.readOnly) { set({ status: 'This file could not be parsed for editing.' }); return false; }
      set({ busy: true, status: 'Updating pages…' });
      try {
        const lib = await PDFDocument.load(await serialize(d), { updateMetadata: false });
        await fn(lib);
        const bytes = await lib.save({ useObjectStreams: false });
        const loaded = await openPdf(bytes);
        const old = get().docs.find((x) => x.id === d.id)!;
        old.loaded.pdf.loadingTask.destroy();
        set((st) => ({
          docs: st.docs.map((x) => x.id === d.id ? {
            ...x, bytes, loaded, markups: loaded.markups, importedRefs: loaded.importedRefs,
            calibrations: loaded.calibrations, viewports: loaded.viewports, dirtyCalibrations: new Set(),
            spaces: loaded.spaces, dirtySpaces: new Set(), columns: loaded.columns, dirtyColumns: false,
            page: Math.max(0, Math.min(loaded.pages.length - 1, page ?? x.page)), selection: [], undo: [], redo: [], dirty: true,
          } : x),
          status: done,
        }));
        return true;
      } catch (e) {
        console.error(e);
        set({ status: `Could not update pages: ${(e as Error).message}` });
        return false;
      } finally {
        set({ busy: false });
      }
    },
    setColumns(columns) {
      withDoc(() => ({ columns, dirtyColumns: true, dirty: true }));
    },
    setSpace(page, sp) {
      withDoc((d) => {
        const spaces = [...d.spaces];
        const list = spaces[page] ?? [];
        spaces[page] = list.some((x) => x.id === sp.id) ? list.map((x) => (x.id === sp.id ? sp : x)) : [...list, sp];
        const snap: ScaleSnapshot = { markups: d.markups, calibrations: d.calibrations, viewports: d.viewports, spaces: d.spaces };
        return { spaces, dirtySpaces: new Set([...d.dirtySpaces, page]), undo: [...d.undo, snap], redo: [], dirty: true };
      });
      set({ spaceDialog: null, activeSpace: sp.id });
    },
    deleteSpaces(page, ids) {
      withDoc((d) => {
        const spaces = [...d.spaces];
        spaces[page] = (spaces[page] ?? []).filter((x) => !ids.includes(x.id));
        const snap: ScaleSnapshot = { markups: d.markups, calibrations: d.calibrations, viewports: d.viewports, spaces: d.spaces };
        return { spaces, dirtySpaces: new Set([...d.dirtySpaces, page]), undo: [...d.undo, snap], redo: [], dirty: true };
      });
      set({ activeSpace: null });
    },
    spaceDialog: null,
    spacesHighlight: true,
    activeSpace: null,
    addSavedScale(scale) {
      set((st) => ({ savedScales: [scale, ...st.savedScales.filter((x) => x.label !== scale.label)], status: `Saved preset ${scale.label}` }));
      savePrefs(get());
    },
    removeSavedScale(label) {
      set((st) => ({ savedScales: st.savedScales.filter((x) => x.label !== label) }));
      savePrefs(get());
    },

    setToolDefault(type, patch) {
      set((s) => ({ toolDefaults: { ...s.toolDefaults, [type]: { ...s.toolDefaults[type], ...patch } } }));
      savePrefs(get());
    },
    toggle(key) {
      set((s) => ({ toggles: { ...s.toggles, [key]: !s.toggles[key] } }));
      savePrefs(get());
    },
    setPanels(p) { set(p); savePrefs(get()); },
    setAuthor(author) { set({ author }); savePrefs(get()); },
    addToToolChest(m) {
      const p: ToolPreset = { id: crypto.randomUUID(), name: m.subject || toolById(m.type).name, type: m.type, style: m.style, subject: m.subject, depth: m.depth };
      set((s) => ({ toolChest: [...s.toolChest, p], status: `Added "${p.name}" to My Tools` }));
      savePrefs(get());
    },
    removeFromToolChest(id) {
      set((s) => ({ toolChest: s.toolChest.filter((t) => t.id !== id) }));
      savePrefs(get());
    },
    openScaleDialog: (scaleDialog) => set({ scaleDialog }),
    startCalibrate(d) {
      set({ scaleDialog: null, calibrateFor: d ?? null, tool: 'calibrate', toolLocked: false, preset: null,
        status: 'Calibrate: click the two ends of a known length on the drawing.' });
    },
    setStatus: (status) => set({ status }),

    async save(saveAs) {
      const d = activeDoc();
      if (!d) return;
      if (d.loaded.readOnly) { alert('This file could not be parsed for editing, so markups cannot be saved into it.'); return; }
      set({ busy: true, status: `Saving ${d.name}…` });
      try {
        const bytes = await serialize(d);
        let handle = saveAs ? undefined : d.fileHandle;
        let name = d.name;
        const w = window as unknown as { showSaveFilePicker?: (o: unknown) => Promise<FileSystemFileHandle> };
        if (!handle && w.showSaveFilePicker) {
          try {
            handle = await w.showSaveFilePicker({ suggestedName: d.name, types: [{ description: 'PDF', accept: { 'application/pdf': ['.pdf'] } }] });
          } catch { set({ status: 'Save cancelled' }); return; }
        }
        if (handle) {
          const ws = await handle.createWritable();
          await ws.write(bytes as unknown as BlobPart);
          await ws.close();
          name = handle.name;
        } else {
          const url = URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' }));
          const a = Object.assign(document.createElement('a'), { href: url, download: d.name });
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 10_000);
        }
        // Reload from the saved bytes so imported refs match the new file.
        const { page, zoom } = get().docs.find((x) => x.id === d.id) ?? d;
        const loaded = await openPdf(bytes);
        d.loaded.pdf.loadingTask.destroy();
        const markups = loaded.markups;
        set((s) => ({
          docs: s.docs.map((x) => x.id === d.id ? {
            ...x, name, bytes, fileHandle: handle, loaded, markups,
            importedRefs: loaded.importedRefs,
            calibrations: loaded.calibrations, viewports: loaded.viewports, dirtyCalibrations: new Set(),
            spaces: loaded.spaces, dirtySpaces: new Set(), columns: loaded.columns, dirtyColumns: false,
            page, zoom, selection: [], undo: [], redo: [], dirty: false,
          } : x),
          status: `Saved ${name}`,
        }));
      } catch (e) {
        console.error(e);
        set({ status: `Save failed: ${(e as Error).message}` });
      } finally {
        set({ busy: false });
      }
    },
  };
});

/** The document in the active view; in split pane 2 its page and zoom are that pane's. */
function viewDoc(s: AppState): DocState | undefined {
  const d = s.docs.find((x) => x.id === s.activeId);
  if (!d || !s.split || s.activePane !== 1 || s.split.docId !== d.id) return d;
  return { ...d, page: s.split.page, zoom: s.split.zoom };
}

export function activeDoc(): DocState | undefined {
  return viewDoc(useApp.getState());
}

const cache = new WeakMap<DocState, { page: number; zoom: number; view: DocState }>();
/** Stable per (document, page, zoom) so components only re-render on real changes. */
export const useActiveDoc = () => useApp((s) => {
  const v = viewDoc(s);
  const d = s.docs.find((x) => x.id === s.activeId);
  if (!v || !d || v === d) return v;
  const c = cache.get(d);
  if (c && c.page === v.page && c.zoom === v.zoom) return c.view;
  cache.set(d, { page: v.page, zoom: v.zoom, view: v });
  return v;
});
