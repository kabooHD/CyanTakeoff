import { create } from 'zustand';
import type { LoadedDoc } from '../pdf/document';
import { openPdf } from '../pdf/document';
import { savePdf } from '../pdf/save';
import { DEFAULT_STYLES, toolById } from '../tools/tools';
import { MEASURE_TYPES, scaleAt } from './measure';
import { translated } from './markup';
import type {
  Markup, MarkupStyle, MarkupType, Pt, Scale, ToolId, ToolPreset, Toggles, Viewport,
} from './types';

export type LeftPanel = 'thumbnails' | 'bookmarks' | null;
export type RightPanel = 'properties' | 'toolchest' | 'measurements' | null;

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
  page: number;
  zoom: number;
  selection: string[];
  undo: Markup[][];
  redo: Markup[][];
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
  setPage(page: number): void;
  setZoom(zoom: number): void;
  setTool(tool: ToolId, opts?: { locked?: boolean; preset?: ToolPreset | null }): void;
  addMarkup(m: Omit<Markup, 'id' | 'author' | 'created' | 'modified' | 'status' | 'label' | 'comment'> & Partial<Markup>): Markup;
  updateMarkups(ids: string[], fn: (m: Markup) => Partial<Markup>, opts?: { history?: boolean }): void;
  pushUndo(snapshot: Markup[]): void;
  deleteMarkups(ids: string[]): void;
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
  return { calibrations, viewports, dirtyCalibrations, markups, undo: [...d.undo, d.markups], dirty: true };
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
      d?.loaded.pdf.loadingTask.destroy();
      set((s) => {
        const docs = s.docs.filter((x) => x.id !== id);
        return { docs, activeId: s.activeId === id ? docs[docs.length - 1]?.id ?? null : s.activeId };
      });
    },
    setActive: (id) => set({ activeId: id }),
    setPage: (page) => withDoc((d) => ({ page: Math.max(0, Math.min(d.loaded.pages.length - 1, page)), selection: [] })),
    setZoom: (zoom) => withDoc(() => ({ zoom: Math.max(0.02, Math.min(64, zoom)) })),

    setTool(tool, opts = {}) {
      set({ tool, toolLocked: opts.locked ?? false, preset: opts.preset ?? null, calibrateFor: null });
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
    deleteMarkups(ids) {
      if (!ids.length) return;
      const set_ = new Set(ids);
      withDoc((d) => ({
        markups: d.markups.filter((m) => !set_.has(m.id)),
        selection: d.selection.filter((x) => !set_.has(x)),
        undo: [...d.undo, d.markups], redo: [], dirty: true,
      }));
    },
    select(ids, add) {
      withDoc((d) => ({ selection: add ? [...new Set([...d.selection, ...ids])] : ids }));
    },
    undo() {
      withDoc((d) => {
        if (!d.undo.length) return {};
        return { markups: d.undo[d.undo.length - 1], undo: d.undo.slice(0, -1), redo: [...d.redo, d.markups], selection: [], dirty: true };
      });
    },
    redo() {
      withDoc((d) => {
        if (!d.redo.length) return {};
        return { markups: d.redo[d.redo.length - 1], redo: d.redo.slice(0, -1), undo: [...d.undo, d.markups], selection: [], dirty: true };
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
        const bytes = await savePdf({
          original: d.bytes, pages: d.loaded.pages, markups: d.markups,
          importedRefs: d.importedRefs, calibrations: d.calibrations, viewports: d.viewports,
          dirtyCalibrations: d.dirtyCalibrations,
        });
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
        const { page, zoom } = d;
        const loaded = await openPdf(bytes);
        d.loaded.pdf.loadingTask.destroy();
        const markups = loaded.markups;
        set((s) => ({
          docs: s.docs.map((x) => x.id === d.id ? {
            ...x, name, bytes, fileHandle: handle, loaded, markups,
            importedRefs: loaded.importedRefs,
            calibrations: loaded.calibrations, viewports: loaded.viewports, dirtyCalibrations: new Set(),
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

export function activeDoc(): DocState | undefined {
  const s = useApp.getState();
  return s.docs.find((d) => d.id === s.activeId);
}

export const useActiveDoc = () => useApp((s) => s.docs.find((d) => d.id === s.activeId));
