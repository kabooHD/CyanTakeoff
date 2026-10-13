// Custom columns of the Markups List: values, defaults, formulas, display.
import { measure } from './measure';
import { evaluate } from './formula';
import type { CustomColumn, Markup } from './types';

/** Revu's "Measurement" column for formulas: the primary measured value without units. */
export function primaryValue(m: Markup): number | undefined {
  const v = measure(m);
  if (!v) return undefined;
  if (m.type === 'area') return v.area;
  if (m.type === 'volume') return v.volume;
  if (m.type === 'count') return v.count;
  if (m.type === 'angle') return v.angle;
  return v.length;
}

/** Numeric variables a formula can use for a markup. */
export function formulaVars(m: Markup, cols: CustomColumn[], depth = 0): Record<string, number | undefined> {
  const v = measure(m);
  const vars: Record<string, number | undefined> = {
    Measurement: primaryValue(m), Length: v?.length, Area: v?.area, Volume: v?.volume, Count: v?.count,
    Angle: v?.angle, Depth: m.depth,
  };
  for (const c of cols) {
    if (c.type === 'formula') vars[c.name] = depth < 8 ? numericValue(m, c, cols, depth + 1) : undefined;
    else if (c.type === 'number' || c.type === 'choice') {
      const x = Number(m.custom?.[c.id]);
      vars[c.name] = m.custom?.[c.id] !== undefined && m.custom[c.id] !== '' && Number.isFinite(x) ? x : undefined;
    } else if (c.type === 'checkmark') vars[c.name] = m.custom?.[c.id] ? 1 : 0;
  }
  return vars;
}

/** The value of a numeric (number, formula or numeric choice) column, if any. */
export function numericValue(m: Markup, c: CustomColumn, cols: CustomColumn[], depth = 0): number | undefined {
  if (c.type === 'formula') {
    const r = evaluate(c.expression ?? '', formulaVars(m, cols.filter((x) => x.id !== c.id), depth));
    return Number.isFinite(r) ? r : undefined;
  }
  const raw = m.custom?.[c.id];
  if (raw === undefined || raw === '') return undefined;
  const x = Number(raw);
  return Number.isFinite(x) ? x : undefined;
}

export function formatValue(c: CustomColumn, v: number | undefined): string {
  if (v === undefined) return '';
  const d = c.decimals ?? 2;
  if (c.format === 'currency') return `${c.currency ?? '$'}${v.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d })}`;
  if (c.format === 'percent') return `${(v * 100).toFixed(d)}%`;
  return v.toFixed(d);
}

/** What the Markups List shows for a custom column. */
export function displayValue(m: Markup, c: CustomColumn, cols: CustomColumn[]): string | number {
  switch (c.type) {
    case 'formula': case 'number': {
      const v = numericValue(m, c, cols);
      return c.format && c.format !== 'normal' ? formatValue(c, v) : v === undefined ? '' : Math.round(v * 10 ** (c.decimals ?? 2)) / 10 ** (c.decimals ?? 2);
    }
    case 'checkmark': return m.custom?.[c.id] ? '✓' : '';
    default: return String(m.custom?.[c.id] ?? '');
  }
}

export const isNumericColumn = (c: CustomColumn) => c.type === 'number' || c.type === 'formula';

/** Default custom values for a new markup. */
export function columnDefaults(cols: CustomColumn[]): Record<string, string | number | boolean> | undefined {
  const out: Record<string, string | number | boolean> = {};
  for (const c of cols) {
    if (c.type === 'formula' || c.defaultValue === undefined || c.defaultValue === '') continue;
    out[c.id] = c.type === 'date' && c.defaultValue === 'today' ? new Date().toISOString().slice(0, 10) : c.defaultValue;
  }
  return Object.keys(out).length ? out : undefined;
}
