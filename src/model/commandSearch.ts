// Help > Find Tools + Commands (Revu): a search box over every menu item
// and tool. Ranking: a label that starts with the query, then a word of
// the label that starts with it, then any substring, then every query
// word somewhere in the label or its menu path.

export interface CommandEntry { label: string; path: string; shortcut?: string; disabled?: boolean; run: () => void }

const norm = (s: string) => s.toLowerCase().replace(/[…]/g, '').trim();

/** Score 0 (no match) .. 4 (best). */
export function matchScore(e: Pick<CommandEntry, 'label' | 'path'>, query: string): number {
  const q = norm(query);
  if (!q) return 1;
  const label = norm(e.label);
  if (label.startsWith(q)) return 4;
  if (label.split(/[\s/>+&()-]+/).some((w) => w.startsWith(q))) return 3;
  if (label.includes(q)) return 2;
  const hay = `${label} ${norm(e.path)}`;
  return q.split(/\s+/).every((w) => hay.includes(w)) ? 1 : 0;
}

/** Entries matching `query`, best first; ties keep the menu order. */
export function rankCommands<T extends Pick<CommandEntry, 'label' | 'path'>>(entries: T[], query: string, limit = 40): T[] {
  return entries
    .map((e, i) => ({ e, i, s: matchScore(e, query) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.e);
}
