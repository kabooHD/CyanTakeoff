// Words in text for spell checking, and replacing one in place.

export interface Word { word: string; start: number; end: number }

/** Words to check: letters with inner apostrophes; numbers, codes (A-101) and web/email addresses are skipped. */
export function words(text: string): Word[] {
  const out: Word[] = [];
  // Web and email addresses (whitespace-separated runs) are not words.
  const skip: [number, number][] = [];
  for (const m of text.matchAll(/\S+/g)) {
    if (/@|:\/\/|^www\.|\p{L}\.\p{L}{2,}/u.test(m[0])) skip.push([m.index!, m.index! + m[0].length]);
  }
  const re = /[\p{L}][\p{L}'’]*/gu;
  for (const m of text.matchAll(re)) {
    const start = m.index!, end = start + m[0].length;
    if (skip.some(([a, b]) => start >= a && start < b)) continue;
    const before = text[start - 1] ?? '', after = text[end] ?? '';
    // Part of a code or address: touching digits, '@', '/', '.', '_' or '-' followed by a digit.
    if (/[\d@_/\\]/.test(before) || /[\d@_/\\]/.test(after)) continue;
    if ((before === '-' && /\d/.test(text[start - 2] ?? '')) || (after === '-' && /\d/.test(text[end + 1] ?? ''))) continue;
    const w = m[0].replace(/['’]+$/, '');
    if (w.length < 2) continue;
    out.push({ word: w, start, end: start + w.length });
  }
  return out;
}

/** Replace the word at [start, end) with `by`. */
export const replaceAt = (text: string, start: number, end: number, by: string) => text.slice(0, start) + by + text.slice(end);

/** Replace every whole-word `word` with `by`. */
export function replaceAll(text: string, word: string, by: string): string {
  let out = text;
  for (const w of words(text).reverse()) if (w.word === word) out = replaceAt(out, w.start, w.end, by);
  return out;
}
