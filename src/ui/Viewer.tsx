import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { PDFPageProxy, RenderTask } from 'pdfjs-dist';
import { useApp, type DocState } from '../model/store';
import { MEASURE_TYPES, bounds, dist, distToSegment, pointInPolygon, formatLength, formatNumber, measure, ortho, rectCorners, resolveFormat, scaleAt, stretchY, circleFrom3 } from '../model/measure';
import { Icon } from './icons';
import { eraseStroke, translated, typewriterBox } from '../model/markup';
import { useSearch } from './Search';
import { newFormField } from './FormsEditor';
import { addLayer } from './LayersPanel';
import { layerIds } from '../pdf/layers';
import { markupShown, ocConfig, visibilityKey } from './layersView';
import { openSignDialog } from './DigitalSignature';
import { cancelPicking, pickAlignPoint, pickingPrompt, useCompareDialog } from './Compare';
import { STAMPS, downloadBase64, loadImage, pageText, pickFile, readAsDataUrl, snapshot, textRectsIn } from './toolActions';
import { applyCutout, ellipsePolygon } from '../model/cutouts';
import { expandGroups } from '../model/arrange';
import { arrangeItems } from './arrangeMenu';
import { legendKey, legendLayout, legendRows, type LegendDef } from '../model/legend';
import { DynamicFillBar, FillOverlay, buildMask, fillDown, fillMove, fillUp, finishBoundary, resetFill, useFill } from './DynamicFill';
import type { Markup, MarkupType, Pt, ToolId, Viewport } from '../model/types';
import { toolById } from '../tools/tools';
import { CURVABLE, arcSegment, bezierAt, closedType, flatPoints, hasCurves, insertHandle, removeHandle, segments, toggleCurve, type Handles } from '../model/curves';
import { MarkupShape, handlePoints } from './renderMarkup';
import { cutoutAt, hitTest, markupBounds, outline } from './hit';
import { setCursor } from './cursor';
import { ViewOverlays, recordView } from './Rulers';
import { setVisualTemplate } from './VisualSearch';
import { finishPickRect } from './pickRect';
import { editText, eraseContent } from '../pdf/editText';
import type { TextBox } from './toolActions';
import { formatSequence, nextInSequence, sequenceMembers } from '../model/sequence';
import { renderLimits } from '../model/device';
import { ContextMenu, type MenuItem } from './ContextMenu';
import { snapGeometry, snapToContent, type SnapGeometry } from '../pdf/geometry';
import { layoutPages, rotateCss, rotateIn, rotateOut, rotatedSize, slotAt, type Slot, type ViewRotation } from '../model/layout';

const PAD = 40;
// Canvas sizes: smaller on machines with little memory (src/model/device.ts).
const LIMITS = renderLimits();
const BASE_MAX_PIXELS = LIMITS.base;
/** Pages other than the active one, in continuous / side-by-side views. */
const TILE_MAX_PIXELS = LIMITS.tile;

/** Imperative hooks for menus/toolbar (fit page etc.). */
export const viewerApi = {
  fitPage: () => {},
  fitWidth: () => {},
  zoomBy: (_f: number) => {},
  /** Scroll so page point `p` is in the middle of the view. */
  centerOn: (_p: Pt) => {},
  /** Scroll so page point `p` is at the top left of the view. */
  showAt: (_p: Pt) => {},
  /** Page point at the top left of the view. */
  topLeft: (): Pt => ({ x: 0, y: 0 }),
};

type Draft = { tool: ToolId; points: Pt[]; cursor: Pt | null; dragFrom?: { x: number; y: number }; target?: string;
  /** Curved segments drawn with Ctrl+drag: handlebars per point, and the point whose handlebar is being dragged. */
  handles?: Handles; curving?: number };
type Drag =
  | { kind: 'pan'; sx: number; sy: number; left: number; top: number }
  | { kind: 'move'; start: Pt; snapshot: Markup[]; ids: string[]; moved: boolean }
  | { kind: 'vertex'; id: string; index: number; snapshot: Markup[]; moved: boolean }
  | { kind: 'band'; start: Pt; cur: Pt; add: boolean; right?: { x: number; y: number } }
  /** Move (corner -1) or resize (corner 0..3) the highlighted viewport. */
  | { kind: 'viewport'; id: string; corner: number; start: Pt; orig: [Pt, Pt]; rect: [Pt, Pt] }
  /** Drag a curve handlebar of vertex `index` (Ctrl: the two sides move independently). */
  | { kind: 'bezier'; id: string; index: number; side: 'in' | 'out'; snapshot: Markup[]; independent: boolean };

const isEditable = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

/** Capture the pointer for a drag (ignored when the browser refuses, e.g. a pointer that is already gone). */
function capture(e: { target: EventTarget; pointerId: number }) {
  try { (e.target as Element).setPointerCapture?.(e.pointerId); } catch { /* not capturable */ }
}

