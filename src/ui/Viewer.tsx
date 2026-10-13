import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PDFPageProxy, RenderTask } from 'pdfjs-dist';
import { useApp, type DocState } from '../model/store';
import { MEASURE_TYPES, dist, formatLength, formatNumber, measure, ortho, rectCorners, resolveFormat } from '../model/measure';
import { Icon } from './icons';
import type { Markup, MarkupType, Pt, ToolId } from '../model/types';
import { toolById } from '../tools/tools';
import { MarkupShape, handlePoints } from './renderMarkup';
import { hitTest, markupBounds } from './hit';
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
};

type Draft = { tool: ToolId; points: Pt[]; cursor: Pt | null; dragFrom?: { x: number; y: number } };
type Drag =
  | { kind: 'pan'; sx: number; sy: number; left: number; top: number }
  | { kind: 'move'; start: Pt; snapshot: Markup[]; ids: string[]; moved: boolean }
  | { kind: 'vertex'; id: string; index: number; snapshot: Markup[]; moved: boolean }
  | { kind: 'band'; start: Pt; cur: Pt; add: boolean; right?: { x: number; y: number } };

const isEditable = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

export function Viewer({ doc }: { doc: DocState }) {
  const s = useApp();
  const page = doc.loaded.pages[doc.page];
  const zoom = doc.zoom || 1;
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
  const lastMiddle = useRef(0);
  const rightDown = useRef<{ x: number; y: number } | null>(null);
  const [, force] = useState(0);
  const [geom, setGeom] = useState<SnapGeometry | null>(null);

  const pw = page.width * zoom, ph = page.height * zoom;
  const innerW = Math.max(size.w, pw + PAD * 2), innerH = Math.max(size.h, ph + PAD * 2);
  const left = (innerW - pw) / 2, top = (innerH - ph) / 2;
  const markups = doc.markups.filter((m) => m.page === doc.page);
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
    doc.loaded.pdf.getPage(doc.page + 1).then((p) => alive && setPdfPage(p));
    countId.current = null;
    setDraft(null);
    return () => { alive = false; };
  }, [doc.loaded.pdf, doc.page]);

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
    s.setZoom(Math.min((el.clientWidth - PAD * 2) / page.width, (el.clientHeight - PAD * 2) / page.height));
  }, [page, s]);
  const fitWidth = useCallback(() => {
    const el = scrollRef.current!;
    s.setZoom((el.clientWidth - PAD * 2) / page.width);
  }, [page, s]);
  const zoomAt = useCallback((factor: number, cx?: number, cy?: number) => {
    const el = scrollRef.current!;
    cx ??= el.clientWidth / 2; cy ??= el.clientHeight / 2;
    anchor.current = {
      px: (el.scrollLeft + cx - left) / zoom,
      py: (el.scrollTop + cy - top) / zoom,
      cx, cy,
    };
    s.setZoom(zoom * factor);
  }, [left, top, zoom, s]);

  useEffect(() => {
    viewerApi.fitPage = fitPage;
    viewerApi.fitWidth = fitWidth;
    viewerApi.zoomBy = (f) => zoomAt(f);
  }, [fitPage, fitWidth, zoomAt]);

  useEffect(() => { if (!doc.zoom) fitPage(); }, [doc.zoom, fitPage]);

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

  // ----- keyboard: space-pan and draft keys -----
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (isEditable(e.target)) return;
      if (e.code === 'Space') { spaceDown.current = true; force((n) => n + 1); e.preventDefault(); }
      if (draft) {
        if (e.key === 'Escape') { setDraft(null); e.stopImmediatePropagation(); }
        else if (e.key === 'Enter') { finishPoly(); e.stopImmediatePropagation(); }
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
    if (e.shiftKey && prev) p = ortho(prev, p);
    return p;
  };

  // ----- markup creation -----
  const tool = spaceDown.current ? 'pan' : s.tool;
  const def = toolById(s.tool);

  const finish = (type: MarkupType, points: Pt[]) => {
    const preset = s.preset;
    let P = points;
    if (type === 'cloud' && points.length === 2) P = rectCorners(points[0], points[1]);
    if (type === 'callout') P = [points[0], points[1], { x: points[1].x + 144, y: points[1].y + 40 }];
    if (type === 'perimeter') P = [...points, points[0]];
    const m = s.addMarkup({
      type,
      page: doc.page,
      points: P,
      style: preset?.style ?? s.toolDefaults[type],
      subject: preset?.subject ?? toolById(type).subject,
      depth: type === 'volume' ? preset?.depth ?? 1 : undefined,
      text: type === 'textbox' || type === 'callout' ? '' : undefined,
    });
    setDraft(null);
    const keep = s.toolLocked || s.toggles.reuse;
    if (!keep) s.setTool('select');
    s.select([m.id]);
    if (type === 'textbox' || type === 'callout') setEditing(m.id);
    return m;
  };

  const finishPoly = () => {
    if (!draft) return;
    const t = toolById(draft.tool);
    const min = t.closed ? 3 : 2;
    if (draft.points.length >= min) finish(draft.tool as MarkupType, draft.points);
    else setDraft(null);
  };

  // ----- pointer handlers -----
  const onPointerDown = (e: React.PointerEvent) => {
    setMenu(null);
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

    if (tool === 'zoom') { zoomAt(e.altKey ? 0.5 : 2, e.clientX - el.getBoundingClientRect().left, e.clientY - el.getBoundingClientRect().top); return; }

    if (tool === 'select') {
      const tol = 5 / zoom;
      // vertex handles of a single selected markup
      if (doc.selection.length === 1) {
        const m = markups.find((x) => x.id === doc.selection[0]);
        if (m) {
          const hs = handlePoints(m);
          const i = hs.findIndex((h) => dist(h, raw) <= 6 / zoom);
          if (i >= 0) {
            setDrag({ kind: 'vertex', id: m.id, index: i, snapshot: doc.markups, moved: false });
            return;
          }
        }
      }
      const hit = [...markups].reverse().find((m) => hitTest(m, raw, tol));
      if (hit) {
        const add = e.ctrlKey || e.metaKey;
        if (add && selected.has(hit.id)) { s.select(doc.selection.filter((x) => x !== hit.id)); return; }
        const ids = selected.has(hit.id) ? doc.selection : add ? [...doc.selection, hit.id] : [hit.id];
        s.select(ids);
        setDrag({ kind: 'move', start: raw, snapshot: doc.markups, ids, moved: false });
      } else {
        if (!(e.ctrlKey || e.metaKey)) s.select([]);
        setDrag({ kind: 'band', start: raw, cur: raw, add: e.ctrlKey || e.metaKey });
      }
      return;
    }

    // Like Revu, ask for a page scale before the first measurement on an unscaled page.
    if (!draft && MEASURE_TYPES.has(s.tool) && s.tool !== 'count' && !doc.calibrations[doc.page]) {
      s.openScaleDialog({ page: doc.page, then: s.tool });
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
        if (def.maxPoints && pts.length >= def.maxPoints) finish(s.tool as MarkupType, pts.slice(0, def.maxPoints));
        else setDraft({ tool: s.tool, points: pts, cursor: p });
        break;
      }
      case 'freehand':
        setDraft({ tool: s.tool, points: [raw], cursor: raw });
        (e.target as Element).setPointerCapture?.(e.pointerId);
        break;
      case 'point':
        finish(s.tool as MarkupType, [p]);
        break;
      case 'count': {
        const cur = countId.current && doc.markups.find((m) => m.id === countId.current);
        if (cur) s.updateMarkups([cur.id], (m) => ({ points: [...m.points, p] }));
        else {
          const m = s.addMarkup({
            type: 'count', page: doc.page, points: [p],
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
    if (draft.tool === 'calibrate') {
      setDraft(null);
      s.openScaleDialog({ page: doc.page, pagePts: dist(a, p) });
      return;
    }
    finish(draft.tool as MarkupType, [a, p]);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const raw = toPage(e);
    setCursor(raw, doc.calibrations[doc.page]);
    if (drag) {
      if (drag.kind === 'pan') {
        const el = scrollRef.current!;
        el.scrollLeft = drag.left - (e.clientX - drag.sx);
        el.scrollTop = drag.top - (e.clientY - drag.sy);
      } else if (drag.kind === 'move') {
        const dx = raw.x - drag.start.x, dy = raw.y - drag.start.y;
        const orig = new Map(drag.snapshot.map((m) => [m.id, m]));
        s.updateMarkups(drag.ids, (m) => ({ points: orig.get(m.id)!.points.map((q) => ({ x: q.x + dx, y: q.y + dy })) }), { history: false });
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
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
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
    if (drag) {
      if ((drag.kind === 'move' || drag.kind === 'vertex') && drag.moved) s.pushUndo(drag.snapshot);
      if (drag.kind === 'band') selectInBand(drag);
      setDrag(null);
      return;
    }
    if (!draft) return;
    if (def.interaction === 'freehand') {
      if (draft.points.length > 1) finish('pen', draft.points);
      else setDraft(null);
      return;
    }
    // Drag-to-draw for two-point and box tools; click-click otherwise.
    if ((def.interaction === 'two-point' || def.interaction === 'box') && draft.dragFrom && draft.points.length === 1) {
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
      if (hit && (hit.type === 'textbox' || hit.type === 'callout')) setEditing(hit.id);
    }
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
    if (hit) {
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
        { label: 'Delete', shortcut: 'Del', action: () => s.deleteMarkups(ids) },
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
  if (draft && draft.cursor) {
    const pts = def.interaction === 'freehand' ? draft.points : [...draft.points, draft.cursor];
    const type = (draft.tool === 'calibrate' ? 'length' : draft.tool) as MarkupType;
    let P = pts;
    if (type === 'cloud' && pts.length === 2) P = rectCorners(pts[0], pts[1]);
    if (type === 'callout') P = [pts[0], pts[1], { x: pts[1].x + 144, y: pts[1].y + 40 }];
    preview = {
      id: 'draft', type, page: doc.page, points: P,
      style: draft.tool === 'calibrate' ? { ...s.toolDefaults.length, color: '#00a000' } : s.preset?.style ?? s.toolDefaults[type],
      subject: '', label: '', comment: '', author: '', created: '', modified: '', status: 'None',
      scale: doc.calibrations[doc.page] ?? undefined, depth: s.preset?.depth ?? 1,
    };
  }

  const editingMarkup = editing ? doc.markups.find((m) => m.id === editing) : null;
  const cursor = tool === 'pan' ? (drag?.kind === 'pan' ? 'grabbing' : 'grab')
    : tool === 'select' ? 'default' : tool === 'zoom' ? 'zoom-in' : 'crosshair';

  return (
    <div className="viewer-wrap">
    <div className="viewer" ref={scrollRef} onScroll={() => setScrollTick((n) => n + 1)}>
      <div style={{ width: innerW, height: innerH, position: 'relative' }}>
        <div className="page" style={{ left, top, width: pw, height: ph }}>
          <canvas ref={baseRef} style={{ width: pw, height: ph }} />
          <canvas ref={detailRef} style={detail ? {
            left: detail.x * zoom, top: detail.y * zoom, width: detail.w * zoom, height: detail.h * zoom,
          } : { display: 'none' }} />
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
            {markups.map((m) => <MarkupShape key={m.id} m={m} />)}
            {preview && <g pointerEvents="none"><MarkupShape m={preview} ghost /></g>}
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
            {snapPt && (
              <rect x={snapPt.x - 5 / zoom} y={snapPt.y - 5 / zoom} width={10 / zoom} height={10 / zoom}
                fill="none" stroke="#00b050" strokeWidth={1.5 / zoom} pointerEvents="none" />
            )}
          </svg>
          {editingMarkup && (
            <TextEditor m={editingMarkup} zoom={zoom} onDone={(text) => {
              if (text !== (editingMarkup.text ?? '')) s.updateMarkups([editingMarkup.id], () => ({ text }));
              setEditing(null);
            }} />
          )}
        </div>
      </div>
      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
    </div>
      <MeasurePreview markup={preview && MEASURE_TYPES.has(preview.type) && doc.calibrations[doc.page] ? preview : null} />
    </div>
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
  if (P.length > 2 && markup.type !== 'angle') rows.push(['Segment', len(dist(P[P.length - 2], P[P.length - 1]) * s.factor)]);
  return (
    <div className="measure-preview">
      <button className="measure-preview-close" title="Hide" onClick={() => setHidden(true)}><Icon name="close" size={10} /></button>
      <table><tbody>{rows.map(([k, x]) => <tr key={k}><td>{k}</td><td>{x}</td></tr>)}</tbody></table>
    </div>
  );
}

function TextEditor({ m, zoom, onDone }: { m: Markup; zoom: number; onDone: (t: string) => void }) {
  const box = m.type === 'callout' ? [m.points[1], m.points[2]] : [m.points[0], m.points[1]];
  const x = Math.min(box[0].x, box[1].x), y = Math.min(box[0].y, box[1].y);
  const w = Math.abs(box[1].x - box[0].x), h = Math.abs(box[1].y - box[0].y);
  const [text, setText] = useState(m.text ?? '');
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
