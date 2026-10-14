// Batch > Apply Stamp: where a stamp goes on a page, from a corner/centre
// anchor and a margin (page space, y down).
import type { Pt } from './types';

export type StampAnchor = 'top-left' | 'top-center' | 'top-right' | 'middle-left' | 'center' | 'middle-right' | 'bottom-left' | 'bottom-center' | 'bottom-right';
export const STAMP_ANCHORS: StampAnchor[] = ['top-left', 'top-center', 'top-right', 'middle-left', 'center', 'middle-right', 'bottom-left', 'bottom-center', 'bottom-right'];

/** Centre point of a `w` × `h` stamp placed at `anchor` with `margin` from the page edges. */
export function stampPlacement(pageW: number, pageH: number, w: number, h: number, anchor: StampAnchor, margin: number): Pt {
  const [v, hz] = anchor === 'center' ? ['middle', 'center'] : anchor.split('-');
  const x = hz === 'left' ? margin + w / 2 : hz === 'right' ? pageW - margin - w / 2 : pageW / 2;
  const y = v === 'top' ? margin + h / 2 : v === 'bottom' ? pageH - margin - h / 2 : pageH / 2;
  return { x, y };
}
