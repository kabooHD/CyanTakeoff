// Blend Mode (Revu: Properties > Appearance): how a markup combines with
// the content under it; the standard PDF blend modes (/BM in the
// appearance's graphics state). Highlights multiply by default and stamps
// darken, as in Revu; everything else is Normal.
import type { Markup, MarkupType } from './types';

export const BLEND_MODES = ['Normal', 'Multiply', 'Screen', 'Overlay', 'Darken', 'Lighten', 'ColorDodge', 'ColorBurn', 'HardLight', 'SoftLight', 'Difference', 'Exclusion', 'Hue', 'Saturation', 'Color', 'Luminosity'] as const;
export type BlendMode = (typeof BLEND_MODES)[number];

/** The mode a markup type uses when none is set. */
export const defaultBlend = (type: MarkupType): BlendMode => (type === 'highlight' ? 'Multiply' : type === 'stamp' ? 'Darken' : 'Normal');

/** The effective blend mode of a markup. */
export const blendOf = (m: Pick<Markup, 'type' | 'style'>): BlendMode => m.style.blend ?? defaultBlend(m.type);

/** CSS mix-blend-mode keyword for a PDF blend mode name ('normal' for Normal). */
export const cssBlend = (mode: BlendMode): string => mode.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();

/** The PDF name read from a file as a blend mode, if it is one. */
export const blendOfName = (name: string | undefined): BlendMode | undefined =>
  (BLEND_MODES as readonly string[]).includes(name ?? '') ? (name as BlendMode) : name === 'Compatible' ? 'Normal' : undefined;
