// Batch > Apply Stamp (Revu): one stamp on every chosen page of the open
// documents, at a corner or the centre with a margin.
import { useState } from 'react';
import { create } from 'zustand';
import { useApp, type DocState } from '../model/store';
import type { Markup } from '../model/types';
import { parsePageRange } from '../model/measure';
import { useStamps } from '../model/stamps';
import { STAMP_ANCHORS, stampPlacement, type StampAnchor } from '../model/batchStamp';
import { STAMPS } from './toolActions';
import { customStampFields } from './Stamps';
import { FilesRow, batchHint, targets } from './filesRow';
import { toolById } from '../tools/tools';

export const useApplyStamp = create<{ open: boolean }>(() => ({ open: false }));

/** Approximate stamp size (points) for placement: built-in stamps are a text box; custom ones carry a size. */
const sizeOf = (name: string, author: string): { w: number; h: number } => {
  if (name.startsWith('custom:')) { const c = customStampFields(name.slice(7), author); if (c?.kind === 'image') return { w: c.w, h: c.h }; }
  return { w: 160, h: 40 };
};

export function ApplyStampDialog() {
  const open = useApplyStamp((x) => x.open);
  const d = useApp((s) => s.docs.find((x) => x.id === s.activeId));
  return open && d ? <ApplyStampForm d={d} /> : null;
}

function ApplyStampForm({ d }: { d: DocState }) {
  const custom = useStamps((x) => x.stamps);
  const [name, setName] = useState('APPROVED');
  const [anchor, setAnchor] = useState<StampAnchor>('top-right');
  const [margin, setMargin] = useState('0.5');
  const [range, setRange] = useState<'all' | 'current' | 'custom'>('all');
  const [customRange, setCustomRange] = useState('1');
  const [all, setAll] = useState(() => batchHint.take());
  const close = () => useApplyStamp.setState({ open: false });
  const pagesOf = (t: DocState) => { const n = t.loaded.pages.length; return range === 'all' ? Array.from({ length: n }, (_, i) => i) : range === 'current' ? [t.page] : parsePageRange(customRange, n); };
  const ok = () => {
    const s = useApp.getState();
    const m = (Number(margin) || 0) * 72;
    let count = 0, files = 0;
    for (const t of targets(d, all)) {
      const ms: Markup[] = [];
      const now = new Date().toISOString();
      for (const p of pagesOf(t)) {
        const info = t.loaded.pages[p];
        const { w, h } = sizeOf(name, s.author);
        const at = stampPlacement(info.width, info.height, w, h, anchor, m);
        const base = { id: crypto.randomUUID(), page: p, author: s.author, created: now, modified: now, status: 'None' as const, label: '', comment: '' };
        if (name.startsWith('custom:')) {
          const c = customStampFields(name.slice(7), s.author);
          if (!c) continue;
          if (c.kind === 'image') ms.push({ ...base, type: 'image', points: [{ x: at.x - c.w / 2, y: at.y - c.h / 2 }, { x: at.x + c.w / 2, y: at.y + c.h / 2 }], style: s.toolDefaults.image, subject: c.name, image: c.image });
          else ms.push({ ...base, type: 'stamp', points: [at], style: c.color ? { ...s.toolDefaults.stamp, color: c.color } : s.toolDefaults.stamp, subject: c.name, text: c.title, subtitle: c.subtitle });
        } else ms.push({ ...base, type: 'stamp', points: [at], style: s.toolDefaults.stamp, subject: toolById('stamp').subject, text: name });
      }
      if (ms.length) { s.addMarkups(ms, t.id); count += ms.length; files++; }
    }
    close();
    s.setStatus(`Apply Stamp: ${count} stamp${count === 1 ? '' : 's'} placed on ${files} document${files === 1 ? '' : 's'}`);
  };
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal" role="dialog" aria-label="Apply Stamp" onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') close(); if (e.key === 'Enter') ok(); }}>
        <div className="modal-title">Apply Stamp</div>
        <div className="scale-dialog">
          <div className="form-row"><span>Stamp</span>
            <select aria-label="Stamp" value={name} onChange={(e) => setName(e.target.value)}>
              {STAMPS.map((n) => <option key={n} value={n}>{n}</option>)}
              {custom.length > 0 && <optgroup label="My stamps">{custom.map((c) => <option key={c.id} value={`custom:${c.id}`}>{c.name}</option>)}</optgroup>}
            </select>
          </div>
          <div className="form-row"><span>Position</span>
            <select aria-label="Position" value={anchor} onChange={(e) => setAnchor(e.target.value as StampAnchor)}>
              {STAMP_ANCHORS.map((a) => <option key={a} value={a}>{a.replace('-', ' ')}</option>)}
            </select>
            <label>Margin <input aria-label="Margin" type="number" min={0} step={0.25} value={margin} onChange={(e) => setMargin(e.target.value)} style={{ width: 60 }} /> in</label>
          </div>
          <div className="form-row"><span>Pages</span>
            <select aria-label="Pages" value={range} onChange={(e) => setRange(e.target.value as typeof range)}>
              <option value="all">All Pages</option><option value="current">Current page</option><option value="custom">Custom</option>
            </select>
            {range === 'custom' && <input aria-label="Custom pages" value={customRange} onChange={(e) => setCustomRange(e.target.value)} placeholder="1-3, 5, 9" style={{ width: 100 }} />}
          </div>
          <FilesRow all={all} setAll={setAll} />
          <div className="modal-actions"><span className="spacer" /><button className="primary" onClick={ok}>OK</button><button onClick={close}>Cancel</button></div>
        </div>
      </div>
    </div>
  );
}
