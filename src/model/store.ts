import { withDefaults, type Prefs } from './prefs';
import { profileColumns } from './columns';
import { create } from 'zustand';
import { useStatusModels } from './statusModels';
import { rememberFile } from './recent';
import { PDFDocument } from 'pdf-lib';
import type { LoadedDoc } from '../pdf/document';
import { openPdf } from '../pdf/document';
import { savePdf } from '../pdf/save';
import { DEFAULT_STYLES, toolById } from '../tools/tools';
import { DEFAULT_TOOL_CHEST, type ToolChestPrefs } from './toolScale';
import { MEASURE_TYPES, scaleAt } from './measure';
import { translated } from './markup';
import { expandGroups } from './arrange';
import { columnDefaults } from './columns';
import type { RulerUnit } from './rulers';
import type { HatchDef, LineStyleDef } from './lineStyles';
import type { LayerSet } from '../pdf/layers';
import type { Bookmark } from '../pdf/bookmarks';
import { PERM, PasswordRequired, allowed, encryptPdf, looksEncrypted, openEncrypted, type NewSecurity, type Security } from '../pdf/crypt';
import { askPassword } from './prompts';
import { overBudget, undoBudget } from './device';
import { hasSignatures, incrementalUpdate, loadForUpdate } from '../pdf/incremental';
import type { ViewMode, ViewRotation } from './layout';
import type {
  CustomColumn, Markup, MarkupStyle, MarkupType, Pt, Scale, Space, ToolId, ToolPreset, ToolSet, Toggles, Viewport,
} from './types';

export type LeftPanel = 'thumbnails' | 'bookmarks' | 'spaces' | 'search' | 'sets' | 'signatures' | 'layers' | 'links' | 'files' | 'flags' | null;
export type RightPanel = 'properties' | 'toolchest' | 'measurements' | null;

/** Page scales and viewports, for undoing scale changes. */
export interface ScaleSnapshot { markups: Markup[]; calibrations: (Scale | null)[]; viewports: Viewport[][]; spaces?: Space[][] }
/** The whole document before a page operation (insert, delete, rotate...), for undoing it. */
export interface DocSnapshot {
  doc: Pick<DocState, typeof DOC_KEYS[number]>;
  /** Its pdf.js document was closed to save memory; undoing to it opens the file copy again. */
  cold?: boolean;
}
const DOC_KEYS = ['bytes', 'loaded', 'markups', 'importedRefs', 'calibrations', 'viewports', 'dirtyCalibrations',
  'spaces', 'dirtySpaces', 'columns', 'dirtyColumns', 'formValues', 'page', 'layers', 'dirtyLayers', 'bookmarks', 'dirtyBookmarks'] as const;
/** Page operations kept in the undo history per document (each holds a copy of the file). */
const MAX_DOC_UNDO = 10;
/** An undo step: markups only, markups with page scales and viewports, or the whole document. */
export type UndoEntry = Markup[] | ScaleSnapshot | DocSnapshot;
const docSnapshot = (d: DocState): DocSnapshot => ({ doc: Object.fromEntries(DOC_KEYS.map((k) => [k, d[k]])) as DocSnapshot['doc'] });
const isDocSnap = (e: UndoEntry): e is DocSnapshot => !Array.isArray(e) && 'doc' in e;
/** Free the pdf.js documents held by undo entries that are being dropped. */
function dropEntries(entries: UndoEntry[], keep: DocState) {
  for (const e of entries) if (isDocSnap(e) && e.doc.loaded !== keep.loaded && !e.cold) e.doc.loaded.pdf.loadingTask.destroy();
}

/** Close a snapshot's pdf.js document once nothing shows it (it is reopened from its bytes if needed). */
function cool(e: UndoEntry) {
  if (!isDocSnap(e) || e.cold) return;
  e.cold = true;
  const pdf = e.doc.loaded.pdf;
  setTimeout(() => {
    // Still shown (e.g. undone to it meanwhile)? Then keep it.
    if (useApp.getState().docs.some((d) => d.loaded.pdf === pdf)) { e.cold = false; return; }
    pdf.loadingTask.destroy();
  }, 1500);
}

