// File Access (Revu, Alt+A): recently opened files, kept in the browser
// (IndexedDB). Files opened with file access keep their handle, so they can
// be reopened and saved in place; others are listed by name only.
import { create } from 'zustand';

export interface RecentFile {
  name: string;
  size: number;
  opened: string;
  pinned?: boolean;
  handle?: FileSystemFileHandle;
}

export const MAX_RECENT = 30;

/** Newest first, pinned files first, at most `max` unpinned ones; `entry` replaces one with the same name. */
export function addToRecent(list: RecentFile[], entry: RecentFile, max = MAX_RECENT): RecentFile[] {
  const old = list.find((r) => r.name === entry.name);
  const next = [{ ...entry, pinned: entry.pinned ?? old?.pinned, handle: entry.handle ?? old?.handle }, ...list.filter((r) => r.name !== entry.name)];
  return sortRecent(next.filter((r, i) => r.pinned || next.slice(0, i).filter((x) => !x.pinned).length < max));
}

export const sortRecent = (list: RecentFile[]) => [...list].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || (a.opened < b.opened ? 1 : a.opened > b.opened ? -1 : 0));

const DB = 'cyantakeoff', STORE = 'kv', KEY = 'recent-files';
function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE); };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function load(): Promise<RecentFile[]> {
  try {
    const d = await db();
    return await new Promise((resolve) => {
      const q = d.transaction(STORE).objectStore(STORE).get(KEY);
      q.onsuccess = () => resolve(Array.isArray(q.result) ? q.result : []);
      q.onerror = () => resolve([]);
    });
  } catch { return []; }
}
async function store(list: RecentFile[]) {
  try {
    const d = await db();
    const tx = d.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(list, KEY);
  } catch { /* private windows may refuse IndexedDB: the list is then per session */ }
}

export const useRecent = create<{ list: RecentFile[]; loaded: boolean }>(() => ({ list: [], loaded: false }));

export async function loadRecent() {
  if (useRecent.getState().loaded) return;
  useRecent.setState({ list: sortRecent(await load()), loaded: true });
}

async function update(fn: (l: RecentFile[]) => RecentFile[]) {
  await loadRecent();
  const list = fn(useRecent.getState().list);
  useRecent.setState({ list });
  await store(list);
}

export const rememberFile = (name: string, size: number, handle?: FileSystemFileHandle) =>
  update((l) => addToRecent(l, { name, size, opened: new Date().toISOString(), handle }));
export const forgetFile = (name: string) => update((l) => l.filter((r) => r.name !== name));
export const pinFile = (name: string, pinned: boolean) => update((l) => sortRecent(l.map((r) => (r.name === name ? { ...r, pinned } : r))));
export const clearRecent = () => update((l) => l.filter((r) => r.pinned));
