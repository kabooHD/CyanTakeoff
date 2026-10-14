import type { MarkupStyle, MarkupType, ToolId } from '../model/types';

/** How the pointer builds a markup. */
export type Interaction =
  | 'two-point' // click-click or drag: line, arrow, length, calibrate
  | 'box' // click-click or drag a rectangle: rectangle, ellipse, cloud, highlight, textbox
  | 'poly' // click vertices, double-click / Enter to finish
  | 'freehand' // drag: pen
  | 'point' // single click: note
  | 'count' // each click adds a point to the active count
  | 'callout' // click tip, then click box position
  | 'cutout' // polygon cutout inside an Area/Volume: drag = rectangle, or click points
  | 'cutout-ellipse' // ellipse cutout: drag
  | 'fill' // Dynamic Fill: press and hold to flood a shape
  | 'cloudplus' // drag the cloud, then click where the text box goes
  | 'text' // drag across text on the drawing: strikethrough, underline, squiggly
  | 'erase' // drag over pen strokes to erase them
  | 'none';

export interface ToolDef {
  id: ToolId;
  name: string;
  group: 'navigate' | 'markup' | 'measure' | 'form';
  /**
   * Default shortcut, matching Revu 20/21's published defaults
   * ("Keyboard shortcuts and mouse navigation", support.bluebeam.com).
   * Revu has no default shortcut for Calibrate.
   */
  shortcut?: string;
  interaction: Interaction;
  subject: string;
  closed?: boolean;
  /** Poly tools that finish automatically after this many points (Angle: 3). */
  maxPoints?: number;
}