/** A cold snapshot ready to restore: its document opened again from its bytes. */
async function reopen(e: DocSnapshot): Promise<DocSnapshot> {
  useApp.setState({ busy: true, status: 'Undoing…' });
  try {
    return { doc: { ...e.doc, loaded: await openPdf(e.doc.bytes) } };
  } finally {
    useApp.setState({ busy: false });
  }
}

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
  /** Form field values edited since opening (saved into the form). */
  formValues: Record<string, string | boolean>;
  /** Custom columns of the Markups List (saved with the document). */
  columns: CustomColumn[];
  dirtyColumns: boolean;
  page: number;
  zoom: number;
  selection: string[];
  undo: UndoEntry[];
  redo: UndoEntry[];
  dirty: boolean;
  /** PDF layers (Layers panel), and whether they changed since opening. */
  layers: LayerSet | null;
  dirtyLayers: boolean;
  /** Bookmarks (Bookmarks panel), and whether they changed since opening. */
  bookmarks: Bookmark[];
  dirtyBookmarks: boolean;
  /** Password security the file was opened with (it is kept when saving), and a change to apply on save. */
  security?: Security | null;
  securityChange?: NewSecurity | 'remove' | null;
  /** View state, not saved: which layers are shown. */
  layerVisible: Record<string, boolean>;
  /** Revu's Markup Layer: new markups go on it. */
  markupLayer: string | null;
  /** The layer configuration shown in the Layers panel (null = Default). */
  layerConfig: string | null;
}

/**
 * Apply Scale dialog state. `pagePts` is set after calibrating (distance
 * between the two picked points); `then` is the measure tool to resume;
 * `viewport` switches it to "Apply Scale to Viewport".
 */
