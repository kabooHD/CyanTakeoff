// Presentation preferences (Revu, Preferences > Window > Presentation):
// Loop after last page, Auto advance every N seconds, background colour,
// mouse cursor (shown, hidden, or hidden after a pause).

/** The page `n` lands on, kept inside the document, or wrapped around when `loop` is on. */
export function wrapPage(n: number, count: number, loop: boolean): number {
  if (count <= 0) return 0;
  if (loop) return ((n % count) + count) % count;
  return Math.max(0, Math.min(count - 1, n));
}
