// Slip Sheet (Revu Document / Batch > Slip Sheet): which revised pages go
// over which current pages, and where the current pages end up when the
// revised ones are inserted in front of them.
import { matchKey } from './batchPairs';

export type SlipMatch = 'label' | 'index';
export interface SlipPair { src: number; at: number }

/**
 * Pairs of (revised page, current page). By page label the labels are
 * compared through the match filter (wildcards); by index page n goes over
 * page n. Revised pages with no match are `extra`.
 */
export function slipPlan(currentLabels: string[], revisedLabels: string[], by: SlipMatch, filter = ''): { matched: SlipPair[]; extra: number[] } {
  const matched: SlipPair[] = [], extra: number[] = [];
  const used = new Set<number>();
  revisedLabels.forEach((label, src) => {
    let at = -1;
    if (by === 'index') at = src < currentLabels.length ? src : -1;
    else {
      const key = matchKey(label, filter);
      at = key ? currentLabels.findIndex((l, i) => !used.has(i) && matchKey(l, filter) === key) : -1;
    }
    if (at >= 0) { matched.push({ src, at }); used.add(at); } else extra.push(src);
  });
  return { matched, extra };
}

/**
 * After inserting a revised page in front of each matched current page,
 * the index the current page that was at `at` now has.
 */
export const supersededIndex = (at: number, matched: SlipPair[]) => at + 1 + matched.filter((m) => m.at < at).length;

/** Rows for the Slip Sheet report. */
export function slipReportRows(currentLabels: string[], revisedLabels: string[], plan: ReturnType<typeof slipPlan>, mode: 'replace' | 'insert'): { current: string; revised: string; result: string }[] {
  return [
    ...plan.matched.map((m) => ({ current: currentLabels[m.at], revised: revisedLabels[m.src], result: mode === 'insert' ? 'inserted before' : 'replaced' })),
    ...plan.extra.map((src) => ({ current: '', revised: revisedLabels[src], result: 'no match' })),
  ];
}
