// Stamp manager (Revu Stamp > Manage / Create / Import): custom text stamps
// (title, subtitle template with {Author} {Date} {Time}, colour) and image
// stamps; export and import a stamp file to share them with a team.
import { useState } from 'react';
import { create } from 'zustand';
import { useApp } from '../model/store';
import { DEFAULT_STAMP_SIZE, DEFAULT_SUBTITLE, STAMP_TEMPLATES, STAMP_TOKENS, parseStamps, saveStamps, stampText, templateDefaults, useStamps, type CustomStamp, type StampTemplate } from '../model/stamps';
import { loadForRender } from '../pdf/document';
import { snapshot } from './toolActions';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { loadImage, pickFile } from './toolActions';

export const useStampManager = create<{ open: boolean }>(() => ({ open: false }));

/** Markup fields for placing custom stamp `id` at `p`, or null if it is gone. */
export function customStampFields(id: string, author: string) {
  const st = useStamps.getState().stamps.find((x) => x.id === id);
  if (!st) return null;
  if (st.kind === 'image') return { kind: 'image' as const, image: st.image!, w: st.w ?? 160, h: st.h ?? 60, name: st.name };
  const file = useApp.getState().docs.find((d) => d.id === useApp.getState().activeId)?.name;
  return { kind: 'text' as const, title: st.title ?? st.name, subtitle: stampText(st.subtitle ?? DEFAULT_SUBTITLE, { author, date: new Date(), file }), color: st.color, name: st.name, w: st.w ?? DEFAULT_STAMP_SIZE.w, h: st.h ?? DEFAULT_STAMP_SIZE.h, border: st.border ?? 'rounded', opacity: st.opacity };
}

