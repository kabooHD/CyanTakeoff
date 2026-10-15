// Rubber-band selection (Revu Select tool): dragging left to right selects
// the markups entirely inside the rectangle, right to left those it touches.
import type { Pt } from './types';

export interface Box { minX: number; minY: number; maxX: number; maxY: number }

/** Normalised band rectangle and its mode from the drag's start and end. */
export function bandOf(start: Pt, cur: Pt): { box: Box; touch: boolean } {
  return {
    box: { minX: Math.min(start.x, cur.x), maxX: Math.max(start.x, cur.x), minY: Math.min(start.y, cur.y), maxY: Math.max(start.y, cur.y) },
    touch: cur.x < start.x,
  };
}

/** Whether a markup with bounds `mb` is picked by the band. */
export function inBand(mb: Box, band: Box, touch: boolean): boolean {
  if (touch) return mb.minX <= band.maxX && mb.maxX >= band.minX && mb.minY <= band.maxY && mb.maxY >= band.minY;
  return mb.minX >= band.minX && mb.maxX <= band.maxX && mb.minY >= band.minY && mb.maxY <= band.maxY;
}
