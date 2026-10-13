// Revu's Compare Documents and Overlay Pages. Compare clouds the differences
// on the revised sheet (and optionally the original), found visually
// (rasterised pages) or from the vector content (lines, curves, text);
// Overlay makes a new two-colour PDF of both sheets. Either can align the
// sheets by two pairs of picked points first.
import { useState } from 'react';
import { create } from 'zustand';
import { PDFDocument } from 'pdf-lib';
import { useApp, type DocState } from '../model/store';
import { alignTransform, diffBoxes, diffMask, inkOf, invertMat, mapBox, overlayImage, vectorDiff, vectorMask, type Mat, type VectorPage } from '../model/compare';
import type { Pt } from '../model/types';
import { hexToRgb } from '../pdf/pdfutil';
import { snapGeometry } from '../pdf/geometry';
import { pageText } from './toolActions';
import { toolById } from '../tools/tools';

type Method = 'raster' | 'vector';
interface CompareState {
  mode: 'compare' | 'overlay' | null;
  aId: string; bId: string; pa: number; pb: number;
  method: Method;
  /** Alignment from picked points: maps the original/base page onto the revised/overlay page. */
  align: Mat | null;
  /** Alignment points picked so far (two on the first sheet, then two on the second); null when not picking. */
  picking: Pt[] | null;
}
export const useCompareDialog = create<CompareState>(() => ({ mode: null, aId: '', bId: '', pa: 0, pb: 0, method: 'raster', align: null, picking: null }));

export function openCompare(mode: 'compare' | 'overlay') {
  const s = useApp.getState();
  const active = s.docs.find((d) => d.id === s.activeId) ?? s.docs[0];
  const other = s.docs.find((d) => d.id !== active?.id) ?? active;
  useCompareDialog.setState({ mode, aId: other?.id ?? '', bId: active?.id ?? '', pa: 0, pb: active?.page ?? 0, align: null, picking: null });
}

/** Show a sheet for picking alignment points. */
function showSheet(docId: string, page: number) {
  const app = useApp.getState();
  app.setActive(docId);
  app.setPage(page);
}

/** Start picking alignment points in the viewer. */
function startPicking() {
  const c = useCompareDialog.getState();
  useCompareDialog.setState({ picking: [], align: null });
  showSheet(c.aId, c.pa);
}

/** A point clicked while picking alignment points (called by the Viewer). */
export function pickAlignPoint(p: Pt) {
  const c = useCompareDialog.getState();
  if (!c.picking) return;
  const pts = [...c.picking, p];
  if (pts.length === 2) showSheet(c.bId, c.pb);
  if (pts.length < 4) { useCompareDialog.setState({ picking: pts }); return; }
  useCompareDialog.setState({ picking: null, align: alignTransform(pts[0], pts[1], pts[2], pts[3]) });
  useApp.getState().setStatus('Alignment set from 2 point pairs');
}

export function cancelPicking() {
  useCompareDialog.setState({ picking: null });
}

/** Prompt shown in the viewer while picking alignment points. */
export function pickingPrompt(pts: Pt[]): string {
  const which = pts.length < 2 ? 'first sheet' : 'second sheet';
  return `Align: click point ${(pts.length % 2) + 1} of 2 on the ${which}. Pick the same two features on both sheets (content snap helps). Esc cancels.`;
}

/** Pixels per point used for comparing (about 100 dpi, capped for very large sheets). */
const scaleFor = (w: number, h: number) => Math.min(100 / 72, Math.sqrt(9e6 / (w * h)));

/**
 * Render a page's content (no annotations) at `k` px/pt onto a white canvas
 * of size w × h px, mapped by `m` (page units) when given.
 */
async function renderInk(doc: DocState, page: number, k: number, w: number, h: number, m?: Mat | null): Promise<Uint8Array> {
  const p = await doc.loaded.pdf.getPage(page + 1);
  const vp = p.getViewport({ scale: k });
  const c = Object.assign(document.createElement('canvas'), { width: w, height: h });
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
  const transform = m ? [m[0], m[1], m[2], m[3], m[4] * k, m[5] * k] : undefined;
  await p.render({ canvas: c, viewport: vp, annotationMode: 0, transform }).promise;
  return inkOf(ctx.getImageData(0, 0, w, h).data);
}

/** A page's vector content: lines, flattened curves and text runs. */
async function vectorsOf(doc: DocState, page: number): Promise<VectorPage> {
  const p = await doc.loaded.pdf.getPage(page + 1);
  const vp = doc.loaded.pages[page].viewport;
  const [g, texts] = await Promise.all([snapGeometry(p, vp), pageText(p, vp)]);
  const segments = new Float32Array(g.segments.length + g.curves.length);
  segments.set(g.segments); segments.set(g.curves, g.segments.length);
  return { segments, texts };
}

