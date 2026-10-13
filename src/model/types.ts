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
  | 'diameter'
  | 'dimension'
  | 'typewriter'
  | 'cloudplus'
  | 'arc'
  | 'flag'
  | 'stamp'
  | 'strikeout'
  | 'underline'
  | 'squiggly'
  | 'image'
  | 'link'
  | 'attachment';

export type ToolId = MarkupType | 'select' | 'pan' | 'calibrate' | 'zoom' | 'cutout' | 'ellipse-cutout' | 'viewport' | 'radius-3pt' | 'dynamic-fill' | 'snapshot' | 'eraser' | 'lasso' | 'space';

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
  /** Separate Y scale: `unit`s per point along the page's vertical axis. */
  yFactor?: number;
  /** Label of the Y scale when separate. */
  yLabel?: string;
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

/**
 * A region of a page with its own scale (Revu "Viewports"). Measurements
 * whose first point falls inside use its scale instead of the page scale.
 */
export interface Viewport {
  id: string;
  name: string;
  /** Two opposite corners, page space. */
  rect: [Pt, Pt];
  scale: Scale;
}

/**
 * A named region of a page (Revu "Spaces"): markups inside it are organised
 * by it. Spaces nest by containment; they never partly overlap.
 */
export interface Space {
  id: string;
  title: string;
  /** Outline, page space. */
  points: Pt[];
  color: string;
  opacity: number;
}

/** A custom column of the Markups List (Revu: Text, Number, Checkmark, Choice, Date, Formula). */
export interface CustomColumn {
  id: string;
  name: string;
  type: 'text' | 'number' | 'checkmark' | 'choice' | 'date' | 'formula';
  /** Choice items. */
  options?: string[];
  /** Default for new markups ('today' for Date: the current date). */
  defaultValue?: string | number | boolean;
  expression?: string;
  format?: 'normal' | 'currency' | 'percent';
  decimals?: number;
  currency?: string;
  includeInTotals?: boolean;
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
  /** Depth in scale units (ft or m): volume, or wall area for lengths. */
  depth?: number;
  /** Slope of the measured plane (Revu: Pitch x/12, Degree or Grade %). */
  slope?: { unit: 'pitch' | 'degree' | 'grade'; value: number };
  /** Rise/Drop added to a length, in scale units (piping, conduit). */
  rise?: number;
  /** Holes cut out of an Area or Volume measurement. */
  cutouts?: Cutout[];
  /** Image markups (image, snapshot): a data: URL. */
  image?: string;
  /** File attachment: name, MIME type and base64 contents. */
  file?: { name: string; mime: string; data: string };
  /** Hyperlink target: a web address or a page (0-based). */
  link?: { uri?: string; page?: number };
  /** Markups sharing a group id move and select together (Revu Group). */
  groupId?: string;
  /** Locked markups cannot be moved, resized or deleted (Revu Lock). */
  locked?: boolean;
  /** Values of the document's custom columns, by column id. */
  custom?: Record<string, string | number | boolean>;
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
