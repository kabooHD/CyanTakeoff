// Window > Presentation (Ctrl+Enter): the document full screen on black, one
// page at a time, fitted to the screen, with its markups. As in Revu: click,
// Down, Right, PageDown or Space go to the next page; right-click, Up, Left,
// PageUp or Backspace go back; Home/End; Esc leaves.
import { useEffect, useRef, useState } from 'react';
import { activeDoc, useApp, useActiveDoc } from '../model/store';
import { MarkupShape } from './renderMarkup';
import { markupShown, ocConfig } from './layersView';
import { wrapPage } from '../model/presentation';

export function Presentation() {
  const on = useApp((s) => s.presentation);
  const doc = useActiveDoc();
  if (!on || !doc) return null;
  return <PresentationView />;
}

const exit = () => {
  useApp.setState({ presentation: false });
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
};

function PresentationView() {
  const doc = useActiveDoc()!;
  const ref = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  const pg = doc.loaded.pages[doc.page];
  const zoom = Math.min(size.w / pg.width, size.h / pg.height);
  const prefs = useApp((s) => s.prefs);
  // Loop after last page (Preferences > Presentation).
  const go = (n: number) => {
    const d = activeDoc();
    if (d) useApp.getState().setPage(wrapPage(n, d.loaded.pages.length, useApp.getState().prefs.presLoop));
  };
  // Auto advance every N seconds.
  useEffect(() => {
    if (!(prefs.presAdvance > 0)) return;
    const t = setInterval(() => { const d = activeDoc(); if (d) go(d.page + 1); }, prefs.presAdvance * 1000);
    return () => clearInterval(t);
  }, [prefs.presAdvance]); // eslint-disable-line react-hooks/exhaustive-deps
  // Mouse cursor: hidden, or hidden after two seconds without moving.
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    if (prefs.presCursor !== 'auto') return;
    let t = window.setTimeout(() => setIdle(true), 2000);
    const move = () => { setIdle(false); clearTimeout(t); t = window.setTimeout(() => setIdle(true), 2000); };
    window.addEventListener('mousemove', move);
    return () => { clearTimeout(t); window.removeEventListener('mousemove', move); };
  }, [prefs.presCursor]);
  const hideCursor = prefs.presCursor === 'hide' || (prefs.presCursor === 'auto' && idle);

  useEffect(() => {
    document.documentElement.requestFullscreen?.().catch(() => {});
    // Leaving the browser's full screen (its own Esc) ends the presentation too.
    let was = false;
    const onFs = () => { if (document.fullscreenElement) was = true; else if (was) useApp.setState({ presentation: false }); };
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    const onKey = (e: KeyboardEvent) => {
      const d = activeDoc();
      if (!d) return;
      const k = e.key;
      let handled = true;
      if (k === 'Escape' || (k === 'Enter' && e.ctrlKey)) exit();
      else if (['ArrowDown', 'ArrowRight', 'PageDown', ' ', 'Enter'].includes(k)) go(d.page + 1);
      else if (['ArrowUp', 'ArrowLeft', 'PageUp', 'Backspace'].includes(k)) go(d.page - 1);
      else if (k === 'Home') go(0);
      else if (k === 'End') go(d.loaded.pages.length - 1);
      else handled = false;
      if (handled) { e.preventDefault(); e.stopImmediatePropagation(); }
    };
    document.addEventListener('fullscreenchange', onFs);
    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('fullscreenchange', onFs);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKey, true);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    let task: { cancel(): void } | null = null;
    (async () => {
      const p = await doc.loaded.pdf.getPage(doc.page + 1);
      if (!alive) return;
      const sc = Math.min(zoom * (window.devicePixelRatio || 1), Math.sqrt(16e6 / (pg.width * pg.height)));
      const vp = p.getViewport({ scale: sc });
      const off = document.createElement('canvas');
      off.width = Math.ceil(vp.width); off.height = Math.ceil(vp.height);
      const t = p.render({ canvas: off, viewport: vp, annotationMode: 1, optionalContentConfigPromise: ocConfig(doc, zoom) });
      task = t;
      await t.promise.catch(() => {});
      const c = ref.current;
      if (!alive || !c) return;
      c.width = off.width; c.height = off.height;
      c.getContext('2d')!.drawImage(off, 0, 0);
      c.dataset.rendered = String(doc.page + 1);
      off.width = off.height = 0;
    })();
    return () => { alive = false; task?.cancel(); };
  }, [doc, doc.page, zoom, pg]);

  const markups = doc.markups.filter((m) => m.page === doc.page && markupShown(doc, m, zoom));
  const w = pg.width * zoom, h = pg.height * zoom;
  return (
    <div className="presentation" role="dialog" aria-label="Presentation" style={{ background: prefs.presBackground, cursor: hideCursor ? 'none' : 'default' }}
      onClick={() => go(doc.page + 1)}
      onContextMenu={(e) => { e.preventDefault(); go(doc.page - 1); }}>
      <div className="presentation-page" style={{ width: w, height: h }}>
        <canvas ref={ref} style={{ width: w, height: h }} />
        {markups.length > 0 && (
          <svg width={w} height={h} viewBox={`0 0 ${pg.width} ${pg.height}`} pointerEvents="none">
            {markups.map((m) => <MarkupShape key={m.id} m={m} />)}
          </svg>
        )}
      </div>
      <div className="presentation-page-no">{doc.page + 1} / {doc.loaded.pages.length}</div>
    </div>
  );
}
