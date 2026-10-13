// Core data model. All geometry is stored in "page space": the pdf.js
// viewport at scale 1 for the page (PDF points, y pointing down, page
// rotation applied). Conversion to PDF user space happens only on save.

export type Pt = { x: number; y: number };

export type MarkupType =
  | 'line'
  | 'arrow'
  | 'polyline'
  | 'polygon'
  | 'rectangle'
  | 'ellipse'
  | 'cloud'
  | 'pen'
  | 'highlight'
  | 'textbox'
  | 'callout'
  | 'note'
  | 'length'
  | 'polylength'
  | 'area'
  | 'perimeter'
  | 'volume'
  | 'count'
  | 'angle'
  | 'radius'
  | 'diameter';

export type ToolId = MarkupType | 'select' | 'pan' | 'calibrate' | 'zoom' | 'cutout' | 'ellipse-cutout';

/** A hole subtracted from an Area or Volume measurement. Ellipse: two opposite corners. */
export interface Cutout { kind: 'polygon' | 'ellipse'; points: Pt[] }

export type LengthUnit = 'in' | 'ft' | 'ft-in' | 'yd' | 'mm' | 'cm' | 'm';

/** Page/markup scale: real-world units per PDF point. */
export interface Scale {
  /** Real-world `unit`s per PDF point. */
  factor: number;
  unit: LengthUnit;
  /** Human-readable ratio, e.g. 1/8" = 1'-0" */
  label: string;
  /** Display format, read from (and written to) the PDF number formats. */
  format?: ScaleFormat;
}

export interface ScaleFormat {
  /** Feet-inch fraction denominator (4 = nearest 1/4"). */
  den?: number;
  /** Decimal places for decimal units, areas and volumes. */
  decimals?: number;
  /** Drop trailing zeros (PDF /FD). */
  trim?: boolean;
  areaLabel?: string;
  volumeLabel?: string;
}

export type MarkupStatus = 'None' | 'Accepted' | 'Rejected' | 'Cancelled' | 'Completed';

export type LineStyle = 'solid' | 'dashed' | 'dotted';

export interface MarkupStyle {
  color: string; // stroke / text colour, #rrggbb
  fill: string | null; // fill colour or null for none
  opacity: number; // 0..1, stroke opacity
  fillOpacity: number; // 0..1
  width: number; // line width, points
  lineStyle: LineStyle;
  fontSize: number; // points
}

export interface Markup {
  id: string;
  type: MarkupType;
  page: number; // 0-based
  points: Pt[];
  style: MarkupStyle;
  subject: string;
  label: string;
  comment: string;
  author: string;
  created: string; // ISO date
  modified: string;
  status: MarkupStatus;
  /** Text content for textbox/callout. */
  text?: string;
  /** Scale captured from the page when the measurement was made. */
  scale?: Scale;
  /** Depth for volume, in scale units (ft or m). */
  depth?: number;
  /** Holes cut out of an Area or Volume measurement. */
  cutouts?: Cutout[];
  /** Original PDF annotation reference when imported from the file. */
  source?: {
    objectNumber: number;
    generation: number;
    dirty: boolean;
    /** Further annotations this markup was read from (e.g. items of a Revu count group). */
    extraRefs?: { objectNumber: number; generation: number }[];
  };
}

export interface ToolPreset {
  id: string;
  name: string;
  type: MarkupType;
  style: MarkupStyle;
  subject: string;
  depth?: number;
}

export interface Toggles {
  snap: boolean;
  grid: boolean;
  content: boolean;
  markup: boolean;
  reuse: boolean;
  sync: boolean;
}
