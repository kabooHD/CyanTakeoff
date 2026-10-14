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
}

export const DEFAULT_PREFS: Prefs = {
  tabTruncation: 'end', showRecentOnStartup: false,
  wheelSingle: 'zoom', wheelContinuous: 'zoom', reverseWheel: false, wheelSensitivity: 5,
  dynamicDefaults: false, autosizeText: false, showAuthorDate: true, copyHighlightedText: true, snapshotDpi: 216, includeMarkupsInSnapshots: true,
  sketchRotation: 'page', ellipseMode: 'size',
  fieldHighlightColor: '#cce0ff', fieldHighlightOpacity: 55,
  hashAlgorithm: 'sha256',
  fillSize: 2, fillBoundarySize: 2, fillColor: '#00a0ff', fillBoundaryColor: '#ff4d00', fillSpeed: 'Medium', fillSensitivity: 'Medium', fillHideMarkups: false,
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

/** "#rrggbb" + opacity (0..100) as a CSS rgba() colour. */
export function rgbaOf(hex: string, opacity: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1], 16) : 0xcce0ff;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${Math.max(0, Math.min(100, opacity)) / 100})`;
}
