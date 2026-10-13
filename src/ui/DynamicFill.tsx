// Revu's Dynamic Fill (J): flood-fill rooms on the drawing's content layer,
// optionally limited by temporary boundaries, then create measurements
// (and Spaces) from the filled outline.
import { useEffect, useRef } from 'react';
import { create } from 'zustand';
import type { PDFPageProxy } from 'pdfjs-dist';
import { Flood, dilate, drawWall, simplifyClosed, traceRegion, type Grid } from '../model/fill';
import { pointInPolygon, polygonArea, signedArea } from '../model/measure';
import { useApp } from '../model/store';
import type { MarkupType, Pt } from '../model/types';
import { toolById } from '../tools/tools';

/** Pixel budget for the content mask (memory and speed). */
const MAX_CELLS = 8_000_000;
const SPEEDS = { Slow: 1_500, Medium: 6_000, Fast: 40_000 } as const;
const SENSITIVITY = { Low: { lum: 96, grow: 0 }, Medium: { lum: 190, grow: 0 }, High: { lum: 235, grow: 1 } } as const;
export type CreateKind = 'space' | 'polygon' | 'area' | 'polylength' | 'perimeter' | 'volume';
export const CREATE_KINDS: { id: CreateKind; label: string }[] = [
  { id: 'space', label: 'Space' }, { id: 'polygon', label: 'Polygon' }, { id: 'area', label: 'Area' },
  { id: 'polylength', label: 'Polylength' }, { id: 'perimeter', label: 'Perimeter' }, { id: 'volume', label: 'Volume' },
];

interface FillState {
  mode: 'fill' | 'boundary';
  key: string; // doc id + page the mask belongs to
  /** cells per page point */
  k: number;
  base: Grid | null; // content walls only
  mask: Grid | null; // content walls + temporary boundaries
  flood: Flood | null;
  boundaries: Pt[][]; // page space
  draftBoundary: Pt[];
  create: Record<CreateKind, boolean>;
  sensitivity: keyof typeof SENSITIVITY;
  speed: keyof typeof SPEEDS;
  boundarySize: number; // page points
  color: string;
  spaceName: string;
  tick: number; // bumps to repaint
  loading: boolean;
}

export const useFill = create<FillState>(() => ({
  mode: 'fill', key: '', k: 1, base: null, mask: null, flood: null, boundaries: [], draftBoundary: [],
  create: { space: false, polygon: false, area: true, polylength: false, perimeter: false, volume: false },
  sensitivity: 'Medium', speed: 'Medium', boundarySize: 2, color: '#00a0ff', spaceName: 'Space', tick: 0, loading: false,
}));

const bump = () => useFill.setState((s) => ({ tick: s.tick + 1 }));

/** Render the page's content layer (no annotations) and mark dark pixels as walls. */
export async function buildMask(pdfPage: PDFPageProxy, key: string) {
  const st = useFill.getState();
  if (st.key === key && st.base) return;
  useFill.setState({ loading: true, key, base: null, mask: null, flood: null, boundaries: [], draftBoundary: [] });
  const vp1 = pdfPage.getViewport({ scale: 1 });
  const k = Math.min(3, Math.sqrt(MAX_CELLS / (vp1.width * vp1.height)));
  const vp = pdfPage.getViewport({ scale: k });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  await pdfPage.render({ canvas, viewport: vp, annotationMode: 0 }).promise;
  if (useFill.getState().key !== key) return;
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const sens = SENSITIVITY[useFill.getState().sensitivity];
  const data = new Uint8Array(canvas.width * canvas.height);
  for (let i = 0; i < data.length; i++) {
    const lum = 0.299 * img[i * 4] + 0.587 * img[i * 4 + 1] + 0.114 * img[i * 4 + 2];
    data[i] = lum < sens.lum ? 1 : 0;
  }
  const base = dilate({ w: canvas.width, h: canvas.height, data }, sens.grow);
  useFill.setState({ k, base, mask: { ...base, data: new Uint8Array(base.data) }, flood: null, loading: false });
  bump();
}

/** Rebuild the effective mask from content + boundaries (after clearing boundaries). */
function rebuildMask() {
  const st = useFill.getState();
  if (!st.base) return;
  const mask = { ...st.base, data: new Uint8Array(st.base.data) };
  for (const b of st.boundaries) drawWall(mask, b.map((p) => ({ x: p.x * st.k, y: p.y * st.k })), (st.boundarySize * st.k) / 2);
  const flood = st.flood ? new Flood(mask, st.flood.filled) : null;
  useFill.setState({ mask, flood });
}

export function resetFill() {
  useFill.setState({ key: '', base: null, mask: null, flood: null, boundaries: [], draftBoundary: [], mode: 'fill' });
}

// ---------- pointer handling (called by the Viewer while the tool is active) ----------

let raf = 0;
let holding = false;
let path: Pt[] = [];

function grow() {
  const st = useFill.getState();
  if (!st.flood || !holding) { raf = 0; return; }
  st.flood.step(SPEEDS[st.speed]);
  bump();
  raf = requestAnimationFrame(grow);
}

