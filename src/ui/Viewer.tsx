import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PDFPageProxy, RenderTask } from 'pdfjs-dist';
import { useApp, type DocState } from '../model/store';
import { MEASURE_TYPES, bounds, dist, distToSegment, pointInPolygon, formatLength, formatNumber, measure, ortho, rectCorners, resolveFormat, scaleAt, stretchY, circleFrom3 } from '../model/measure';
import { Icon } from './icons';
import { eraseStroke, translated, typewriterBox } from '../model/markup';
import { useSearch } from './Search';
import { STAMPS, downloadBase64, loadImage, pageText, pickFile, readAsDataUrl, snapshot, textRectsIn } from './toolActions';
import { applyCutout, ellipsePolygon } from '../model/cutouts';
import { expandGroups } from '../model/arrange';
import { arrangeItems } from './arrangeMenu';
import { legendKey, legendLayout, legendRows, type LegendDef } from '../model/legend';
import { DynamicFillBar, FillOverlay, buildMask, fillDown, fillMove, fillUp, finishBoundary, resetFill, useFill } from './DynamicFill';
import type { Markup, MarkupType, Pt, ToolId, Viewport } from '../model/types';
import { toolById } from '../tools/tools';
import { MarkupShape, handlePoints } from './renderMarkup';
import { cutoutAt, hitTest, markupBounds, outline } from './hit';
import { setCursor } from './cursor';
import { ContextMenu, type MenuItem } from './ContextMenu';
import { snapGeometry, snapToContent, type SnapGeometry } from '../pdf/geometry';

const PAD = 40;
const BASE_MAX_PIXELS = 6e6;

/** Imperative hooks for menus/toolbar (fit page etc.). */
export const viewerApi = {
  fitPage: () => {},
  fitWidth: () => {},
  zoomBy: (_f: number) => {},
  /** Scroll so page point `p` is in the middle of the view. */
  centerOn: (_p: Pt) => {},
};

type Draft = { tool: ToolId; points: Pt[]; cursor: Pt | null; dragFrom?: { x: number; y: number }; target?: string };
type Drag =
  | { kind: 'pan'; sx: number; sy: number; left: number; top: number }
  | { kind: 'move'; start: Pt; snapshot: Markup[]; ids: string[]; moved: boolean }
  | { kind: 'vertex'; id: string; index: number; snapshot: Markup[]; moved: boolean }
  | { kind: 'band'; start: Pt; cur: Pt; add: boolean; right?: { x: number; y: number } }
  /** Move (corner -1) or resize (corner 0..3) the highlighted viewport. */
  | { kind: 'viewport'; id: string; corner: number; start: Pt; orig: [Pt, Pt]; rect: [Pt, Pt] };

