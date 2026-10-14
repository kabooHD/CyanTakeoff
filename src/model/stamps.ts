// Custom stamps (Revu Stamp > Create Stamp / Import): text stamps with a
// title and a subtitle template ({Author}, {Date}, {Time}, {DateTime}), and
// image stamps. Kept in this browser; export/import as JSON to share them.
import { create } from 'zustand';

export interface CustomStamp {
  id: string;
  name: string;
  kind: 'text' | 'image';
  /** Text stamps: the big line and the small template line. */
  title?: string;
  subtitle?: string;
  color?: string;
  /** Image stamps: PNG/JPEG data URL and its size in points. */
  image?: string;
  w?: number;
  h?: number;
}

export const DEFAULT_SUBTITLE = '{Author} {Date}';

/** Fill a subtitle template. Unknown tokens are left as typed. */
export function stampText(template: string, v: { author: string; date: Date }): string {
  const d = v.date;
  const tokens: Record<string, string> = {
    author: v.author,
    date: d.toLocaleDateString(),
    time: d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    datetime: `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
  };
  return template.replace(/\{(\w+)\}/g, (all, k: string) => tokens[k.toLowerCase()] ?? all);
}

/** Stamps read from an exported file (anything malformed is dropped). */
export function parseStamps(json: string): CustomStamp[] {
  const data = JSON.parse(json);
  const list = Array.isArray(data) ? data : Array.isArray(data?.stamps) ? data.stamps : [];
  return list.filter((x: CustomStamp) => x && typeof x.name === 'string' && (x.kind === 'text' ? typeof x.title === 'string' : x.kind === 'image' && typeof x.image === 'string' && /^data:image\/(png|jpeg);base64,/.test(x.image)))
    .map((x: CustomStamp) => ({ ...x, id: crypto.randomUUID() }));
}

const LS = 'cyantakeoff:stamps';
const load = (): CustomStamp[] => { try { return JSON.parse(localStorage.getItem(LS) ?? '[]'); } catch { return []; } };

export const useStamps = create<{ stamps: CustomStamp[] }>(() => ({ stamps: typeof localStorage === 'undefined' ? [] : load() }));

export function saveStamps(stamps: CustomStamp[]) {
  useStamps.setState({ stamps });
  try { localStorage.setItem(LS, JSON.stringify(stamps)); return true; } catch { return false; }
}
