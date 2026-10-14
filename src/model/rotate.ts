// Markup rotation (Revu): the orange handle above a selected markup turns
// it in 15° steps (Shift: any angle). Shapes made of points are rotated
// point by point; box shapes (rectangle, ellipse, text boxes, stamps,
// images) keep a `rotation` in degrees (counter-clockwise), drawn as a
// transform and saved as a matrix in the appearance. Lines cannot rotate.
import { bounds } from './measure';
import { mapped } from './markup';
import type { Markup, MarkupType, Pt } from './types';

/** Types that keep a rotation angle (their geometry is an axis-aligned box). */
export const ROTATION_FIELD = new Set<MarkupType>(['rectangle', 'ellipse', 'textbox', 'callout', 'typewriter', 'stamp', 'image', 'cloudplus']);
/** Types that cannot be turned: two-point lines and text/page-bound markups. */
const FIXED = new Set<MarkupType>(['line', 'arrow', 'dimension', 'length', 'angle', 'radius', 'diameter', 'link', 'legend', 'caret', 'note', 'flag', 'attachment',
  'count', 'highlight', 'strikeout', 'underline', 'squiggly', 'redaction']);

export const canRotate = (m: Pick<Markup, 'type' | 'points' | 'locked'>) => !FIXED.has(m.type) && !m.locked && m.points.length >= 2;

/** Angle normalised to (-180, 180]. */
export const normDeg = (d: number) => { let r = ((d % 360) + 360) % 360; if (r > 180) r -= 360; return Math.round(r * 10) / 10; };

/** Rotation snapped to 15° steps unless free; 0 when within a step of nothing. */
export const snapRotation = (deg: number, free: boolean) => normDeg(free ? Math.round(deg) : Math.round(deg / 15) * 15);

/** Centre of rotation: the middle of the markup's box. */
export function rotationCenter(m: Pick<Markup, 'points'>): Pt {
  const b = bounds(m.points);
  return { x: b.minX + b.w / 2, y: b.minY + b.h / 2 };
}

/** `p` turned by `deg` counter-clockwise (page space, y down) about `c`. */
export function rotatePt(p: Pt, c: Pt, deg: number): Pt {
  const a = (deg * Math.PI) / 180, cs = Math.cos(a), sn = Math.sin(a);
  const dx = p.x - c.x, dy = p.y - c.y;
  return { x: c.x + dx * cs + dy * sn, y: c.y - dx * sn + dy * cs };
}

/** The markup turned by `deg` (counter-clockwise) about its centre: new points, or a new rotation angle for box shapes. */
export function rotated(m: Markup, deg: number): Partial<Markup> {
  if (!deg) return {};
  if (ROTATION_FIELD.has(m.type)) return { rotation: normDeg((m.rotation ?? 0) + deg) || undefined };
  const c = rotationCenter(m);
  return mapped(m, (p) => rotatePt(p, c, deg));
}

/** The markup set to an absolute angle (box shapes only; others turn by the difference from 0). */
export function withRotation(m: Markup, deg: number): Partial<Markup> {
  return ROTATION_FIELD.has(m.type) ? { rotation: normDeg(deg) || undefined } : rotated(m, deg);
}

/** Points of a box shape as drawn (turned about the centre) — for hit tests, bounds and handles. */
export function drawnPoints(m: Pick<Markup, 'type' | 'points' | 'rotation'>, pts: Pt[] = m.points): Pt[] {
  if (!m.rotation || !ROTATION_FIELD.has(m.type)) return pts;
  const c = rotationCenter(m);
  return pts.map((p) => rotatePt(p, c, m.rotation!));
}

/** A pointer position in the markup's own (unturned) frame. */
export function unrotatePt(m: Pick<Markup, 'type' | 'points' | 'rotation'>, p: Pt): Pt {
  if (!m.rotation || !ROTATION_FIELD.has(m.type)) return p;
  return rotatePt(p, rotationCenter(m), -m.rotation);
}

/** Where the rotate handle sits: above the top edge of the (turned) box, `gap` page units away. */
export function rotateHandle(m: Pick<Markup, 'type' | 'points' | 'rotation'>, gap: number): { at: Pt; from: Pt } {
  const c = rotationCenter(m);
  const b = bounds(m.points);
  const deg = ROTATION_FIELD.has(m.type) ? m.rotation ?? 0 : 0;
  const top = rotatePt({ x: c.x, y: b.minY }, c, deg);
  const at = rotatePt({ x: c.x, y: b.minY - gap }, c, deg);
  return { at, from: top };
}

/** Pointer angle about `c` in degrees (counter-clockwise, page space). */
export const angleAbout = (c: Pt, p: Pt) => (-Math.atan2(p.y - c.y, p.x - c.x) * 180) / Math.PI;