export function fillDown(p: Pt) {
  const st = useFill.getState();
  if (!st.mask) return;
  if (st.mode === 'boundary') {
    useFill.setState({ draftBoundary: [...st.draftBoundary, p] });
    return;
  }
  const flood = st.flood ?? new Flood(st.mask);
  if (!st.flood) useFill.setState({ flood });
  holding = true;
  path = [p];
  flood.seed(p.x * st.k, p.y * st.k);
  if (!raf) raf = requestAnimationFrame(grow);
}

export function fillMove(p: Pt) {
  const st = useFill.getState();
  if (st.mode === 'boundary') { if (st.draftBoundary.length) bump(); return; }
  if (!holding || !st.flood) return;
  // Dragging spreads the fill from the cursor too.
  path.push(p);
  st.flood.seed(p.x * st.k, p.y * st.k);
}

export function fillUp() {
  const st = useFill.getState();
  if (!holding) return;
  holding = false;
  // Encircling: everything inside a closed cursor path is filled, even across boundaries.
  if (st.flood && st.mask && path.length > 8) {
    const a = path[0], b = path[path.length - 1];
    const span = Math.max(...path.map((q) => Math.hypot(q.x - a.x, q.y - a.y)));
    if (Math.hypot(b.x - a.x, b.y - a.y) < span * 0.25) {
      const xs = path.map((q) => q.x), ys = path.map((q) => q.y);
      const { w, h } = st.mask;
      for (let y = Math.max(0, Math.floor(Math.min(...ys) * st.k)); y < Math.min(h, Math.ceil(Math.max(...ys) * st.k)); y++) {
        for (let x = Math.max(0, Math.floor(Math.min(...xs) * st.k)); x < Math.min(w, Math.ceil(Math.max(...xs) * st.k)); x++) {
          if (pointInPolygon({ x: (x + 0.5) / st.k, y: (y + 0.5) / st.k }, path)) st.flood.filled[y * w + x] = 1;
        }
      }
    }
  }
  path = [];
  bump();
}

/** Finish the boundary being drawn (double-click or Enter). */
export function finishBoundary() {
  const st = useFill.getState();
  if (st.draftBoundary.length < 2 || !st.mask) { useFill.setState({ draftBoundary: [] }); return; }
  const b = st.draftBoundary;
  drawWall(st.mask, b.map((p) => ({ x: p.x * st.k, y: p.y * st.k })), (st.boundarySize * st.k) / 2);
  useFill.setState({ boundaries: [...st.boundaries, b], draftBoundary: [] });
}

export function clearFill(what: 'all' | 'fill' | 'boundaries') {
  if (what !== 'boundaries') useFill.setState({ flood: null });
  if (what !== 'fill') { useFill.setState({ boundaries: [], draftBoundary: [] }); rebuildMask(); }
  bump();
}

/** Outlines of the current fill in page space: outer rings with their holes. */
export function fillOutlines(): { outer: Pt[]; holes: Pt[][] }[] {
  const st = useFill.getState();
  if (!st.flood || !st.mask) return [];
  const loops = traceRegion(st.flood.filled, st.mask.w, st.mask.h)
    .map((l) => simplifyClosed(l, 1).map((p) => ({ x: p.x / st.k, y: p.y / st.k })));
  const outers = loops.filter((l) => signedArea(l) > 0);
  const holes = loops.filter((l) => signedArea(l) < 0);
  return outers.map((outer) => {
    const area = polygonArea(outer);
    // Room labels and hatching leave small pockets; only larger holes (columns, shafts) are kept.
    const minHole = Math.max(area * 0.005, 36 * 36);
    return { outer, holes: holes.filter((h) => polygonArea(h) >= minHole && pointInPolygon(h[0], outer)) };
  }).filter((o) => polygonArea(o.outer) > 4);
}

/** Create the selected markups (and Spaces) from the fill. */
export function applyFill(): number {
  const app = useApp.getState();
  const doc = app.docs.find((d) => d.id === app.activeId);
  const st = useFill.getState();
  if (!doc) return 0;
  const outlines = fillOutlines();
  let n = 0;
  for (const { outer, holes } of outlines) {
    for (const kind of CREATE_KINDS.map((c) => c.id).filter((c) => st.create[c])) {
      if (kind === 'space') {
        const taken = (doc.spaces[doc.page] ?? []).length;
        app.setSpace(doc.page, { id: crypto.randomUUID(), title: outlines.length > 1 ? `${st.spaceName} ${taken + 1}` : st.spaceName, points: outer, color: '#0000ff', opacity: 0.1 });
        n++;
        continue;
      }
      const type = kind as MarkupType;
      const preset = app.preset?.type === type ? app.preset : null;
      const points = type === 'perimeter' || type === 'polylength' ? [...outer, outer[0]] : outer;
      app.addMarkup({
        type, page: doc.page, points,
        style: preset?.style ?? app.toolDefaults[type],
        subject: preset?.subject ?? toolById(type).subject,
        depth: type === 'volume' ? preset?.depth ?? 1 : undefined,
        cutouts: type === 'area' || type === 'volume' ? holes.map((h) => ({ kind: 'polygon' as const, points: h })) : undefined,
      });
      n++;
    }
  }
  useFill.setState({ flood: null });
  bump();
  app.setStatus(n ? `Dynamic Fill created ${n} item${n === 1 ? '' : 's'}` : 'Dynamic Fill: nothing to create; fill a shape first');
  return n;
}