export interface ScaleDialogState {
  page: number;
  /** Pages selected in the Thumbnails panel when the dialog was opened (its Selected option). */
  pages?: number[];
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
  /** User keyboard shortcuts: command id -> combo ('' = none). See ui/commands.ts. */
  customKeys: Record<string, string>;
  setCustomKeys(k: Record<string, string>): void;
  /** Tool Chest tool sets; the first is "My Tools". */
  toolSets: ToolSet[];
  recentTools: ToolPreset[];
  /** Tool Chest settings (Revu): Comment Persistence, Update Tool Set Item on Reuse, Maximum Recents, icon size. */
  toolChest: ToolChestPrefs;
  /** Tool Chest > Recent Tools > Hide (this session). */
  recentHidden?: boolean;
  setToolChest(p: Partial<ToolChestPrefs>): void;
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
  /** Image the Image tool places next (signature), instead of asking for a file. */
  pendingImage: { url: string; w: number; h: number; subject: string } | null;
  /** Stamp placed by the Stamp tool. */
  stampName: string;
  /** Hyperlink dialog for a new (or existing, by id) link rectangle. */
  /** Hyperlink dialog: a new link over `rect`, or the action of existing links (`ids`); `place` preselects a Place. */
  linkDialog: { page: number; rect: [Pt, Pt]; ids?: string[]; place?: string } | null;
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
  /** `keep` leaves the selection alone (pointer moving onto another page in continuous view). */
  setViewPage(pane: 0 | 1, page: number, keep?: boolean): void;
  setViewZoom(pane: 0 | 1, zoom: number): void;
  /** Split view (Revu: Split Horizontal Ctrl+H, Split Vertical Ctrl+2, Unsplit, Switch Ctrl+1). */
  split: { dir: 'h' | 'v'; mainDocId: string; docId: string; page: number; zoom: number } | null;
  /** Share of the split view taken by the first pane (Balance sets 0.5). */
  splitRatio: number;
  /** Window > Presentation (Ctrl+Enter). */
  presentation: boolean;
  /** The next hyperlink drawn jumps to this Place (Links panel > hyperlink to a Place). */
  linkPlace: string | null;
  /** Offset in progress (select a markup, press O). */
  offsetOp: { id: string } | null;
  /** Text picked with Select Text (Shift+T) or Select All Text (Ctrl+Shift+A). */
  textSel: { docId: string; page: number; rects: [Pt, Pt][]; text: string } | null;
  activePane: 0 | 1;
  /** Revu View > Mode (Single Page Ctrl+4, Continuous Ctrl+5, Side by Side Ctrl+6, Continuous Side by Side Ctrl+7). */
  viewMode: ViewMode;
  /** Revu Rotate View (Ctrl+Shift+Plus/Minus): turns the display only, never the file. */
  viewRotation: ViewRotation;
  setViewMode(mode: ViewMode): void;
  rotateView(delta: 90 | -90): void;
  splitView(dir: 'h' | 'v'): void;
  unsplit(): void;
  /** Toggle Split (Ctrl+I): vertical <-> horizontal (splits vertically when there is no split). */
  toggleSplit(): void;
  focusPane(pane: 0 | 1): void;
  setTool(tool: ToolId, opts?: { locked?: boolean; preset?: ToolPreset | null }): void;
  addMarkup(m: Omit<Markup, 'id' | 'author' | 'created' | 'modified' | 'status' | 'label' | 'comment'> & Partial<Markup>): Markup;
  /** Add ready-made markups (copies) as one undo step. */
  addMarkups(ms: Markup[], docId?: string): void;
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
  /** Select markups; grouped markups select together unless `exact` (a group member picked in the Markups List). */
  select(ids: string[], add?: boolean, exact?: boolean): void;
  undo(): void | Promise<void>;
  redo(): void | Promise<void>;
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
  /** Dimmer strength: how strongly page content shows, in percent (Revu's Dimmer menu). */
  dimLevel: number;
  /** Units of the rulers (right-click a ruler). */
  rulerUnit: RulerUnit;
  /** Line styles and hatch patterns the user made (Manage Line Styles / Hatch Patterns). */
  customLineStyles: LineStyleDef[];
  customHatches: HatchDef[];
  setView(p: Partial<Pick<AppState, 'dimLevel' | 'rulerUnit' | 'customLineStyles' | 'customHatches'>>): void;
  /** Revu > Preferences (Ctrl+K). */
  prefs: Prefs;
  setPrefs(p: Partial<Prefs>): void;
  setPanels(p: Partial<Pick<AppState, 'left' | 'right' | 'markupsList'>>): void;
  setAuthor(a: string): void;
  /** Add a markup as a tool (to the first set, or `setId`). */
  addToToolChest(m: Markup, setId?: string): void;
  removeFromToolChest(id: string): void;
  setToolSets(sets: ToolSet[]): void;
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
  /** Change the file with pdf-lib (undoable). `markups` replaces the document's markups in the file first (for changes that move both). */
  transformDoc(fn: (lib: PDFDocument, bytes: Uint8Array) => Promise<void | Uint8Array> | void | Uint8Array, done: string, page?: number, markups?: Markup[], docId?: string): Promise<boolean>;
  /** Replace the document's custom columns. */
  setColumns(cols: CustomColumn[]): void;
  setFieldValue(name: string, value: string | boolean): void;
  /** Change the layer list (saved with the document); `patch` can update view state at the same time. */
  setLayers(layers: LayerSet | null, patch?: Partial<DocState>): void;
  /** Replace the bookmarks (`edit` false: expand/collapse only, not a change to save). */
  setBookmarks(bookmarks: Bookmark[], edit?: boolean): void;
  /** Change layer view state (visibility, markup layer, configuration): not saved. */
  setLayerView(patch: Partial<Pick<DocState, 'layerVisible' | 'markupLayer' | 'layerConfig'>>): void;
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
      toolSets: s.toolSets, customKeys: s.customKeys, recentTools: s.recentTools, savedScales: s.savedScales, toolChest: s.toolChest,
      left: s.left, right: s.right, markupsList: s.markupsList, dimLevel: s.dimLevel, rulerUnit: s.rulerUnit,
      customLineStyles: s.customLineStyles, customHatches: s.customHatches, prefs: s.prefs,
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

/** Layer state for a freshly (re)loaded file; visibility already chosen for a layer is kept. */
export function layerState(loaded: LoadedDoc, prev?: Partial<DocState>): Pick<DocState, 'layers' | 'dirtyLayers' | 'layerVisible' | 'markupLayer' | 'layerConfig'> {
  const layers = loaded.layers;
  // Layers created before a save get their real id on reload: match them by name.
  const renamed = new Map<string, string>();
  for (const [id, l] of Object.entries(prev?.layers?.layers ?? {})) {
    if (!id.startsWith('new:')) continue;
    const now = Object.values(layers?.layers ?? {}).find((x) => x.name === l.name && !prev?.layers?.layers[x.id]);
    if (now) renamed.set(id, now.id);
  }
  const before = (id: string) => [...renamed].find(([, v]) => v === id)?.[0] ?? id;
  const vis: Record<string, boolean> = {};
  for (const l of Object.values(layers?.layers ?? {})) vis[l.id] = prev?.layerVisible?.[before(l.id)] ?? l.on;
  const m0 = prev?.markupLayer ? renamed.get(prev.markupLayer) ?? prev.markupLayer : null;
  const ml = m0 && layers?.layers[m0] ? m0 : null;
  return { layers, dirtyLayers: false, layerVisible: vis, markupLayer: ml, layerConfig: prev?.layerConfig ?? null };
}

/** The document with all its changes written into the PDF. */
export function serialize(d: DocState): Promise<Uint8Array> {
  return savePdf({
    original: d.bytes, pages: d.loaded.pages, markups: d.markups,
    importedRefs: d.importedRefs, calibrations: d.calibrations, viewports: d.viewports,
    dirtyCalibrations: d.dirtyCalibrations, spaces: d.spaces, dirtySpaces: d.dirtySpaces,
    columns: d.dirtyColumns ? d.columns : undefined, legendColumns: d.columns,
    formValues: d.formValues,
    layers: d.dirtyLayers ? d.layers : undefined,
    bookmarks: d.dirtyBookmarks ? d.bookmarks : undefined,
  });
}

/** State after applying an undo entry, plus the entry that reverses it. */
function restore(d: DocState, e: UndoEntry): [Partial<DocState>, UndoEntry] {
  if (Array.isArray(e)) return [{ markups: e }, d.markups];
  if (isDocSnap(e)) return [{ ...e.doc, page: Math.min(d.page, e.doc.loaded.pages.length - 1) }, docSnapshot(d)];
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
    toggles: { snap: false, grid: false, content: true, markup: true, reuse: false, sync: false, rulers: false, dimmer: false, crosshair: false, penMode: false, navBar: true, ...(prefs.toggles ?? {}) },
    dimLevel: prefs.dimLevel ?? 50,
    rulerUnit: prefs.rulerUnit ?? 'in',
    customLineStyles: prefs.customLineStyles ?? [],
    customHatches: prefs.customHatches ?? [],
    setView(p) { set(p); savePrefs(get()); },
    prefs: withDefaults((prefs as { prefs?: Partial<Prefs> }).prefs),
    setPrefs(p) { set({ prefs: { ...get().prefs, ...p } }); savePrefs(get()); },
    left: prefs.left === undefined ? 'thumbnails' : prefs.left,
    right: prefs.right === undefined ? 'properties' : prefs.right,
    markupsList: prefs.markupsList ?? true,
    author: prefs.author ?? 'User',
    customKeys: prefs.customKeys ?? {},
    setCustomKeys(customKeys) { set({ customKeys }); savePrefs(get()); },
    toolSets: prefs.toolSets ?? [
      { id: 'my-tools', name: 'My Tools', tools: (prefs as { toolChest?: ToolPreset[] }).toolChest ?? [] },
      { id: 'takeoff', name: 'Sample Takeoff', tools: SAMPLE_TOOL_CHEST },
    ],
    recentTools: prefs.recentTools ?? [],
    toolChest: { ...DEFAULT_TOOL_CHEST, ...(prefs.toolChest ?? {}) },
    setToolChest(p) { set((st) => ({ toolChest: { ...st.toolChest, ...p } })); savePrefs(get()); },
    scaleDialog: null,
    calibrateFor: null,
    radiusTool: 'radius',
    stampName: 'APPROVED',
    pendingImage: null,
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
        // Password-protected: ask for the password, then work on a decrypted copy.
        let security: Security | null = null;
        if (looksEncrypted(bytes)) {
          let pw = '', retry = false, plain: Uint8Array | null = null;
          for (;;) {
            try {
              const r = await openEncrypted(bytes, pw);
              security = r.security;
              plain = await r.doc.save({ useObjectStreams: false });
              break;
            } catch (e) {
              if (!(e instanceof PasswordRequired)) {
                if (/Not an encrypted/.test(String(e))) break;
                throw e;
              }
              set({ busy: false });
              const answer = await askPassword(name, retry || e.retry);
              set({ busy: true });
              if (answer === null) { set({ status: `${name}: not opened (password required)` }); return; }
              pw = answer; retry = true;
            }
          }
          if (plain) bytes = plain;
        }
        const loaded = await openPdf(bytes);
        if (security && !allowed(security, PERM.annotate)) loaded.readOnly = true;
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
          // Manage Columns > Save to Profile: a file without custom columns starts with the profile's.
          columns: loaded.columns.length ? loaded.columns : profileColumns(),
          dirtyColumns: !loaded.columns.length && profileColumns().length > 0,
          formValues: {},
          page: 0, zoom: 0, selection: [], undo: [], redo: [], dirty: false,
          ...layerState(loaded), bookmarks: loaded.bookmarks, dirtyBookmarks: false,
          security, securityChange: null,
        };
        const why = security && loaded.readOnly ? 'the file\'s permissions do not allow markups' : 'file could not be parsed for editing';
        rememberFile(name, bytes.length, handle).catch(() => {});
        set((s) => ({ docs: [...s.docs, doc], activeId: doc.id, status: loaded.readOnly ? `${name} opened read-only (${why})` : `Opened ${name}${security ? ' (password protected)' : ''}` }));
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
      if (d) dropEntries([...d.undo, ...d.redo], d);
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
    setViewPage(pane, page, keep) {
      const { split, docs, toggles } = get();
      const clampTo = (id: string, p: number) => { const d = docs.find((x) => x.id === id); return d ? Math.max(0, Math.min(d.loaded.pages.length - 1, p)) : 0; };
      // Synchronize Document (Revu): the other pane follows to the same page index.
      const follow = split && toggles.syncDoc;
      if (pane === 1 && split) {
        set({
          split: { ...split, page: clampTo(split.docId, page) },
          ...(follow ? { docs: docs.map((d) => (d.id === split.mainDocId ? { ...d, page: clampTo(d.id, page) } : d)) } : {}),
        });
        if (!keep) withDoc(() => ({ selection: [] }));
        return;
      }
      const id = split ? split.mainDocId : get().activeId;
      set({
        docs: docs.map((d) => (d.id === id ? { ...d, page: clampTo(d.id, page), selection: keep ? d.selection : [] } : d)),
        ...(follow ? { split: { ...split, page: clampTo(split.docId, page) } } : {}),
      });
    },
    setViewZoom(pane, zoom) {
      const z = Math.max(0.02, Math.min(64, zoom));
      const { split, docs, toggles } = get();
      // Synchronize Page (Revu): both panes share the zoom (the Viewer mirrors the scroll).
      const both = split && toggles.sync;
      if (pane === 1 && split && !both) { set({ split: { ...split, zoom: z } }); return; }
      const id = split ? split.mainDocId : get().activeId;
      set({ docs: docs.map((d) => (d.id === id ? { ...d, zoom: z } : d)), ...(both ? { split: { ...split, zoom: z } } : {}) });
    },
    toggleSplit() {
      const { split } = get();
      if (split) set({ split: { ...split, dir: split.dir === 'v' ? 'h' : 'v' } }); else get().splitView('v');
    },
    split: null,
    splitRatio: 0.5,
    presentation: false,
    linkPlace: null,
    offsetOp: null,
    textSel: null,
    activePane: 0,
    viewMode: 'single',
    viewRotation: 0,
    setViewMode: (viewMode) => set({ viewMode }),
    rotateView: (delta) => set({ viewRotation: ((((get().viewRotation + delta) % 360) + 360) % 360) as ViewRotation }),
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
        // A default status set in Manage Status applies to new markups (Revu).
        status: useStatusModels.getState().defaultState ?? 'None',
        statusModel: useStatusModels.getState().defaultModel,
        label: '',
        comment: '',
        ...partial,
      } as Markup;
      if (MEASURE_TYPES.has(m.type) && !m.scale) m.scale = scaleAt(d.calibrations[m.page], d.viewports[m.page], m.points[0]) ?? undefined;
      if (!m.custom) m.custom = columnDefaults(d.columns);
      // New markups go on the Markup Layer (Revu).
      if (m.layer === undefined && d.markupLayer) m.layer = d.markupLayer;
      withDoc((doc) => ({
        markups: [...doc.markups, m], undo: [...doc.undo, doc.markups], redo: [], dirty: true,
      }));
      // Recent Tools, like Revu: newest first, unique by type+subject+colour.
      const p: ToolPreset = { id: crypto.randomUUID(), name: m.subject, type: m.type, style: m.style, subject: m.subject, depth: m.depth };
      const key = (x: ToolPreset) => `${x.type}|${x.subject}|${x.style.color}|${x.style.fill}`;
      set((st) => ({ recentTools: [p, ...st.recentTools.filter((r) => key(r) !== key(p))].slice(0, Math.max(1, st.toolChest.maxRecents)) }));
      savePrefs(get());
      return m;
    },

    addMarkups(ms, docId) {
      if (!ms.length) return;
      const id = docId ?? get().activeId;
      set((st) => ({ docs: st.docs.map((doc) => (doc.id === id ? { ...doc, markups: [...doc.markups, ...ms], undo: [...doc.undo, doc.markups], redo: [], dirty: true } : doc)) }));
    },
    updateMarkups(ids, fn, opts = { history: true }) {
      const set_ = new Set(ids);
      // Update Tool Set Item on Reuse (Revu): a style change on a markup made with a tool goes back to the tool.
      if (get().toolChest.updateOnReuse) {
        const d0 = activeDoc();
        const changed = (d0?.markups ?? []).filter((m) => set_.has(m.id) && m.toolId).map((m) => ({ m, patch: fn(m) })).filter((x) => x.patch.style);
        if (changed.length) {
          set((st) => ({ toolSets: st.toolSets.map((t) => ({ ...t, tools: t.tools.map((p) => { const c = changed.find((x) => x.m.toolId === p.id); return c ? { ...p, style: { ...p.style, ...c.patch.style } } : p; }) })) }));
          savePrefs(get());
        }
      }
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
    select(ids, add, exact) {
      // Grouped markups select together (Revu), except a member picked in the Markups List.
      withDoc((d) => {
        const all = exact ? ids : expandGroups(d.markups, ids);
        return { selection: add ? [...new Set([...d.selection, ...all])] : all };
      });
    },
    async undo() {
      const d0 = activeDoc();
      const top = d0?.undo[d0.undo.length - 1];
      const entry = top && isDocSnap(top) && top.cold ? await reopen(top) : top;
      if (!entry) return;
      let reverse: UndoEntry | null = null;
      withDoc((d) => {
        if (!d.undo.length || (d.undo[d.undo.length - 1] !== top)) return {};
        const [state, current] = restore(d, entry);
        reverse = current;
        return { ...state, undo: d.undo.slice(0, -1), redo: [...d.redo, current], selection: [], dirty: true };
      });
      if (reverse) cool(reverse);
    },
    async redo() {
      const d0 = activeDoc();
      const top = d0?.redo[d0.redo.length - 1];
      const entry = top && isDocSnap(top) && top.cold ? await reopen(top) : top;
      if (!entry) return;
      let reverse: UndoEntry | null = null;
      withDoc((d) => {
        if (!d.redo.length || (d.redo[d.redo.length - 1] !== top)) return {};
        const [state, current] = restore(d, entry);
        reverse = current;
        return { ...state, redo: d.redo.slice(0, -1), undo: [...d.undo, current], selection: [], dirty: true };
      });
      if (reverse) cool(reverse);
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
    async transformDoc(fn, done, page, markups, docId) {
      const d = docId ? get().docs.find((x) => x.id === docId) : activeDoc();
      if (!d) return false;
      if (d.loaded.readOnly) { set({ status: 'This file could not be parsed for editing.' }); return false; }
      set({ busy: true, status: 'Updating pages…' });
      try {
        const src = await serialize(markups ? { ...d, markups } : d);
        const lib = await loadForUpdate(src);
        const result = await fn(lib, src);
        // `fn` may produce the new file itself (signing); signed files are updated incrementally.
        const bytes = result instanceof Uint8Array ? result
          : hasSignatures(lib) ? await incrementalUpdate(src, lib) : await lib.save({ useObjectStreams: false });
        const loaded = await openPdf(bytes);
        // The old document goes on the undo stack (Revu undoes page operations too).
        const old = get().docs.find((x) => x.id === d.id)!;
        const snap = docSnapshot(old);
        let undo = [...old.undo, snap];
        // Keep at most MAX_DOC_UNDO file copies, and fewer on machines with little memory.
        const snaps = undo.filter(isDocSnap);
        const drop = overBudget(snaps.map((x) => x.doc.bytes.length), undoBudget(), MAX_DOC_UNDO);
        if (drop) {
          const last = snaps[drop - 1];
          undo = undo.slice(undo.indexOf(last) + 1);
          dropEntries(snaps.slice(0, drop), old);
        }
        dropEntries(old.redo, old);
        set((st) => ({
          docs: st.docs.map((x) => x.id === d.id ? {
            ...x, bytes, loaded, markups: loaded.markups, importedRefs: loaded.importedRefs,
            calibrations: loaded.calibrations, viewports: loaded.viewports, dirtyCalibrations: new Set(),
            spaces: loaded.spaces, dirtySpaces: new Set(), columns: loaded.columns, dirtyColumns: false, formValues: {},
            page: Math.max(0, Math.min(loaded.pages.length - 1, page ?? x.page)), selection: [], undo, redo: [], dirty: true,
            ...layerState(loaded, x), bookmarks: loaded.bookmarks, dirtyBookmarks: false,
          } : x),
          status: done,
        }));
        // The file copy stays for Undo; its pdf.js document is closed to save memory.
        cool(snap);
        return true;
      } catch (e) {
        console.error(e);
        set({ status: `Could not update pages: ${(e as Error).message}` });
        return false;
      } finally {
        set({ busy: false });
      }
    },
    setLayers(layers, patch) {
      withDoc(() => ({ layers, dirtyLayers: true, dirty: true, ...patch }));
    },
    setBookmarks(bookmarks, edit = true) {
      withDoc(() => (edit ? { bookmarks, dirtyBookmarks: true, dirty: true } : { bookmarks }));
    },
    setLayerView(patch) {
      withDoc(() => patch);
    },
    setFieldValue(name, value) {
      withDoc((d) => ({ formValues: { ...d.formValues, [name]: value }, dirty: true }));
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
    addToToolChest(m, setId) {
      const { id: _i, page: _p, source: _s, author: _a, created: _c, modified: _m, ...shape } = m;
      const p: ToolPreset = { id: crypto.randomUUID(), name: m.subject || toolById(m.type).name, type: m.type, style: m.style, subject: m.subject, depth: m.depth, mode: 'properties', markup: shape };
      const target = setId ?? get().toolSets[0]?.id;
      set((s) => ({
        toolSets: s.toolSets.map((t) => (t.id === target ? { ...t, tools: [...t.tools, p] } : t)),
        status: `Added "${p.name}" to ${s.toolSets.find((t) => t.id === target)?.name ?? 'My Tools'}`,
      }));
      savePrefs(get());
    },
    removeFromToolChest(id) {
      set((s) => ({ toolSets: s.toolSets.map((t) => ({ ...t, tools: t.tools.filter((x) => x.id !== id) })) }));
      savePrefs(get());
    },
    setToolSets(toolSets) { set({ toolSets }); savePrefs(get()); },
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
        // Encrypt what is written: the security it was opened with, or the new one.
        const change = d.securityChange;
        const out = change === 'remove' ? bytes : change ? await encryptPdf(bytes, change) : d.security ? await encryptPdf(bytes, d.security) : bytes;
        const security = change === 'remove' ? null : change ? (await openEncrypted(out, change.ownerPassword || change.userPassword)).security : d.security ?? null;
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
          await ws.write(out as unknown as BlobPart);
          await ws.close();
          name = handle.name;
        } else {
          const url = URL.createObjectURL(new Blob([out as unknown as BlobPart], { type: 'application/pdf' }));
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
            spaces: loaded.spaces, dirtySpaces: new Set(), columns: loaded.columns, dirtyColumns: false, formValues: {},
            page, zoom, selection: [], undo: [], redo: [], dirty: false,
            ...layerState(loaded, x), bookmarks: loaded.bookmarks, dirtyBookmarks: false,
            security, securityChange: null,
          } : x),
          status: `Saved ${name}${security ? ' (password protected)' : ''}`,
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
