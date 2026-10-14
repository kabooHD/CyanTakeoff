// AutoCAD hatch pattern files (.pat), which Revu imports into its Hatch
// list. A pattern is a header "*NAME, description" followed by line
// families: "angle, x, y, dx, dy [, dash, gap, ...]" where successive lines
// of the family are offset by dx along the line and dy across it, and the
// dashes (positive), gaps (negative) and dots (0) repeat along each line.
// We turn each pattern into our tile (HatchDef): a rectangle sized so the
// line spacings repeat exactly, with the lines of every family clipped to it.
import type { HatchDef } from './lineStyles';

export interface PatFamily { angle: number; x: number; y: number; dx: number; dy: number; dashes: number[] }
export interface PatPattern { name: string; description: string; families: PatFamily[] }

/** Parse a .pat file (one or many patterns). Comment lines start with ";". */
export function parsePat(text: string): PatPattern[] {
  const out: PatPattern[] = [];
  let cur: PatPattern | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/;.*$/, '').trim();
    if (!line) continue;
    if (line.startsWith('*')) {
      const m = /^\*([^,]+),?\s*(.*)$/.exec(line)!;
      cur = { name: m[1].trim(), description: m[2].trim(), families: [] };
      out.push(cur);
      continue;
    }
    if (!cur) continue;
    const nums = line.split(/[\s,]+/).filter(Boolean).map(Number);
    if (nums.length < 5 || nums.some((n) => !Number.isFinite(n))) continue;
    const [angle, x, y, dx, dy, ...dashes] = nums;
    if (!dy) continue; // lines on top of each other
    cur.families.push({ angle, x, y, dx, dy, dashes });
  }
  return out.filter((p) => p.families.length);
}

/** Units of a .pat file: metric files (acadiso.pat) space lines millimetres apart, imperial ones fractions of an inch. */
export function guessPatUnits(p: PatPattern): 'in' | 'mm' {
  const spacings = p.families.map((f) => Math.abs(f.dy)).sort((a, b) => a - b);
  return spacings[spacings.length >> 1] > 1 ? 'mm' : 'in';
}

/** Smallest multiple (up to `maxK`) of each period that all agree on, within 1%; null when there is none. */
function commonPeriod(periods: number[], maxK = 12): number | null {
  const ps = periods.filter((p) => Number.isFinite(p) && p > 0);
  if (!ps.length) return null;
  const base = Math.max(...ps);
  for (let k = 1; k <= maxK; k++) {
    const S = base * k;
    if (ps.every((p) => { const m = S / p; return Math.abs(m - Math.round(m)) < 0.01; })) return S;
  }
  return null;
}

const EPS = 1e-9;

/**
 * Convert a pattern to a hatch tile. `unit` is the size of one drawing unit
 * in points (72 for inches, 72/25.4 for millimetres). A family whose lines
 * cannot repeat in the tile (an angle like 30° mixed with 45°) is clipped to
 * it anyway, so the pattern still looks right at a glance.
 */
