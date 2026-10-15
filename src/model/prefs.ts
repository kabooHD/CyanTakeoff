// Preferences (Revu > Preferences, Ctrl+K): General, Navigation, Markup,
// Sketch, Forms, Signature. Kept in the browser with the other settings.

export interface Prefs {
  // General
  /** Long file names in tabs are cut at the end (default) or the start. */
  tabTruncation: 'end' | 'start';
  /** Open the File Access panel when the app starts with no document. */
  showRecentOnStartup: boolean;
  // Navigation
  /** What the mouse wheel does in single page / continuous mode. */
  wheelSingle: 'zoom' | 'scroll';
  wheelContinuous: 'zoom' | 'scroll';
  reverseWheel: boolean;
  /** 1 (slow) .. 10 (fast); 5 is the default step. */
  wheelSensitivity: number;
  // Markup
  /** Dynamically Set as Default: a property changed on a markup becomes the tool's default. */
  dynamicDefaults: boolean;
  /** Autosize Text Box and Callout markups after typing. */
  autosizeText: boolean;
  /** Author and date shown when hovering a markup. */
  showAuthorDate: boolean;
  /** Text under a Highlight/Underline/Strikethrough/Squiggly goes into the markup's comment. */
  copyHighlightedText: boolean;
  /** Enable Text Highlighting: the Highlight tool marks the text under a drag (Ctrl+drag: free box). Off: always a box. */
  textHighlighting: boolean;
  /** Drag Behavior for Shapes: a drag with a shape tool draws a rectangle (Ctrl+drag pulls a curve) or pulls a curve (Ctrl+drag: rectangle). */
  dragShapes: 'rect' | 'curves';
  /** Snapshot resolution in dpi. */
  snapshotDpi: number;
  includeMarkupsInSnapshots: boolean;
  // Sketch
  sketchRotation: 'page' | 'relative';
  ellipseMode: 'size' | 'radius';
  // Forms
  fieldHighlightColor: string;
  /** 0..100 */
  fieldHighlightOpacity: number;
  // Signature
  hashAlgorithm: 'sha256' | 'sha384' | 'sha512';
  // Measure > Dynamic Fill defaults
  fillSize: number;
  fillBoundarySize: number;
  fillColor: string;
  fillBoundaryColor: string;
  fillSpeed: 'Slow' | 'Medium' | 'Fast';
  fillSensitivity: 'Low' | 'Medium' | 'High';
  fillHideMarkups: boolean;
  // Grid & Snap
  /** Grid spacing in points (the grid is drawn when Show Grid is on; Snap to Grid uses it). */
  gridSpacing: number;
  /** Snap area in screen pixels (5..25). */
  snapSensitivity: number;
  /** Colour of the grid and snap indicators. */
  snapColor: string;
  // Document
  /** Largest zoom, percent. */
  maxZoom: number;
  /** Page layout a document opens in: single, continuous, or by page size (pages under 14 in: continuous). */
  defaultLayout: 'single' | 'continuous' | 'auto';
  /** How a document shows when opened: fit the page, fit its width, or 100 %. */
  openDisplay: 'fitPage' | 'fitWidth' | 'actual';
  /** Rotate all Pages by Default: Rotate Clockwise / Counterclockwise turn every page, not only the current one. */
  rotateAllPages: boolean;
  /** Remember Last Page: a file reopens on the page it was closed at. */
  rememberLastPage: boolean;
  /** Automatically Reorder Bookmarks: top-level bookmarks follow their pages when thumbnails are reordered. */
  reorderBookmarks: boolean;
  /** Redirect Links and Bookmarks when Inserting Pages with Slip Sheet: they point at the revised page. */
  redirectOnSlipSheet: boolean;
  /** Find Hyperlinks in PDF Content: web addresses in the page's text are clickable. */
  findHyperlinks: boolean;
  // Navigation
  /** Lock Panning in Fit Width: dragging the page at the fit-width zoom only moves it vertically. */
  lockPanFitWidth: boolean;
  // Forms
  /** Enable Single Key Shortcuts: a tool's one-key shortcut works while a form field has the focus. */
  singleKeyInForms: boolean;
  // Markups List
  /** Zoom to fit a markup when it is selected in the list. */
  zoomFitOnSelect: boolean;
  wrapComments: boolean;
  /** How much markups filtered out of the list are dimmed on the page (0-100 %). */
  filteredDim: number;
  // Layers
  /** Hiding a parent layer hides its children too. */
  hideChildLayers: boolean;
  /** The Layers panel starts with Show Layers on Page Only. */
  layersOnPageOnly: boolean;
  // Spelling
  /** Check words written in capitals too. */
  spellUpperCase: boolean;
  /** Custom words (one per line) the spell checker accepts. */
  customWords: string;
  /** Enable Spell Check: text being typed is underlined by the browser's checker. */
  spellCheck: boolean;
  /** Spell Check Color: the squiggly colour of Markup Spelling Mistakes. */
  spellColor: string;
}

