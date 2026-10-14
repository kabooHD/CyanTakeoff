// Review Text (Revu: Markup > PDF Content > Review Text): drag across text
// to mark it for replacement (a strikethrough plus an insertion caret, the
// new text in the note), or click to mark a point where text is to be
// inserted. The text in the PDF is not changed. Also Create Hyperlinks from
// URLs: web addresses and emails in the page text become Hyperlink markups.
import { useState } from 'react';
import { create } from 'zustand';
import { useApp, type DocState } from '../model/store';
import type { Pt } from '../model/types';
import { parsePageRange } from '../model/measure';
import { findUrls } from '../model/urls';
import { pageText } from './toolActions';

interface Pending { kind: 'replace' | 'insert'; ids: string[] }
export const useReviewText = create<{ pending: Pending | null }>(() => ({ pending: null }));

/** Mark text runs (`rects`, point pairs) for replacement, or a point for insertion when there are none. */
export function reviewTextMark(page: number, rects: Pt[], at: Pt) {
  const s = useApp.getState();
  const d = s.docs.find((x) => x.id === s.activeId);
  if (!d) return;
  const ids: string[] = [];
  const groupId = crypto.randomUUID();
  let caretAt = at, h = 10;
  if (rects.length >= 2) {
    const last = rects.slice(-2);
    h = Math.abs(last[1].y - last[0].y) || 10;
    caretAt = { x: Math.max(last[0].x, last[1].x), y: Math.max(last[0].y, last[1].y) };
    ids.push(s.addMarkup({ type: 'strikeout', page, points: rects, style: s.toolDefaults.strikeout, subject: 'Replace Text', groupId }).id);
  }
  const w = h * 0.6;
  ids.push(s.addMarkup({ type: 'caret', page, points: [{ x: caretAt.x - w / 2, y: caretAt.y - h * 0.6 }, { x: caretAt.x + w / 2, y: caretAt.y }], style: s.toolDefaults.caret, subject: rects.length ? 'Replace Text' : 'Insert Text', groupId: rects.length ? groupId : undefined }).id);
  useReviewText.setState({ pending: { kind: rects.length ? 'replace' : 'insert', ids } });
}

export function ReviewTextDialog() {
  const pending = useReviewText((x) => x.pending);
  const [text, setText] = useState('');
  if (!pending) return null;
  const close = (keep: boolean) => {
    const s = useApp.getState();
    if (keep && text.trim()) s.updateMarkups(pending.ids, () => ({ comment: text.trim() }));
    else s.deleteMarkups(pending.ids);
    useReviewText.setState({ pending: null });
    setText('');
  };
  const title = pending.kind === 'replace' ? 'Replacement Text' : 'Inserted Text';
  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-label={title} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') close(false); if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); close(true); } }}>
        <div className="modal-title">{title}</div>
        <div className="scale-dialog">
          <textarea autoFocus aria-label={title} rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={pending.kind === 'replace' ? 'Text that replaces the struck-through text' : 'Text to insert here'} style={{ width: 320 }} />
          <div className="modal-actions"><span className="spacer" /><button className="primary" disabled={!text.trim()} onClick={() => close(true)}>OK</button><button onClick={() => close(false)}>Cancel</button></div>
        </div>
      </div>
    </div>
  );
}

// ---------- Create Hyperlinks from URLs ----------

export const useLinkUrls = create<{ open: boolean }>(() => ({ open: false }));

/** Hyperlink markups over every web address and email in the text of `pages`; returns how many were made. */
export async function createHyperlinksFromUrls(d: DocState, pages: number[]): Promise<number> {
  const s = useApp.getState();
  let n = 0;
  for (const p of pages) {
    const boxes = await pageText(await d.loaded.pdf.getPage(p + 1), d.loaded.pages[p].viewport);
    for (const b of boxes) {
      const len = b.str.length || 1;
      for (const u of findUrls(b.str)) {
        const x0 = b.x0 + ((b.x1 - b.x0) * u.start) / len, x1 = b.x0 + ((b.x1 - b.x0) * u.end) / len;
        const dup = d.markups.some((m) => m.type === 'link' && m.page === p && m.link?.uri === u.uri && Math.abs(m.points[0].x - x0) < 2 && Math.abs(m.points[0].y - b.y0) < 2);
        if (dup) continue;
        s.addMarkup({ type: 'link', page: p, points: [{ x: x0, y: b.y0 }, { x: x1, y: b.y1 }], style: s.toolDefaults.link, subject: 'Hyperlink', link: { uri: u.uri }, comment: u.uri });
        n++;
      }
    }
  }
  s.setStatus(n ? `Create Hyperlinks from URLs: ${n} hyperlink${n === 1 ? '' : 's'} added` : 'Create Hyperlinks from URLs: no web addresses found in the page text');
  return n;
}

export function LinkUrlsDialog() {
  const open = useLinkUrls((x) => x.open);
  const d = useApp((s) => s.docs.find((x) => x.id === s.activeId));
  const [range, setRange] = useState<'all' | 'current' | 'custom'>('all');
  const [custom, setCustom] = useState('1');
  if (!open || !d) return null;
  const close = () => useLinkUrls.setState({ open: false });
  const ok = async () => {
    const n = d.loaded.pages.length;
    const pages = range === 'all' ? Array.from({ length: n }, (_, i) => i) : range === 'current' ? [d.page] : parsePageRange(custom, n);
    close();
    try { await createHyperlinksFromUrls(d, pages); } catch (e) { useApp.getState().setStatus(`Create Hyperlinks failed: ${(e as Error).message}`); }
  };
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal" role="dialog" aria-label="Create Hyperlinks from URLs" onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') close(); if (e.key === 'Enter') ok(); }}>
        <div className="modal-title">Create Hyperlinks from URLs</div>
        <div className="scale-dialog">
          <p className="muted small">Web addresses and emails in the page text get a Hyperlink markup.</p>
          <div className="form-row"><span>Pages</span>
            <select aria-label="Pages" value={range} onChange={(e) => setRange(e.target.value as typeof range)}>
              <option value="all">All Pages</option><option value="current">Current ({d.loaded.pages[d.page]?.label})</option><option value="custom">Custom</option>
            </select>
            {range === 'custom' && <input aria-label="Custom pages" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="1-3, 5, 9" style={{ width: 100 }} />}
          </div>
          <div className="modal-actions"><span className="spacer" /><button className="primary" onClick={ok}>OK</button><button onClick={close}>Cancel</button></div>
        </div>
      </div>
    </div>
  );
}