export function Viewer({ doc, pane = 0 }: { doc: DocState; pane?: 0 | 1 }) {
  const s = useApp();
  // Split view: pane 1 has its own page and zoom.
  const split = s.split;
  const pageIdx = pane === 1 && split ? split.page : doc.page;
  const zoomRaw = pane === 1 && split ? split.zoom : doc.zoom;
  const isActivePane = !split || s.activePane === pane;
  const page = doc.loaded.pages[Math.min(pageIdx, doc.loaded.pages.length - 1)];
  const zoom = zoomRaw || 1;
  const scrollRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLCanvasElement>(null);
  const detailRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [pdfPage, setPdfPage] = useState<PDFPageProxy | null>(null);
  const renderedPage = useRef<PDFPageProxy | null>(null);
  const [renderedIdx, setRenderedIdx] = useState(-1);
  const [baseScale, setBaseScale] = useState(0);
  const [detail, setDetail] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [snapPt, setSnapPt] = useState<Pt | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  /** Edit Text: the run of the drawing's text being edited. */
  const [textEdit, setTextEdit] = useState<TextBox | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const anchor = useRef<{ px: number; py: number; cx: number; cy: number } | null>(null);
  const spaceDown = useRef(false);
  const countId = useRef<string | null>(null);
  const eraseSnapshot = useRef<Markup[] | null>(null);
  const lastMiddle = useRef(0);
  const buttonDown = useRef(false);
  const rightDown = useRef<{ x: number; y: number } | null>(null);
  const [, force] = useState(0);
  const [geom, setGeom] = useState<SnapGeometry | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  // Compare / Overlay: picking alignment points (two on each sheet).
  const align = useCompareDialog((c) => (c.picking ? c : null));
  const alignPts = align?.picking?.filter((_, i) => (i < 2 ? align.aId === doc.id && align.pa === pageIdx : align.bId === doc.id && align.pb === pageIdx)) ?? [];

  const pw = page.width * zoom, ph = page.height * zoom;
  // View mode and Rotate View: where each shown page sits in the scroll area.
  const mode = s.viewMode, rot = s.viewRotation;
  const multi = mode !== 'single';
  const lay = layoutPages(doc.loaded.pages.map((p) => rotatedSize(p.width * zoom, p.height * zoom, rot)), mode, pageIdx, PAD, size);
  const { innerW, innerH } = lay;
  const slot = lay.slots.find((x) => x.index === page.index)!;
  const left = slot.x, top = slot.y;
  /** Page pixels (unrotated, relative to the page) to scroll-area pixels, and back. */
  const outPt = (u: number, v: number) => { const q = rotateOut(u, v, pw, ph, rot); return { x: left + q.x, y: top + q.y }; };
  // Markups on hidden layers are not shown (nor hit or snapped to).
  const markups = doc.markups.filter((m) => m.page === pageIdx && markupShown(doc, m, zoom));
  const visKey = visibilityKey(doc, zoom);
  const viewports = doc.viewports[pageIdx] ?? [];
  /** Scale a measurement starting at `p` would use (viewport, else page). */
  const scaleFor = (p: Pt | undefined) => scaleAt(doc.calibrations[pageIdx], viewports, p);
  const selected = new Set(doc.selection);

  // Selected markups' extent on the rulers (scroll-area pixels).
  const selectionBox = (() => {
    const sel = markups.filter((m) => selected.has(m.id));
    if (!s.toggles.rulers || !sel.length) return null;
    const qs = sel.flatMap((m) => {
      const b = markupBounds(m);
      return [outPt(b.minX * zoom, b.minY * zoom), outPt(b.maxX * zoom, b.maxY * zoom)];
    });
    return { x0: Math.min(...qs.map((q) => q.x)), x1: Math.max(...qs.map((q) => q.x)), y0: Math.min(...qs.map((q) => q.y)), y1: Math.max(...qs.map((q) => q.y)) };
  })();

  // Previous / Next View: record where the view settles.
  useEffect(() => {
    if (!isActivePane) return;
    const el = scrollRef.current;
    if (!el) return;
    let t = 0;
    const rec = () => {
      clearTimeout(t);
      t = window.setTimeout(() => {
        const c = rotateIn(el.scrollLeft + el.clientWidth / 2 - left, el.scrollTop + el.clientHeight / 2 - top, pw, ph, rot);
        recordView({ docId: doc.id, page: pageIdx, zoom, cx: c.x / zoom, cy: c.y / zoom });
      }, 400);
    };
    rec();
    el.addEventListener('scroll', rec);
    return () => { clearTimeout(t); el.removeEventListener('scroll', rec); };
  }, [isActivePane, doc.id, pageIdx, zoom, left, top, pw, ph, rot]);

  // ----- container size -----
  useEffect(() => {
    const el = scrollRef.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ----- page proxy -----
  useEffect(() => {
    let alive = true;
    doc.loaded.pdf.getPage(pageIdx + 1).then((p) => alive && setPdfPage(p));
    setDetail(null);
    countId.current = null;
    setDraft(null);
    return () => { alive = false; };
  }, [doc.loaded.pdf, pageIdx]);

  // ----- content geometry for snapping -----
  const wantGeom = s.toggles.content;
  useEffect(() => {
    setGeom(null);
    if (!pdfPage || !wantGeom) return;
    let alive = true;
    // Only for a page that stays current a moment (not every page passed while scrolling).
    const t = setTimeout(() => { snapGeometry(pdfPage, page.viewport).then((g) => alive && setGeom(g)).catch(() => {}); }, 300);
    return () => { alive = false; clearTimeout(t); };
  }, [pdfPage, page.viewport, wantGeom]);

  // ----- fit / zoom helpers -----
  const fitPage = useCallback(() => {
    const el = scrollRef.current!;
    const r = rotatedSize(page.width, page.height, s.viewRotation);
    s.setViewZoom(pane, Math.min((el.clientWidth - PAD * 2) / r.w, (el.clientHeight - PAD * 2) / r.h));
  }, [page, s]);
  const fitWidth = useCallback(() => {
    const el = scrollRef.current!;
    s.setViewZoom(pane, (el.clientWidth - PAD * 2) / rotatedSize(page.width, page.height, s.viewRotation).w);
  }, [page, s]);
  const zoomAt = useCallback((factor: number, cx?: number, cy?: number) => {
    const el = scrollRef.current!;
    cx ??= el.clientWidth / 2; cy ??= el.clientHeight / 2;
    anchor.current = {
      px: (el.scrollLeft + cx - left) / zoom,
      py: (el.scrollTop + cy - top) / zoom,
      cx, cy,
    };
    s.setViewZoom(pane, zoom * factor);
  }, [left, top, zoom, s]);

  useEffect(() => {
    if (!isActivePane) return;
    viewerApi.fitPage = fitPage;
    viewerApi.fitWidth = fitWidth;
    viewerApi.zoomBy = (f) => zoomAt(f);
    viewerApi.centerOn = (p) => {
      const el = scrollRef.current;
      if (!el) return;
      const q = outPt(p.x * zoom, p.y * zoom);
      el.scrollLeft = q.x - el.clientWidth / 2;
      el.scrollTop = q.y - el.clientHeight / 2;
    };
    viewerApi.showAt = (p) => {
      const el = scrollRef.current;
      if (!el) return;
      const q = outPt(p.x * zoom, p.y * zoom);
      el.scrollLeft = q.x;
      el.scrollTop = q.y;
    };
    viewerApi.topLeft = () => {
      const el = scrollRef.current;
      if (!el) return { x: 0, y: 0 };
      const c = rotateIn(Math.max(left, el.scrollLeft) - left, Math.max(top, el.scrollTop) - top, pw, ph, rot);
      return { x: c.x / zoom, y: c.y / zoom };
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitPage, fitWidth, zoomAt, left, top, zoom, isActivePane, rot]);

  useEffect(() => { if (!zoomRaw) fitPage(); }, [zoomRaw, fitPage]);

  useLayoutEffect(() => {
    const a = anchor.current;
    const el = scrollRef.current;
    if (!a || !el) return;
    anchor.current = null;
    el.scrollLeft = left + a.px * zoom - a.cx;
    el.scrollTop = top + a.py * zoom - a.cy;
  }, [zoom, left, top]);

  // ----- continuous / side-by-side views -----
  // The page under the pointer becomes the active (editable) page; with the
  // pointer outside the view, the page in the middle of the view does.
  const ownPage = useRef(pageIdx);
  const lastLayout = useRef('');
  const pointerIn = useRef(false);
  const activate = (index: number) => {
    if (index === pageIdx || draft || drag || buttonDown.current || editing) return;
    ownPage.current = index;
    flushSync(() => s.setViewPage(pane, index, true));
  };
  const layoutPoint = (clientX: number, clientY: number) => {
    const el = scrollRef.current!, r = el.getBoundingClientRect();
    return { x: clientX - r.left + el.scrollLeft, y: clientY - r.top + el.scrollTop };
  };
  const onLayoutMove = (e: React.PointerEvent) => {
    pointerIn.current = true;
    if (!multi || e.buttons) return;
    const q = layoutPoint(e.clientX, e.clientY);
    const hit = lay.slots.find((x) => q.x >= x.x && q.x <= x.x + x.w && q.y >= x.y && q.y <= x.y + x.h);
    if (hit) activate(hit.index);
  };
  // Scrolling re-renders the view only when it must: when the set of pages in
  // reach changes (continuous views), and once scrolling pauses (zoom detail).
  const scrollIdle = useRef(0);
  const reach = useRef('');
  const onScroll = () => {
    clearTimeout(scrollIdle.current);
    scrollIdle.current = window.setTimeout(() => setScrollTick((n) => n + 1), 120);
    if (multi) {
      const el = scrollRef.current!;
      const vy = el.scrollTop, vh = el.clientHeight;
      const inReach = lay.slots.filter((x) => x.y < vy + vh * 2 && x.y + x.h > vy - vh).map((x) => x.index).join(',');
      if (inReach !== reach.current) { reach.current = inReach; setScrollTick((n) => n + 1); }
    }
    if (!multi || pointerIn.current) return;
    const el = scrollRef.current!;
    const mid = slotAt(lay.slots, el.scrollLeft + el.clientWidth / 2, el.scrollTop + el.clientHeight / 2);
    if (mid) activate(mid.index);
  };
  // Going to a page (thumbnails, Ctrl+Right, a new view mode...) scrolls it into view.
  useLayoutEffect(() => {
    const key = `${mode}:${rot}`;
    const changed = lastLayout.current !== key;
    lastLayout.current = key;
    if (!multi || (!changed && ownPage.current === pageIdx)) return;
    ownPage.current = pageIdx;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = top - PAD / 2;
    el.scrollLeft = left + slot.w / 2 - el.clientWidth / 2;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageIdx, mode, rot, multi]);

  // Touch: two fingers pinch to zoom and drag to pan; a finger outside the
  // page pans. Handled before the drawing surface sees the touches.
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; mid: { x: number; y: number } } | null>(null);
  useEffect(() => {
    const el = scrollRef.current!;
    const local = (x: number, y: number) => { const r = el.getBoundingClientRect(); return { x: x - r.left, y: y - r.top }; };
    const state = () => {
      const pts = [...touches.current.values()];
      const [a, b] = pts;
      return { dist: Math.hypot(b.x - a.x, b.y - a.y), mid: local((a.x + b.x) / 2, (a.y + b.y) / 2) };
    };
    let single: { x: number; y: number; left: number; top: number } | null = null;
    const down = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.current.size >= 2) {
        // A second finger: whatever the first one started becomes a pinch.
        e.stopPropagation();
        cancelLongPress();
        setDraft(null);
        setDrag(null);
        single = null;
        pinch.current = state();
        return;
      }
      if (!(e.target as Element).closest?.('.markup-layer, .form-field, input, textarea, button')) {
        single = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
        e.stopPropagation();
      }
    };
    const move = (e: PointerEvent) => {
      if (e.pointerType !== 'touch' || !touches.current.has(e.pointerId)) return;
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch.current && touches.current.size >= 2) {
        e.stopPropagation();
        const now = state(), was = pinch.current;
        const factor = now.dist / (was.dist || 1);
        if (Math.abs(factor - 1) > 0.01) {
          // The page point under the old midpoint goes under the new one.
          anchor.current = { px: (el.scrollLeft + was.mid.x - left) / zoom, py: (el.scrollTop + was.mid.y - top) / zoom, cx: now.mid.x, cy: now.mid.y };
          s.setViewZoom(pane, zoom * factor);
          pinch.current = now;
        } else {
          el.scrollLeft -= now.mid.x - was.mid.x;
          el.scrollTop -= now.mid.y - was.mid.y;
          pinch.current = { dist: was.dist, mid: now.mid };
        }
      } else if (single) {
        e.stopPropagation();
        el.scrollLeft = single.left - (e.clientX - single.x);
        el.scrollTop = single.top - (e.clientY - single.y);
      }
    };
    const up = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      touches.current.delete(e.pointerId);
      if (touches.current.size < 2) pinch.current = null;
      if (!touches.current.size) single = null;
    };
    el.addEventListener('pointerdown', down, true);
    el.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
    return () => {
      el.removeEventListener('pointerdown', down, true);
      el.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, left, top, pane]);

  // Wheel zooms around the cursor (Revu default). Shift/Ctrl+wheel scrolls.
  useEffect(() => {
    const el = scrollRef.current!;
    const onWheel = (e: WheelEvent) => {
      if (e.shiftKey || e.ctrlKey) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  // ----- rendering -----
  const dpr = window.devicePixelRatio || 1;
  const wantBase = Math.min(zoom * dpr, Math.sqrt(BASE_MAX_PIXELS / (page.width * page.height)));
  useEffect(() => {
    if (!pdfPage) return;
    let task: RenderTask | null = null;
    const t = setTimeout(() => {
      const canvas = baseRef.current!;
      const vp = pdfPage.getViewport({ scale: wantBase });
      const off = document.createElement('canvas');
      off.width = Math.ceil(vp.width); off.height = Math.ceil(vp.height);
      // Form fields are drawn as live inputs (FormLayer), so the canvas leaves them out.
      task = pdfPage.render({ canvas: off, viewport: vp, annotationMode: doc.loaded.fields.length ? 2 : 1, optionalContentConfigPromise: ocConfig(doc, zoom) });
      task.promise.then(() => {
        canvas.width = off.width; canvas.height = off.height;
        canvas.getContext('2d')!.drawImage(off, 0, 0);
        renderedPage.current = pdfPage;
        setBaseScale(wantBase);
        setRenderedIdx(pdfPage.pageNumber - 1);
      }).catch(() => {});
      // Debounce re-renders while zooming; a different page renders at once.
    }, baseScale && renderedPage.current === pdfPage ? 200 : 0);
    return () => { clearTimeout(t); task?.cancel(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfPage, Math.round(wantBase * 20), visKey]);

  const [scrollTick, setScrollTick] = useState(0);
  useEffect(() => {
    if (!pdfPage || zoom * dpr <= wantBase * 1.05) { setDetail(null); return; }
    let task: RenderTask | null = null;
    const t = setTimeout(() => {
      const el = scrollRef.current!;
      // The visible part of the page, in page units (the view may be rotated).
      const c = [[el.scrollLeft, el.scrollTop], [el.scrollLeft + el.clientWidth, el.scrollTop + el.clientHeight]]
        .map(([sx, sy]) => rotateIn(sx - left, sy - top, pw, ph, rot));
      const x = Math.max(0, Math.min(c[0].x, c[1].x) / zoom);
      const y = Math.max(0, Math.min(c[0].y, c[1].y) / zoom);
      const w = Math.min(page.width, Math.max(c[0].x, c[1].x) / zoom) - x;
      const h = Math.min(page.height, Math.max(c[0].y, c[1].y) / zoom) - y;
      if (w <= 0 || h <= 0) return;
      const sc = zoom * dpr;
      const off = document.createElement('canvas');
      off.width = Math.ceil(w * sc); off.height = Math.ceil(h * sc);
      task = pdfPage.render({
        canvas: off,
        viewport: pdfPage.getViewport({ scale: sc }),
        transform: [1, 0, 0, 1, -x * sc, -y * sc],
        annotationMode: doc.loaded.fields.length ? 2 : 1,
        optionalContentConfigPromise: ocConfig(doc, zoom),
      });
      task.promise.then(() => {
        const c = detailRef.current;
        if (!c) return;
        c.width = off.width; c.height = off.height;
        c.getContext('2d')!.drawImage(off, 0, 0);
        setDetail({ x, y, w, h });
      }).catch(() => {});
    }, 150);
    return () => { clearTimeout(t); task?.cancel(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfPage, zoom, scrollTick, size.w, size.h, rot, left, top, visKey]);

  // ----- Dynamic Fill: read the page's content layer while the tool is active -----
  const fillKey = useFill((f) => f.key);
  const search = useSearch();
  const [fillCursor, setFillCursor] = useState<Pt | null>(null);
  useEffect(() => {
    if (s.tool === 'dynamic-fill' && pdfPage) buildMask(pdfPage, `${doc.id}:${pageIdx}`);
    if (s.tool !== 'dynamic-fill') resetFill();
  }, [s.tool, pdfPage, doc.id, pageIdx, fillKey]);

  // ----- keyboard: space-pan and draft keys -----
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (isEditable(e.target)) return;
      if (e.code === 'Space') { spaceDown.current = true; force((n) => n + 1); e.preventDefault(); }
      if (align && e.key === 'Escape') { cancelPicking(); e.stopImmediatePropagation(); return; }
      if (s.tool === 'dynamic-fill' && useFill.getState().draftBoundary.length) {
        if (e.key === 'Enter') { finishBoundary(); e.stopImmediatePropagation(); }
        else if (e.key === 'Escape') { useFill.setState({ draftBoundary: [] }); e.stopImmediatePropagation(); }
      }
      if (draft) {
        if (e.key === 'Escape') { setDraft(null); e.stopImmediatePropagation(); }
        else if (e.key === 'Enter') { finishPoly(); e.stopImmediatePropagation(); }
        else if (isRegion(draft.tool) && e.key.toLowerCase() === 'c' && !e.ctrlKey && !e.metaKey && !e.altKey) {
          finishPoly(); e.stopImmediatePropagation(); e.preventDefault();
        }
        else if (e.key === 'Backspace') {
          setDraft({ ...draft, points: draft.points.slice(0, -1), handles: draft.handles?.slice(0, -1) });
          e.stopImmediatePropagation(); e.preventDefault();
        }
      } else if (countId.current && (e.key === 'Enter' || e.key === 'Escape')) {
        countId.current = null;
        if (!s.toolLocked && !s.toggles.reuse) s.setTool('select');
        e.stopImmediatePropagation();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') { spaceDown.current = false; force((n) => n + 1); }
    };
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down, true); window.removeEventListener('keyup', up); };
  });

  useEffect(() => { setDraft(null); countId.current = null; }, [s.tool, s.preset]);

  // ----- coordinate helpers -----
  const svgRef = useRef<SVGSVGElement>(null);
  const toPage = (e: { clientX: number; clientY: number }): Pt => {
    const r = svgRef.current!.getBoundingClientRect();
    const q = rotateIn(e.clientX - r.left, e.clientY - r.top, pw, ph, rot);
    return { x: q.x / zoom, y: q.y / zoom };
  };
  const GRID = 12;
  // Like Revu's status bar: Markup = snap to markups, Content = snap to the
  // drawing, Snap = snap to grid. Each works on its own.
  const snap = (p: Pt, exclude?: string): Pt => {
    const tol = 10 / zoom;
    let best: Pt | null = null, bestD = tol;
    if (s.toggles.markup) {
      for (const m of markups) {
        if (m.id === exclude) continue;
        for (const q of handlePoints(m)) {
          const d = dist(p, q);
          if (d < bestD) { bestD = d; best = q; }
        }
      }
    }
    if (!best && geom) best = snapToContent(geom, p, tol)?.p ?? null;
    if (!best && s.toggles.snap) best = { x: Math.round(p.x / GRID) * GRID, y: Math.round(p.y / GRID) * GRID };
    return best ?? p;
  };
  /** Apply snapping and Shift-ortho relative to the previous point. */
  const constrain = (raw: Pt, e: { shiftKey: boolean }, prev?: Pt, exclude?: string): Pt => {
    let p = snap(raw, exclude);
    if (e.shiftKey && prev && s.tool === 'viewport') {
      // Shift draws the viewport as a square (Revu).
      const d = Math.max(Math.abs(p.x - prev.x), Math.abs(p.y - prev.y));
      return { x: prev.x + Math.sign(p.x - prev.x || 1) * d, y: prev.y + Math.sign(p.y - prev.y || 1) * d };
    }
    if (e.shiftKey && prev) p = ortho(prev, p);
    return p;
  };

  // ----- markup creation -----
  const tool = spaceDown.current ? 'pan' : s.tool;
  const def = toolById(s.tool);

  /** A Tool Chest tool with a Sequence numbers the markup it places. */
  const seqFields = (type: MarkupType): Partial<Markup> => {
    const p = s.preset;
    if (!p?.sequence) return {};
    const cur = useApp.getState().docs.find((x) => x.id === doc.id)?.markups ?? doc.markups;
    const n = nextInSequence(cur, p.id, p.sequence);
    const v = formatSequence(p.sequence, n);
    const textual = type === 'textbox' || type === 'callout' || type === 'typewriter' || type === 'cloudplus';
    return { seq: { id: p.id, run: p.sequence.run, n }, ...(textual ? { text: v } : { label: v }) };
  };

  const finish = (type: MarkupType, points: Pt[], extra: Partial<Markup> = {}) => {
    const preset = s.preset;
    const style = preset?.style ?? s.toolDefaults[type];
    let P = points;
    if (type === 'cloud' && points.length === 2) P = rectCorners(points[0], points[1]);
    if (type === 'callout') P = [points[0], points[1], { x: points[1].x + 144, y: points[1].y + 40 }];
    if (type === 'perimeter') {
      P = [...points, points[0]];
      // The closing point repeats the first: it takes its incoming handlebar.
      const h0 = extra.handles?.[0];
      if (extra.handles) extra = { ...extra, handles: [...extra.handles, h0 ? { in: h0.in, out: { x: 0, y: 0 } } : null] };
    }
    if (type === 'typewriter') P = typewriterBox(points[0], '', style.fontSize);
    if (type === 'stamp' && points.length === 1) P = [{ x: points[0].x - 80, y: points[0].y - 25 }, { x: points[0].x + 80, y: points[0].y + 25 }];
    const editable = type === 'textbox' || type === 'callout' || type === 'typewriter' || type === 'cloudplus';
    const m = s.addMarkup({
      type,
      page: pageIdx,
      points: P,
      style,
      subject: preset?.subject ?? toolById(type).subject,
      depth: type === 'volume' ? preset?.depth ?? 1 : undefined,
      text: editable ? '' : type === 'stamp' ? s.stampName : undefined,
      ...seqFields(type),
      ...extra,
    });
    setDraft(null);
    const keep = s.toolLocked || s.toggles.reuse;
    if (!keep) s.setTool('select');
    s.select([m.id]);
    if (editable && !m.seq) setEditing(m.id);
    return m;
  };

  /** Eraser: remove the parts of pen strokes under the cursor. */
  const eraseAt = (p: Pt) => {
    const r = 8 / zoom;
    const cur = useApp.getState().docs.find((x) => x.id === doc.id)?.markups ?? doc.markups;
    let changed = false;
    const next = cur.flatMap((m) => {
      if (m.page !== pageIdx || m.type !== 'pen' || m.locked) return [m];
      const pieces = eraseStroke(m.points, p, r);
      if (pieces.length === 1 && pieces[0].length === m.points.length) return [m];
      changed = true;
      return pieces.map((pts, i) => ({ ...m, id: i ? crypto.randomUUID() : m.id, points: pts, source: i ? undefined : m.source && { ...m.source, dirty: true } }));
    });
    if (changed) s.setMarkups(next, { history: false });
  };

  /** Place a Legend for the chosen markup kinds (default: every kind on this page). */
  const placeLegend = (p: Pt) => {
    const keys = s.legendKeys ?? [...new Set(markups.filter((m) => !['legend', 'link', 'image', 'attachment'].includes(m.type)).map(legendKey))];
    const def: LegendDef = { title: 'Legend', keys, source: 'page', showQuantity: true, showMeasurement: keys.some((k) => MEASURE_TYPES.has(k.split('|')[0])) };
    useApp.setState({ legendKeys: null });
    // The click is the table's top-left corner.
    const L = legendLayout(def, legendRows(def, doc.markups, pageIdx), (s.preset?.style ?? s.toolDefaults.legend).fontSize);
    finish('legend', [p, { x: p.x + L.w, y: p.y + L.h }], { legend: def });
  };

  // ----- tools that need text, files or a rendered snapshot -----
  const placeImage = async (p: Pt) => {
    const pending = s.pendingImage;
    if (pending) {
      useApp.setState({ pendingImage: null });
      finish('image', [p, { x: p.x + pending.w, y: p.y + pending.h }], { image: pending.url, subject: pending.subject });
      return;
    }
    const f = await pickFile('image/*');
    if (!f) return;
    const img = await loadImage(f);
    const k = Math.min(1, 300 / Math.max(img.w, img.h));
    finish('image', [p, { x: p.x + img.w * k, y: p.y + img.h * k }], { image: img.url });
  };
  const placeAttachment = async (p: Pt) => {
    const f = await pickFile();
    if (!f) return;
    const url = await readAsDataUrl(f);
    finish('attachment', [p], { file: { name: f.name, mime: f.type || 'application/octet-stream', data: url.slice(url.indexOf(',') + 1) }, comment: f.name });
  };
  const textMarkup = async (type: MarkupType, a: Pt, b: Pt) => {
    if (!pdfPage) return false;
    const rects = textRectsIn(await pageText(pdfPage, page.viewport), a, b);
    if (!rects.length) return false;
    finish(type, rects);
    return true;
  };
  const takeSnapshot = async (a: Pt, b: Pt) => {
    setDraft(null);
    if (!pdfPage) return;
    const url = await snapshot(pdfPage, a, b);
    const r = bounds([a, b]);
    const t = new Date().toISOString();
    const m: Markup = {
      id: crypto.randomUUID(), type: 'image', page: pageIdx, points: [{ x: r.minX, y: r.minY }, { x: r.maxX, y: r.maxY }],
      style: s.toolDefaults.image, subject: 'Snapshot', label: '', comment: '', author: s.author, created: t, modified: t, status: 'None', image: url,
    };
    useApp.setState({ clipboard: [m] });
    try {
      const blob = await (await fetch(url)).blob();
      await navigator.clipboard?.write?.([new ClipboardItem({ 'image/png': blob })]);
    } catch { /* system clipboard is optional */ }
    if (!s.toolLocked && !s.toggles.reuse) s.setTool('select');
    s.setStatus('Snapshot copied. Paste with Ctrl+V (Ctrl+Shift+V pastes in place).');
  };

  /** Area or Volume measurement under `p` that a cutout would subtract from. */
  const cutoutTarget = (p: Pt) => [...markups].reverse().find((m) => (m.type === 'area' || m.type === 'volume') && pointInPolygon(p, m.points));

  const finishCutout = (pts: Pt[], kind: 'polygon' | 'ellipse') => {
    const id = draft?.target;
    const space = draft?.tool === 'space';
    setDraft(null);
    if (space) {
      // Add Space: name it in the Add Space dialog (Revu).
      s.setTool('select');
      useApp.setState({ spaceDialog: { page: pageIdx, points: pts } });
      return;
    }
    if (!id) return;
    // The cutout tool stays active for further cutouts until Esc (Revu).
    const m = doc.markups.find((x) => x.id === id);
    if (!m) return;
    // A curved outline is cut as its flattened polygon; it stays curved when only a hole is added.
    const curved = hasCurves(m.handles);
    const base = curved ? { ...m, points: flatPoints(m) } : m;
    const r = applyCutout(base, { kind, points: pts });
    if ('error' in r) { s.setStatus(r.error); return; }
    const same = r.points.length === base.points.length && r.points.every((q, k) => q.x === base.points[k].x && q.y === base.points[k].y);
    s.updateMarkups([id], () => (curved && same ? { cutouts: r.cutouts } : { ...r, handles: curved ? undefined : m.handles }));
  };

  const finishPoly = () => {
    if (!draft) return;
    if (isRegion(draft.tool)) {
      if (draft.points.length >= 3) finishCutout(draft.points, 'polygon');
      else setDraft(null);
      return;
    }
    const t = toolById(draft.tool);
    const min = t.closed ? 3 : 2;
    if (draft.points.length >= min) finish(draft.tool as MarkupType, draft.points, hasCurves(draft.handles) ? { handles: draft.handles } : {});
    else setDraft(null);
  };

  // ----- pointer handlers -----
  const onPointerDown = (e: React.PointerEvent) => {
    setMenu(null);
    buttonDown.current = e.button === 0;
    // No text selection or native drag on the drawing surface: a native drag
    // would swallow the pointer-up and leave a markup half-drawn.
    window.getSelection()?.removeAllRanges();
    e.preventDefault();
    // preventDefault also stops the focus change, so close an open editor here.
    if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) document.activeElement.blur();
    const el = scrollRef.current!;
    if (e.button === 1) {
      // Middle double-click re-centers the view on that point (Revu).
      const now = Date.now();
      if (now - lastMiddle.current < 350) {
        const r = el.getBoundingClientRect();
        el.scrollLeft += e.clientX - (r.left + el.clientWidth / 2);
        el.scrollTop += e.clientY - (r.top + el.clientHeight / 2);
        lastMiddle.current = 0;
        return;
      }
      lastMiddle.current = now;
    }
    if (e.button === 2) {
      // Right button: click = context menu (or leave the tool), drag = multi-select (Revu).
      rightDown.current = { x: e.clientX, y: e.clientY };
      if (tool === 'select') {
        const raw = toPage(e);
        setDrag({ kind: 'band', start: raw, cur: raw, add: true, right: { x: e.clientX, y: e.clientY } });
        capture(e);
      }
      return;
    }
    // Touch: a finger pans in Pen Mode, and in Select where it does not touch a markup;
    // pressing and holding opens the context menu.
    if (e.pointerType === 'touch' && e.button === 0) {
      const at = toPage(e);
      const onMarkup = markups.some((m) => hitTest(m, at, 14 / zoom));
      startLongPress(e);
      if (s.toggles.penMode || ((tool === 'select' || tool === 'pan') && !onMarkup)) {
        setDrag({ kind: 'pan', sx: e.clientX, sy: e.clientY, left: el.scrollLeft, top: el.scrollTop });
        capture(e);
        return;
      }
    }
    if (e.button === 1 || (e.button === 0 && tool === 'pan')) {
      setDrag({ kind: 'pan', sx: e.clientX, sy: e.clientY, left: el.scrollLeft, top: el.scrollTop });
      capture(e);
      e.preventDefault();
      return;
    }
    if (e.button !== 0) return;
    const raw = toPage(e);
    if (align && isActivePane) { pickAlignPoint(snap(raw)); return; }
    if (tool === 'edit-text') {
      if (!pdfPage) return;
      pageText(pdfPage, page.viewport).then((boxes) => {
        const hit = boxes.find((b) => raw.x >= b.x0 - 1 && raw.x <= b.x1 + 1 && raw.y >= b.y0 - 1 && raw.y <= b.y1 + 1);
        if (hit) setTextEdit(hit); else s.setStatus('Edit Text: no text there. Click on a line of the drawing\'s text.');
      });
      return;
    }

    if (tool === 'dynamic-fill') {
      fillDown(raw);
      capture(e);
      return;
    }

    if (tool === 'zoom') { zoomAt(e.altKey ? 0.5 : 2, e.clientX - el.getBoundingClientRect().left, e.clientY - el.getBoundingClientRect().top); return; }

    if (tool === 'select') {
      const tol = (e.pointerType === 'touch' ? 14 : 5) / zoom;
      // The viewport highlighted in the Measurements panel: drag its edge to move, a corner to resize.
      const av = viewports.find((v) => v.id === s.activeViewport);
      if (av) {
        const cs = viewportCorners(av.rect);
        const corner = cs.findIndex((c) => dist(c, raw) <= 6 / zoom);
        const onEdge = cs.some((c, i) => distToSegment(raw, c, cs[(i + 1) % 4]) <= tol);
        if (corner >= 0 || onEdge) {
          setDrag({ kind: 'viewport', id: av.id, corner, start: raw, orig: av.rect, rect: av.rect });
          return;
        }
      }
      // vertex handles of a single selected markup
      if (doc.selection.length === 1) {
        const m = markups.find((x) => x.id === doc.selection[0]);
        if (m && !m.locked) {
          const curvable = CURVABLE.has(m.type);
          // Curve handlebars (drag; Ctrl+drag moves one side only).
          if (curvable && m.handles) {
            for (let k = 0; k < m.points.length; k++) {
              const h = m.handles[k];
              if (!h) continue;
              for (const side of ['in', 'out'] as const) {
                const q = { x: m.points[k].x + h[side].x, y: m.points[k].y + h[side].y };
                if ((h[side].x || h[side].y) && dist(q, raw) <= 6 / zoom) {
                  setDrag({ kind: 'bezier', id: m.id, index: k, side, snapshot: doc.markups, independent: e.ctrlKey || e.metaKey });
                  return;
                }
              }
            }
          }
          const hs = handlePoints(m);
          const i = hs.findIndex((h) => dist(h, raw) <= 6 / zoom);
          if (i >= 0 && curvable && (e.ctrlKey || e.metaKey)) {
            // Ctrl+click a control point: straight <-> curve (Revu).
            s.updateMarkups([m.id], (x) => ({ handles: cleanHandles(toggleCurve(x.points, x.handles, i, closedType(x.type))) }));
            return;
          }
          if (i >= 0 && curvable && e.shiftKey) {
            // Shift+click a control point removes it.
            if (m.points.length > (closedType(m.type) ? 3 : 2)) {
              s.updateMarkups([m.id], (x) => ({ points: x.points.filter((_, k) => k !== i), handles: removeHandle(x.handles, i) }));
            }
            return;
          }
          if (i >= 0) {
            setDrag({ kind: 'vertex', id: m.id, index: i, snapshot: doc.markups, moved: false });
            return;
          }
          if (curvable && e.shiftKey) {
            // Shift+click on a line adds a control point there.
            const k = segmentAt(m, raw, tol * 1.5);
            if (k >= 0) {
              s.updateMarkups([m.id], (x) => {
                const pts = [...x.points];
                pts.splice(k + 1, 0, raw);
                return { points: pts, handles: insertHandle(x.handles, x.points.length, k + 1) };
              });
              return;
            }
          }
        }
      }
      const hit = [...markups].reverse().find((m) => hitTest(m, raw, tol));
      if (hit && s.painter) {
        // Format Painter: apply the picked-up style to the clicked markup (and its group).
        s.updateMarkups(expandGroups(doc.markups, [hit.id]), () => ({ style: { ...s.painter!.style } }));
        useApp.setState({ painter: null, status: 'Format applied' });
        return;
      }
      if (hit) {
        const add = e.ctrlKey || e.metaKey;
        if (add && selected.has(hit.id)) { s.select(doc.selection.filter((x) => x !== hit.id)); return; }
        const ids = expandGroups(doc.markups, selected.has(hit.id) ? doc.selection : add ? [...doc.selection, hit.id] : [hit.id]);
        s.select(ids);
        const movable = ids.filter((id) => !doc.markups.find((m) => m.id === id)?.locked);
        if (movable.length) setDrag({ kind: 'move', start: raw, snapshot: doc.markups, ids: movable, moved: false });
      } else {
        if (!(e.ctrlKey || e.metaKey)) s.select([]);
        setDrag({ kind: 'band', start: raw, cur: raw, add: e.ctrlKey || e.metaKey });
      }
      return;
    }

    // Tool Chest tool in Drawing mode: place a copy of the saved markup, centred on the click (Revu).
    if (!draft && s.preset?.mode === 'drawing' && s.preset.markup) {
      const shape = s.preset.markup;
      const b = bounds(shape.points);
      const moved = translated({ ...shape, id: '', page: pageIdx, author: '', created: '', modified: '' } as Markup, raw.x - (b.minX + b.w / 2), raw.y - (b.minY + b.h / 2));
      const m = s.addMarkup({ ...shape, ...moved, page: pageIdx, scale: undefined, replies: undefined, groupId: undefined, seq: undefined, ...seqFields(shape.type) });
      if (!s.toolLocked && !s.toggles.reuse) s.setTool('select');
      s.select([m.id]);
      return;
    }
    // Area/Volume tool over a cutout: convert it into its own measurement (Shift: all of them).
    if (!draft && (s.tool === 'area' || s.tool === 'volume')) {
      const host = [...markups].reverse().find((m) => (m.type === 'area' || m.type === 'volume') && cutoutAt(m, raw) >= 0);
      if (host) {
        const list = e.shiftKey ? host.cutouts! : [host.cutouts![cutoutAt(host, raw)]];
        for (const c of list) {
          s.addMarkup({
            type: s.tool, page: pageIdx,
            points: c.kind === 'ellipse' ? ellipsePolygon(c.points[0], c.points[1], 256) : c.points,
            style: s.preset?.style ?? s.toolDefaults[s.tool], subject: s.preset?.subject ?? def.subject,
            depth: s.tool === 'volume' ? s.preset?.depth ?? 1 : undefined,
          });
        }
        s.setStatus(`Converted ${list.length} cutout${list.length === 1 ? '' : 's'} to ${def.name}`);
        return;
      }
    }
    // Like Revu, ask for a page scale before the first measurement on an unscaled page.
    if (!draft && isMeasureTool(s.tool) && s.tool !== 'count' && !scaleFor(raw)) {
      s.openScaleDialog({ page: pageIdx, then: s.tool });
      return;
    }
    const prev = draft?.points[draft.points.length - 1];
    const p = constrain(raw, e, prev);

    switch (def.interaction) {
      case 'two-point': case 'box': case 'callout':
        if (!draft) setDraft({ tool: s.tool, points: [p], cursor: p, dragFrom: { x: e.clientX, y: e.clientY } });
        else completeTwoPoint(p);
        break;
      case 'poly': {
        const pts = draft ? [...draft.points, p] : [p];
        if (s.tool === 'radius-3pt' && pts.length >= 3) {
          const c = circleFrom3(pts[0], pts[1], pts[2]);
          if (c) finish('radius', [c.center, pts[0]]);
          else s.setStatus('3-Point Radius: the three points are in a line; pick a point off the line.');
        } else if (def.maxPoints && pts.length >= def.maxPoints) finish(s.tool as MarkupType, pts.slice(0, def.maxPoints));
        else if ((e.ctrlKey || e.metaKey) && CURVABLE.has(s.tool)) {
          // Ctrl+drag: this point gets a curve handlebar, dragged out until release (Revu).
          const handles: Handles = [...(draft?.handles ?? (draft?.points ?? []).map(() => null)), null];
          setDraft({ tool: s.tool, points: pts, cursor: p, handles, curving: pts.length - 1 });
          capture(e);
        } else setDraft({ tool: s.tool, points: pts, cursor: p, handles: draft?.handles ? [...draft.handles, null] : undefined });
        break;
      }
      case 'cutout': case 'cutout-ellipse': {
        if (!draft && s.tool === 'space') {
          setDraft({ tool: s.tool, points: [p], cursor: p, dragFrom: { x: e.clientX, y: e.clientY } });
        } else if (!draft) {
          const t = cutoutTarget(p);
          if (!t) { s.setStatus('Click inside an Area or Volume measurement to cut out from it.'); return; }
          setDraft({ tool: s.tool, points: [p], cursor: p, dragFrom: { x: e.clientX, y: e.clientY }, target: t.id });
        } else if (def.interaction === 'cutout-ellipse') {
          completeTwoPoint(p);
        } else if (draft.points.length >= 3 && dist(p, draft.points[0]) * zoom < 8) {
          finishCutout(draft.points, 'polygon'); // clicked the first point again
        } else {
          setDraft({ ...draft, points: [...draft.points, p] });
        }
        break;
      }
      case 'freehand':
        setDraft({ tool: s.tool, points: [raw], cursor: raw });
        capture(e);
        break;
      case 'point':
        if (s.tool === 'legend') placeLegend(p);
        else if (s.tool === 'image') placeImage(p);
        else if (s.tool === 'attachment') placeAttachment(p);
        else finish(s.tool as MarkupType, [p]);
        break;
      case 'cloudplus':
        // First the cloud (click-click or drag), then a click for the text box.
        if (!draft) setDraft({ tool: s.tool, points: [p], cursor: p, dragFrom: { x: e.clientX, y: e.clientY } });
        else if (draft.points.length === 1) setDraft({ ...draft, points: [draft.points[0], p], dragFrom: undefined });
        else finish('cloudplus', [draft.points[0], draft.points[1], p, { x: p.x + 144, y: p.y + 40 }]);
        break;
      case 'text':
        setDraft({ tool: s.tool, points: [p], cursor: p, dragFrom: { x: e.clientX, y: e.clientY } });
        break;
      case 'erase': {
        eraseSnapshot.current = doc.markups;
        eraseAt(raw);
        capture(e);
        break;
      }
      case 'count': {
        const cur = countId.current && doc.markups.find((m) => m.id === countId.current);
        if (cur) s.updateMarkups([cur.id], (m) => ({ points: [...m.points, p] }));
        else {
          const m = s.addMarkup({
            type: 'count', page: pageIdx, points: [p],
            style: s.preset?.style ?? s.toolDefaults.count,
            subject: s.preset?.subject ?? def.subject,
          });
          countId.current = m.id;
        }
        break;
      }
    }
  };

  const completeTwoPoint = (p: Pt) => {
    if (!draft) return;
    const a = draft.points[0];
    if (dist(a, p) * zoom < 2) return;
    if (draft.tool === 'ellipse-cutout') { finishCutout([a, p], 'ellipse'); return; }
    if (isRegion(draft.tool)) { finishCutout(rectCorners(a, p), 'polygon'); return; }
    if (draft.tool === 'calibrate') {
      setDraft(null);
      const back = s.calibrateFor;
      s.setTool('select');
      useApp.setState({ calibrateFor: null });
      s.openScaleDialog({ ...back, page: back?.page ?? pageIdx, pagePts: dist(a, p) });
      return;
    }
    if (draft.tool === 'snapshot') { takeSnapshot(a, p); return; }
    if (draft.tool === 'erase-content') {
      setDraft(null);
      const [c0, c1] = [a, p].map((q) => page.viewport.convertToPdfPoint(q.x, q.y) as [number, number]);
      const rect: [number, number, number, number] = [Math.min(c0[0], c1[0]), Math.min(c0[1], c1[1]), Math.max(c0[0], c1[0]), Math.max(c0[1], c1[1])];
      let removed = false;
      s.transformDoc(async (lib) => { removed = await eraseContent(lib, pageIdx, rect); }, 'Content erased', pageIdx)
        .then((ok) => { if (ok && !removed) s.setStatus('Erase Content: nothing under that rectangle'); });
      return;
    }
    if (draft.tool === 'region-pick') { setDraft(null); s.setTool('select'); finishPickRect(doc.id, pageIdx, a, p); return; }
    if (draft.tool === 'visual-pick') { setDraft(null); s.setTool('select'); setVisualTemplate(doc, pageIdx, a, p); return; }
    if (draft.tool === 'cloudplus') { setDraft({ ...draft, points: [a, p], dragFrom: undefined }); return; }
    if (def.interaction === 'text') {
      setDraft(null);
      textMarkup((draft.tool === 'redact-text' ? 'redaction' : draft.tool) as MarkupType, a, p).then((ok) => { if (!ok) s.setStatus('No text found there. Drag across text on the drawing.'); });
      return;
    }
    if (draft.tool === 'link') {
      setDraft(null);
      s.setTool('select');
      useApp.setState({ linkDialog: { page: pageIdx, rect: [a, p] } });
      return;
    }
    if (draft.tool === 'highlight') {
      // Over text, Highlight marks the text lines; elsewhere it draws a box (Revu).
      setDraft(null);
      textMarkup('highlight', a, p).then((done) => { if (!done) finish('highlight', [a, p]); });
      return;
    }
    if (draft.tool.startsWith('form-')) {
      setDraft(null);
      newFormField(draft.tool, doc, pageIdx, a, p);
      return;
    }
    if (draft.tool === 'viewport') {
      setDraft(null);
      s.setTool('select');
      s.openScaleDialog({ page: pageIdx, viewport: { rect: [{ x: Math.min(a.x, p.x), y: Math.min(a.y, p.y) }, { x: Math.max(a.x, p.x), y: Math.max(a.y, p.y) }] } });
      return;
    }
    finish(draft.tool as MarkupType, [a, p]);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const raw = toPage(e);
    if (longPress.current && Math.hypot(e.clientX - longPress.current.x, e.clientY - longPress.current.y) > 8) cancelLongPress();
    setCursor(raw, scaleFor(raw));
    if (s.tool === 'dynamic-fill') { fillMove(raw); setFillCursor(raw); }
    if (s.tool === 'eraser') { setFillCursor(raw); if (eraseSnapshot.current) { eraseAt(raw); return; } }
    if (drag) {
      if (drag.kind === 'pan') {
        const el = scrollRef.current!;
        el.scrollLeft = drag.left - (e.clientX - drag.sx);
        el.scrollTop = drag.top - (e.clientY - drag.sy);
      } else if (drag.kind === 'move') {
        const dx = raw.x - drag.start.x, dy = raw.y - drag.start.y;
        const orig = new Map(drag.snapshot.map((m) => [m.id, m]));
        s.updateMarkups(drag.ids, (m) => translated(orig.get(m.id)!, dx, dy), { history: false });
        if (!drag.moved) setDrag({ ...drag, moved: true });
      } else if (drag.kind === 'vertex') {
        const p = snap(raw, drag.id);
        s.updateMarkups([drag.id], (m) => {
          const pts = [...m.points];
          pts[drag.index] = p;
          return { points: pts };
        }, { history: false });
        if (!drag.moved) setDrag({ ...drag, moved: true });
      } else if (drag.kind === 'bezier') {
        const orig = drag.snapshot.find((x) => x.id === drag.id);
        if (orig) {
          const v = orig.points[drag.index];
          const d = { x: raw.x - v.x, y: raw.y - v.y };
          const other = drag.side === 'in' ? 'out' : 'in';
          s.updateMarkups([drag.id], (m) => {
            const H = [...(m.handles ?? [])];
            const h = H[drag.index] ?? { in: { x: 0, y: 0 }, out: { x: 0, y: 0 } };
            // Smooth points stay smooth: the other side turns with it, keeping its length.
            const len = Math.hypot(h[other].x, h[other].y), dl = Math.hypot(d.x, d.y) || 1;
            const o = drag.independent || !len ? h[other] : { x: (-d.x / dl) * len, y: (-d.y / dl) * len };
            H[drag.index] = drag.side === 'in' ? { in: d, out: o } : { out: d, in: o };
            return { handles: H };
          }, { history: false });
        }
      } else if (drag.kind === 'band') {
        setDrag({ ...drag, cur: raw });
      } else if (drag.kind === 'viewport') {
        const [a, b] = drag.orig;
        const dx = raw.x - drag.start.x, dy = raw.y - drag.start.y;
        if (drag.corner < 0) {
          setDrag({ ...drag, rect: [{ x: a.x + dx, y: a.y + dy }, { x: b.x + dx, y: b.y + dy }] });
        } else {
          // Corners 0..3 = top-left, top-right, bottom-right, bottom-left; the opposite one stays.
          const opp = viewportCorners(drag.orig)[(drag.corner + 2) % 4];
          const p = snap(raw);
          setDrag({ ...drag, rect: [{ x: Math.min(opp.x, p.x), y: Math.min(opp.y, p.y) }, { x: Math.max(opp.x, p.x), y: Math.max(opp.y, p.y) }] });
        }
      }
      return;
    }
    if (draft?.curving !== undefined && draft.handles) {
      // Ctrl+drag while drawing: pull out the handlebar of the point just placed (smooth).
      const v = draft.points[draft.curving];
      const out = { x: raw.x - v.x, y: raw.y - v.y };
      const handles = [...draft.handles];
      handles[draft.curving] = Math.hypot(out.x, out.y) * zoom < 3 ? null : { out, in: { x: -out.x, y: -out.y } };
      setDraft({ ...draft, handles, cursor: raw });
      return;
    }
    if (draft) {
      if (def.interaction === 'freehand') {
        setDraft({ ...draft, points: [...draft.points, raw], cursor: raw });
      } else {
        const prev = draft.points[draft.points.length - 1];
        const p = constrain(raw, e, prev);
        setDraft({ ...draft, cursor: p });
        setSnapPt(p !== raw && !e.shiftKey ? p : null);
      }
    } else if (align || (s.tool !== 'select' && s.tool !== 'pan')) {
      const p = snap(raw);
      setSnapPt(p !== raw ? p : null);
      if (def.interaction === 'cutout' || def.interaction === 'cutout-ellipse') setHover(cutoutTarget(raw)?.id ?? null);
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    cancelLongPress();
    buttonDown.current = false;
    if (draft?.curving !== undefined) { setDraft({ ...draft, curving: undefined }); return; }
    if (eraseSnapshot.current) {
      const before = eraseSnapshot.current;
      eraseSnapshot.current = null;
      const now = useApp.getState().docs.find((x) => x.id === doc.id)?.markups;
      if (now && now !== before) s.pushUndo(before);
      return;
    }
    if (e.button === 2) {
      const start = rightDown.current;
      rightDown.current = null;
      const moved = start ? Math.hypot(e.clientX - start.x, e.clientY - start.y) > 4 : false;
      if (drag?.kind === 'band' && drag.right && moved) {
        selectInBand(drag);
        setDrag(null);
        return;
      }
      setDrag(null);
      rightClick(e);
      return;
    }
    if (s.tool === 'dynamic-fill') fillUp();
    if (drag) {
      if ((drag.kind === 'move' || drag.kind === 'vertex') && drag.moved) s.pushUndo(drag.snapshot);
      if (drag.kind === 'bezier') s.pushUndo(drag.snapshot);
      if (drag.kind === 'band') selectInBand(drag);
      if (drag.kind === 'viewport' && drag.rect !== drag.orig) {
        const v = viewports.find((x) => x.id === drag.id);
        const [a, b] = drag.rect;
        if (v && b.x - a.x > 2 && b.y - a.y > 2) s.setViewport(pageIdx, { ...v, rect: drag.rect });
      }
      setDrag(null);
      return;
    }
    if (!draft) return;
    if (def.interaction === 'freehand') {
      if (draft.tool === 'lasso') {
        // Lasso: select the markups drawn entirely inside the loop.
        const loop = draft.points;
        setDraft(null);
        if (loop.length > 2) s.select(markups.filter((m) => outline(m).pts.every((q) => pointInPolygon(q, loop))).map((m) => m.id), e.shiftKey || e.ctrlKey);
        s.setTool('select');
        return;
      }
      if (draft.points.length > 1) finish('pen', draft.points);
      else setDraft(null);
      return;
    }
    // Drag-to-draw for two-point and box tools; click-click otherwise.
    if (['two-point', 'box', 'cutout', 'cutout-ellipse', 'text', 'cloudplus'].includes(def.interaction) && draft.dragFrom && draft.points.length === 1) {
      const moved = Math.hypot(e.clientX - draft.dragFrom.x, e.clientY - draft.dragFrom.y) > 4;
      if (moved) completeTwoPoint(constrain(toPage(e), e, draft.points[0]));
    }
  };

  const selectInBand = (band: Extract<Drag, { kind: 'band' }>) => {
    const b = { minX: Math.min(band.start.x, band.cur.x), maxX: Math.max(band.start.x, band.cur.x), minY: Math.min(band.start.y, band.cur.y), maxY: Math.max(band.start.y, band.cur.y) };
    if (b.maxX - b.minX <= 1 / zoom) return;
    const ids = markups.filter((m) => {
      const mb = markupBounds(m);
      return mb.minX >= b.minX && mb.maxX <= b.maxX && mb.minY >= b.minY && mb.maxY <= b.maxY;
    }).map((m) => m.id);
    s.select(ids, band.add);
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if (s.tool === 'dynamic-fill') { finishBoundary(); return; }
    if (draft && isRegion(draft.tool)) {
      const pts = draft.points.slice(0, -1); // the double-click's second click added a point
      if (pts.length >= 3) finishCutout(pts, 'polygon');
      return;
    }
    if (draft && def.interaction === 'poly') {
      // the second click of the double-click added a duplicate point
      const pts = draft.points.slice(0, -1);
      const min = def.closed ? 3 : 2;
      if (pts.length >= min) finish(draft.tool as MarkupType, pts);
      return;
    }
    if (s.tool === 'select') {
      const raw = toPage(e);
      const hit = [...markups].reverse().find((m) => hitTest(m, raw, 5 / zoom));
      if (!hit) return;
      if (['textbox', 'callout', 'typewriter', 'cloudplus'].includes(hit.type)) setEditing(hit.id);
      else if (hit.type === 'link') followLink(hit);
      else if (hit.type === 'attachment' && hit.file) downloadBase64(hit.file.name, hit.file.mime, hit.file.data);
    }
  };

  const followLink = (m: Markup) => {
    if (m.link?.uri) window.open(m.link.uri, '_blank', 'noopener');
    else if (m.link?.file) {
      const target = s.docs.find((x) => x.name === m.link!.file);
      if (!target) { s.setStatus(`Open ${m.link.file} (or its Set) to follow this link`); return; }
      s.setActive(target.id);
      s.setPage(m.link.page ?? 0);
    } else if (m.link?.page !== undefined) s.setViewPage(pane, m.link.page);
  };

  // The browser's own menu is suppressed; the right button is handled on pointer-up.
  const onContextMenu = (e: React.MouseEvent) => e.preventDefault();

  // ----- touch: long press = right-click -----
  const longPress = useRef<{ x: number; y: number; t: number } | null>(null);
  const cancelLongPress = () => { if (longPress.current) { clearTimeout(longPress.current.t); longPress.current = null; } };
  const startLongPress = (e: React.PointerEvent) => {
    cancelLongPress();
    const at = { clientX: e.clientX, clientY: e.clientY };
    const t = window.setTimeout(() => {
      longPress.current = null;
      setDrag(null);
      setDraft(null);
      rightClick(at);
    }, 550);
    longPress.current = { x: e.clientX, y: e.clientY, t };
  };

  const rightClick = (e: { clientX: number; clientY: number }) => {
    if (draft) { finishPoly(); return; }
    // Right-click leaves a drawing tool, including Reuse mode (Revu).
    if (s.tool !== 'select') {
      if (countId.current) countId.current = null;
      s.setTool('select');
      return;
    }
    const raw = toPage(e);
    const hit = [...markups].reverse().find((m) => hitTest(m, raw, 5 / zoom));
    const items: MenuItem[] = [];
    const holeOwner = !hit && [...markups].reverse().find((m) => m.cutouts?.length && pointInPolygon(raw, m.points) && cutoutAt(m, raw) >= 0);
    if (holeOwner) {
      const i = cutoutAt(holeOwner, raw);
      items.push({ label: 'Delete Cutout', action: () => s.updateMarkups([holeOwner.id], (m) => ({ cutouts: m.cutouts!.filter((_, k) => k !== i) })) });
    } else if (hit) {
      if (!selected.has(hit.id)) s.select([hit.id]);
      const ids = selected.has(hit.id) ? doc.selection : [hit.id];
      if (CURVABLE.has(hit.type) && !hit.locked) {
        // Control point menu (Revu): curve a point, or turn a line into an arc.
        const vi = hit.points.findIndex((q) => dist(q, raw) <= 6 / zoom);
        const si = segmentAt(hit, raw, 6 / zoom);
        if (vi >= 0) items.push({ label: hit.handles?.[vi] ? 'Convert Control Point to Straight' : 'Convert Control Point to Curve',
          action: () => s.updateMarkups([hit.id], (x) => ({ handles: cleanHandles(toggleCurve(x.points, x.handles, vi, closedType(x.type))) })) });
        else if (si >= 0) {
          items.push({ label: 'Convert to Arc', action: () => s.updateMarkups([hit.id], (x) => ({ handles: arcSegment(x.points, x.handles, si, closedType(x.type)) })) });
          items.push({ label: 'Add Control Point', action: () => s.updateMarkups([hit.id], (x) => {
            const pts = [...x.points]; pts.splice(si + 1, 0, raw);
            return { points: pts, handles: insertHandle(x.handles, x.points.length, si + 1) };
          }) });
        }
        if (vi >= 0 && hit.points.length > (closedType(hit.type) ? 3 : 2)) {
          items.push({ label: 'Subtract Control Point', action: () => s.updateMarkups([hit.id], (x) => ({ points: x.points.filter((_, k) => k !== vi), handles: removeHandle(x.handles, vi) })) });
        }
        items.push({ sep: true });
      }
      items.push(
        { label: 'Properties', action: () => s.setPanels({ right: 'properties' }) },
        { label: 'Add to My Tools', action: () => s.addToToolChest(hit) },
        ...(hit.seq ? [{ label: 'Select Sequence', action: () => s.select(sequenceMembers(doc.markups, hit)) }] : []),
        { sep: true },
        ...(['None', 'Accepted', 'Rejected', 'Cancelled', 'Completed'] as const).map((st) => ({
          label: `Status: ${st}`, checked: hit.status === st, action: () => s.updateMarkups(ids, () => ({ status: st })),
        })),
        { sep: true },
        // Revu: right-click > Layer > (a layer) / Create New Layer.
        ...layerIds(doc.layers?.order ?? []).map((id) => ({
          label: `Layer › ${doc.layers!.layers[id].name}`, checked: hit.layer === id,
          action: () => s.updateMarkups(ids, () => ({ layer: hit.layer === id ? undefined : id })),
        })),
        { label: 'Layer › Create New Layer…', action: () => {
          const name = prompt('Layer name', `Layer ${Object.keys(doc.layers?.layers ?? {}).length + 1}`);
          const id = name ? addLayer(name, null, 'after') : null;
          if (id) s.updateMarkups(ids, () => ({ layer: id }));
        } },
        { sep: true },
        { label: 'Copy', shortcut: 'Ctrl+C', action: () => s.copy() },
        { label: 'Delete', shortcut: 'Del', action: () => s.deleteMarkups(ids), disabled: !!hit.locked },
        { label: 'Reply', action: () => { s.setPanels({ markupsList: true }); useApp.setState({ replyTo: hit.id }); } },
        { label: hit.checked ? 'Uncheck' : 'Check', action: () => s.updateMarkups(ids, () => ({ checked: !hit.checked || undefined })) },
        { label: 'Clear All Checkmarks', action: () => s.updateMarkups(doc.markups.filter((x) => x.checked).map((x) => x.id), () => ({ checked: undefined })) },
        { label: 'Create Legend', action: () => {
          const sel = doc.markups.filter((m) => ids.includes(m.id) && m.type !== 'legend');
          useApp.setState({ legendKeys: [...new Set(sel.map(legendKey))] });
          s.setTool('legend');
          s.setStatus('Click on the drawing to place the Legend.');
        } },
        { sep: true },
        ...arrangeItems(),
      );
    } else {
      items.push(
        { label: 'Paste', shortcut: 'Ctrl+V', action: () => s.paste(), disabled: !s.clipboard.length },
        { label: 'Select All', shortcut: 'Ctrl+A', action: () => s.select(markups.map((m) => m.id)) },
        { sep: true },
        { label: 'Fit Page', action: fitPage },
        { label: 'Fit Width', action: fitWidth },
      );
    }
    setMenu({ x: e.clientX, y: e.clientY, items });
  };

  // ----- draft preview -----
  let preview: Markup | null = null;
  if (draft && draft.cursor && (isRegion(draft.tool) || draft.tool === 'ellipse-cutout')) {
    const target = markups.find((m) => m.id === draft.target);
    const pts = [...draft.points, draft.cursor];
    preview = {
      id: 'draft', type: isRegion(draft.tool) ? 'polyline' : 'ellipse', page: pageIdx,
      points: isRegion(draft.tool) && pts.length === 2 && buttonDown.current ? [...rectCorners(pts[0], pts[1]), pts[0]] : pts,
      style: { ...(target?.style ?? s.toolDefaults.area), fill: null, lineStyle: 'dashed' },
      subject: '', label: '', comment: '', author: '', created: '', modified: '', status: 'None',
    };
  } else if (draft && draft.cursor) {
    const pts = def.interaction === 'freehand' || draft.curving !== undefined ? draft.points : [...draft.points, draft.cursor];
    const boxed = draft.tool.startsWith('form-') || draft.tool === 'lasso' || draft.tool === 'redact-text' || draft.tool === 'viewport' || draft.tool === 'snapshot' || draft.tool === 'visual-pick' || draft.tool === 'region-pick' || draft.tool === 'erase-content' || draft.tool === 'link' || def.interaction === 'text';
    let type = (draft.tool === 'calibrate' ? 'length' : boxed ? 'rectangle' : draft.tool) as MarkupType;
    let P = pts;
    if (draft.tool === 'cloudplus' && pts.length >= 3) P = [pts[0], pts[1], pts[2], { x: pts[2].x + 144, y: pts[2].y + 40 }];
    if (draft.tool === 'radius-3pt') {
      const c = pts.length === 3 ? circleFrom3(pts[0], pts[1], pts[2]) : null;
      type = c ? 'radius' : 'polyline';
      if (c) P = [c.center, pts[0]];
    }
    if (type === 'cloud' && pts.length === 2) P = rectCorners(pts[0], pts[1]);
    if (type === 'callout') P = [pts[0], pts[1], { x: pts[1].x + 144, y: pts[1].y + 40 }];
    preview = {
      id: 'draft', type, page: pageIdx, points: P,
      style: draft.tool === 'calibrate' ? { ...s.toolDefaults.length, color: '#00a000' }
        : boxed ? { ...s.toolDefaults.rectangle, color: '#1a73e8', fill: null, width: 1, lineStyle: 'dashed' }
          : s.preset?.style ?? s.toolDefaults[type],
      subject: '', label: '', comment: '', author: '', created: '', modified: '', status: 'None',
      scale: scaleFor(draft.points[0]) ?? undefined, depth: s.preset?.depth ?? 1,
      handles: draft.handles && CURVABLE.has(type) && P === pts ? [...draft.handles, null].slice(0, P.length) : undefined,
    };
  }

  const editingMarkup = editing ? doc.markups.find((m) => m.id === editing) : null;
  const cursor = align ? 'crosshair' : tool === 'pan' ? (drag?.kind === 'pan' ? 'grabbing' : 'grab')
    : tool === 'select' ? 'default' : tool === 'zoom' ? 'zoom-in' : 'crosshair';

  return (
    <div className={`viewer-wrap ${split ? (isActivePane ? 'pane-active' : 'pane-inactive') : ''} ${s.toggles.rulers ? 'with-rulers' : ''}`}
      onPointerDownCapture={() => { if (split && !isActivePane) s.focusPane(pane); }}>
    <div className="viewer" ref={scrollRef} onScroll={onScroll} onPointerLeave={() => { pointerIn.current = false; }}>
      <div style={{ width: innerW, height: innerH, position: 'relative' }} onPointerMove={onLayoutMove}>
        {multi && (() => {
          const el = scrollRef.current;
          const vy = el?.scrollTop ?? 0, vh = el?.clientHeight ?? size.h;
          return lay.slots.filter((x) => x.y < vy + vh * 2 && x.y + x.h > vy - vh).map((x) => (
            <PageTile key={x.index} doc={doc} slot={x} zoom={zoom} rot={rot} active={x.index === page.index}
              onActivate={() => activate(x.index)} />
          ));
        })()}
        <div className="page" data-rendered={renderedIdx === page.index ? page.index + 1 : undefined} style={{
          left, top, width: pw, height: ph, transform: rotateCss(pw, ph, rot), transformOrigin: '0 0',
          ...(multi ? { background: 'transparent', boxShadow: 'none' } : {}),
        }}>
          <canvas ref={baseRef} style={{ width: pw, height: ph, visibility: multi && renderedIdx !== page.index ? 'hidden' : undefined }} />
          <canvas ref={detailRef} style={detail ? {
            left: detail.x * zoom, top: detail.y * zoom, width: detail.w * zoom, height: detail.h * zoom,
          } : { display: 'none' }} />
          {s.toggles.dimmer && <div className="dimmer" style={{ opacity: 1 - s.dimLevel / 100 }} />}
          {s.tool === 'dynamic-fill' && <FillOverlay width={pw} height={ph} pageW={page.width} pageH={page.height} cursor={fillCursor} />}
          <svg ref={svgRef} className="markup-layer" width={pw} height={ph}
            viewBox={`0 0 ${page.width} ${page.height}`} style={{ cursor }}
            onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
            onDoubleClick={onDoubleClick} onContextMenu={onContextMenu}
            onPointerLeave={() => setCursor(null, null)}>
            {s.toggles.grid && (
              <>
                <defs>
                  <pattern id="grid" width={GRID} height={GRID} patternUnits="userSpaceOnUse">
                    <path d={`M${GRID} 0H0V${GRID}`} fill="none" stroke="#3a7bd5" strokeOpacity={0.25} strokeWidth={0.3} />
                  </pattern>
                </defs>
                <rect width={page.width} height={page.height} fill="url(#grid)" pointerEvents="none" />
              </>
            )}
            {((s.spacesHighlight && s.left === 'spaces') || s.tool === 'space' || s.activeSpace) && (doc.spaces[pageIdx] ?? [])
              .filter((sp) => (s.spacesHighlight && s.left === 'spaces') || s.tool === 'space' || sp.id === s.activeSpace).map((sp) => (
                <g key={sp.id} className="space-shape" pointerEvents="none">
                  <polygon points={sp.points.map((q) => `${q.x},${q.y}`).join(' ')} fill={sp.color} fillOpacity={sp.opacity}
                    stroke={sp.color} strokeOpacity={sp.id === s.activeSpace ? 0.9 : 0.4} strokeWidth={(sp.id === s.activeSpace ? 2 : 1) / zoom} />
                  <text x={Math.min(...sp.points.map((q) => q.x)) + 3 / zoom} y={Math.min(...sp.points.map((q) => q.y)) + 12 / zoom}
                    fontSize={10 / zoom} fill={sp.color} fillOpacity={0.9}>{sp.title}</text>
                </g>
              ))}
            {(isMeasureTool(s.tool) || s.tool === 'viewport' || s.tool === 'calibrate') && viewports.map((v) => (
              <ViewportBox key={v.id} v={v} zoom={zoom} />
            ))}
            {s.activeViewport && !isMeasureTool(s.tool) && viewports.filter((v) => v.id === s.activeViewport).map((v) => (
              <ViewportBox key={v.id} v={drag?.kind === 'viewport' && drag.id === v.id ? { ...v, rect: drag.rect } : v}
                zoom={zoom} active handles={s.tool === 'select'} />
            ))}
            {search.docId === doc.id && search.hits.map((h, i) => h.page === pageIdx && (
              <rect key={`hit${i}`} className={`search-hl ${i === search.index ? 'active' : ''}`} pointerEvents="none"
                x={Math.min(h.rect[0].x, h.rect[1].x) - 1} y={Math.min(h.rect[0].y, h.rect[1].y) - 1}
                width={Math.abs(h.rect[1].x - h.rect[0].x) + 2} height={Math.abs(h.rect[1].y - h.rect[0].y) + 2} />
            ))}
            {markups.map((m) => <MarkupShape key={m.id} m={m} />)}
            {preview && <g pointerEvents="none"><MarkupShape m={preview} ghost /></g>}
            {hover && !draft && (s.tool === 'cutout' || s.tool === 'ellipse-cutout') && (() => {
              const m = markups.find((x) => x.id === hover);
              return m ? <polygon points={m.points.map((q) => `${q.x},${q.y}`).join(' ')} fill="#1a73e8" fillOpacity={0.12}
                stroke="#1a73e8" strokeWidth={2 / zoom} pointerEvents="none" /> : null;
            })()}
            {markups.filter((m) => selected.has(m.id)).map((m) => {
              const b = markupBounds(m);
              const pad = 3 / zoom + m.style.width / 2;
              return (
                <g key={`sel-${m.id}`} pointerEvents="none">
                  <rect x={b.minX - pad} y={b.minY - pad} width={b.w + pad * 2} height={b.h + pad * 2}
                    fill="none" stroke="#1a73e8" strokeWidth={1 / zoom} strokeDasharray={`${4 / zoom} ${3 / zoom}`} />
                  {doc.selection.length === 1 && m.handles?.map((h, i) => h && (['in', 'out'] as const).filter((k) => h[k].x || h[k].y).map((k) => {
                    const v = m.points[i], q = { x: v.x + h[k].x, y: v.y + h[k].y };
                    return (
                      <g key={`bz${i}${k}`} className="bezier-handle">
                        <line x1={v.x} y1={v.y} x2={q.x} y2={q.y} stroke="#1a73e8" strokeWidth={1 / zoom} />
                        <circle cx={q.x} cy={q.y} r={3.5 / zoom} fill="#1a73e8" stroke="#fff" strokeWidth={1 / zoom} />
                      </g>
                    );
                  }))}
                  {doc.selection.length === 1 && handlePoints(m).map((h, i) => (
                    <rect key={i} x={h.x - 3.5 / zoom} y={h.y - 3.5 / zoom} width={7 / zoom} height={7 / zoom}
                      fill="#fff" stroke="#1a73e8" strokeWidth={1 / zoom} />
                  ))}
                </g>
              );
            })}
            {drag?.kind === 'band' && (
              <rect x={Math.min(drag.start.x, drag.cur.x)} y={Math.min(drag.start.y, drag.cur.y)}
                width={Math.abs(drag.cur.x - drag.start.x)} height={Math.abs(drag.cur.y - drag.start.y)}
                fill="#1a73e8" fillOpacity={0.08} stroke="#1a73e8" strokeWidth={1 / zoom} pointerEvents="none" />
            )}
            {s.tool === 'eraser' && fillCursor && (
              <circle cx={fillCursor.x} cy={fillCursor.y} r={8 / zoom} fill="none" stroke="#555" strokeWidth={1 / zoom} pointerEvents="none" />
            )}
            {alignPts.map((q, i) => (
              <g key={`al${i}`} pointerEvents="none" stroke="#e00000" strokeWidth={1.5 / zoom}>
                <circle cx={q.x} cy={q.y} r={6 / zoom} fill="none" />
                <path d={`M${q.x - 10 / zoom} ${q.y}H${q.x + 10 / zoom}M${q.x} ${q.y - 10 / zoom}V${q.y + 10 / zoom}`} />
              </g>
            ))}
            {snapPt && (
              <rect x={snapPt.x - 5 / zoom} y={snapPt.y - 5 / zoom} width={10 / zoom} height={10 / zoom}
                fill="none" stroke="#00b050" strokeWidth={1.5 / zoom} pointerEvents="none" />
            )}
          </svg>
          {textEdit && (
            <input className="edit-text-input" aria-label="Edit text" autoFocus defaultValue={textEdit.str}
              style={{ left: textEdit.x0 * zoom - 2, top: textEdit.y0 * zoom - 2, width: Math.max(60, (textEdit.x1 - textEdit.x0) * zoom * 1.4 + 8), height: (textEdit.y1 - textEdit.y0) * zoom + 4, fontSize: (textEdit.y1 - textEdit.y0) * zoom * 0.75 }}
              onPointerDown={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Escape') setTextEdit(null);
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              }}
              onBlur={(e) => {
                const box = textEdit, text = e.target.value;
                setTextEdit(null);
                if (text === box.str) return;
                // Shrink the box a little so neighbouring runs are not touched.
                const h = box.y1 - box.y0;
                const [c0, c1] = [{ x: box.x0 + 0.3, y: box.y0 + h * 0.2 }, { x: box.x1 - 0.3, y: box.y1 - h * 0.2 }].map((q) => page.viewport.convertToPdfPoint(q.x, q.y) as [number, number]);
                const rect: [number, number, number, number] = [Math.min(c0[0], c1[0]), Math.min(c0[1], c1[1]), Math.max(c0[0], c1[0]), Math.max(c0[1], c1[1])];
                let res = { reusedFont: false, found: false };
                s.transformDoc(async (lib) => { res = await editText(lib, pageIdx, rect, box.str, text, box.font); }, 'Text edited', pageIdx)
                  .then((ok) => { if (ok) s.setStatus(!res.found ? 'Edit Text: that text could not be found in the page content' : res.reusedFont ? 'Text edited' : 'Text edited (new characters use a standard font)'); });
              }} />
          )}
          {doc.loaded.fields.length > 0 && <FormLayer doc={doc} pageIdx={pageIdx} zoom={zoom} interactive={s.tool === 'select' || s.tool === 'pan'} />}
          {editingMarkup && (
            <TextEditor m={editingMarkup} zoom={zoom} onDone={(text) => {
              if (text !== (editingMarkup.text ?? '')) {
                s.updateMarkups([editingMarkup.id], (m) => m.type === 'typewriter'
                  ? { text, points: typewriterBox(m.points[0], text, m.style.fontSize) } : { text });
              }
              setEditing(null);
            }} />
          )}
        </div>
      </div>
      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
    </div>
      {(s.toggles.rulers || s.toggles.crosshair) && (
        <ViewOverlays scrollRef={scrollRef} zoom={zoom} rulers={s.toggles.rulers} crosshair={s.toggles.crosshair}
          page={{ x0: left, x1: left + slot.w, y0: top, y1: top + slot.h }} selection={selectionBox} />
      )}
      {s.tool === 'dynamic-fill' && <DynamicFillBar />}
      {align && isActivePane && (
        <div className="fill-bar" role="status" aria-label="Alignment points">
          <strong>Align Points</strong>
          <span>{pickingPrompt(align.picking!)}</span>
          <button onClick={cancelPicking}>Cancel</button>
        </div>
      )}
      {s.tool === 'stamp' && (
        <div className="fill-bar" role="toolbar" aria-label="Stamp">
          <strong>Stamp</strong>
          <select aria-label="Stamp" value={s.stampName} onChange={(e) => useApp.setState({ stampName: e.target.value })}>
            {STAMPS.map((x) => <option key={x}>{x}</option>)}
          </select>
          <span className="muted">Click on the drawing to place it.</span>
        </div>
      )}
      <MeasurePreview markup={preview && MEASURE_TYPES.has(preview.type) && preview.scale ? preview : null} />
    </div>
  );
}

/**
 * A page other than the active one in a continuous or side-by-side view:
 * its drawing and markups, display only. The active page is drawn on top of
 * its tile by the Viewer, so the tile shows while that page re-renders.
 */
function PageTile({ doc, slot, zoom, rot, active, onActivate }: {
  doc: DocState; slot: Slot; zoom: number; rot: ViewRotation; active: boolean; onActivate: () => void;
}) {
  const pg = doc.loaded.pages[slot.index];
  const ref = useRef<HTMLCanvasElement>(null);
  const done = useRef(false);
  const pw = pg.width * zoom, ph = pg.height * zoom;
  const sc = Math.min(zoom * (window.devicePixelRatio || 1), Math.sqrt(TILE_MAX_PIXELS / (pg.width * pg.height)));
  const forms = doc.loaded.fields.length > 0;
  useEffect(() => {
    let task: RenderTask | null = null, alive = true;
    const t = setTimeout(async () => {
      const p = await doc.loaded.pdf.getPage(slot.index + 1);
      if (!alive) return;
      const vp = p.getViewport({ scale: sc });
      const off = document.createElement('canvas');
      off.width = Math.ceil(vp.width); off.height = Math.ceil(vp.height);
      task = p.render({ canvas: off, viewport: vp, annotationMode: forms ? 2 : 1, optionalContentConfigPromise: ocConfig(doc, zoom) });
      task.promise.then(() => {
        const c = ref.current;
        if (!c || !alive) return;
        c.width = off.width; c.height = off.height;
        c.getContext('2d')!.drawImage(off, 0, 0);
        off.width = off.height = 0;
        done.current = true;
        // The picture is kept; pdf.js can drop what it parsed for this page.
        p.cleanup();
      }).catch(() => {});
    }, done.current ? 200 : 90); // pages that only fly past during a fast scroll are not rendered
    return () => { alive = false; clearTimeout(t); task?.cancel(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.loaded.pdf, slot.index, Math.round(sc * 20), visibilityKey(doc, zoom)]);
  const markups = active ? [] : doc.markups.filter((m) => m.page === slot.index && markupShown(doc, m, zoom));
  const dim = useApp((s) => (s.toggles.dimmer ? 1 - s.dimLevel / 100 : 0));
  return (
    <div className="page-tile" data-page={slot.index + 1} onPointerDown={onActivate}
      style={{ left: slot.x, top: slot.y, width: pw, height: ph, transform: rotateCss(pw, ph, rot), transformOrigin: '0 0' }}>
      <canvas ref={ref} style={{ width: pw, height: ph }} />
      {dim > 0 && <div className="dimmer" style={{ opacity: dim }} />}
      {markups.length > 0 && (
        <svg width={pw} height={ph} viewBox={`0 0 ${pg.width} ${pg.height}`} pointerEvents="none">
          {markups.map((m) => <MarkupShape key={m.id} m={m} />)}
        </svg>
      )}
    </div>
  );
}

/** Index of the segment of a curvable markup passing within `tol` of `p`, or -1. */
function segmentAt(m: Markup, p: Pt, tol: number): number {
  const segs = segments(m.points, m.handles, closedType(m.type));
  return segs.findIndex(([a, c1, c2, b]) => {
    if (!c1 || !c2) return distToSegment(p, a, b) <= tol;
    let prev = a;
    for (let k = 1; k <= 24; k++) {
      const q = bezierAt(a, c1, c2, b, k / 24);
      if (distToSegment(p, prev, q) <= tol) return true;
      prev = q;
    }
    return false;
  });
}

/** No handles at all reads as "no curves". */
const cleanHandles = (h: Handles): Handles | undefined => (hasCurves(h) ? h : undefined);

/** Tools that draw a region: drag a rectangle, or click points and close the shape. */
const isRegion = (t: ToolId) => t === 'cutout' || t === 'space';
const isMeasureTool = (t: ToolId) => MEASURE_TYPES.has(t) || t === 'radius-3pt';

/** Corners of a viewport rectangle: top-left, top-right, bottom-right, bottom-left. */
const viewportCorners = ([a, b]: [Pt, Pt]): Pt[] => [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }];

/**
 * A viewport outline with its name and scale. Revu highlights viewports
 * while measuring, and the one picked in the Measurements panel.
 */
function ViewportBox({ v, zoom, active, handles }: { v: Viewport; zoom: number; active?: boolean; handles?: boolean }) {
  const [a, b] = v.rect;
  const fs = 11 / zoom;
  return (
    <g className="viewport-box" pointerEvents="none">
      {handles && viewportCorners(v.rect).map((h, i) => (
        <rect key={i} x={h.x - 3.5 / zoom} y={h.y - 3.5 / zoom} width={7 / zoom} height={7 / zoom} fill="#fff" stroke="#1a73e8" strokeWidth={1 / zoom} />
      ))}
      <rect x={a.x} y={a.y} width={b.x - a.x} height={b.y - a.y} fill="#1a73e8" fillOpacity={active ? 0.1 : 0.04}
        stroke="#1a73e8" strokeWidth={(active ? 2 : 1) / zoom} strokeDasharray={`${6 / zoom} ${3 / zoom}`} />
      <text x={a.x + 4 / zoom} y={a.y + fs + 3 / zoom} fontSize={fs} fill="#1a73e8" fontFamily="sans-serif">
        {`${v.name || '(unnamed)'}: ${v.scale.label}`}
      </text>
    </g>
  );
}

/**
 * Live values while placing a measurement on a calibrated page, in the
 * lower-right corner of the drawing (Revu). X hides it; the icon recalls it.
 */
function MeasurePreview({ markup }: { markup: Markup | null }) {
  const [hidden, setHidden] = useState(false);
  if (!markup) return null;
  if (hidden) {
    return <button className="measure-preview-icon" title="Show measurement values" onClick={() => setHidden(false)}><Icon name="measurements" size={16} /></button>;
  }
  const v = measure(markup)!;
  const s = markup.scale!;
  const f = resolveFormat(s);
  const len = (x: number) => formatLength(x, s.unit, f.decimals, f.den, f.trim);
  const P = markup.points;
  const rows: [string, string][] = [];
  if (v.length !== undefined) rows.push([markup.type === 'area' ? 'Perimeter' : markup.type === 'radius' ? 'Radius' : markup.type === 'diameter' ? 'Diameter' : 'Length', len(v.length)]);
  if (v.area !== undefined) rows.push(['Area', `${formatNumber(v.area, f.decimals, f.trim)} ${f.areaLabel}`]);
  if (v.volume !== undefined) rows.push(['Volume', `${formatNumber(v.volume, f.decimals, f.trim)} ${f.volumeLabel}`]);
  if (v.angle !== undefined) rows.push(['Angle', v.text]);
  if (v.count !== undefined) rows.push(['Count', v.text]);
  const Q = stretchY(P, s);
  if (P.length > 2 && markup.type !== 'angle') rows.push(['Segment', len(dist(Q[Q.length - 2], Q[Q.length - 1]) * s.factor)]);
  return (
    <div className="measure-preview">
      <button className="measure-preview-close" title="Hide" onClick={() => setHidden(true)}><Icon name="close" size={10} /></button>
      <table><tbody>{rows.map(([k, x]) => <tr key={k}><td>{k}</td><td>{x}</td></tr>)}</tbody></table>
    </div>
  );
}

function TextEditor({ m, zoom, onDone }: { m: Markup; zoom: number; onDone: (t: string) => void }) {
  const [text, setText] = useState(m.text ?? '');
  const box = m.type === 'callout' ? [m.points[1], m.points[2]] : m.type === 'cloudplus' ? [m.points[2], m.points[3]]
    : m.type === 'typewriter' ? typewriterBox(m.points[0], text, m.style.fontSize) : [m.points[0], m.points[1]];
  const x = Math.min(box[0].x, box[1].x), y = Math.min(box[0].y, box[1].y);
  const w = Math.abs(box[1].x - box[0].x), h = Math.abs(box[1].y - box[0].y);
  return (
    <textarea className="text-editor" spellCheck lang="en" autoFocus value={text}
      style={{ left: x * zoom, top: y * zoom, width: w * zoom, height: h * zoom, fontSize: m.style.fontSize * zoom, color: m.style.color }}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => onDone(text)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape' || (e.key === 'Enter' && e.ctrlKey)) (e.target as HTMLTextAreaElement).blur();
      }} />
  );
}