export function patToHatch(p: PatPattern, unit: number, id = `pat-${p.name.toLowerCase()}`): HatchDef {
  const fams = p.families.map((f) => {
    const a = (f.angle * Math.PI) / 180;
    return { ...f, ux: Math.cos(a), uy: Math.sin(a), nx: -Math.sin(a), ny: Math.cos(a), dy: Math.abs(f.dy) };
  });
  // Tile periods: a family at angle θ with spacing d repeats every d/|sin θ| in x and d/|cos θ| in y.
  const px = fams.map((f) => (Math.abs(f.uy) > EPS ? f.dy / Math.abs(f.uy) : Infinity));
  const py = fams.map((f) => (Math.abs(f.ux) > EPS ? f.dy / Math.abs(f.ux) : Infinity));
  const fallback = Math.max(...fams.map((f) => f.dy)) * 4;
  // A period of Infinity (horizontal lines in x, vertical in y) accepts any size.
  let Sx = commonPeriod(px) ?? fallback;
  let Sy = commonPeriod(py) ?? fallback;
  // Dashed families: grow the tile (up to 6×) so the dash period along the lines repeats too, when that is cheap.
  const L = (f: PatFamily) => f.dashes.reduce((s, d) => s + Math.abs(d), 0);
  for (const f of fams) {
    const len = L(f);
    if (!len) continue;
    const along = (sx: number, sy: number) => Math.abs(sx * f.ux) + Math.abs(sy * f.uy);
    for (let k = 1; k <= 6; k++) {
      const m = along(Sx * k, Sy * k) / len;
      if (Math.abs(m - Math.round(m)) < 0.02) { Sx *= k; Sy *= k; break; }
    }
  }
  const W = Sx * unit, H = Sy * unit;
  const lines: HatchDef['lines'] = [];
  const dots: HatchDef['dots'] = [];
  const toTile = (x: number, y: number): [number, number] => [x / Sx, 1 - y / Sy];
  // Clip the line base + s·u to the tile; returns the s range.
  const clip = (bx: number, by: number, ux: number, uy: number): [number, number] | null => {
    let s0 = -Infinity, s1 = Infinity;
    for (const [b, u, S] of [[bx, ux, Sx], [by, uy, Sy]] as const) {
      if (Math.abs(u) < EPS) { if (b < -EPS || b > S + EPS) return null; continue; }
      const a = (0 - b) / u, c = (S - b) / u;
      s0 = Math.max(s0, Math.min(a, c)); s1 = Math.min(s1, Math.max(a, c));
    }
    return s1 - s0 > EPS ? [s0, s1] : null;
  };
  let budget = 4000;
  for (const f of fams) {
    // Offsets of the tile corners along the normal.
    const corners = [[0, 0], [Sx, 0], [0, Sy], [Sx, Sy]].map(([x, y]) => x * f.nx + y * f.ny);
    const c0 = f.x * f.nx + f.y * f.ny;
    const kMin = Math.ceil((Math.min(...corners) - c0) / f.dy - 1e-6), kMax = Math.floor((Math.max(...corners) - c0) / f.dy + 1e-6);
    const len = L(f);
    for (let k = kMin; k <= kMax && budget > 0; k++) {
      const bx = f.x + k * (f.dx * f.ux + f.dy * f.nx), by = f.y + k * (f.dx * f.uy + f.dy * f.ny);
      const r = clip(bx, by, f.ux, f.uy);
      if (!r) continue;
      const seg = (s0: number, s1: number) => {
        const [x1, y1] = toTile(bx + s0 * f.ux, by + s0 * f.uy), [x2, y2] = toTile(bx + s1 * f.ux, by + s1 * f.uy);
        lines.push([x1, y1, x2, y2]); budget--;
      };
      if (!len) { seg(r[0], r[1]); continue; }
      // Dashes repeat along the line from its base point.
      for (let j = Math.floor(r[0] / len); j * len < r[1] && budget > 0; j++) {
        let s = j * len;
        for (const d of f.dashes) {
          if (d === 0) {
            if (s >= r[0] - EPS && s <= r[1] + EPS) { const [x, y] = toTile(bx + s * f.ux, by + s * f.uy); dots.push([x, y, 0.5 / Math.max(W, 1)]); budget--; }
            continue;
          }
          if (d > 0) { const a = Math.max(s, r[0]), b = Math.min(s + d, r[1]); if (b - a > EPS) seg(a, b); }
          s += Math.abs(d);
        }
      }
    }
  }
  const round = (v: number) => Math.round(v * 1e4) / 1e4;
  return {
    id, name: p.description ? `${p.name} (${p.description})` : p.name, size: round(W), aspect: round(H / W),
    lines: lines.map((l) => l.map(round) as HatchDef['lines'][number]), dots: dots.map((d) => d.map(round) as HatchDef['dots'][number]),
  };
}
