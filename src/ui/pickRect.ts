// Pick a rectangle on the sheet for a dialog (AutoMark regions...): the
// dialog hides, the user drags, the callback gets the page and corners.
import { useApp } from '../model/store';
import type { Pt } from '../model/types';

type Done = (docId: string, page: number, a: Pt, b: Pt) => void;
let pending: Done | null = null;

export function pickRect(status: string, done: Done) {
  pending = done;
  useApp.getState().setTool('region-pick');
  useApp.getState().setStatus(status);
}

/** Called by the Viewer when the rectangle is drawn. */
export function finishPickRect(docId: string, page: number, a: Pt, b: Pt) {
  const f = pending;
  pending = null;
  f?.(docId, page, a, b);
}
