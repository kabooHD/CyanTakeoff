// Automatically Reorder Bookmarks (Revu, Preferences > Document): after
// pages are reordered, top-level bookmarks are put back in the order of the
// pages they jump to. Bookmarks that are not page jumps keep their place;
// children are left as they are.

export interface PageOrdered { page: number | null }

/** The list with its page-jump items sorted by page (stable); other items stay where they were. */
export function reorderByPage<T extends PageOrdered>(list: T[]): T[] {
  const jumps = list.filter((b) => b.page !== null);
  const sorted = [...jumps].sort((a, b) => a.page! - b.page!);
  let k = 0;
  return list.map((b) => (b.page === null ? b : sorted[k++]));
}

/** True when `reorderByPage` would change the order. */
export const isPageOrdered = <T extends PageOrdered>(list: T[]) => reorderByPage(list).every((b, i) => b === list[i]);
