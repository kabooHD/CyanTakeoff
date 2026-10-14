// Autosize Text Box (Revu, Alt+Z): fit a text box or callout box to its text.
import { bounds } from './measure';
import type { Markup, Pt } from './types';

/**
 * The text box of a text markup sized to its text, top-left corner kept.
 * `width(line, size)` measures a line of text in points.
 */
export function autosizedBox(m: Markup, width: (text: string, size: number) => number): [Pt, Pt] | null {
  const box = m.type === 'callout' ? [m.points[1], m.points[2]] : m.type === 'textbox' ? [m.points[0], m.points[1]] : null;
  if (!box?.[0] || !box[1]) return null;
  const b = bounds(box);
  const lines = (m.text ?? '').split('\n');
  const size = m.style.fontSize;
  // As drawn (.markup-text): 3 pt side padding, 2 pt top and bottom, line height 1.15, plus the border.
  const w = Math.max(size, ...lines.map((l) => width(l, size))) + 6 + m.style.width * 2 + 2;
  const h = lines.length * size * 1.15 + 4 + m.style.width * 2 + 2;
  return [{ x: b.minX, y: b.minY }, { x: b.minX + w, y: b.minY + h }];
}

/** The markup's points with its text box replaced by `box`. */
export function withBox(m: Markup, box: [Pt, Pt]): Pt[] {
  return m.type === 'callout' ? [m.points[0], box[0], box[1]] : box;
}
