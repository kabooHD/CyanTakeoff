// Set files (Revu saves Sets as .bex, a format that is not documented):
// CyanTakeoff keeps its own JSON with the files of the Set and its options.
// A browser cannot reopen files by path, so Open Set asks for the PDFs and
// matches them by name.

import type { SetOptions } from './revisions';

export interface SetFile {
  format: 'cyantakeoff-set';
  version: 1;
  name: string;
  /** File names in the Set, in the order they were open. */
  files: string[];
  options: SetOptions;
}

export const SET_EXT = '.ctset.json';

export function setFileFrom(name: string, files: string[], options: SetOptions): SetFile {
  return { format: 'cyantakeoff-set', version: 1, name: name.replace(/\.ctset\.json$/i, ''), files: [...new Set(files)], options };
}

/** Parses a Set file; null when it is not one. */
export function parseSetFile(text: string): SetFile | null {
  try {
    const j = JSON.parse(text) as Partial<SetFile>;
    if (j?.format !== 'cyantakeoff-set' || !Array.isArray(j.files) || !j.options) return null;
    return { format: 'cyantakeoff-set', version: 1, name: String(j.name ?? 'Set'), files: j.files.map(String), options: j.options as SetOptions };
  } catch { return null; }
}

/**
 * Which of the Set's files a pick supplied (by name, case ignored) and
 * which are still missing, in the Set's order.
 */
export function matchSetFiles<T extends { name: string }>(set: SetFile, picked: T[]): { found: T[]; missing: string[] } {
  const byName = new Map(picked.map((f) => [f.name.toLowerCase(), f]));
  const found: T[] = [], missing: string[] = [];
  for (const name of set.files) {
    const f = byName.get(name.toLowerCase());
    if (f) found.push(f); else missing.push(name);
  }
  return { found, missing };
}
