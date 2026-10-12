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
  | 'none';

export interface ToolDef {
  id: ToolId;
  name: string;
  group: 'navigate' | 'markup' | 'measure';
  /**
   * Default shortcut, written like Revu's: "Shift+Alt+L". Kept in one place so
   * the full map can be checked against Revu's default profile and
   * remapped by users later.
   */
  shortcut?: string;
  interaction: Interaction;
  subject: string;
  closed?: boolean;
}

export const TOOLS: ToolDef[] = [
  { id: 'select', name: 'Select', group: 'navigate', shortcut: 'V', interaction: 'none', subject: '' },
  { id: 'pan', name: 'Pan', group: 'navigate', shortcut: 'Shift+V', interaction: 'none', subject: '' },
  { id: 'zoom', name: 'Zoom', group: 'navigate', shortcut: 'Z', interaction: 'none', subject: '' },

  { id: 'textbox', name: 'Text Box', group: 'markup', shortcut: 'W', interaction: 'box', subject: 'Text Box' },
  { id: 'callout', name: 'Callout', group: 'markup', shortcut: 'Q', interaction: 'callout', subject: 'Callout' },
  { id: 'note', name: 'Note', group: 'markup', shortcut: 'Shift+N', interaction: 'point', subject: 'Note' },
  { id: 'pen', name: 'Pen', group: 'markup', shortcut: 'K', interaction: 'freehand', subject: 'Pen' },
  { id: 'highlight', name: 'Highlight', group: 'markup', shortcut: 'H', interaction: 'box', subject: 'Highlight' },
  { id: 'line', name: 'Line', group: 'markup', shortcut: 'L', interaction: 'two-point', subject: 'Line' },
  { id: 'arrow', name: 'Arrow', group: 'markup', shortcut: 'A', interaction: 'two-point', subject: 'Arrow' },
  { id: 'polyline', name: 'Polyline', group: 'markup', shortcut: 'N', interaction: 'poly', subject: 'Polyline' },
  { id: 'rectangle', name: 'Rectangle', group: 'markup', shortcut: 'R', interaction: 'box', subject: 'Rectangle' },
  { id: 'ellipse', name: 'Ellipse', group: 'markup', shortcut: 'E', interaction: 'box', subject: 'Ellipse' },
  { id: 'polygon', name: 'Polygon', group: 'markup', shortcut: 'P', interaction: 'poly', subject: 'Polygon', closed: true },
  { id: 'cloud', name: 'Cloud', group: 'markup', shortcut: 'C', interaction: 'box', subject: 'Cloud', closed: true },

  { id: 'calibrate', name: 'Calibrate', group: 'measure', shortcut: 'Shift+Alt+K', interaction: 'two-point', subject: '' },
  { id: 'length', name: 'Length', group: 'measure', shortcut: 'Shift+Alt+L', interaction: 'two-point', subject: 'Length Measurement' },
  { id: 'polylength', name: 'Polylength', group: 'measure', shortcut: 'Shift+Alt+P', interaction: 'poly', subject: 'Polylength Measurement' },
  { id: 'area', name: 'Area', group: 'measure', shortcut: 'Shift+Alt+A', interaction: 'poly', subject: 'Area Measurement', closed: true },
  { id: 'perimeter', name: 'Perimeter', group: 'measure', shortcut: 'Shift+Alt+M', interaction: 'poly', subject: 'Perimeter Measurement', closed: true },
  { id: 'volume', name: 'Volume', group: 'measure', shortcut: 'Shift+Alt+V', interaction: 'poly', subject: 'Volume Measurement', closed: true },
  { id: 'count', name: 'Count', group: 'measure', shortcut: 'Shift+Alt+C', interaction: 'count', subject: 'Count Measurement' },
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
