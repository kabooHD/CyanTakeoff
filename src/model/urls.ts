// Web addresses and emails in a run of text (Create Hyperlinks from URLs).
export interface UrlHit { start: number; end: number; uri: string }

const RE = /\b(?:(https?:\/\/|ftp:\/\/)[^\s<>"')\]]+|www\.[^\s<>"')\]]+|[\w.+-]+@[\w-]+(?:\.[\w-]+)+)/gi;

/** URLs (also bare www.) and emails with their character ranges and the address to open. */
export function findUrls(text: string): UrlHit[] {
  const out: UrlHit[] = [];
  for (const m of text.matchAll(RE)) {
    let s = m[0];
    // Trailing punctuation belongs to the sentence, not the address.
    while (/[.,;:!?]$/.test(s)) s = s.slice(0, -1);
    if (s.length < 4) continue;
    const uri = /^[a-z]+:\/\//i.test(s) ? s : s.includes('@') ? `mailto:${s}` : `https://${s}`;
    out.push({ start: m.index!, end: m.index! + s.length, uri });
  }
  return out;
}

/** A clickable address on the page (Find Hyperlinks in PDF Content). */
export interface UrlRect { x0: number; y0: number; x1: number; y1: number; uri: string }

/**
 * Where the addresses in the page's text runs are. A run's characters are
 * taken as evenly spaced (horizontal text), so an address covers its share
 * of the run's width.
 */
export function urlRects(boxes: { x0: number; y0: number; x1: number; y1: number; str: string }[]): UrlRect[] {
  const out: UrlRect[] = [];
  for (const b of boxes) {
    const len = b.str.length;
    if (!len) continue;
    for (const u of findUrls(b.str)) {
      out.push({ x0: b.x0 + ((b.x1 - b.x0) * u.start) / len, x1: b.x0 + ((b.x1 - b.x0) * u.end) / len, y0: b.y0, y1: b.y1, uri: u.uri });
    }
  }
  return out;
}

/** The address under a point, within `tol` of its box. */
export function urlAt(rects: UrlRect[], p: { x: number; y: number }, tol = 0): UrlRect | null {
  return rects.find((r) => p.x >= Math.min(r.x0, r.x1) - tol && p.x <= Math.max(r.x0, r.x1) + tol && p.y >= Math.min(r.y0, r.y1) - tol && p.y <= Math.max(r.y0, r.y1) + tol) ?? null;
}