// ---------- rendering ----------

/** Fill highlight and temporary boundaries, drawn over the page. */
export function FillOverlay({ width, height, pageW, pageH, cursor }: { width: number; height: number; pageW: number; pageH: number; cursor: Pt | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const st = useFill();
  const img = useRef<ImageData | null>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c || !st.mask) return;
    const { w, h } = st.mask;
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; img.current = null; }
    const ctx = c.getContext('2d')!;
    if (!img.current) img.current = ctx.createImageData(w, h);
    const d = img.current.data;
    const f = st.flood?.filled;
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(st.color.slice(i, i + 2), 16));
    for (let i = 0, j = 0; i < w * h; i++, j += 4) {
      if (f && f[i]) { d[j] = r; d[j + 1] = g; d[j + 2] = b; d[j + 3] = 110; } else d[j + 3] = 0;
    }
    ctx.putImageData(img.current, 0, 0);
  }, [st.tick, st.mask, st.flood, st.color]);
  const line = (pts: Pt[]) => pts.map((p) => `${p.x},${p.y}`).join(' ');
  return (
    <>
      <canvas ref={ref} className="fill-overlay" style={{ width: width, height: height }} />
      <svg className="fill-boundaries" width={width} height={height} viewBox={`0 0 ${pageW} ${pageH}`}>
        {st.boundaries.map((b, i) => <polyline key={i} points={line(b)} fill="none" stroke="#ff4d00" strokeWidth={st.boundarySize} />)}
        {st.draftBoundary.length > 0 && (
          <polyline points={line(cursor ? [...st.draftBoundary, cursor] : st.draftBoundary)} fill="none" stroke="#ff4d00" strokeWidth={st.boundarySize} strokeDasharray="4 3" />
        )}
      </svg>
    </>
  );
}

/** The Dynamic Fill toolbar shown over the drawing while the tool is active. */
export function DynamicFillBar() {
  const st = useFill();
  const app = useApp();
  const set = (p: Partial<FillState>) => useFill.setState(p);
  const filled = !!st.flood;
  return (
    <div className="fill-bar" role="toolbar" aria-label="Dynamic Fill" onKeyDown={(e) => e.stopPropagation()}>
      <strong>Dynamic Fill</strong>
      {st.loading && <span className="muted">Reading drawing…</span>}
      <button className={st.mode === 'boundary' ? 'on' : ''} onClick={() => set({ mode: 'boundary' })}>Add Boundary</button>
      <button className={st.mode === 'fill' ? 'on' : ''} onClick={() => { finishBoundary(); set({ mode: 'fill' }); }}>Fill</button>
      <span className="sep" />
      <span>Create:</span>
      {CREATE_KINDS.map((c) => (
        <label key={c.id}><input type="checkbox" checked={st.create[c.id]} onChange={(e) => set({ create: { ...st.create, [c.id]: e.target.checked } })} /> {c.label}</label>
      ))}
      {st.create.space && <input aria-label="Space name" value={st.spaceName} onChange={(e) => set({ spaceName: e.target.value })} style={{ width: 90 }} />}
      <button className="primary" disabled={!filled} onClick={applyFill}>Apply</button>
      <span className="sep" />
      <select aria-label="Clear Dynamic Fill" value="" onChange={(e) => { if (e.target.value) clearFill(e.target.value as 'all'); }}>
        <option value="">Clear…</option>
        <option value="all">Clear All</option>
        <option value="fill">Clear Fill</option>
        <option value="boundaries">Clear Boundaries</option>
      </select>
      <select aria-label="Edge Sensitivity" title="Edge Sensitivity" value={st.sensitivity}
        onChange={(e) => { set({ sensitivity: e.target.value as FillState['sensitivity'], key: '' }); bump(); }}>
        {Object.keys(SENSITIVITY).map((k) => <option key={k} value={k}>Edges: {k}</option>)}
      </select>
      <select aria-label="Fill Speed" title="Fill Speed" value={st.speed} onChange={(e) => set({ speed: e.target.value as FillState['speed'] })}>
        {Object.keys(SPEEDS).map((k) => <option key={k} value={k}>Speed: {k}</option>)}
      </select>
      <input type="color" aria-label="Fill Color" title="Fill Color" value={st.color} onChange={(e) => set({ color: e.target.value })} />
      <button title="Close Dynamic Fill (Esc)" onClick={() => app.setTool('select')}>✕</button>
    </div>
  );
}
