// What the machine can afford: memory-based limits for low-end computers
// (4 GB laptops, older tablets). navigator.deviceMemory is reported by
// Chromium browsers (rounded, at most 8); elsewhere we assume a normal machine.

export function deviceMemoryGB(): number {
  const m = typeof navigator !== 'undefined' ? (navigator as unknown as { deviceMemory?: number }).deviceMemory : undefined;
  return typeof m === 'number' && m > 0 ? m : 8;
}

/** Bytes of file copies kept for undoing page operations (per document). */
export const undoBudget = (gb = deviceMemoryGB()) => Math.min(400, Math.max(96, gb * 48)) * 2 ** 20;

/** Canvas sizes (pixels) for the page being worked on and for the other pages shown. */
export function renderLimits(gb = deviceMemoryGB()): { base: number; tile: number } {
  if (gb <= 2) return { base: 3e6, tile: 1.2e6 };
  if (gb <= 4) return { base: 4.5e6, tile: 2e6 };
  return { base: 6e6, tile: 3e6 };
}

/**
 * How many of the oldest snapshots to drop so that at most `maxCount` remain
 * and their sizes fit `budget` (the newest one is always kept).
 */
export function overBudget(sizes: number[], budget: number, maxCount = 10): number {
  let drop = Math.max(0, sizes.length - maxCount);
  let total = sizes.slice(drop).reduce((a, b) => a + b, 0);
  while (drop < sizes.length - 1 && total > budget) { total -= sizes[drop]; drop++; }
  return drop;
}
