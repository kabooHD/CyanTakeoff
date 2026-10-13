// Edits of the bookmark tree (Bookmarks panel): add before / after / as
// child, drag to move or copy, delete, rename and properties.
import type { Bookmark } from '../pdf/bookmarks';

export type Where = 'before' | 'after' | 'child';

export function findBookmark(list: Bookmark[], id: string): Bookmark | undefined {
  for (const b of list) {
    if (b.id === id) return b;
    const k = findBookmark(b.kids, id);
    if (k) return k;
  }
  return undefined;
}

/** Bookmarks in list order, with their depth (only open branches when `openOnly`). */
export function flatten(list: Bookmark[], openOnly = false, depth = 0): { b: Bookmark; depth: number }[] {
  return list.flatMap((b) => [{ b, depth }, ...(!openOnly || b.open ? flatten(b.kids, openOnly, depth + 1) : [])]);
}

export function removeBookmarks(list: Bookmark[], ids: Set<string>): Bookmark[] {
  return list.filter((b) => !ids.has(b.id)).map((b) => ({ ...b, kids: removeBookmarks(b.kids, ids) }));
}

export function updateBookmark(list: Bookmark[], id: string, patch: Partial<Bookmark>): Bookmark[] {
  return list.map((b) => (b.id === id ? { ...b, ...patch } : { ...b, kids: updateBookmark(b.kids, id, patch) }));
}

/** Insert `items` relative to `target` (none: top for before, end otherwise). */
export function insertBookmarks(list: Bookmark[], items: Bookmark[], target: string | null, where: Where): Bookmark[] {
  if (!target || !findBookmark(list, target)) return where === 'before' ? [...items, ...list] : [...list, ...items];
  const place = (l: Bookmark[]): Bookmark[] => l.flatMap((b) => {
    if (b.id === target) {
      if (where === 'child') return [{ ...b, open: true, kids: [...b.kids, ...items] }];
      return where === 'before' ? [...items, b] : [b, ...items];
    }
    return [{ ...b, kids: place(b.kids) }];
  });
  return place(list);
}

/** A copy with new ids, no link to the original objects. */
export function copyBookmark(b: Bookmark): Bookmark {
  const { src: _s, ...rest } = b;
  return { ...rest, id: crypto.randomUUID(), destEdited: b.page !== null, kids: b.kids.map(copyBookmark) };
}

/** Move (or copy) the bookmarks `ids` next to / into `target`; a bookmark cannot move into itself. */
export function moveBookmarks(list: Bookmark[], ids: string[], target: string, where: Where, copy = false): Bookmark[] {
  const all = flatten(list).map((x) => x.b);
  // Only the top-most selected (children travel with their parent), in list order.
  const sel = new Set(ids);
  const under = (b: Bookmark): string[] => b.kids.flatMap((k) => [k.id, ...under(k)]);
  const nested = new Set(all.filter((b) => sel.has(b.id)).flatMap(under));
  const moving = all.filter((b) => sel.has(b.id) && !nested.has(b.id));
  if (moving.some((b) => b.id === target || under(b).includes(target))) return list;
  if (copy) return insertBookmarks(list, moving.map(copyBookmark), target, where);
  return insertBookmarks(removeBookmarks(list, new Set(moving.map((b) => b.id))), moving, target, where);
}
