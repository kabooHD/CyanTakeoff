// Stamp manager (Revu Stamp > Manage / Create / Import): custom text stamps
// (title, subtitle template with {Author} {Date} {Time}, colour) and image
// stamps; export and import a stamp file to share them with a team.
import { useState } from 'react';
import { create } from 'zustand';
import { useApp } from '../model/store';
import { DEFAULT_SUBTITLE, parseStamps, saveStamps, stampText, useStamps, type CustomStamp } from '../model/stamps';
import { loadImage, pickFile } from './toolActions';

export const useStampManager = create<{ open: boolean }>(() => ({ open: false }));

/** Markup fields for placing custom stamp `id` at `p`, or null if it is gone. */
export function customStampFields(id: string, author: string) {
  const st = useStamps.getState().stamps.find((x) => x.id === id);
  if (!st) return null;
  if (st.kind === 'image') return { kind: 'image' as const, image: st.image!, w: st.w ?? 160, h: st.h ?? 60, name: st.name };
  return { kind: 'text' as const, title: st.title ?? st.name, subtitle: stampText(st.subtitle ?? DEFAULT_SUBTITLE, { author, date: new Date() }), color: st.color, name: st.name };
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
                <div className="form-row"><span>Title</span><input aria-label="Stamp title" value={edit.title ?? ''} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></div>
                <div className="form-row"><span>Subtitle</span><input aria-label="Stamp subtitle" value={edit.subtitle ?? ''} onChange={(e) => setEdit({ ...edit, subtitle: e.target.value })} /></div>
                <div className="form-row"><span />{['Author', 'Date', 'Time', 'DateTime'].map((t) => (
                  <button key={t} type="button" onClick={() => setEdit({ ...edit, subtitle: `${edit.subtitle ?? ''}{${t}}` })}>{`{${t}}`}</button>
                ))}</div>
                <div className="form-row"><span>Colour</span><input type="color" aria-label="Stamp colour" value={edit.color ?? '#cc0000'} onChange={(e) => setEdit({ ...edit, color: e.target.value })} /></div>
                <div className="stamp-preview" style={{ color: edit.color ?? '#cc0000', borderColor: edit.color ?? '#cc0000' }}>
                  <b>{edit.title}</b><small>{stampText(edit.subtitle ?? '', { author, date: new Date() })}</small>
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
                  <button onClick={() => saveStamps(stamps.filter((x) => x.id !== st.id))}>Delete</button>
                </div>
              )) : <p className="muted small">No custom stamps yet. The standard stamps (Approved, Reviewed…) are always available.</p>}
              <div className="modal-actions">
                <button onClick={() => setEdit({ id: crypto.randomUUID(), name: 'New Stamp', kind: 'text', title: 'CHECKED', subtitle: 'By {Author} on {Date}', color: '#0066cc' })}>New Text Stamp</button>
                <button onClick={addImage}>From Image…</button>
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