export async function compareDocuments(a: DocState, pa: number, b: DocState, pb: number,
  opts: { cloudA: boolean; color: string; method?: Method; align?: Mat | null }) {
  const app = useApp.getState();
  const P = b.loaded.pages[pb];
  const k = scaleFor(P.width, P.height);
  const w = Math.ceil(P.width * k), h = Math.ceil(P.height * k);
  const m = opts.align ?? null;
  app.setStatus('Comparing…');
  let mask: Uint8Array;
  if (opts.method === 'vector') {
    const [va, vb] = await Promise.all([vectorsOf(a, pa), vectorsOf(b, pb)]);
    mask = vectorMask(vectorDiff(va, vb, m), w, h, k);
  } else {
    const [ia, ib] = await Promise.all([renderInk(a, pa, k, w, h, m), renderInk(b, pb, k, w, h)]);
    mask = diffMask(ia, ib, w, h, 1);
  }
  const boxes = diffBoxes(mask, w, h, 8, 2, opts.method === 'vector' ? 1 : 12);
  const back = m ? invertMat(m) : null;
  const add = (doc: DocState, page: number, kinds: string[], color: string, toA: boolean) => {
    const ms = boxes.filter((x) => kinds.includes(x.kind)).map((x) => {
      const pad = 4;
      let r = { x0: x.x0 / k - pad, y0: x.y0 / k - pad, x1: x.x1 / k + pad, y1: x.y1 / k + pad };
      if (toA && back) r = mapBox(back, r); // boxes are found on the revised sheet
      return {
        type: 'cloud' as const, page,
        points: [{ x: r.x0, y: r.y0 }, { x: r.x1, y: r.y0 }, { x: r.x1, y: r.y1 }, { x: r.x0, y: r.y1 }],
        style: { ...app.toolDefaults.cloud, color }, subject: 'Compare', label: x.kind[0].toUpperCase() + x.kind.slice(1),
      };
    });
    if (!ms.length) return 0;
    const cur = useApp.getState().activeId;
    useApp.setState({ activeId: doc.id });
    for (const mk of ms) useApp.getState().addMarkup({ ...mk, subject: mk.subject || toolById('cloud').subject });
    useApp.setState({ activeId: cur });
    return ms.length;
  };
  const nb = add(b, pb, ['added', 'changed'], opts.color, false);
  const na = opts.cloudA ? add(a, pa, ['removed', 'changed'], '#ff8c00', true) : 0;
  useApp.getState().setActive(b.id);
  useApp.getState().setPage(pb);
  app.setStatus(boxes.length ? `Compare: ${boxes.length} difference${boxes.length === 1 ? '' : 's'} clouded (${nb} on the revised sheet${opts.cloudA ? `, ${na} on the original` : ''})` : 'Compare: no differences found');
  return boxes.length;
}

export async function overlayPages(a: DocState, pa: number, b: DocState, pb: number, ca: string, cb: string, align?: Mat | null) {
  const app = useApp.getState();
  const P = a.loaded.pages[pa];
  const k = scaleFor(P.width, P.height);
  const w = Math.ceil(P.width * k), h = Math.ceil(P.height * k);
  app.setStatus('Overlaying…');
  // The overlay sheet is moved onto the base sheet.
  const [ia, ib] = await Promise.all([renderInk(a, pa, k, w, h), renderInk(b, pb, k, w, h, align ? invertMat(align) : null)]);
  const c = Object.assign(document.createElement('canvas'), { width: w, height: h });
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  overlayImage(ia, ib, img.data, hexToRgb(ca).map((v) => v * 255) as [number, number, number], hexToRgb(cb).map((v) => v * 255) as [number, number, number]);
  ctx.putImageData(img, 0, 0);
  const png = await new Promise<Blob>((res) => c.toBlob((bl) => res(bl!), 'image/png'));
  const out = await PDFDocument.create();
  const page = out.addPage([P.width, P.height]);
  const im = await out.embedPng(new Uint8Array(await png.arrayBuffer()));
  page.drawImage(im, { x: 0, y: 0, width: P.width, height: P.height });
  const name = `Overlay - ${a.name.replace(/\.pdf$/i, '')} vs ${b.name.replace(/\.pdf$/i, '')}.pdf`;
  await useApp.getState().openBytes(await out.save(), name);
  useApp.getState().setStatus(`Overlay: ${a.name} p${pa + 1} in ${ca}, ${b.name} p${pb + 1} in ${cb}; unchanged in grey`);
}

