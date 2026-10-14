// Core data model. All geometry is stored in "page space": the pdf.js
// viewport at scale 1 for the page (PDF points, y pointing down, page
// rotation applied). Conversion to PDF user space happens only on save.
import type { HatchDef, LineStyleDef } from './lineStyles';
import type { SequenceDef } from './sequence';

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
  | 'attachment'
  | 'legend'
  | 'redaction';

export type ToolId = MarkupType | 'select' | 'pan' | 'calibrate' | 'zoom' | 'cutout' | 'ellipse-cutout' | 'viewport' | 'radius-3pt' | 'dynamic-fill' | 'snapshot' | 'eraser' | 'lasso' | 'space' | 'redact-text' | 'visual-pick' | 'region-pick' | 'edit-text' | 'erase-content' | 'cut-content' | 'select-text' | 'snapshot-content'
  | 'form-text' | 'form-checkbox' | 'form-radio' | 'form-dropdown' | 'form-list' | 'form-signature';

/** A hole subtracted from an Area or Volume measurement. Ellipse: two opposite corners. */
/** Polygon cutouts may have curved edges (`handles`, as on markups). */
export interface Cutout { kind: 'polygon' | 'ellipse'; points: Pt[]; handles?: import('./curves').Handles }

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

export interface Reply { id: string; author: string; date: string; text: string }

/** A state of the markup's status model (Review: None, Accepted, Rejected, Cancelled, Completed). */
export type MarkupStatus = string;

/** Line style id: a standard one ('solid', 'dashed', 'center'...) or a custom one (see lineStyles.ts). */
export type LineStyle = string;

export interface MarkupStyle {
  color: string; // stroke / text colour, #rrggbb
  fill: string | null; // fill colour or null for none
  opacity: number; // 0..1, stroke opacity
  fillOpacity: number; // 0..1
  width: number; // line width, points
  lineStyle: LineStyle;
  /** Copy of a custom line style's definition (standard styles are looked up by id). */
  lineDef?: LineStyleDef;
  /** Hatch pattern filling a closed markup (drawn in the fill colour), and its scale. */
  hatch?: HatchDef;
  hatchScale?: number;
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
  /** Status model of `status` (undefined: Review), who set it and when (Revu shows both). */
  statusModel?: string;
  statusBy?: string;
  statusDate?: string;
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
  /** Layer (optional content group) the markup is on: its id from src/pdf/layers.ts. */
  layer?: string;
  /** Bézier handlebars per vertex (curved segments), offsets from the vertex; see model/curves.ts. */
  handles?: ({ in: Pt; out: Pt } | null)[];
  /** Image markups (image, snapshot): a data: URL. */
  image?: string;
  /** File attachment: name, MIME type and base64 contents. */
  file?: { name: string; mime: string; data: string };
  /** Hyperlink target: a web address, or a page (0-based) here or in another file of the set. */
  /** Hyperlink action: a web address, a page, a page of another file, or a Place (named destination). */
  link?: { uri?: string; page?: number; file?: string; dest?: string };
  /** Stamp: the small line under the title (default: author and date). */
  subtitle?: string;
  /** Markups sharing a group id move and select together (Revu Group). */
  groupId?: string;
  /** Locked markups cannot be moved, resized or deleted (Revu Lock). */
  locked?: boolean;
  /** Legend settings (Legend markups). */
  legend?: import('./legend').LegendDef;
  /** Replies to this markup (PDF: /Text annotations with /IRT to it). */
  replies?: Reply[];
  /** Member of a Sequence: the tool's id, its run and this markup's value. */
  seq?: { id: string; run: number; n: number };
  /** Markups List Checkmark column. */
  checked?: boolean;
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
  /** Revu: Properties mode draws a new markup with these properties; Drawing mode places a copy of the saved markup. */
  mode?: 'properties' | 'drawing';
  /** The saved markup, for Drawing mode (page-space geometry as captured). */
  markup?: Omit<Markup, 'id' | 'page' | 'source' | 'author' | 'created' | 'modified'>;
  /** Sequence: markups placed with this tool number themselves. */
  sequence?: SequenceDef;
}

/** A named tool set in the Tool Chest. */
export interface ToolSet { id: string; name: string; tools: ToolPreset[] }

export interface Toggles {
  snap: boolean;
  grid: boolean;
  content: boolean;
  markup: boolean;
  reuse: boolean;
  sync: boolean;
  /** View > Rulers (Ctrl+R). */
  rulers: boolean;
  /** View > Dimmer (Ctrl+F5): page content faded so markups stand out. */
  dimmer: boolean;
  /** View > Full-Screen Crosshair. */
  crosshair: boolean;
  /** Pen Mode (tablets): a finger pans and zooms, only the pen draws. */
  penMode: boolean;
  /** Window > Navigation Bar (F4): page navigation in the status bar. */
  navBar: boolean;
}
