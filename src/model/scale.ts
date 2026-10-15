// Scaling markups (Revu): the purple handles at the corners of a polygon,
// polyline, cloud, pen or arc scale it about the opposite corner, keeping
// its proportions unless Shift is held. Rectangles and ellipses have no
// purple handles: Ctrl+drag a corner keeps their proportions instead.
import { bounds } from './measure';
import { mapped } from './markup';
import { ROTATION_FIELD } from './rotate';
import type { Markup, MarkupType, Pt } from './types';

const NO_SCALE = new Set<MarkupType>(['line', 'arrow', 'dimension', 'length', 'angle', 'radius', 'diameter', 'link', 'legend', 'caret', 'note', 'flag', 'attachment',
  'count', 'highlight', 'strikeout', 'underline', 'squiggly', 'redaction', 'stamp', 'image', 'textbox', 'typewriter', 'callout', 'cloudplus']);

/** Whether a markup gets purple scale handles. */
export const hasScaleHandles = (m: Pick<Markup, 'type' | 'points' | 'locked'>) => !NO_SCALE.has(m.type) && !ROTATION_FIELD.has(m.type) && !m.locked && m.points.length >= 2;

/** The four corners of the markup's box (top-left, top-right, bottom-right, bottom-left), pushed `out` page units outward so they sit clear of the yellow points. */
export function scaleHandles(m: Pick<Markup, 'points'>, out = 0): Pt[] {
  const b = bounds(m.points);
  return [{ x: b.minX - out, y: b.minY - out }, { x: b.maxX + out, y: b.minY - out }, { x: b.maxX + out, y: b.maxY + out }, { x: b.minX - out, y: b.maxY + out }];
}

/** The corner opposite handle `i`. */
export const oppositeCorner = (handles: Pt[], i: number) => handles[(i + 2) % 4];

/**
 * Scale factors for dragging the corner that was at `corner` to `p`, about
 * `fixed`: the same factor on both axes (the pointer's share of the
 * diagonal) unless `free`, never below a hair.
 */
export function scaleFactor(fixed: Pt, corner: Pt, p: Pt, free: boolean): { kx: number; ky: number } {
  const dx = corner.x - fixed.x, dy = corner.y - fixed.y;
  const min = 0.02;
  if (free) {
    return { kx: Math.abs(dx) < 1e-9 ? 1 : Math.max(min, (p.x - fixed.x) / dx), ky: Math.abs(dy) < 1e-9 ? 1 : Math.max(min, (p.y - fixed.y) / dy) };
  }
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-9) return { kx: 1, ky: 1 };
  const k = Math.max(min, ((p.x - fixed.x) * dx + (p.y - fixed.y) * dy) / len2);
  return { kx: k, ky: k };
}

/** The markup scaled by (kx, ky) about `fixed` (cutouts and curve handlebars follow). */
export function scaleAbout(m: Markup, fixed: Pt, kx: number, ky: number): Partial<Markup> {
  return mapped(m, (p) => ({ x: fixed.x + (p.x - fixed.x) * kx, y: fixed.y + (p.y - fixed.y) * ky }));
}

/** A dragged box corner moved so the box keeps the proportions it had (Ctrl+drag a rectangle corner). */
export function aspectCorner(fixed: Pt, orig: Pt, p: Pt): Pt {
  const w = orig.x - fixed.x, h = orig.y - fixed.y;
  if (Math.abs(w) < 1e-9 || Math.abs(h) < 1e-9) return p;
  const k = Math.max(0.02, ((p.x - fixed.x) * w + (p.y - fixed.y) * h) / (w * w + h * h));
  return { x: fixed.x + w * k, y: fixed.y + h * k };
}

/** The four corners of the box around several markups' points (same order as `scaleHandles`), pushed `out` outward. */
export function selectionCorners(ms: Pick<Markup, 'points'>[], out = 0): Pt[] {
  return scaleHandles({ points: ms.flatMap((m) => m.points) }, out);
}

/** True when the markups are all members of one Group. */
export const oneGroup = (ms: Pick<Markup, 'groupId'>[]) => ms.length > 1 && !!ms[0].groupId && ms.every((m) => m.groupId === ms[0].groupId);

/** Scale Appearance Properties for Grouped Markups (Revu): the line width and font size follow the scale factor. */
export function scaledStyle<S extends { width: number; fontSize: number }>(style: S, k: number): S {
  const r = (v: number) => Math.round(v * k * 100) / 100;
  return { ...style, width: r(style.width), fontSize: Math.max(1, r(style.fontSize)) };
}