const isEditable = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

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
  const [baseScale, setBaseScale] = useState(0);
  const [detail, setDetail] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [snapPt, setSnapPt] = useState<Pt | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
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

  const pw = page.width * zoom, ph = page.height * zoom;
  const innerW = Math.max(size.w, pw + PAD * 2), innerH = Math.max(size.h, ph + PAD * 2);
  const left = (innerW - pw) / 2, top = (innerH - ph) / 2;
  const markups = doc.markups.filter((m) => m.page === pageIdx);
  const viewports = doc.viewports[pageIdx] ?? [];
  /** Scale a measurement starting at `p` would use (viewport, else page). */
  const scaleFor = (p: Pt | undefined) => scaleAt(doc.calibrations[pageIdx], viewports, p);
  const selected = new Set(doc.selection);

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
    snapGeometry(pdfPage, page.viewport).then((g) => alive && setGeom(g)).catch(() => {});
    return () => { alive = false; };
  }, [pdfPage, page.viewport, wantGeom]);

  // ----- fit / zoom helpers -----
  const fitPage = useCallback(() => {
    const el = scrollRef.current!;
    s.setViewZoom(pane, Math.min((el.clientWidth - PAD * 2) / page.width, (el.clientHeight - PAD * 2) / page.height));
  }, [page, s]);
  const fitWidth = useCallback(() => {
    const el = scrollRef.current!;
    s.setViewZoom(pane, (el.clientWidth - PAD * 2) / page.width);
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
      el.scrollLeft = left + p.x * zoom - el.clientWidth / 2;
      el.scrollTop = top + p.y * zoom - el.clientHeight / 2;
    };
  }, [fitPage, fitWidth, zoomAt, left, top, zoom, isActivePane]);

  useEffect(() => { if (!zoomRaw) fitPage(); }, [zoomRaw, fitPage]);

  useLayoutEffect(() => {
    const a = anchor.current;
    const el = scrollRef.current;
    if (!a || !el) return;
    anchor.current = null;
    el.scrollLeft = left + a.px * zoom - a.cx;
    el.scrollTop = top + a.py * zoom - a.cy;
  }, [zoom, left, top]);

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
      task = pdfPage.render({ canvas: off, viewport: vp });
      task.promise.then(() => {
        canvas.width = off.width; canvas.height = off.height;
        canvas.getContext('2d')!.drawImage(off, 0, 0);
        setBaseScale(wantBase);
      }).catch(() => {});
    }, baseScale ? 200 : 0);
    return () => { clearTimeout(t); task?.cancel(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfPage, Math.round(wantBase * 20)]);

  const [scrollTick, setScrollTick] = useState(0);
  useEffect(() => {
    if (!pdfPage || zoom * dpr <= wantBase * 1.05) { setDetail(null); return; }
    let task: RenderTask | null = null;
    const t = setTimeout(() => {
      const el = scrollRef.current!;
      const x = Math.max(0, (el.scrollLeft - left) / zoom);
      const y = Math.max(0, (el.scrollTop - top) / zoom);
      const w = Math.min(page.width - x, el.clientWidth / zoom);
      const h = Math.min(page.height - y, el.clientHeight / zoom);
      if (w <= 0 || h <= 0) return;
      const sc = zoom * dpr;
      const off = document.createElement('canvas');
      off.width = Math.ceil(w * sc); off.height = Math.ceil(h * sc);
      task = pdfPage.render({
        canvas: off,
        viewport: pdfPage.getViewport({ scale: sc }),
        transform: [1, 0, 0, 1, -x * sc, -y * sc],
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
  }, [pdfPage, zoom, scrollTick, size.w, size.h]);

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
          setDraft({ ...draft, points: draft.points.slice(0, -1) });
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
    return { x: (e.clientX - r.left) / zoom, y: (e.clientY - r.top) / zoom };
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

  const finish = (type: MarkupType, points: Pt[], extra: Partial<Markup> = {}) => {
    const preset = s.preset;
    const style = preset?.style ?? s.toolDefaults[type];
    let P = points;
    if (type === 'cloud' && points.length === 2) P = rectCorners(points[0], points[1]);
    if (type === 'callout') P = [points[0], points[1], { x: points[1].x + 144, y: points[1].y + 40 }];
    if (type === 'perimeter') P = [...points, points[0]];
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
      ...extra,
    });
    setDraft(null);
    const keep = s.toolLocked || s.toggles.reuse;
    if (!keep) s.setTool('select');
    s.select([m.id]);
    if (editable) setEditing(m.id);
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
    const r = applyCutout(m, { kind, points: pts });
    if ('error' in r) { s.setStatus(r.error); return; }
    s.updateMarkups([id], () => r);
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
    if (draft.points.length >= min) finish(draft.tool as MarkupType, draft.points);
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
        (e.target as Element).setPointerCapture?.(e.pointerId);
      }
      return;
    }
    if (e.button === 1 || (e.button === 0 && tool === 'pan')) {
      setDrag({ kind: 'pan', sx: e.clientX, sy: e.clientY, left: el.scrollLeft, top: el.scrollTop });
      (e.target as Element).setPointerCapture?.(e.pointerId);
      e.preventDefault();
      return;
    }
    if (e.button !== 0) return;
    const raw = toPage(e);

    if (tool === 'dynamic-fill') {
      fillDown(raw);
      (e.target as Element).setPointerCapture?.(e.pointerId);
      return;
    }

    if (tool === 'zoom') { zoomAt(e.altKey ? 0.5 : 2, e.clientX - el.getBoundingClientRect().left, e.clientY - el.getBoundingClientRect().top); return; }

    if (tool === 'select') {
      const tol = 5 / zoom;
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
          const hs = handlePoints(m);
          const i = hs.findIndex((h) => dist(h, raw) <= 6 / zoom);
          if (i >= 0) {
            setDrag({ kind: 'vertex', id: m.id, index: i, snapshot: doc.markups, moved: false });
            return;
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
      const m = s.addMarkup({ ...shape, ...moved, page: pageIdx, scale: undefined, replies: undefined, groupId: undefined });
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
        else setDraft({ tool: s.tool, points: pts, cursor: p });
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
        (e.target as Element).setPointerCapture?.(e.pointerId);
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
        (e.target as Element).setPointerCapture?.(e.pointerId);
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
    if (draft.tool === 'cloudplus') { setDraft({ ...draft, points: [a, p], dragFrom: undefined }); return; }
    if (def.interaction === 'text') {
      setDraft(null);
      textMarkup(draft.tool as MarkupType, a, p).then((ok) => { if (!ok) s.setStatus('No text found there. Drag across text on the drawing.'); });
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
    if (draft) {
      if (def.interaction === 'freehand') {
        setDraft({ ...draft, points: [...draft.points, raw], cursor: raw });
      } else {
        const prev = draft.points[draft.points.length - 1];
        const p = constrain(raw, e, prev);
        setDraft({ ...draft, cursor: p });
        setSnapPt(p !== raw && !e.shiftKey ? p : null);
      }
    } else if (s.tool !== 'select' && s.tool !== 'pan') {
      const p = snap(raw);
      setSnapPt(p !== raw ? p : null);
      if (def.interaction === 'cutout' || def.interaction === 'cutout-ellipse') setHover(cutoutTarget(raw)?.id ?? null);
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    buttonDown.current = false;
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
      items.push(
        { label: 'Properties', action: () => s.setPanels({ right: 'properties' }) },
        { label: 'Add to My Tools', action: () => s.addToToolChest(hit) },
        { sep: true },
        ...(['None', 'Accepted', 'Rejected', 'Cancelled', 'Completed'] as const).map((st) => ({
          label: `Status: ${st}`, checked: hit.status === st, action: () => s.updateMarkups(ids, () => ({ status: st })),
        })),
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
    const pts = def.interaction === 'freehand' ? draft.points : [...draft.points, draft.cursor];
    const boxed = draft.tool === 'lasso' || draft.tool === 'viewport' || draft.tool === 'snapshot' || draft.tool === 'link' || def.interaction === 'text';
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
    };
  }

  const editingMarkup = editing ? doc.markups.find((m) => m.id === editing) : null;
  const cursor = tool === 'pan' ? (drag?.kind === 'pan' ? 'grabbing' : 'grab')
    : tool === 'select' ? 'default' : tool === 'zoom' ? 'zoom-in' : 'crosshair';

  return (
    <div className={`viewer-wrap ${split ? (isActivePane ? 'pane-active' : 'pane-inactive') : ''}`}
      onPointerDownCapture={() => { if (split && !isActivePane) s.focusPane(pane); }}>
    <div className="viewer" ref={scrollRef} onScroll={() => setScrollTick((n) => n + 1)}>
      <div style={{ width: innerW, height: innerH, position: 'relative' }}>
        <div className="page" style={{ left, top, width: pw, height: ph }}>
          <canvas ref={baseRef} style={{ width: pw, height: ph }} />
          <canvas ref={detailRef} style={detail ? {
            left: detail.x * zoom, top: detail.y * zoom, width: detail.w * zoom, height: detail.h * zoom,
          } : { display: 'none' }} />
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
            {snapPt && (
              <rect x={snapPt.x - 5 / zoom} y={snapPt.y - 5 / zoom} width={10 / zoom} height={10 / zoom}
                fill="none" stroke="#00b050" strokeWidth={1.5 / zoom} pointerEvents="none" />
            )}
          </svg>
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
      {s.tool === 'dynamic-fill' && <DynamicFillBar />}
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
    <textarea className="text-editor" autoFocus value={text}
      style={{ left: x * zoom, top: y * zoom, width: w * zoom, height: h * zoom, fontSize: m.style.fontSize * zoom, color: m.style.color }}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => onDone(text)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape' || (e.key === 'Enter' && e.ctrlKey)) (e.target as HTMLTextAreaElement).blur();
      }} />
  );
}
