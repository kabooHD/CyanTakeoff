// Revu Legends: a table markup listing markup kinds (symbol, description)
// with live quantities and measurement totals from the source pages, plus
// any other Markups List column (label, comment, status, custom columns...).
import { displayValue, isNumericColumn, numericValue, formatValue } from './columns';
import { formatLength, formatNumber, measure, parsePageRange, resolveFormat } from './measure';
import type { CustomColumn, Markup, MarkupStyle, MarkupType } from './types';

export interface FontFlags { bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean }

export interface LegendDef {
  title: string;
  /** Markup kinds shown: see legendKey. */
  keys: string[];
  /** Markups counted: on the Legend's page, on all pages, or on a custom page range. */
  source: 'page' | 'all' | 'custom';
  /** Custom source pages, 1-based ranges ("1-3, 5"). */
  pages?: string;
  showQuantity: boolean;
  showMeasurement: boolean;
  /** Extra columns after Description: a Markups List field or 'custom:<column id>' (see LEGEND_COLUMNS). */
  columns?: string[];
  /** Title bar and column headers (both shown by default). */
  showTitle?: boolean;
  showHeaders?: boolean;
  /** Title and header text: size in points (defaults: 1.2× and 1× the text size) and style. */
  titleSize?: number;
  titleStyle?: FontFlags;
  headerSize?: number;
  headerStyle?: FontFlags;
  /** Symbol size as a percentage of the default (100). */
  symbolSize?: number;
  /** Space between text and cell borders, points (5). */
  margin?: number;
  /** Alignment of text cells (numbers are always right-aligned). */
  align?: 'left' | 'center' | 'right';
  /** Text colour (default: the table's line colour). */
  textColor?: string;
}

/** Markups are the same kind for a Legend when type, subject and colour match (Revu: type and appearance). */
export const legendKey = (m: Pick<Markup, 'type' | 'subject' | 'style'>) => `${m.type}|${m.subject}|${m.style.color.toLowerCase()}`;

/** The Markups List fields a Legend can show as columns (custom columns are added per document). */
export const LEGEND_COLUMNS: { id: string; label: string }[] = [
  { id: 'label', label: 'Label' }, { id: 'comment', label: 'Comments' }, { id: 'status', label: 'Status' },
  { id: 'author', label: 'Author' }, { id: 'layer', label: 'Layer' }, { id: 'pages', label: 'Pages' }, { id: 'color', label: 'Color' },
];

export interface LegendRow {
  key: string;
  type: MarkupType;
  style: MarkupStyle;
  description: string;
  quantity: number;
  measurement: string;
  /** Values of the extra columns, by column id. */
  cells: Record<string, string>;
}

export interface LegendContext {
  /** Needed for a custom page range. */
  pageCount?: number;
  /** The document's custom columns (for 'custom:<id>' columns). */
  columns?: CustomColumn[];
  /** Page labels for the Pages column. */
  pageLabels?: string[];
}

/** Whether a markup on `page` (0-based) is in the Legend's source pages when the Legend sits on `own`. */
export function inSourcePages(def: LegendDef, own: number, page: number, pageCount = 0): boolean {
  if (def.source === 'all') return true;
  if (def.source === 'custom') return parsePageRange(def.pages ?? '', Math.max(pageCount, page + 1)).includes(page);
  return page === own;
}

const distinct = (vs: string[]) => [...new Set(vs.filter((v) => v !== ''))].join(', ');

/** The value of an extra column for the markups of one kind. */
export function legendCell(id: string, ms: Markup[], ctx: LegendContext): string {
  if (id.startsWith('custom:')) {
    const c = ctx.columns?.find((x) => x.id === id.slice(7));
    if (!c) return '';
    const cols = ctx.columns ?? [];
    if (isNumericColumn(c)) {
      const vals = ms.map((m) => numericValue(m, c, cols)).filter((v): v is number => v !== undefined);
      return vals.length ? formatValue(c, vals.reduce((a, b) => a + b, 0)) : '';
    }
    return distinct(ms.map((m) => String(displayValue(m, c, cols) ?? '')));
  }
  switch (id) {
    case 'label': return distinct(ms.map((m) => m.label));
    case 'comment': return distinct(ms.map((m) => m.comment));
    case 'status': return distinct(ms.map((m) => (m.status === 'None' ? '' : m.status)));
    case 'author': return distinct(ms.map((m) => m.author));
    case 'layer': return distinct(ms.map((m) => m.layer ?? ''));
    case 'pages': return distinct([...new Set(ms.map((m) => m.page))].sort((a, b) => a - b).map((p) => ctx.pageLabels?.[p] ?? String(p + 1)));
    case 'color': return ms[0]?.style.color.toUpperCase() ?? '';
    default: return '';
  }
}

