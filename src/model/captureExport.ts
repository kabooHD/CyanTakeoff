// Markups List > Export Capture Media and Capture Summary (Revu): the
// photos embedded in the markups as files (named after the markup, unique)
// and as the rows of a report. Also the Legend column: the legends a
// markup appears in.
import { legendKey } from './legend';
import type { Markup } from './types';

export interface CaptureFile { name: string; bytes: Uint8Array; markup: Markup; index: number }

/** Bytes of a data: URL (base64). */
export function dataUrlBytes(url: string): Uint8Array {
  const i = url.indexOf(',');
  return Uint8Array.from(atob(i >= 0 ? url.slice(i + 1) : url), (c) => c.charCodeAt(0));
}

/** Every capture photo as a file; names are made unique with a counter. */
export function captureFiles(markups: Markup[]): CaptureFile[] {
  const out: CaptureFile[] = [];
  const used = new Map<string, number>();
  for (const m of markups) {
    (m.capture ?? []).forEach((c, index) => {
      const base = (c.name || `${m.subject || 'Markup'}.jpg`).replace(/[\\/:*?"<>|]+/g, '_');
      const n = used.get(base) ?? 0;
      used.set(base, n + 1);
      const name = n ? base.replace(/(\.[a-z0-9]+)?$/i, (ext) => ` (${n})${ext}`) : base;
      out.push({ name, bytes: dataUrlBytes(c.data), markup: m, index });
    });
  }
  return out;
}

/** Whether image bytes are a JPEG (else they are taken as PNG). */
export const isJpeg = (b: Uint8Array) => b.length > 2 && b[0] === 0xff && b[1] === 0xd8;

/** The Legend column: titles of the legends that list this markup (a legend row shows its own title). */
export function legendsOf(m: Markup, markups: Markup[]): string {
  if (m.type === 'legend') return m.legend?.title ?? 'Legend';
  const key = legendKey(m);
  return markups
    .filter((l) => l.type === 'legend' && l.legend && l.legend.keys.includes(key) && (l.legend.source === 'all' || l.page === m.page))
    .map((l) => l.legend!.title || 'Legend')
    .join(', ');
}
