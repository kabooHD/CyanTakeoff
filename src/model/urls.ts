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
