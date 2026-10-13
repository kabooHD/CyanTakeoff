// Revu Legends: a table markup listing markup kinds (symbol, description)
// with live quantities and measurement totals from the source pages.
import { formatLength, formatNumber, measure, resolveFormat } from './measure';
import type { Markup, MarkupStyle, MarkupType } from './types';

export interface LegendDef {
  title: string;
  /** Markup kinds shown: see legendKey. */
  keys: string[];
  /** Markups counted: on the Legend's page, or on all pages. */
  source: 'page' | 'all';
  showQuantity: boolean;
  showMeasurement: boolean;
}

/** Markups are the same kind for a Legend when type, subject and colour match (Revu: type and appearance). */
export const legendKey = (m: Pick<Markup, 'type' | 'subject' | 'style'>) => `${m.type}|${m.subject}|${m.style.color.toLowerCase()}`;

export interface LegendRow {
  key: string;
  type: MarkupType;
  style: MarkupStyle;
  description: string;
  quantity: number;
  measurement: string;
}

export function legendRows(def: LegendDef, markups: Markup[], page: number): LegendRow[] {
  const rows: LegendRow[] = [];
  for (const key of def.keys) {
    const ms = markups.filter((m) => m.type !== 'legend' && legendKey(m) === key && (def.source === 'all' || m.page === page));
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
    rows.push({
      key, type: type as MarkupType, description: subject,
      style: first?.style ?? { color, fill: null, opacity: 1, fillOpacity: 0.3, width: 1, lineStyle: 'solid', fontSize: 10 },
      quantity, measurement,
    });
  }
  return rows;
}

/** Table geometry (page units) shared by the screen and the saved appearance. */
export function legendLayout(def: LegendDef, rows: LegendRow[], fontSize: number) {
  const row = Math.max(14, fontSize * 1.8);
  const char = fontSize * 0.55;
  const sym = row * 1.6;
  const desc = Math.max(8, def.title.length * 0.9, ...rows.map((r) => r.description.length)) * char + 10;
  const qty = def.showQuantity ? Math.max(8, ...rows.map((r) => String(r.quantity).length + 2)) * char + 8 : 0;
  const meas = def.showMeasurement ? Math.max(11, ...rows.map((r) => r.measurement.length + 1)) * char + 8 : 0;
  const cols = [
    { id: 'symbol', w: sym }, { id: 'description', w: desc },
    ...(def.showQuantity ? [{ id: 'quantity', w: qty }] : []), ...(def.showMeasurement ? [{ id: 'measurement', w: meas }] : []),
  ];
  const w = cols.reduce((t, c) => t + c.w, 0);
  const title = row * 1.15;
  return { w, h: title + row * (rows.length + 1), row, title, cols };
}

export const LEGEND_HEADERS: Record<string, string> = { symbol: '', description: 'Description', quantity: 'Quantity', measurement: 'Measurement' };