export const DEFAULT_PREFS: Prefs = {
  tabTruncation: 'end', showRecentOnStartup: false,
  wheelSingle: 'zoom', wheelContinuous: 'zoom', reverseWheel: false, wheelSensitivity: 5,
  dynamicDefaults: false, autosizeText: false, showAuthorDate: true, copyHighlightedText: true, textHighlighting: true, dragShapes: 'rect', snapshotDpi: 216, includeMarkupsInSnapshots: true,
  sketchRotation: 'page', ellipseMode: 'size',
  fieldHighlightColor: '#cce0ff', fieldHighlightOpacity: 55,
  hashAlgorithm: 'sha256',
  fillSize: 2, fillBoundarySize: 2, fillColor: '#00a0ff', fillBoundaryColor: '#ff4d00', fillSpeed: 'Medium', fillSensitivity: 'Medium', fillHideMarkups: false,
  gridSpacing: 12, snapSensitivity: 10, snapColor: '#3a7bd5',
  maxZoom: 6400, defaultLayout: 'single', openDisplay: 'fitPage', rotateAllPages: false, rememberLastPage: false,
  reorderBookmarks: true, redirectOnSlipSheet: true, findHyperlinks: true, lockPanFitWidth: true, singleKeyInForms: false,
  zoomFitOnSelect: false, wrapComments: false, filteredDim: 75,
  hideChildLayers: true, layersOnPageOnly: false,
  spellUpperCase: false, customWords: '', spellCheck: true, spellColor: '#ff0000',
};

/** Fill in defaults for a saved (possibly older) preferences object. */
export const withDefaults = (p: Partial<Prefs> | undefined): Prefs => ({ ...DEFAULT_PREFS, ...(p ?? {}) });

/**
 * What a wheel turn does: the zoom factor to apply, or null to let the page
 * scroll. Ctrl+wheel always zooms (as in a browser), Shift+wheel always scrolls.
 */
export function wheelZoomFactor(p: Prefs, continuous: boolean, e: { deltaY: number; ctrlKey: boolean; shiftKey: boolean }): number | null {
  if (e.shiftKey) return null;
  const mode = continuous ? p.wheelContinuous : p.wheelSingle;
  if (mode === 'scroll' && !e.ctrlKey) return null;
  const k = 0.0015 * (Math.max(1, Math.min(10, p.wheelSensitivity)) / 5);
  return Math.exp((p.reverseWheel ? 1 : -1) * e.deltaY * k);
}

/** The zoom that shows a box of `w` × `h` page units in a view of `vw` × `vh` pixels with room around it. */
export function fitZoom(vw: number, vh: number, w: number, h: number, pad = 40): number {
  const z = Math.min((vw - pad * 2) / Math.max(1, w), (vh - pad * 2) / Math.max(1, h));
  return Math.max(0.05, Math.min(8, z));
}

/** The page layout a document opens in ('auto': continuous for pages under 14 in tall, single otherwise); null keeps the current one. */
export function layoutForPage(pageHeightPt: number, pref: Prefs['defaultLayout']): 'single' | 'continuous' | null {
  if (pref === 'auto') return pageHeightPt < 14 * 72 ? 'continuous' : 'single';
  return pref === 'continuous' ? 'continuous' : pref === 'single' ? 'single' : null;
}

/** Whether the spell checker leaves a word alone: capitals (unless checked), or a custom word. */
export function skipSpelling(word: string, upperCase: boolean, customWords: string): boolean {
  if (!upperCase && word.length > 1 && word === word.toUpperCase() && /[A-Z]/.test(word)) return true;
  return customWords.split(/\r?\n|,/).map((w) => w.trim().toLowerCase()).filter(Boolean).includes(word.toLowerCase());
}

/** "#rrggbb" + opacity (0..100) as a CSS rgba() colour. */
export function rgbaOf(hex: string, opacity: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1], 16) : 0xcce0ff;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${Math.max(0, Math.min(100, opacity)) / 100})`;
}

// Remember Last Page (Preferences > Document): the page each file was closed at, kept in the browser.
const LAST_PAGES = 'cyantakeoff:last-pages';
const lastPages = (): Record<string, number> => { try { return JSON.parse(localStorage.getItem(LAST_PAGES) ?? '{}'); } catch { return {}; } };
export const lastPageOf = (name: string): number => lastPages()[name] ?? 0;
export function rememberLastPage(name: string, page: number) {
  try {
    const m = lastPages();
    delete m[name];
    const entries = [...Object.entries(m), [name, page] as [string, number]].slice(-200);
    localStorage.setItem(LAST_PAGES, JSON.stringify(Object.fromEntries(entries)));
  } catch { /* storage unavailable */ }
}
