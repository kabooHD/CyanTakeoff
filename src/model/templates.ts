// PDF templates (Revu File > New PDF from Template): PDFs kept in the
// browser (IndexedDB) to start new documents from — title-block sheets,
// forms, cover pages.
import { create } from 'zustand';

export interface PdfTemplate { id: string; name: string; pages: number; size: number; created: string; bytes: Uint8Array }

/** A name not used yet: "Sheet", "Sheet (2)", "Sheet (3)"… */
export function uniqueTemplateName(list: { name: string }[], base: string): string {
  const used = new Set(list.map((t) => t.name));
  if (!used.has(base)) return base;
  for (let i = 2; ; i++) if (!used.has(`${base} (${i})`)) return `${base} (${i})`;
}

/** The list with `t` added (its name made unique), newest first. */
export function addTemplate(list: PdfTemplate[], t: PdfTemplate): PdfTemplate[] {
  return [{ ...t, name: uniqueTemplateName(list, t.name) }, ...list];
}

const DB = 'cyantakeoff', STORE = 'kv', KEY = 'pdf-templates';
function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE); };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function load(): Promise<PdfTemplate[]> {
  try {
    const d = await db();
    return await new Promise((resolve) => {
      const q = d.transaction(STORE).objectStore(STORE).get(KEY);
      q.onsuccess = () => resolve(Array.isArray(q.result) ? q.result : []);
      q.onerror = () => resolve([]);
    });
  } catch { return []; }
}
async function store(list: PdfTemplate[]) {
  try { const d = await db(); d.transaction(STORE, 'readwrite').objectStore(STORE).put(list, KEY); } catch { /* per session only */ }
}

export const useTemplates = create<{ list: PdfTemplate[]; loaded: boolean }>(() => ({ list: [], loaded: false }));

export async function loadTemplates() {
  if (useTemplates.getState().loaded) return;
  useTemplates.setState({ list: await load(), loaded: true });
}
async function update(fn: (l: PdfTemplate[]) => PdfTemplate[]) {
  await loadTemplates();
  const list = fn(useTemplates.getState().list);
  useTemplates.setState({ list });
  await store(list);
}
export const saveTemplate = (name: string, bytes: Uint8Array, pages: number) =>
  update((l) => addTemplate(l, { id: crypto.randomUUID(), name, pages, size: bytes.length, created: new Date().toISOString(), bytes }));
export const renameTemplate = (id: string, name: string) => update((l) => l.map((t) => (t.id === id ? { ...t, name: uniqueTemplateName(l.filter((x) => x.id !== id), name) } : t)));
export const deleteTemplate = (id: string) => update((l) => l.filter((t) => t.id !== id));
