// View > Rulers (Ctrl+R), Full-Screen Crosshair, and the view history for
// Previous / Next View (Alt+Left / Alt+Right). Rulers run along the top and
// left of the view, scaled with the zoom and counted from the page edge;
// they shade the page's extent and the selected markups, and mark the
// pointer. Right-click a ruler to change its units.
import { useEffect, useRef, useState, type RefObject } from 'react';
import { useApp } from '../model/store';
import { RULER_UNITS, ViewHistory, rulerTicks, type RulerUnit, type ViewEntry } from '../model/rulers';
import { ContextMenu } from './ContextMenu';

export const RULER = 20;

interface Box { x0: number; x1: number; y0: number; y1: number }

/** Rulers and crosshair over a viewer. Boxes are in scroll-area pixels. */
export function ViewOverlays({ scrollRef, page, selection, zoom, rulers, crosshair }: {
  scrollRef: RefObject<HTMLDivElement | null>; page: Box; selection: Box | null; zoom: number; rulers: boolean; crosshair: boolean;
}) {
  const unit = useApp((s) => s.rulerUnit);
  const top = useRef<HTMLCanvasElement>(null), left = useRef<HTMLCanvasElement>(null);
  const hLine = useRef<HTMLDivElement>(null), vLine = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null); // viewport px, relative to the scroll element

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const draw = () => {
      const p = pointer.current;
      if (hLine.current && vLine.current) {
        hLine.current.style.display = vLine.current.style.display = p ? '' : 'none';
        if (p) { hLine.current.style.top = `${p.y + (rulers ? RULER : 0)}px`; vLine.current.style.left = `${p.x + (rulers ? RULER : 0)}px`; }
      }
      if (!rulers) return;
      const sx = el.scrollLeft, sy = el.scrollTop;
      drawRuler(top.current, el.clientWidth, page.x0 - sx, page.x1 - sx, selection && [selection.x0 - sx, selection.x1 - sx], p?.x, zoom, unit, false);
      drawRuler(left.current, el.clientHeight, page.y0 - sy, page.y1 - sy, selection && [selection.y0 - sy, selection.y1 - sy], p?.y, zoom, unit, true);
    };
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      pointer.current = { x: e.clientX - r.left, y: e.clientY - r.top };
      draw();
    };
    const leave = () => { pointer.current = null; draw(); };
    const ro = new ResizeObserver(draw);
    ro.observe(el);
    el.addEventListener('scroll', draw);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerleave', leave);
    draw();
    return () => { ro.disconnect(); el.removeEventListener('scroll', draw); el.removeEventListener('pointermove', move); el.removeEventListener('pointerleave', leave); };
  }, [scrollRef, page.x0, page.x1, page.y0, page.y1, selection?.x0, selection?.x1, selection?.y0, selection?.y1, zoom, unit, rulers]);

  const onMenu = (e: React.MouseEvent) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY }); };
  return (
    <>
      {rulers && (
        <>
          <div className="ruler-corner" title={RULER_UNITS[unit].label} onContextMenu={onMenu}>{unit}</div>
          <canvas ref={top} className="ruler ruler-top" aria-label="Horizontal ruler" onContextMenu={onMenu} />
          <canvas ref={left} className="ruler ruler-left" aria-label="Vertical ruler" onContextMenu={onMenu} />
        </>
      )}
      {crosshair && (
        <>
          <div ref={hLine} className="crosshair crosshair-h" style={{ display: 'none' }} />
          <div ref={vLine} className="crosshair crosshair-v" style={{ display: 'none' }} />
        </>
      )}
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)}
          items={(Object.keys(RULER_UNITS) as RulerUnit[]).map((u) => ({
            label: RULER_UNITS[u].label, checked: u === unit, action: () => useApp.getState().setView({ rulerUnit: u }),
          }))} />
      )}
    </>
  );
}

function drawRuler(c: HTMLCanvasElement | null, length: number, p0: number, p1: number, sel: number[] | null, mouse: number | undefined,
  zoom: number, unit: RulerUnit, vertical: boolean) {
  if (!c) return;
  const dpr = window.devicePixelRatio || 1;
  const [w, h] = vertical ? [RULER, length] : [length, RULER];
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
    c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    c.style.width = `${w}px`; c.style.height = `${h}px`;
  }
  const ctx = c.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const css = getComputedStyle(c);
  ctx.fillStyle = css.getPropertyValue('--ruler-bg') || '#e8e8e8';
  ctx.fillRect(0, 0, w, h);
  // Draw along x, then rotate for the vertical ruler.
  if (vertical) ctx.setTransform(0, dpr, dpr, 0, 0, 0);
  ctx.fillStyle = '#fff';
  ctx.fillRect(p0, 0, p1 - p0, RULER);
  if (sel) { ctx.fillStyle = 'rgba(26,115,232,0.3)'; ctx.fillRect(sel[0], 0, sel[1] - sel[0], RULER); }
  ctx.strokeStyle = '#555'; ctx.fillStyle = '#333'; ctx.lineWidth = 1;
  ctx.font = '9px system-ui, sans-serif';
  const ticks = rulerTicks(p0, length, zoom, unit);
  ctx.beginPath();
  for (const t of ticks) {
    const x = Math.round(t.px) + 0.5;
    ctx.moveTo(x, RULER); ctx.lineTo(x, t.major ? 4 : RULER - 5);
  }
  ctx.stroke();
  for (const t of ticks) {
    if (!t.label) continue;
    if (!vertical) { ctx.fillText(t.label, t.px + 2, 10); continue; }
    // On the vertical ruler labels read upward, just above their tick.
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.translate(10, t.px - 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(t.label, 0, 0);
    ctx.restore();
  }
  if (mouse !== undefined) { ctx.strokeStyle = '#d00'; ctx.beginPath(); ctx.moveTo(mouse + 0.5, 0); ctx.lineTo(mouse + 0.5, RULER); ctx.stroke(); }
}

// ---------- Previous / Next View ----------

export const viewHistory = new ViewHistory();
let restoring = false;

/** Record the view shown (called by the active viewer, debounced). */
export function recordView(v: ViewEntry) { if (!restoring) viewHistory.record(v); }

/** Alt+Left / Alt+Right. `centerOn` scrolls the active viewer once it shows the view. */
export function stepView(dir: -1 | 1, centerOn: (p: { x: number; y: number }) => void) {
  const s = useApp.getState();
  let v = dir < 0 ? viewHistory.back() : viewHistory.forward();
  while (v && !s.docs.some((d) => d.id === v!.docId)) { viewHistory.drop(v.docId); v = dir < 0 ? viewHistory.back() : viewHistory.forward(); }
  if (!v) return;
  restoring = true;
  if (s.activeId !== v.docId) s.setActive(v.docId);
  s.setPage(v.page);
  s.setZoom(v.zoom);
  const target = v;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    centerOn({ x: target.cx, y: target.cy });
    setTimeout(() => { restoring = false; }, 600);
  }));
}