function download(name: string, text: string) {
  const href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  Object.assign(document.createElement('a'), { href, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

export function StampManagerDialog() {
  const open = useStampManager((x) => x.open);
  const stamps = useStamps((x) => x.stamps);
  const author = useApp((s) => s.author);
  const [edit, setEdit] = useState<CustomStamp | null>(null);
  if (!open) return null;
  const close = () => { setEdit(null); useStampManager.setState({ open: false }); };
  const put = (st: CustomStamp) => {
    const next = stamps.some((x) => x.id === st.id) ? stamps.map((x) => (x.id === st.id ? st : x)) : [...stamps, st];
    if (!saveStamps(next)) useApp.getState().setStatus('The stamp is too large to keep in this browser; use a smaller image.');
    setEdit(null);
  };
  const addImage = async () => {
    const f = await pickFile('image/png,image/jpeg');
    if (!f) return;
    const img = await loadImage(f);
    const k = Math.min(1, 200 / Math.max(img.w, img.h));
    put({ id: crypto.randomUUID(), name: f.name.replace(/\.[^.]+$/, ''), kind: 'image', image: img.url, w: Math.round(img.w * k), h: Math.round(img.h * k) });
  };
  const importPdfStamp = async () => {
    const f = await pickFile('.pdf,application/pdf');
    if (!f) return;
    try {
      const pdf = await loadForRender(new Uint8Array(await f.arrayBuffer()));
      const page = await pdf.getPage(1);
      const vp = page.getViewport({ scale: 1 });
      const url = await snapshot(page, { x: 0, y: 0 }, { x: vp.width, y: vp.height }, Math.min(4, 600 / Math.max(vp.width, vp.height)), null);
      const k = Math.min(1, 300 / Math.max(vp.width, vp.height));
      put({ id: crypto.randomUUID(), name: f.name.replace(/\.pdf$/i, ''), kind: 'image', image: url, w: Math.round(vp.width * k), h: Math.round(vp.height * k) });
      (pdf as unknown as { destroy?: () => void }).destroy?.();
      useApp.getState().setStatus(`Stamp imported from ${f.name}`);
    } catch { useApp.getState().setStatus(`${f.name} could not be read as a stamp.`); }
  };
  const importFile = async () => {
    const f = await pickFile('.json,application/json');
    if (!f) return;
    try {
      const got = parseStamps(await f.text());
      saveStamps([...stamps, ...got]);
      useApp.getState().setStatus(`Imported ${got.length} stamp${got.length === 1 ? '' : 's'}`);
    } catch { useApp.getState().setStatus('That file is not a stamp file.'); }
  };
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal" role="dialog" aria-label="Stamps" onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') close(); }}>
        <div className="modal-title">Stamps</div>
        <div className="scale-dialog">
          {edit ? (
            <>
              <div className="form-row"><span>Name</span><input autoFocus aria-label="Stamp name" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></div>
              {edit.kind === 'text' && <>
                <div className="form-row"><span>Template</span>
                  <select aria-label="Stamp template" value={edit.template ?? 'rounded'} onChange={(e) => { const t = e.target.value as StampTemplate; setEdit({ ...edit, template: t, ...templateDefaults(t, edit.name) }); }}>
                    {STAMP_TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
                <div className="form-row"><span>Size</span>
                  <input aria-label="Stamp width" type="number" min={0.25} max={12} step={0.25} value={+((edit.w ?? DEFAULT_STAMP_SIZE.w) / 72).toFixed(2)} onChange={(e) => setEdit({ ...edit, w: Math.max(18, +e.target.value * 72) })} style={{ width: 60 }} /> ×
                  <input aria-label="Stamp height" type="number" min={0.25} max={12} step={0.25} value={+((edit.h ?? DEFAULT_STAMP_SIZE.h) / 72).toFixed(2)} onChange={(e) => setEdit({ ...edit, h: Math.max(18, +e.target.value * 72) })} style={{ width: 60 }} /> in
                </div>
                <div className="form-row"><span>Title</span><input aria-label="Stamp title" value={edit.title ?? ''} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></div>
                <div className="form-row"><span>Subtitle</span><input aria-label="Stamp subtitle" value={edit.subtitle ?? ''} onChange={(e) => setEdit({ ...edit, subtitle: e.target.value })} /></div>
                <div className="form-row"><span>Dynamic</span>
                  <select aria-label="Dynamic text" value="" onChange={(e) => { if (e.target.value) setEdit({ ...edit, subtitle: `${edit.subtitle ?? ''}{${e.target.value}}` }); }}>
                    <option value="">Insert…</option>
                    {STAMP_TOKENS.map((g) => <optgroup key={g.group} label={g.group}>{g.tokens.map((t) => <option key={t} value={t}>{t}</option>)}</optgroup>)}
                  </select>
                  <span className="muted small">Author/User, File, Date, Time… are filled in when the stamp is placed.</span>
                </div>
                <div className="form-row"><span>Border</span>
                  <select aria-label="Stamp border" value={edit.border ?? 'rounded'} onChange={(e) => setEdit({ ...edit, border: e.target.value as CustomStamp['border'] })}>
                    <option value="rounded">Rounded</option><option value="rect">Rectangle</option><option value="none">None</option>
                  </select>
                </div>
                <div className="form-row"><span>Opacity</span><input aria-label="Stamp opacity" type="range" min={10} max={100} value={Math.round((edit.opacity ?? 1) * 100)} onChange={(e) => setEdit({ ...edit, opacity: +e.target.value / 100 })} /> {Math.round((edit.opacity ?? 1) * 100)}%</div>
                <div className="form-row"><span>Colour</span><input type="color" aria-label="Stamp colour" value={edit.color ?? '#cc0000'} onChange={(e) => setEdit({ ...edit, color: e.target.value })} /></div>
                <div className="stamp-preview" style={{ color: edit.color ?? '#cc0000', borderColor: edit.color ?? '#cc0000', opacity: edit.opacity ?? 1, borderStyle: edit.border === 'none' ? 'none' : 'solid', borderRadius: edit.border === 'rect' ? 0 : 6 }}>
                  <b>{edit.title}</b><small>{stampText(edit.subtitle ?? '', { author, date: new Date(), file: 'Drawing.pdf' })}</small>
                </div>
              </>}
              <div className="modal-actions"><span className="spacer" /><button className="primary" disabled={!edit.name.trim()} onClick={() => put({ ...edit, name: edit.name.trim() })}>Save Stamp</button><button onClick={() => setEdit(null)}>Back</button></div>
            </>
          ) : (
            <>
              {stamps.length ? stamps.map((st) => (
                <div key={st.id} className="space-row">
                  {st.kind === 'image' ? <img src={st.image} alt="" style={{ height: 22, maxWidth: 60 }} /> : <span className="swatch" style={{ background: st.color ?? '#cc0000' }} />}
                  <span style={{ flex: 1 }}>{st.name}</span>
                  {st.kind === 'text' && <button onClick={() => setEdit(st)}>Edit</button>}
                  <button title="Save the stamp as a PDF file (Revu stamps are PDFs)" onClick={() => exportStampPdf(st, author)}>PDF</button>
                  <button onClick={() => saveStamps(stamps.filter((x) => x.id !== st.id))}>Delete</button>
                </div>
              )) : <p className="muted small">No custom stamps yet. The standard stamps (Approved, Reviewed…) are always available.</p>}
              <div className="modal-actions">
                <button onClick={() => setEdit({ id: crypto.randomUUID(), name: 'New Stamp', kind: 'text', template: 'dateBorder', ...templateDefaults('dateBorder', 'NEW STAMP'), subtitle: 'By {Author} on {Date}', color: '#0066cc', w: DEFAULT_STAMP_SIZE.w, h: DEFAULT_STAMP_SIZE.h })}>Create Stamp…</button>
                <button onClick={addImage}>From Image…</button>
                <button onClick={importPdfStamp} title="A Revu stamp file: its first page becomes an image stamp">Import Stamp (PDF)…</button>
                <button onClick={importFile}>Import…</button>
                <button disabled={!stamps.length} onClick={() => download('stamps.json', JSON.stringify({ stamps }, null, 1))}>Export</button>
                <span className="spacer" /><button className="primary" onClick={close}>Close</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Export a stamp as a one-page PDF of its size (Revu keeps every stamp as a PDF file). */
export async function exportStampPdf(st: CustomStamp, author: string) {
  const doc = await PDFDocument.create();
  doc.setTitle(st.name); doc.setProducer('CyanTakeoff');
  const w = st.w ?? DEFAULT_STAMP_SIZE.w, h = st.h ?? DEFAULT_STAMP_SIZE.h;
  const page = doc.addPage([w, h]);
  if (st.kind === 'image' && st.image) {
    const bytes = Uint8Array.from(atob(st.image.split(',')[1]), (c) => c.charCodeAt(0));
    const img = st.image.startsWith('data:image/jpeg') ? await doc.embedJpg(bytes) : await doc.embedPng(bytes);
    page.drawImage(img, { x: 0, y: 0, width: w, height: h });
  } else {
    const bold = await doc.embedFont(StandardFonts.HelveticaBold), font = await doc.embedFont(StandardFonts.Helvetica);
    const hex = (st.color ?? '#cc0000').replace('#', '');
    const col = rgb(parseInt(hex.slice(0, 2), 16) / 255, parseInt(hex.slice(2, 4), 16) / 255, parseInt(hex.slice(4, 6), 16) / 255);
    if ((st.border ?? 'rounded') !== 'none') page.drawRectangle({ x: 1, y: 1, width: w - 2, height: h - 2, borderColor: col, borderWidth: 1.5, opacity: 0 });
    const title = st.title ?? st.name;
    const size = Math.min(h * 0.42, (w * 1.6) / Math.max(4, title.length));
    page.drawText(title, { x: (w - bold.widthOfTextAtSize(title, size)) / 2, y: h * 0.48 - size * 0.35, size, font: bold, color: col, opacity: st.opacity ?? 1 });
    const sub = st.subtitle ?? '';
    const s2 = Math.max(5, size * 0.38);
    page.drawText(sub, { x: (w - font.widthOfTextAtSize(sub, s2)) / 2, y: h * 0.18 - s2 * 0.35, size: s2, font, color: col, opacity: st.opacity ?? 1 });
    void author;
  }
  const bytes = await doc.save();
  const href = URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' }));
  Object.assign(document.createElement('a'), { href, download: `${st.name}.pdf` }).click();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}
