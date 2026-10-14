// Document > Header & Footer, Batch > Bates Numbering and Document >
// Watermark: dialogs with a live preview; applied as page content (undoable
// like other page operations) and removable from the same menus. Each can
// run over all open documents (Revu's Batch); Bates numbers then continue
// from one file to the next.
import { useState } from 'react';
import { create } from 'zustand';
import { useApp, type DocState } from '../model/store';
import { FilesRow, batchHint, targets } from './filesRow';
import { parsePageRange } from '../model/measure';
import { hexToRgb } from '../pdf/pdfutil';
import {
  FONTS, TOKENS, addHeaderFooter, addWatermark, batesText, expandTokens, removeArtifacts,
  type Bates, type FontName, type Slot,
} from '../pdf/stamps';

type Mode = 'header' | 'bates' | 'watermark';
export const useStampDialog = create<{ open: Mode | null }>(() => ({ open: null }));

interface HFSettings { texts: Record<Slot, string>; font: FontName; size: number; color: string; margin: number; bates: Bates }
interface WMSettings { text: string; font: FontName; size: number; color: string; opacity: number; angle: number; behind: boolean }
const HF_LS = 'cyantakeoff:header-footer', WM_LS = 'cyantakeoff:watermark';
const HF_DEFAULT: HFSettings = { texts: { hl: '', hc: '', hr: '', fl: '<<File Name>>', fc: '', fr: 'Page <<Page>> of <<Pages>>' }, font: 'Helvetica', size: 10, color: '#000000', margin: 18, bates: { prefix: '', suffix: '', start: 1, digits: 6 } };
const WM_DEFAULT: WMSettings = { text: 'DRAFT', font: 'Helvetica', size: 96, color: '#ff0000', opacity: 0.25, angle: 45, behind: false };
const load = <T,>(k: string, d: T): T => { try { return { ...d, ...JSON.parse(localStorage.getItem(k) ?? '{}') }; } catch { return d; } };
const save = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } };

const rgb = (hex: string) => hexToRgb(hex) as [number, number, number];

export async function removeStamps(kind: 'Header' | 'Watermark') {
  let n = 0;
  await useApp.getState().transformDoc((lib) => { n = removeArtifacts(lib, kind); }, kind === 'Header' ? 'Header & Footer removed' : 'Watermark removed');
  if (!n) useApp.getState().setStatus(kind === 'Header' ? 'No header or footer added by CyanTakeoff in this file' : 'No watermark added by CyanTakeoff in this file');
}

export function StampDialog() {
  const open = useStampDialog((x) => x.open);
  const d = useApp((s) => s.docs.find((x) => x.id === s.activeId));
  if (!open || !d) return null;
  return open === 'watermark' ? <WatermarkForm d={d} /> : <HeaderFooterForm d={d} bates={open === 'bates'} />;
}

const close = () => useStampDialog.setState({ open: null });

function PageRange({ d, range, setRange, custom, setCustom }: { d: DocState; range: string; setRange: (v: string) => void; custom: string; setCustom: (v: string) => void }) {
  return (
    <div className="form-row"><span>Pages</span>
      <select aria-label="Pages" value={range} onChange={(e) => setRange(e.target.value)}>
        <option value="all">All Pages</option><option value="current">Current ({d.loaded.pages[d.page]?.label})</option><option value="custom">Custom</option>
      </select>
      {range === 'custom' && <input aria-label="Custom pages" value={custom} placeholder="2-10" onChange={(e) => setCustom(e.target.value)} style={{ width: 100 }} />}
    </div>
  );
}
const pagesOf = (d: DocState, range: string, custom: string) => {
  const n = d.loaded.pages.length;
  return range === 'all' ? Array.from({ length: n }, (_, i) => i) : range === 'current' ? [d.page] : parsePageRange(custom, n);
};

/** Small picture of the first page in range with the stamped text. */
function Preview({ d, page, render }: { d: DocState; page: number; render: (W: number, H: number) => React.ReactNode }) {
  const p = d.loaded.pages[page] ?? d.loaded.pages[0];
  const k = 240 / Math.max(p.width, p.height);
  return (
    <svg className="stamp-preview" width={p.width * k} height={p.height * k} viewBox={`0 0 ${p.width} ${p.height}`} aria-label="Preview">
      <rect width={p.width} height={p.height} fill="#fff" stroke="#999" strokeWidth={1 / k} />
      {render(p.width, p.height)}
    </svg>
  );
}

