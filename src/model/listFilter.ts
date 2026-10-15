// Markups List custom column filters (Revu): conditions on one column,
// combined with AND or OR. Numbers compare as numbers, dates as dates
// (before / after a day), text by containing or matching.

export type FilterOp = 'eq' | 'ne' | 'gt' | 'lt' | 'contains' | 'before' | 'after';
export interface FilterCondition { op: FilterOp; value: string }
export interface CustomFilter { join: 'and' | 'or'; conds: FilterCondition[] }
export type ColumnKind = 'number' | 'date' | 'text';

export const OPS: Record<ColumnKind, { op: FilterOp; label: string }[]> = {
  number: [{ op: 'eq', label: 'equal to' }, { op: 'ne', label: 'not equal to' }, { op: 'gt', label: 'greater than' }, { op: 'lt', label: 'less than' }],
  date: [{ op: 'before', label: 'before' }, { op: 'after', label: 'after' }, { op: 'eq', label: 'on' }],
  text: [{ op: 'contains', label: 'contains' }, { op: 'eq', label: 'equal to' }, { op: 'ne', label: 'not equal to' }],
};

/** The number in a cell ("$1,258.30", "419.43 sf", "10'-6\"" -> 10.5 is not attempted: the first number). */
export function cellNumber(v: string | number): number | null {
  if (typeof v === 'number') return v;
  const m = /-?\d[\d,]*(?:\.\d+)?/.exec(v);
  return m ? Number(m[0].replace(/,/g, '')) : null;
}

/** A cell's day (local), from an ISO date or a locale date string. */
export function cellDay(v: string | number): number | null {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function matchesCondition(v: string | number, kind: ColumnKind, c: FilterCondition): boolean {
  if (kind === 'number') {
    const a = cellNumber(v), b = cellNumber(c.value);
    if (a === null || b === null) return c.op === 'ne';
    return c.op === 'eq' ? Math.abs(a - b) < 1e-9 : c.op === 'ne' ? Math.abs(a - b) >= 1e-9 : c.op === 'gt' ? a > b : c.op === 'lt' ? a < b : false;
  }
  if (kind === 'date') {
    const a = cellDay(v), b = cellDay(c.value);
    if (a === null || b === null) return false;
    return c.op === 'before' ? a < b : c.op === 'after' ? a > b : a === b;
  }
  const a = String(v).toLowerCase(), b = c.value.toLowerCase();
  return c.op === 'contains' ? a.includes(b) : c.op === 'eq' ? a === b : c.op === 'ne' ? a !== b : false;
}

/** Whether a cell passes the custom filter (no conditions: everything passes). */
export function matchesCustom(v: string | number, kind: ColumnKind, f: CustomFilter): boolean {
  const live = f.conds.filter((c) => c.value !== '');
  if (!live.length) return true;
  return f.join === 'or' ? live.some((c) => matchesCondition(v, kind, c)) : live.every((c) => matchesCondition(v, kind, c));
}

/** A one-line summary of a custom filter for the filter row ("> 100 and < 500"). */
export function describeFilter(f: CustomFilter, kind: ColumnKind): string {
  const sym: Record<FilterOp, string> = { eq: '=', ne: '≠', gt: '>', lt: '<', contains: '∋', before: '<', after: '>' };
  const live = f.conds.filter((c) => c.value !== '');
  return live.map((c) => `${sym[c.op]} ${c.value}`).join(f.join === 'or' ? ' or ' : ' and ') || (kind === 'text' ? 'Custom…' : 'Custom…');
}
