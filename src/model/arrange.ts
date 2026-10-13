// Revu's markup arrangement commands: Group, Arrange (z-order), Align, Flip.
// Pure functions over the document's markup list (array order = drawing order).
import { bounds } from './measure';
import { translated } from './markup';
import type { Markup, Pt } from './types';

const markDirty = (m: Markup): Markup => ({ ...m, modified: new Date().toISOString(), source: m.source && { ...m.source, dirty: true } });

/** Selected ids plus every member of the groups they belong to. */
export function expandGroups(markups: Markup[], ids: string[]): string[] {
  const groups = new Set(markups.filter((m) => ids.includes(m.id) && m.groupId).map((m) => m.groupId));
  if (!groups.size) return ids;
  return [...new Set([...ids, ...markups.filter((m) => m.groupId && groups.has(m.groupId)).map((m) => m.id)])];
}

export function group(markups: Markup[], ids: string[]): Markup[] {
  if (ids.length < 2) return markups;
  const g = crypto.randomUUID();
  return markups.map((m) => (ids.includes(m.id) ? markDirty({ ...m, groupId: g }) : m));
}

export function ungroup(markups: Markup[], ids: string[]): Markup[] {
  return markups.map((m) => (ids.includes(m.id) && m.groupId ? markDirty({ ...m, groupId: undefined }) : m));
}

export type Order = 'front' | 'forward' | 'backward' | 'back';

/** Change drawing order of the selected markups (only relative to markups on the same page). */
export function reorder(markups: Markup[], ids: string[], order: Order): Markup[] {
  const sel = new Set(ids);
  const page = markups.find((m) => sel.has(m.id))?.page;
  if (page === undefined) return markups;
  const onPage = markups.filter((m) => m.page === page);
  let next: Markup[];
  if (order === 'front') next = [...onPage.filter((m) => !sel.has(m.id)), ...onPage.filter((m) => sel.has(m.id))];
  else if (order === 'back') next = [...onPage.filter((m) => sel.has(m.id)), ...onPage.filter((m) => !sel.has(m.id))];
  else {
    next = [...onPage];
    const step = order === 'forward' ? 1 : -1;
    const idx = next.map((m, i) => (sel.has(m.id) ? i : -1)).filter((i) => i >= 0);
    for (const i of step > 0 ? idx.reverse() : idx) {
      const j = i + step;
      if (j < 0 || j >= next.length || sel.has(next[j].id)) continue;
      [next[i], next[j]] = [next[j], next[i]];
    }
  }
  // Put the reordered page back in place of the old one; mark moved markups dirty
  // so the saved annotation order follows.
  let k = 0;
  return markups.map((m) => (m.page === page ? next[k++] : m)).map((m, i) => (m !== markups[i] && sel.has(m.id) ? markDirty(m) : m));
}

export type Edge = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';

/** Align the selected markups to the selection's edge or centre line. */
export function align(markups: Markup[], ids: string[], edge: Edge, boxOf: (m: Markup) => ReturnType<typeof bounds>): Markup[] {
  const sel = markups.filter((m) => ids.includes(m.id) && !m.locked);
  if (sel.length < 2) return markups;
  const all = bounds(sel.flatMap((m) => { const b = boxOf(m); return [{ x: b.minX, y: b.minY }, { x: b.maxX, y: b.maxY }]; }));
  return markups.map((m) => {
    if (!sel.includes(m)) return m;
    const b = boxOf(m);
    const dx = edge === 'left' ? all.minX - b.minX : edge === 'right' ? all.maxX - b.maxX
      : edge === 'center' ? (all.minX + all.maxX) / 2 - (b.minX + b.maxX) / 2 : 0;
    const dy = edge === 'top' ? all.minY - b.minY : edge === 'bottom' ? all.maxY - b.maxY
      : edge === 'middle' ? (all.minY + all.maxY) / 2 - (b.minY + b.maxY) / 2 : 0;
    return dx || dy ? markDirty({ ...m, ...translated(m, dx, dy) }) : m;
  });
}

/** Mirror the selected markups across the selection's vertical (horizontal flip) or horizontal axis. */
export function flip(markups: Markup[], ids: string[], axis: 'horizontal' | 'vertical'): Markup[] {
  const sel = markups.filter((m) => ids.includes(m.id) && !m.locked);
  if (!sel.length) return markups;
  const all = bounds(sel.flatMap((m) => [...m.points, ...(m.cutouts ?? []).flatMap((c) => c.points)]));
  const cx = all.minX + all.maxX, cy = all.minY + all.maxY;
  const f = (p: Pt) => (axis === 'horizontal' ? { x: cx - p.x, y: p.y } : { x: p.x, y: cy - p.y });
  return markups.map((m) => (sel.includes(m)
    ? markDirty({ ...m, points: m.points.map(f), cutouts: m.cutouts?.map((c) => ({ ...c, points: c.points.map(f) })) })
    : m));
}