function HeaderFooterForm({ d, bates }: { d: DocState; bates: boolean }) {
  const [o, setO] = useState<HFSettings>(() => {
    const s = load(HF_LS, HF_DEFAULT);
    return bates && !Object.values(s.texts).some((t) => t.includes('<<Bates>>')) ? { ...s, texts: { ...s.texts, fr: '<<Bates>>' } } : s;
  });
  const [range, setRange] = useState('all');
  const [custom, setCustom] = useState('');
  const [focus, setFocus] = useState<Slot>('fr');
  const [all, setAll] = useState(() => batchHint.take());
  const pages = pagesOf(d, range, custom);
  const ctx = (pi: number, k: number) => ({ page: pi, pages: d.loaded.pages.length, label: d.loaded.pages[pi]?.label ?? '', date: new Date(), file: d.name, bates: batesText(o.bates, o.bates.start + k) });
  const setText = (slot: Slot, v: string) => setO({ ...o, texts: { ...o.texts, [slot]: v } });
  const slots: [Slot, string][] = [['hl', 'Header left'], ['hc', 'Header center'], ['hr', 'Header right'], ['fl', 'Footer left'], ['fc', 'Footer center'], ['fr', 'Footer right']];
  const ok = async () => {
    save(HF_LS, o);
    close();
    const docs = targets(d, all);
    let start = o.bates.start, n = 0;
    for (const t of docs) {
      const tp = pagesOf(t, range, custom);
      if (!tp.length) continue;
      const done = await useApp.getState().transformDoc((lib) => addHeaderFooter(lib, {
        texts: o.texts, font: o.font, size: o.size, color: rgb(o.color), margins: { top: o.margin, bottom: o.margin, left: o.margin, right: o.margin },
        pages: tp, bates: { ...o.bates, start }, fileName: t.name, date: new Date(),
      }, t.loaded.pages.map((p) => p.label)), bates ? 'Bates numbers added' : 'Header & Footer added', undefined, undefined, t.id);
      if (!done) continue;
      start += tp.length; n++;
    }
    if (docs.length > 1) useApp.getState().setStatus(`${bates ? 'Bates numbers' : 'Header & Footer'} added to ${n} document${n === 1 ? '' : 's'}`);
  };
  const title = bates ? 'Bates Numbering' : 'Header & Footer';
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal stamp-dialog" role="dialog" aria-label={title} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') close(); }}>
        <div className="modal-title">{title}</div>
        <div className="stamp-body">
          <div className="scale-dialog">
            <div className="hf-grid">
              {slots.map(([slot, label]) => (
                <label key={slot}><span className="small muted">{label}</span>
                  <textarea aria-label={label} rows={2} value={o.texts[slot]} onFocus={() => setFocus(slot)} onChange={(e) => setText(slot, e.target.value)} />
                </label>
              ))}
            </div>
            <div className="form-row"><span>Insert</span>
              <select aria-label="Insert field" value="" onChange={(e) => e.target.value && setText(focus, `${o.texts[focus]}${e.target.value}`)}>
                <option value="">Field…</option>{TOKENS.map((t) => <option key={t}>{t}</option>)}
              </select>
              <span className="muted small">into {slots.find((s) => s[0] === focus)?.[1]}</span>
            </div>
            <div className="form-row"><span>Font</span>
              <select aria-label="Font" value={o.font} onChange={(e) => setO({ ...o, font: e.target.value as FontName })}>{Object.keys(FONTS).map((n) => <option key={n}>{n}</option>)}</select>
              <input aria-label="Font size" type="number" min={4} max={72} value={o.size} onChange={(e) => setO({ ...o, size: Math.max(4, +e.target.value || 10) })} style={{ width: 56 }} />
              <input aria-label="Text colour" type="color" value={o.color} onChange={(e) => setO({ ...o, color: e.target.value })} />
            </div>
            <div className="form-row"><span>Margin</span><input aria-label="Margin" type="number" min={0} max={4} step={0.05} value={Math.round((o.margin / 72) * 100) / 100} onChange={(e) => setO({ ...o, margin: Math.max(0, +e.target.value) * 72 })} style={{ width: 64 }} /> in</div>
            {(bates || Object.values(o.texts).some((t) => t.includes('<<Bates>>'))) && (
              <div className="form-row"><span>Bates</span>
                <input aria-label="Bates prefix" placeholder="Prefix" value={o.bates.prefix} onChange={(e) => setO({ ...o, bates: { ...o.bates, prefix: e.target.value } })} style={{ width: 70 }} />
                <input aria-label="Bates start" type="number" min={0} value={o.bates.start} onChange={(e) => setO({ ...o, bates: { ...o.bates, start: Math.max(0, Math.floor(+e.target.value)) } })} style={{ width: 70 }} />
                <input aria-label="Bates digits" type="number" min={1} max={12} value={o.bates.digits} onChange={(e) => setO({ ...o, bates: { ...o.bates, digits: Math.max(1, Math.min(12, Math.floor(+e.target.value))) } })} style={{ width: 50 }} />
                <input aria-label="Bates suffix" placeholder="Suffix" value={o.bates.suffix} onChange={(e) => setO({ ...o, bates: { ...o.bates, suffix: e.target.value } })} style={{ width: 70 }} />
              </div>
            )}
            <PageRange d={d} range={range} setRange={setRange} custom={custom} setCustom={setCustom} />
            <FilesRow all={all} setAll={setAll} />
          </div>
          <Preview d={d} page={pages[0] ?? 0} render={(W, H) => slots.map(([slot]) => {
            const t = expandTokens(o.texts[slot], ctx(pages[0] ?? 0, 0));
            if (!t.trim()) return null;
            const x = slot[1] === 'l' ? o.margin : slot[1] === 'c' ? W / 2 : W - o.margin;
            const y = slot[0] === 'h' ? o.margin + o.size * 0.8 : H - o.margin - o.size * 0.2;
            return <text key={slot} x={x} y={y} fontSize={o.size} fill={o.color} textAnchor={slot[1] === 'l' ? 'start' : slot[1] === 'c' ? 'middle' : 'end'} fontFamily="Helvetica, Arial, sans-serif">{t.split('\n')[0]}</text>;
          })} />
        </div>
        <div className="modal-actions"><span className="spacer" />
          <button className="primary" disabled={!pages.length || !Object.values(o.texts).some((t) => t.trim())} onClick={ok}>OK</button>
          <button onClick={close}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function WatermarkForm({ d }: { d: DocState }) {
  const [o, setO] = useState<WMSettings>(() => load(WM_LS, WM_DEFAULT));
  const [range, setRange] = useState('all');
  const [custom, setCustom] = useState('');
  const [all, setAll] = useState(() => batchHint.take());
  const pages = pagesOf(d, range, custom);
  const ok = async () => {
    save(WM_LS, o);
    close();
    const docs = targets(d, all);
    let n = 0;
    for (const t of docs) {
      const tp = pagesOf(t, range, custom);
      if (tp.length && await useApp.getState().transformDoc((lib) => addWatermark(lib, { ...o, color: rgb(o.color), pages: tp }), 'Watermark added', undefined, undefined, t.id)) n++;
    }
    if (docs.length > 1) useApp.getState().setStatus(`Watermark added to ${n} document${n === 1 ? '' : 's'}`);
  };
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal stamp-dialog" role="dialog" aria-label="Watermark" onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') close(); }}>
        <div className="modal-title">Watermark</div>
        <div className="stamp-body">
          <div className="scale-dialog">
            <div className="form-row"><span>Text</span><textarea aria-label="Watermark text" rows={2} value={o.text} onChange={(e) => setO({ ...o, text: e.target.value })} /></div>
            <div className="form-row"><span>Font</span>
              <select aria-label="Font" value={o.font} onChange={(e) => setO({ ...o, font: e.target.value as FontName })}>{Object.keys(FONTS).map((n) => <option key={n}>{n}</option>)}</select>
              <input aria-label="Font size" type="number" min={6} max={400} value={o.size} onChange={(e) => setO({ ...o, size: Math.max(6, +e.target.value || 72) })} style={{ width: 64 }} />
              <input aria-label="Text colour" type="color" value={o.color} onChange={(e) => setO({ ...o, color: e.target.value })} />
            </div>
            <div className="form-row"><span>Opacity</span><input aria-label="Opacity" type="range" min={5} max={100} value={Math.round(o.opacity * 100)} onChange={(e) => setO({ ...o, opacity: +e.target.value / 100 })} /> {Math.round(o.opacity * 100)}%</div>
            <div className="form-row"><span>Rotation</span><input aria-label="Rotation" type="number" min={-180} max={180} value={o.angle} onChange={(e) => setO({ ...o, angle: +e.target.value || 0 })} style={{ width: 64 }} />°</div>
            <div className="form-row"><span>Position</span>
              <label><input type="radio" name="wm-z" checked={!o.behind} onChange={() => setO({ ...o, behind: false })} /> In front of page</label>
              <label><input type="radio" name="wm-z" checked={o.behind} onChange={() => setO({ ...o, behind: true })} /> Behind page</label>
            </div>
            <PageRange d={d} range={range} setRange={setRange} custom={custom} setCustom={setCustom} />
            <FilesRow all={all} setAll={setAll} />
          </div>
          <Preview d={d} page={pages[0] ?? 0} render={(W, H) => (
            <text x={W / 2} y={H / 2} fontSize={o.size} fill={o.color} fillOpacity={o.opacity} textAnchor="middle" dominantBaseline="central"
              transform={`rotate(${-o.angle} ${W / 2} ${H / 2})`} fontFamily="Helvetica, Arial, sans-serif">{o.text.split('\n')[0]}</text>
          )} />
        </div>
        <div className="modal-actions"><span className="spacer" />
          <button className="primary" disabled={!pages.length || !o.text.trim()} onClick={ok}>OK</button>
          <button onClick={close}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
