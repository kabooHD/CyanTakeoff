// Tool Chest behaviour (Revu): a tool set with a scale places its Drawing
// mode tools resized for the drawing's scale; a Properties mode tool
// applied to selected markups copies its appearance and, per Comment
// Persistence, its comment.
import type { Markup, MarkupStyle, Pt, Scale } from './types';

export type CommentPersistence = 'none' | 'excludeText' | 'all';
export interface ToolChestPrefs { commentPersistence: CommentPersistence; updateOnReuse: boolean; maxRecents: number; size: number }
export const DEFAULT_TOOL_CHEST: ToolChestPrefs = { commentPersistence: 'excludeText', updateOnReuse: false, maxRecents: 12, size: 1 };

/** Factor that keeps a tool drawn at `toolScale` (units per point) the same real size on a page at `pageScale`. */
export function toolScaleFactor(toolScale: Scale | undefined, pageScale: Scale | null | undefined): number {
  if (!toolScale || !pageScale || !toolScale.factor || !pageScale.factor) return 1;
  return toolScale.factor / pageScale.factor;
}

/** Points scaled by `k` about their centre. */
export function scaledPoints(points: Pt[], k: number): Pt[] {
  if (k === 1 || !points.length) return points;
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  return points.map((p) => ({ x: cx + (p.x - cx) * k, y: cy + (p.y - cy) * k }));
}

const TEXTUAL = new Set(['textbox', 'callout', 'typewriter', 'cloudplus']);

/** The patch a Properties mode tool applies to a selected markup. */
export function applyToolProperties(m: Markup, tool: { style: MarkupStyle; subject: string; markup?: { comment?: string } }, persistence: CommentPersistence): Partial<Markup> {
  const patch: Partial<Markup> = { style: { ...m.style, ...tool.style } };
  const comment = tool.markup?.comment;
  if (comment && (persistence === 'all' || (persistence === 'excludeText' && !TEXTUAL.has(m.type)))) patch.comment = comment;
  return patch;
}
