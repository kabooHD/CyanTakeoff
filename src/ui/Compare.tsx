// Revu's Compare Documents and Overlay Pages, on rasterised pages.
// Compare clouds the differences on the revised sheet (and optionally the
// original); Overlay makes a new two-colour PDF of both sheets.
import { useState } from 'react';
import { create } from 'zustand';
import { PDFDocument } from 'pdf-lib';
import { useApp, type DocState } from '../model/store';
import { diffBoxes, diffMask, inkOf, overlayImage } from '../model/compare';
import { hexToRgb } from '../pdf/pdfutil';
import { toolById } from '../tools/tools';

export const useCompareDialog = create<{ mode: 'compare' | 'overlay' | null }>(() => ({ mode: null }));

/** Pixels per point used for comparing (about 100 dpi, capped for very large sheets). */
const scaleFor = (w: number, h: number) => Math.min(100 / 72, Math.sqrt(9e6 / (w * h)));

/** Render a page's content (no annotations) at `k` px/pt onto a white canvas of size w × h px. */
async function renderInk(doc: DocState, page: number, k: number, w: number, h: number): Promise<Uint8Array> {
  const p = await doc.loaded.pdf.getPage(page + 1);
  const vp = p.getViewport({ scale: k });
  const c = Object.assign(document.createElement('canvas'), { width: w, height: h });
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
  await p.render({ canvas: c, viewport: vp, annotationMode: 0 }).promise;
  return inkOf(ctx.getImageData(0, 0, w, h).data);
}

export async function compareDocuments(a: DocState, pa: number, b: DocState, pb: number, opts: { cloudA: boolean; color: string }) {
  const app = useApp.getState();
  const P = b.loaded.pages[pb];
  const k = scaleFor(P.width, P.height);
  const w = Math.ceil(P.width * k), h = Math.ceil(P.height * k);
  app.setStatus('Comparing…');
  const [ia, ib] = await Promise.all([renderInk(a, pa, k, w, h), renderInk(b, pb, k, w, h)]);
  const boxes = diffBoxes(diffMask(ia, ib, w, h, 1), w, h, 8, 2, 12);
  const add = (doc: DocState, page: number, kinds: string[], color: string) => {
    const ms = boxes.filter((x) => kinds.includes(x.kind)).map((x) => {
      const pad = 4;
      const r = [{ x: x.x0 / k - pad, y: x.y0 / k - pad }, { x: x.x1 / k + pad, y: x.y1 / k + pad }];
      return {
        type: 'cloud' as const, page,
        points: [r[0], { x: r[1].x, y: r[0].y }, r[1], { x: r[0].x, y: r[1].y }],
        style: { ...app.toolDefaults.cloud, color }, subject: 'Compare', label: x.kind[0].toUpperCase() + x.kind.slice(1),
      };
    });
    if (!ms.length) return 0;
    const cur = useApp.getState().activeId;
    useApp.setState({ activeId: doc.id });
    for (const m of ms) useApp.getState().addMarkup({ ...m, subject: m.subject || toolById('cloud').subject });
    useApp.setState({ activeId: cur });
    return ms.length;
  };
  const nb = add(b, pb, ['added', 'changed'], opts.color);
  const na = opts.cloudA ? add(a, pa, ['removed', 'changed'], '#ff8c00') : 0;
  useApp.getState().setActive(b.id);
  useApp.getState().setPage(pb);
  app.setStatus(boxes.length ? `Compare: ${boxes.length} difference${boxes.length === 1 ? '' : 's'} clouded (${nb} on the revised sheet${opts.cloudA ? `, ${na} on the original` : ''})` : 'Compare: no differences found');
  return boxes.length;
}

export async function overlayPages(a: DocState, pa: number, b: DocState, pb: number, ca: string, cb: string) {
  const app = useApp.getState();
  const P = a.loaded.pages[pa];
  const k = scaleFor(P.width, P.height);
  const w = Math.ceil(P.width * k), h = Math.ceil(P.height * k);
  app.setStatus('Overlaying…');
  const [ia, ib] = await Promise.all([renderInk(a, pa, k, w, h), renderInk(b, pb, k, w, h)]);
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
  return mode ? <CompareForm key={mode} mode={mode} /> : null;
}

function CompareForm({ mode }: { mode: 'compare' | 'overlay' }) {
  const s = useApp();
  const docs = s.docs;
  const active = docs.find((d) => d.id === s.activeId) ?? docs[0];
  const other = docs.find((d) => d.id !== active?.id) ?? active;
  const [aId, setA] = useState(other?.id ?? '');
  const [bId, setB] = useState(active?.id ?? '');
  const [pa, setPa] = useState(0);
  const [pb, setPb] = useState(active?.page ?? 0);
  const [ca, setCa] = useState('#e00000');
  const [cb, setCb] = useState('#0050ff');
  const [cloudA, setCloudA] = useState(false);
  const close = () => useCompareDialog.setState({ mode: null });
  const a = docs.find((d) => d.id === aId), b = docs.find((d) => d.id === bId);
  const ok = async () => {
    if (!a || !b) return;
    close();
    try {
      if (mode === 'compare') await compareDocuments(a, pa, b, pb, { cloudA, color: '#ff0000' });
      else await overlayPages(a, pa, b, pb, ca, cb);
    } catch (e) { s.setStatus(`${mode === 'compare' ? 'Compare' : 'Overlay'} failed: ${(e as Error).message}`); }
  };
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal" role="dialog" aria-label={mode === 'compare' ? 'Compare Documents' : 'Overlay Pages'} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') close(); }}>
        <div className="modal-title">{mode === 'compare' ? 'Compare Documents' : 'Overlay Pages'}</div>
        <div className="scale-dialog">
          <DocPage label={mode === 'compare' ? 'Original' : 'Base'} docId={aId} page={pa} onDoc={setA} onPage={setPa} />
          <DocPage label={mode === 'compare' ? 'Revised' : 'Overlay'} docId={bId} page={pb} onDoc={setB} onPage={setPb} />
          {mode === 'overlay' ? (
            <div className="form-row"><span>Colours</span>
              <input type="color" aria-label="Base colour" value={ca} onChange={(e) => setCa(e.target.value)} /> base
              <input type="color" aria-label="Overlay colour" value={cb} onChange={(e) => setCb(e.target.value)} /> overlay
            </div>
          ) : (
            <div className="form-row"><label><input type="checkbox" checked={cloudA} onChange={(e) => setCloudA(e.target.checked)} /> Also cloud removed items on the original</label></div>
          )}
          <p className="muted small">{mode === 'compare'
            ? 'Differences are clouded on the revised sheet (subject "Compare"); pages are compared as drawn, at the same position.'
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
