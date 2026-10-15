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
    else if (c.type === 'number' || c.type === 'choice') vars[c.name] = numericValue(m, c, cols, depth + 1);
    else if (c.type === 'checkmark') vars[c.name] = m.custom?.[c.id] ? 1 : 0;
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
  // A choice item's assigned numeric value counts (Revu: Assign Numeric Value); else the text as a number.
  const assigned = c.type === 'choice' ? c.choiceMeta?.[String(raw)]?.value : undefined;
  if (assigned !== undefined) return assigned;
  const x = Number(raw);
  return Number.isFinite(x) ? x : undefined;
}

/** A number column's value kept within its Min/Max. */
export function clampNumber(c: CustomColumn, v: number): number {
  let x = v;
  if (c.min !== undefined) x = Math.max(c.min, x);
  if (c.max !== undefined) x = Math.min(c.max, x);
  return x;
}

/** Choice items from a CSV (Revu: column A item, B subject, C numeric value). */
export function parseChoiceCsv(text: string): { options: string[]; choiceMeta: NonNullable<CustomColumn['choiceMeta']> } {
  const options: string[] = [];
  const choiceMeta: NonNullable<CustomColumn['choiceMeta']> = {};
  for (const line of text.split(/\r?\n/)) {
    const cells = line.split(',').map((x) => x.trim().replace(/^"|"$/g, ''));
    const item = cells[0];
    if (!item || options.includes(item)) continue;
    options.push(item);
    const meta: { subject?: string; value?: number } = {};
    if (cells[1]) meta.subject = cells[1];
    if (cells[2] !== undefined && cells[2] !== '' && Number.isFinite(Number(cells[2]))) meta.value = Number(cells[2]);
    if (Object.keys(meta).length) choiceMeta[item] = meta;
  }
  return { options, choiceMeta };
}

const PROFILE_LS = 'cyantakeoff:profile-columns';
/** Custom columns saved to the profile: every new document without its own columns starts with them. */
export function profileColumns(): CustomColumn[] {
  try { const v = JSON.parse(localStorage.getItem(PROFILE_LS) ?? '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}
export function saveProfileColumns(cols: CustomColumn[] | null) {
  try { if (cols?.length) localStorage.setItem(PROFILE_LS, JSON.stringify(cols)); else localStorage.removeItem(PROFILE_LS); } catch { /* storage unavailable */ }
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