/** Live inputs for the page's form fields (text, check boxes, radio buttons, lists). */
function FormLayer({ doc, pageIdx, zoom, interactive }: { doc: DocState; pageIdx: number; zoom: number; interactive: boolean }) {
  const s = useApp();
  const items = doc.loaded.fields.flatMap((f) => f.widgets.filter((w) => w.page === pageIdx).map((w, i) => ({ f, w, i })));
  return (
    <div className="form-layer" style={{ pointerEvents: 'none' }}>
      {items.map(({ f, w, i }) => {
        const [x0, y0, x1, y1] = w.rect;
        const style: React.CSSProperties = { left: x0 * zoom, top: y0 * zoom, width: (x1 - x0) * zoom, height: (y1 - y0) * zoom, fontSize: Math.max(8, Math.min(14, (y1 - y0) * 0.65)) * zoom, pointerEvents: interactive && !f.readOnly ? 'auto' : 'none' };
        const value = f.name in doc.formValues ? doc.formValues[f.name] : f.value;
        const set = (v: string | boolean) => s.setFieldValue(f.name, v);
        const key = `${f.name}:${i}`;
        const stop = { onPointerDown: (e: React.PointerEvent) => e.stopPropagation(), onKeyDown: (e: React.KeyboardEvent) => e.stopPropagation() };
        switch (f.type) {
          case 'text':
            return f.multiline
              ? <textarea key={key} className="form-field" aria-label={f.name} style={style} value={String(value)} onChange={(e) => set(e.target.value)} {...stop} />
              : <input key={key} className="form-field" aria-label={f.name} style={style} value={String(value)} onChange={(e) => set(e.target.value)} {...stop} />;
          case 'checkbox':
            return <input key={key} type="checkbox" className="form-field" aria-label={f.name} style={style} checked={!!value} onChange={(e) => set(e.target.checked)} {...stop} />;
          case 'radio':
            return <input key={key} type="radio" className="form-field" aria-label={`${f.name} ${w.option}`} style={style} name={`${doc.id}:${f.name}`} checked={value === w.option} onChange={() => set(w.option ?? '')} {...stop} />;
          case 'dropdown': case 'list':
            return (
              <select key={key} className="form-field" aria-label={f.name} style={style} value={String(value)} onChange={(e) => set(e.target.value)} {...stop}>
                <option value="" />
                {(f.options ?? []).map((o) => <option key={o}>{o}</option>)}
              </select>
            );
          case 'signature':
            // Signed: the signature's own appearance shows on the page.
            return value ? null : (
              <div key={key} className="form-field signature-field" style={style} role="button" title="Signature field: click to sign with your digital ID"
                onClick={() => openSignDialog(f.name)} {...stop}>Sign here</div>
            );
          default:
            return <div key={key} className="form-field button-field" style={style} />;
        }
      })}
    </div>
  );
}
