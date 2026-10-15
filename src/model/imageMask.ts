// Image markups (Revu: Properties > Mask Color / Mask Tolerance): pixels
// close to the mask colour become transparent so the content shows through
// the image's background, as with a logo on white.

export interface ImageMask { color: string; /** 0..100 */ tolerance: number }

const hexRgb = (hex: string): [number, number, number] => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1], 16) : 0xffffff;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** Whether a pixel is within the tolerance of the mask colour (tolerance 100 = any colour). */
export function withinMask(r: number, g: number, b: number, mask: [number, number, number], tolerance: number): boolean {
  const limit = (Math.max(0, Math.min(100, tolerance)) / 100) * 441.68; // the longest RGB distance
  const d = Math.hypot(r - mask[0], g - mask[1], b - mask[2]);
  return d <= limit + 1e-9;
}

/** The RGBA pixels with the masked colour made transparent (returns how many pixels changed). */
export function applyMask(rgba: Uint8ClampedArray, mask: ImageMask): number {
  const c = hexRgb(mask.color);
  let n = 0;
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i + 3] !== 0 && withinMask(rgba[i], rgba[i + 1], rgba[i + 2], c, mask.tolerance)) { rgba[i + 3] = 0; n++; }
  }
  return n;
}
