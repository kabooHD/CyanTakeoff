// Custom stamps (Revu Stamp > Create Stamp / Import): text stamps with a
// title and a subtitle template ({Author}, {Date}, {Time}, {DateTime}), and
// image stamps. Kept in this browser; export/import as JSON to share them.
import { create } from 'zustand';

export type StampTemplate = 'blank' | 'text' | 'border' | 'dateBorder' | 'rounded';
export type StampBorder = 'none' | 'rect' | 'rounded';

export interface CustomStamp {
  id: string;
  name: string;
  kind: 'text' | 'image';
  /** Text stamps: the big line and the small template line. */
  title?: string;
  subtitle?: string;
  color?: string;
  /** Create Stamp: the template it was made from, its border, and its opacity (0..1). */
  template?: StampTemplate;
  border?: StampBorder;
  opacity?: number;
  /** Image stamps: PNG/JPEG data URL and its size in points. */
  image?: string;
  w?: number;
  h?: number;
}

export const DEFAULT_SUBTITLE = '{Author} {Date}';

/** Revu's dynamic text, by group (the token is typed in braces). */
export const STAMP_TOKENS: { group: string; tokens: string[] }[] = [
  { group: 'File and user', tokens: ['User', 'File', 'FileName', 'Path'] },
  { group: 'Date', tokens: ['Date', 'Day', 'Month', 'Month3', 'MonthName', 'Year', 'Year2'] },
  { group: 'Time', tokens: ['Time', 'Hour', 'Minutes', 'Seconds', 'DateTime'] },
];

/** Fill a subtitle template with the dynamic text. Unknown tokens are left as typed. */
export function stampText(template: string, v: { author: string; date: Date; file?: string }): string {
  const d = v.date;
  const two = (n: number) => String(n).padStart(2, '0');
  const file = v.file ?? '';
  const tokens: Record<string, string> = {
    author: v.author, user: v.author,
    file, filename: file.replace(/\.[^.]+$/, ''), path: file,
    date: d.toLocaleDateString(),
    time: d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    datetime: `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
    day: two(d.getDate()), month: two(d.getMonth() + 1), month3: d.toLocaleString('en', { month: 'short' }), monthname: d.toLocaleString('en', { month: 'long' }),
    year: String(d.getFullYear()), year2: String(d.getFullYear()).slice(-2),
    hour: two(d.getHours()), minutes: two(d.getMinutes()), seconds: two(d.getSeconds()),
  };
  return template.replace(/\{(\w+)\}/g, (all, k: string) => tokens[k.toLowerCase()] ?? all);
}

export const STAMP_TEMPLATES: { id: StampTemplate; name: string }[] = [
  { id: 'blank', name: 'Blank' }, { id: 'text', name: 'Text' }, { id: 'border', name: 'Text with Border' },
  { id: 'dateBorder', name: 'Text with Date and Border' }, { id: 'rounded', name: 'Text with Rounded Border' },
];

/** What a template puts in a new stamp (Revu: most add the Subject text, some a date and a border). */
export function templateDefaults(t: StampTemplate, subject: string): Pick<CustomStamp, 'title' | 'subtitle' | 'border'> {
  switch (t) {
    case 'blank': return { title: '', subtitle: '', border: 'none' };
    case 'text': return { title: subject, subtitle: '', border: 'none' };
    case 'border': return { title: subject, subtitle: '', border: 'rect' };
    case 'dateBorder': return { title: subject, subtitle: '{Date}', border: 'rect' };
    case 'rounded': return { title: subject, subtitle: '', border: 'rounded' };
  }
}

/** Default size of a text stamp in points (Revu: inches in the dialog). */
export const DEFAULT_STAMP_SIZE = { w: 160, h: 50 };

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