function DocPage({ label, docId, page, onDoc, onPage }: { label: string; docId: string; page: number; onDoc: (id: string) => void; onPage: (p: number) => void }) {
  const docs = useApp((s) => s.docs);
  const d = docs.find((x) => x.id === docId);
  return (
    <div className="form-row">
      <span>{label}</span>
      <select aria-label={`${label} document`} value={docId} onChange={(e) => { onDoc(e.target.value); onPage(0); }}>
        {docs.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
      </select>
      page <input aria-label={`${label} page`} type="number" min={1} max={d?.loaded.pages.length ?? 1} value={page + 1}
        onChange={(e) => onPage(Math.max(0, Math.min((d?.loaded.pages.length ?? 1) - 1, Number(e.target.value) - 1)))} style={{ width: 56 }} />
      of {d?.loaded.pages.length ?? 0}
    </div>
  );
}

export function CompareDialog() {
  const mode = useCompareDialog((x) => x.mode);
  const picking = useCompareDialog((x) => x.picking);
  return mode && !picking ? <CompareForm mode={mode} /> : null;
}

function CompareForm({ mode }: { mode: 'compare' | 'overlay' }) {
  const s = useApp();
  const c = useCompareDialog();
  const set = (p: Partial<CompareState>) => useCompareDialog.setState(p);
  const docs = s.docs;
  const [ca, setCa] = useState('#e00000');
  const [cb, setCb] = useState('#0050ff');
  const [cloudA, setCloudA] = useState(false);
  const close = () => set({ mode: null, picking: null });
  const a = docs.find((d) => d.id === c.aId), b = docs.find((d) => d.id === c.bId);
  // Changing a sheet invalidates picked alignment points.
  const sheet = (p: Partial<CompareState>) => set({ ...p, align: null });
  const ok = async () => {
    if (!a || !b) return;
    close();
    try {
      if (mode === 'compare') await compareDocuments(a, c.pa, b, c.pb, { cloudA, color: '#ff0000', method: c.method, align: c.align });
      else await overlayPages(a, c.pa, b, c.pb, ca, cb, c.align);
    } catch (e) { s.setStatus(`${mode === 'compare' ? 'Compare' : 'Overlay'} failed: ${(e as Error).message}`); }
  };
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal" role="dialog" aria-label={mode === 'compare' ? 'Compare Documents' : 'Overlay Pages'} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') close(); }}>
        <div className="modal-title">{mode === 'compare' ? 'Compare Documents' : 'Overlay Pages'}</div>
        <div className="scale-dialog">
          <DocPage label={mode === 'compare' ? 'Original' : 'Base'} docId={c.aId} page={c.pa} onDoc={(id) => sheet({ aId: id })} onPage={(p) => sheet({ pa: p })} />
          <DocPage label={mode === 'compare' ? 'Revised' : 'Overlay'} docId={c.bId} page={c.pb} onDoc={(id) => sheet({ bId: id })} onPage={(p) => sheet({ pb: p })} />
          <div className="form-row"><span>Alignment</span>
            <span className="muted">{c.align ? 'By 2 point pairs' : 'As positioned'}</span>
            <button disabled={!a || !b} onClick={startPicking}>Align Points…</button>
            {c.align && <button onClick={() => set({ align: null })}>Clear</button>}
          </div>
          {mode === 'overlay' ? (
            <div className="form-row"><span>Colours</span>
              <input type="color" aria-label="Base colour" value={ca} onChange={(e) => setCa(e.target.value)} /> base
              <input type="color" aria-label="Overlay colour" value={cb} onChange={(e) => setCb(e.target.value)} /> overlay
            </div>
          ) : (
            <>
              <div className="form-row"><span>Compare</span>
                <select aria-label="Compare method" value={c.method} onChange={(e) => set({ method: e.target.value as Method })}>
                  <option value="raster">Visual (rendered pages)</option>
                  <option value="vector">Vector (lines and text)</option>
                </select>
              </div>
              <div className="form-row"><label><input type="checkbox" checked={cloudA} onChange={(e) => setCloudA(e.target.checked)} /> Also cloud removed items on the original</label></div>
            </>
          )}
          <p className="muted small">{mode === 'compare'
            ? 'Differences are clouded on the revised sheet (subject "Compare"). Vector compares the drawing\'s lines, curves and text exactly; Visual compares how the pages look (use it for scans).'
            : 'Creates a new PDF: ink only on the base sheet in the base colour, only on the overlay in its colour, unchanged in grey.'}</p>
          <div className="modal-actions">
            <span className="spacer" />
            <button className="primary" disabled={!a || !b} onClick={ok}>OK</button>
            <button onClick={close}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}
