// Reopen Files from Last Session on Startup (Revu, Preferences > General):
// the names of the files open when the app was left are kept in the
// browser; at startup those that can be reopened without asking (the
// sample, files whose access is still granted) open on their own, the
// others wait for a click (a browser asks for file access on a gesture).
import type { RecentFile } from './recent';

const KEY = 'cyantakeoff:last-session';

export function saveSession(names: string[]) {
  try { localStorage.setItem(KEY, JSON.stringify(names)); } catch { /* storage full or blocked */ }
}

export function loadSession(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch { return []; }
}

export const clearSession = () => { try { localStorage.removeItem(KEY); } catch { /* ignore */ } };

/**
 * The last session's files matched to the recent list, in session order:
 * `recent` entries (the sample needs no handle) and the names that cannot
 * be reopened (no entry, or opened without file access).
 */
export function sessionFiles(names: string[], recent: RecentFile[], sampleName: string): { files: RecentFile[]; missing: string[] } {
  const files: RecentFile[] = [], missing: string[] = [];
  for (const name of names) {
    const r = recent.find((x) => x.name === name);
    if (r && (r.handle || r.name === sampleName)) files.push(r);
    else if (name === sampleName) files.push({ name, size: 0, opened: '' });
    else missing.push(name);
  }
  return { files, missing };
}

import { create } from 'zustand';
/** Files of the last session still waiting for a click (the browser asks for file access on a gesture). */
export const usePendingSession = create<{ pending: RecentFile[] }>(() => ({ pending: [] }));