export function legendRows(def: LegendDef, markups: Markup[], page: number, ctx: LegendContext = {}): LegendRow[] {
  const rows: LegendRow[] = [];
  for (const key of def.keys) {
    const ms = markups.filter((m) => m.type !== 'legend' && legendKey(m) === key && inSourcePages(def, page, m.page, ctx.pageCount));
    const [type, subject, color] = key.split('|');
    const first = ms[0];
    let quantity = 0, total = 0;
    for (const m of ms) {
      const v = measure(m);
      quantity += m.type === 'count' ? v?.count ?? 0 : 1;
      total += m.type === 'area' ? v?.area ?? 0 : m.type === 'volume' ? v?.volume ?? 0 : m.type === 'count' ? 0 : v?.length ?? 0;
    }
    let measurement = '';
    if (first?.scale && total) {
      const f = resolveFormat(first.scale);
      measurement = first.type === 'area' ? `${formatNumber(total, f.decimals, f.trim)} ${f.areaLabel}`
        : first.type === 'volume' ? `${formatNumber(total, f.decimals, f.trim)} ${f.volumeLabel}`
          : formatLength(total, first.scale.unit, f.decimals, f.den, f.trim);
    }
    const cells: Record<string, string> = {};
    for (const id of def.columns ?? []) cells[id] = legendCell(id, ms, ctx);
    rows.push({
      key, type: type as MarkupType, description: subject,
      style: first?.style ?? { color, fill: null, opacity: 1, fillOpacity: 0.3, width: 1, lineStyle: 'solid', fontSize: 10 },
      quantity, measurement, cells,
    });
  }
  return rows;
}

/** The resolved sizes of a Legend (defaults filled in). */
export function legendSizes(def: LegendDef, fontSize: number) {
  return {
    title: def.titleSize ?? Math.round(fontSize * 1.2 * 10) / 10,
    header: def.headerSize ?? fontSize,
    symbol: Math.max(1, Math.min(5000, def.symbolSize ?? 100)) / 100,
    margin: def.margin ?? 5,
    showTitle: def.showTitle !== false,
    showHeaders: def.showHeaders !== false,
    align: def.align ?? 'left',
  };
}

/** Whether a column holds numbers (right-aligned). */
export const isNumericLegendColumn = (id: string, columns?: CustomColumn[]) =>
  id === 'quantity' || id === 'measurement' || (id.startsWith('custom:') && !!columns?.some((c) => c.id === id.slice(7) && isNumericColumn(c)));

/** Header text of a column. */
export function legendHeader(id: string, columns?: CustomColumn[]): string {
  if (id.startsWith('custom:')) return columns?.find((c) => c.id === id.slice(7))?.name ?? '';
  return LEGEND_HEADERS[id] ?? LEGEND_COLUMNS.find((c) => c.id === id)?.label ?? id;
}

/** Table geometry (page units) shared by the screen and the saved appearance. */
export function legendLayout(def: LegendDef, rows: LegendRow[], fontSize: number, columns?: CustomColumn[]) {
  const z = legendSizes(def, fontSize);
  const row = Math.max(14, fontSize * 1.8, z.showHeaders ? z.header * 1.8 : 0);
  const char = fontSize * 0.55, pad = z.margin * 2;
  const sym = Math.max(row * 0.6, row * 1.6 * z.symbol);
  const hchar = z.showHeaders ? z.header * 0.6 : 0;
  const width = (id: string, texts: string[], min: number) => Math.max(min * char, legendHeader(id, columns).length * hchar, ...texts.map((t) => t.length * char)) + pad;
  const desc = width('description', rows.map((r) => r.description), 8);
  const qty = def.showQuantity ? width('quantity', rows.map((r) => String(r.quantity)), 6) : 0;
  const meas = def.showMeasurement ? width('measurement', rows.map((r) => r.measurement), 10) : 0;
  const cols = [
    { id: 'symbol', w: sym }, { id: 'description', w: desc },
    ...(def.showQuantity ? [{ id: 'quantity', w: qty }] : []), ...(def.showMeasurement ? [{ id: 'measurement', w: meas }] : []),
    ...(def.columns ?? []).map((id) => ({ id, w: width(id, rows.map((r) => r.cells[id] ?? ''), 6) })),
  ];
  const titleW = z.showTitle ? def.title.length * z.title * 0.6 + pad : 0;
  let w = cols.reduce((t, c) => t + c.w, 0);
  if (titleW > w) { cols[1].w += titleW - w; w = titleW; }
  const title = z.showTitle ? Math.max(14, z.title * 1.9) : 0;
  const header = z.showHeaders ? row : 0;
  return { w, h: title + header + row * rows.length, row, title, header, cols, sizes: z };
}

export const LEGEND_HEADERS: Record<string, string> = { symbol: '', description: 'Description', quantity: 'Quantity', measurement: 'Measurement' };

/** The horizontal anchor of a text cell: numbers right, text per the alignment. */
export function cellAnchor(id: string, align: 'left' | 'center' | 'right', columns?: CustomColumn[]): 'start' | 'middle' | 'end' {
  if (isNumericLegendColumn(id, columns)) return 'end';
  return align === 'center' ? 'middle' : align === 'right' ? 'end' : 'start';
}

/** Text x within a cell at [x, x+w] for an anchor and margin. */
export const cellX = (anchor: 'start' | 'middle' | 'end', x: number, w: number, margin: number) => (anchor === 'start' ? x + margin : anchor === 'end' ? x + w - margin : x + w / 2);