export const TOOLS: ToolDef[] = [
  { id: 'select', name: 'Select', group: 'navigate', shortcut: 'V', interaction: 'none', subject: '' },
  { id: 'pan', name: 'Pan', group: 'navigate', shortcut: 'Shift+V', interaction: 'none', subject: '' },
  { id: 'zoom', name: 'Zoom', group: 'navigate', shortcut: 'Z', interaction: 'none', subject: '' },
  { id: 'select-text', name: 'Select Text', group: 'navigate', shortcut: 'Shift+T', interaction: 'box', subject: '' },
  { id: 'edit-text', name: 'Edit Text', group: 'navigate', interaction: 'point', subject: '' },
  { id: 'erase-content', name: 'Erase Content', group: 'navigate', interaction: 'box', subject: '' },
  { id: 'cut-content', name: 'Cut Content', group: 'navigate', interaction: 'box', subject: '' },
  { id: 'review-text', name: 'Review Text', group: 'navigate', interaction: 'text', subject: '' },
  // Sketch to Scale: sizes typed in the Sketch bar (src/ui/SketchBar.tsx); the first click is the anchor.
  { id: 'sketch-polygon', name: 'Polygon Sketch to Scale', group: 'navigate', interaction: 'poly', subject: 'Polygon', closed: true },
  { id: 'sketch-polyline', name: 'Polyline Sketch to Scale', group: 'navigate', interaction: 'poly', subject: 'Polyline' },
  { id: 'sketch-rectangle', name: 'Rectangle Sketch to Scale', group: 'navigate', interaction: 'poly', subject: 'Rectangle' },
  { id: 'sketch-ellipse', name: 'Ellipse Sketch to Scale', group: 'navigate', interaction: 'poly', subject: 'Ellipse' },
  { id: 'region-pick', name: 'Select Region', group: 'navigate', interaction: 'box', subject: '' },
  { id: 'visual-pick', name: 'VisualSearch: Get Rectangle', group: 'navigate', interaction: 'box', subject: '' },
  { id: 'lasso', name: 'Lasso', group: 'navigate', shortcut: 'Shift+O', interaction: 'freehand', subject: '' },

  { id: 'textbox', name: 'Text Box', group: 'markup', shortcut: 'T', interaction: 'box', subject: 'Text Box' },
  { id: 'callout', name: 'Callout', group: 'markup', shortcut: 'Q', interaction: 'callout', subject: 'Callout' },
  { id: 'note', name: 'Note', group: 'markup', shortcut: 'N', interaction: 'point', subject: 'Note' },
  { id: 'pen', name: 'Pen', group: 'markup', shortcut: 'P', interaction: 'freehand', subject: 'Pen' },
  { id: 'highlight', name: 'Highlight', group: 'markup', shortcut: 'H', interaction: 'box', subject: 'Highlight' },
  { id: 'line', name: 'Line', group: 'markup', shortcut: 'L', interaction: 'two-point', subject: 'Line' },
  { id: 'arrow', name: 'Arrow', group: 'markup', shortcut: 'A', interaction: 'two-point', subject: 'Arrow' },
  { id: 'polyline', name: 'Polyline', group: 'markup', shortcut: 'Shift+N', interaction: 'poly', subject: 'Polyline' },
  { id: 'rectangle', name: 'Rectangle', group: 'markup', shortcut: 'R', interaction: 'box', subject: 'Rectangle' },
  { id: 'ellipse', name: 'Ellipse', group: 'markup', shortcut: 'E', interaction: 'box', subject: 'Ellipse' },
  { id: 'polygon', name: 'Polygon', group: 'markup', shortcut: 'Shift+P', interaction: 'poly', subject: 'Polygon', closed: true },
  { id: 'cloud', name: 'Cloud', group: 'markup', shortcut: 'C', interaction: 'box', subject: 'Cloud', closed: true },
  { id: 'cloudplus', name: 'Cloud+', group: 'markup', shortcut: 'K', interaction: 'cloudplus', subject: 'Cloud+' },
  { id: 'typewriter', name: 'Typewriter', group: 'markup', shortcut: 'W', interaction: 'point', subject: 'Typewriter' },
  { id: 'arc', name: 'Arc', group: 'markup', shortcut: 'Shift+C', interaction: 'poly', subject: 'Arc', maxPoints: 3 },
  { id: 'dimension', name: 'Dimension', group: 'markup', shortcut: 'Shift+L', interaction: 'two-point', subject: 'Dimension' },
  { id: 'stamp', name: 'Stamp', group: 'markup', shortcut: 'S', interaction: 'point', subject: 'Stamp' },
  { id: 'flag', name: 'Flag', group: 'markup', shortcut: 'Shift+F', interaction: 'point', subject: 'Flag' },
  { id: 'strikeout', name: 'Strikethrough', group: 'markup', shortcut: 'D', interaction: 'text', subject: 'Strikethrough' },
  { id: 'underline', name: 'Underline', group: 'markup', shortcut: 'U', interaction: 'text', subject: 'Underline' },
  { id: 'caret', name: 'Insert Text', group: 'markup', interaction: 'point', subject: 'Insert Text' },
  { id: 'squiggly', name: 'Squiggly', group: 'markup', shortcut: 'Shift+U', interaction: 'text', subject: 'Squiggly' },
  { id: 'image', name: 'Image', group: 'markup', shortcut: 'I', interaction: 'point', subject: 'Image' },
  { id: 'snapshot', name: 'Snapshot', group: 'markup', shortcut: 'G', interaction: 'box', subject: 'Snapshot' },
  { id: 'snapshot-content', name: 'Snapshot Content', group: 'markup', shortcut: 'Shift+G', interaction: 'box', subject: 'Snapshot' },
  { id: 'link', name: 'Hyperlink', group: 'markup', shortcut: 'Shift+H', interaction: 'box', subject: 'Hyperlink' },
  { id: 'attachment', name: 'File Attachment', group: 'markup', shortcut: 'F', interaction: 'point', subject: 'File Attachment' },
  { id: 'redaction', name: 'Mark for Redaction', group: 'markup', shortcut: 'Shift+R', interaction: 'box', subject: 'Redaction' },
  { id: 'redact-text', name: 'Mark Text for Redaction', group: 'markup', shortcut: 'Shift+K', interaction: 'text', subject: 'Redaction' },
  { id: 'legend', name: 'Legend', group: 'markup', interaction: 'point', subject: 'Legend' },
  { id: 'eraser', name: 'Eraser', group: 'markup', shortcut: 'Shift+E', interaction: 'erase', subject: '' },

  { id: 'calibrate', name: 'Calibrate', group: 'measure', interaction: 'two-point', subject: '' },
  { id: 'viewport', name: 'Add Viewport', group: 'measure', interaction: 'box', subject: '' },
  { id: 'space', name: 'Add Space', group: 'measure', interaction: 'cutout', subject: '' },
  { id: 'length', name: 'Length', group: 'measure', shortcut: 'Shift+Alt+L', interaction: 'two-point', subject: 'Length Measurement' },
  { id: 'polylength', name: 'Polylength', group: 'measure', shortcut: 'Shift+Alt+Q', interaction: 'poly', subject: 'Polylength Measurement' },
  { id: 'area', name: 'Area', group: 'measure', shortcut: 'Shift+Alt+A', interaction: 'poly', subject: 'Area Measurement', closed: true },
  { id: 'perimeter', name: 'Perimeter', group: 'measure', shortcut: 'Shift+Alt+P', interaction: 'poly', subject: 'Perimeter Measurement', closed: true },
  { id: 'volume', name: 'Volume', group: 'measure', shortcut: 'Shift+Alt+V', interaction: 'poly', subject: 'Volume Measurement', closed: true },
  { id: 'diameter', name: 'Diameter', group: 'measure', shortcut: 'Shift+Alt+D', interaction: 'two-point', subject: 'Diameter Measurement' },
  { id: 'radius-3pt', name: '3-Point Radius', group: 'measure', interaction: 'poly', subject: 'Radius Measurement', maxPoints: 3 },
  { id: 'radius', name: 'Radius', group: 'measure', shortcut: 'Shift+Alt+U', interaction: 'two-point', subject: 'Radius Measurement' },
  { id: 'angle', name: 'Angle', group: 'measure', shortcut: 'Shift+Alt+G', interaction: 'poly', subject: 'Angle Measurement', maxPoints: 3 },
  { id: 'cutout', name: 'Polygon Cutout', group: 'measure', interaction: 'cutout', subject: '' },
  { id: 'ellipse-cutout', name: 'Ellipse Cutout', group: 'measure', interaction: 'cutout-ellipse', subject: '' },
  { id: 'dynamic-fill', name: 'Dynamic Fill', group: 'measure', shortcut: 'J', interaction: 'fill', subject: '' },
  { id: 'count', name: 'Count', group: 'measure', shortcut: 'Shift+Alt+C', interaction: 'count', subject: 'Count Measurement' },

  // Forms: drag the field's box, then name it (Revu Forms menu).
  { id: 'form-text', name: 'Text Field', group: 'form', interaction: 'box', subject: '' },
  { id: 'form-checkbox', name: 'Check Box', group: 'form', interaction: 'box', subject: '' },
  { id: 'form-radio', name: 'Radio Button', group: 'form', interaction: 'box', subject: '' },
  { id: 'form-dropdown', name: 'Dropdown', group: 'form', interaction: 'box', subject: '' },
  { id: 'form-list', name: 'List Box', group: 'form', interaction: 'box', subject: '' },
  { id: 'form-signature', name: 'Signature Field', group: 'form', shortcut: 'X', interaction: 'box', subject: '' },
];

export const toolById = (id: ToolId) => TOOLS.find((t) => t.id === id)!;

export const CLOSED_TYPES = new Set<MarkupType>(['polygon', 'cloud', 'area', 'perimeter', 'volume']);

const base: MarkupStyle = {
  color: '#ff0000',
  fill: null,
  opacity: 1,
  fillOpacity: 0.3,
  width: 1,
  lineStyle: 'solid',
  fontSize: 10,
};

export const DEFAULT_STYLES: Record<MarkupType, MarkupStyle> = {
  line: base,
  arrow: base,
  polyline: base,
  polygon: base,
  rectangle: base,
  ellipse: base,
  cloud: base,
  pen: base,
  highlight: { ...base, color: '#ffff00', fill: '#ffff00', width: 0, fillOpacity: 0.4 },
  textbox: { ...base, color: '#000000', fill: '#ffffff', fillOpacity: 1, fontSize: 12 },
  callout: { ...base, color: '#000000', fill: '#ffffff', fillOpacity: 1, fontSize: 12 },
  note: { ...base, color: '#ffd400', fill: '#ffd400', fillOpacity: 1 },
  length: { ...base, color: '#0066ff' },
  polylength: { ...base, color: '#0066ff' },
  area: { ...base, color: '#0066ff', fill: '#0066ff', fillOpacity: 0.25 },
  perimeter: { ...base, color: '#0066ff' },
  volume: { ...base, color: '#7a00cc', fill: '#7a00cc', fillOpacity: 0.25 },
  count: { ...base, color: '#ff6600', fill: '#ff6600', fillOpacity: 0.6 },
  angle: { ...base, color: '#0066ff' },
  radius: { ...base, color: '#0066ff' },
  diameter: { ...base, color: '#0066ff' },
  dimension: { ...base, color: '#0066ff' },
  typewriter: { ...base, color: '#000000', fill: null, width: 0, fontSize: 12 },
  cloudplus: { ...base, fill: '#ffffff', fillOpacity: 1, fontSize: 12 },
  arc: base,
  flag: { ...base, color: '#e00000', fill: '#e00000', fillOpacity: 1 },
  stamp: { ...base, color: '#c00000', width: 2, fontSize: 18 },
  strikeout: { ...base, color: '#ff0000' },
  caret: { ...base, color: '#1a73e8' },
  underline: { ...base, color: '#0066ff' },
  squiggly: { ...base, color: '#00a000' },
  image: { ...base, width: 0 },
  link: { ...base, color: '#0066ff', lineStyle: 'dashed' },
  attachment: { ...base, color: '#0066ff' },
  legend: { ...base, color: '#000000', fill: '#ffffff', fillOpacity: 1, fontSize: 10 },
  redaction: { ...base, color: '#ff0000', fill: '#000000', fillOpacity: 0.25, width: 1.5, lineStyle: 'dashed' },
};

/** Normalised combo string for a keyboard event, e.g. "Ctrl+Shift+S". */
export function comboFromEvent(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.shiftKey) parts.push('Shift');
  if (e.altKey) parts.push('Alt');
  let key = e.key;
  // With Alt held some layouts produce special characters; use the physical key.
  if (e.code.startsWith('Key')) key = e.code.slice(3);
  else if (e.code.startsWith('Digit')) key = e.code.slice(5);
  else if (key.length === 1) key = key.toUpperCase();
  parts.push(key);
  return parts.join('+');
}
