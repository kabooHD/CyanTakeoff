// Document > Number Pages (page labels: style, prefix, start, range),
// Create Page Labels from Bookmarks, and Page Setup (new media size; the
// drawing scaled and placed on it), as in Revu.
import { useState } from 'react';
import { create } from 'zustand';
import { useApp, type DocState } from '../model/store';
import { parsePageRange } from '../model/measure';
import { NUMBER_STYLES, labelsFromBookmarks, numberPages, type NumberStyle } from '../model/pageLabels';
import { writePageLabels } from '../pdf/pages';
import { PAPER, pageSetup, pageSetupTransform, type Align, type VAlign } from '../pdf/docTools';
import { selectedPages } from './Panels';

type Mode = 'number' | 'bookmarks' | 'setup';
export const usePageSetup = create<{ open: Mode | null }>(() => ({ open: null }));
const close = () => usePageSetup.setState({ open: null });

type Range = 'all' | 'current' | 'selected' | 'custom';
function PagesRow({ d, range, setRange, custom, setCustom }: { d: DocState; range: Range; setRange: (r: Range) => void; custom: string; setCustom: (v: string) => void }) {
  const sel = selectedPages(d);
  return (
    <div className="form-row"><span>Pages</span>
      <select aria-label="Pages" value={range} onChange={(e) => setRange(e.target.value as Range)}>
        <option value="all">All Pages</option><option value="current">Current ({d.loaded.pages[d.page]?.label})</option>
        {sel.length > 0 && <option value="selected">Selected ({sel.length})</option>}
        <option value="custom">Custom</option>
      </select>
      {range === 'custom' && <input aria-label="Custom pages" value={custom} placeholder="1-3, 5, 9" onChange={(e) => setCustom(e.target.value)} style={{ width: 100 }} />}
    </div>
  );
}
const pagesOf = (d: DocState, range: Range, custom: string): number[] => {
  const n = d.loaded.pages.length;
  return range === 'all' ? Array.from({ length: n }, (_, i) => i) : range === 'current' ? [d.page] : range === 'selected' ? selectedPages(d) : parsePageRange(custom, n);
};

export function PageSetupDialogs() {
  const open = usePageSetup((x) => x.open);
  const d = useApp((s) => s.docs.find((x) => x.id === s.activeId));
  if (!open || !d) return null;
  return open === 'number' ? <NumberPagesForm d={d} /> : open === 'bookmarks' ? <BookmarkLabelsForm d={d} /> : <PageSetupForm d={d} />;
}

function Frame({ title, children, onOk, okDisabled }: { title: string; children: React.ReactNode; onOk: () => void; okDisabled?: boolean }) {
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal" role="dialog" aria-label={title} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') close(); if (e.key === 'Enter' && !okDisabled) onOk(); }}>
        <div className="modal-title">{title}</div>
        <div className="scale-dialog">
          {children}
          <div className="modal-actions"><span className="spacer" /><button className="primary" disabled={okDisabled} onClick={onOk}>OK</button><button onClick={close}>Cancel</button></div>
        </div>
      </div>
    </div>
  );
}

function NumberPagesForm({ d }: { d: DocState }) {
  const [style, setStyle] = useState<NumberStyle>('decimal');
  const [prefix, setPrefix] = useState('');
  const [start, setStart] = useState('1');
  const [range, setRange] = useState<Range>('all');
  const [custom, setCustom] = useState('');
  const pages = pagesOf(d, range, custom);
  const preview = numberPages(d.loaded.pages.map((p) => p.label), pages, style, prefix, Math.max(0, Math.floor(Number(start) || 0)));
  const ok = async () => {
    close();
    await useApp.getState().transformDoc((lib) => writePageLabels(lib, preview), 'Page labels updated');
  };
  return (
    <Frame title="Number Pages" onOk={ok} okDisabled={!pages.length}>
      <div className="form-row"><span>Style</span>
        <select aria-label="Number style" value={style} onChange={(e) => setStyle(e.target.value as NumberStyle)}>{NUMBER_STYLES.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
      </div>
      <div className="form-row"><span>Prefix</span><input aria-label="Prefix" value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="e.g. A-" /></div>
      <div className="form-row"><span>Start</span><input aria-label="Start" type="number" min={0} value={start} onChange={(e) => setStart(e.target.value)} style={{ width: 70 }} /></div>
      <PagesRow d={d} range={range} setRange={setRange} custom={custom} setCustom={setCustom} />
      <p className="muted small">First label: {pages.length ? preview[Math.min(...pages)] : '—'}. Style None with an empty prefix clears a label.</p>
    </Frame>
  );
}

function BookmarkLabelsForm({ d }: { d: DocState }) {
  const [range, setRange] = useState<Range>('all');
  const [custom, setCustom] = useState('');
  const pages = pagesOf(d, range, custom);
  const labels = labelsFromBookmarks(d.loaded.pages.map((p) => p.label), d.bookmarks, pages);
  const changed = labels.filter((l, i) => l !== d.loaded.pages[i].label).length;
  const ok = async () => {
    close();
    await useApp.getState().transformDoc((lib) => writePageLabels(lib, labels), `Page labels from bookmarks: ${changed} page${changed === 1 ? '' : 's'}`);
  };
  return (
    <Frame title="Create Page Labels" onOk={ok} okDisabled={!changed}>
      <p className="muted small">Each page with a bookmark takes the bookmark's title as its label{d.bookmarks.length ? '' : ' (this document has no bookmarks)'}.</p>
      <PagesRow d={d} range={range} setRange={setRange} custom={custom} setCustom={setCustom} />
      <p className="muted small">{changed} label{changed === 1 ? '' : 's'} will change.</p>
    </Frame>
  );
}

const ALIGNS: [Align, VAlign, string][] = [
  ['left', 'top', 'Top left'], ['center', 'top', 'Top'], ['right', 'top', 'Top right'],
  ['left', 'middle', 'Left'], ['center', 'middle', 'Center'], ['right', 'middle', 'Right'],
  ['left', 'bottom', 'Bottom left'], ['center', 'bottom', 'Bottom'], ['right', 'bottom', 'Bottom right'],
];

function PageSetupForm({ d }: { d: DocState }) {
  const [media, setMedia] = useState<string>('custom');
  const [portrait, setPortrait] = useState(d.loaded.pages[d.page].height >= d.loaded.pages[d.page].width);
  const [cw, setCw] = useState((d.loaded.pages[d.page].width / 72).toFixed(2));
  const [ch, setCh] = useState((d.loaded.pages[d.page].height / 72).toFixed(2));
  const [auto, setAuto] = useState(true);
  const [scale, setScale] = useState('100');
  const [align, setAlign] = useState(4);
  const [dx, setDx] = useState('0');
  const [dy, setDy] = useState('0');
  const [range, setRange] = useState<Range>('current');
  const [custom, setCustom] = useState('');
  const pages = pagesOf(d, range, custom);
  let [W, H] = media === 'custom' ? [Number(cw) * 72, Number(ch) * 72] : PAPER[media];
  if (media !== 'custom' && !portrait !== (W > H)) [W, H] = [H, W];
  const opts = { width: W, height: H, autoScale: auto, scale: (Number(scale) || 100) / 100, align: ALIGNS[align][0], valign: ALIGNS[align][1], offset: [Number(dx) * 72 || 0, Number(dy) * 72 || 0] as [number, number] };
  const valid = W >= 36 && H >= 36 && pages.length > 0;
  const cur = d.loaded.pages[d.page];
  const t = pageSetupTransform([0, 0, cur.width, cur.height], opts);
  const ok = async () => {
    close();
    const s = useApp.getState();
    const n = await s.transformDoc((lib) => { pageSetup(lib, pages, opts); }, `Page Setup: ${pages.length} page${pages.length === 1 ? '' : 's'} set to ${(W / 72).toFixed(2)} x ${(H / 72).toFixed(2)} in`);
    void n;
  };
  return (
    <Frame title="Page Setup" onOk={ok} okDisabled={!valid}>
      <div className="form-row"><span>Media Size</span>
        <select aria-label="Media size" value={media} onChange={(e) => setMedia(e.target.value)}>
          <option value="custom">Custom Page Size</option>
          {Object.keys(PAPER).map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <label><input type="radio" name="ps-o" checked={portrait} onChange={() => setPortrait(true)} /> Portrait</label>
        <label><input type="radio" name="ps-o" checked={!portrait} onChange={() => setPortrait(false)} /> Landscape</label>
      </div>
      {media === 'custom' && (
        <div className="form-row"><span>Size</span>
          <input aria-label="Media width" type="number" min={0.5} step={0.01} value={cw} onChange={(e) => { setCw(e.target.value); setPortrait(Number(e.target.value) <= Number(ch)); }} style={{ width: 70 }} /> ×
          <input aria-label="Media height" type="number" min={0.5} step={0.01} value={ch} onChange={(e) => { setCh(e.target.value); setPortrait(Number(cw) <= Number(e.target.value)); }} style={{ width: 70 }} /> in
        </div>
      )}
      <div className="form-row"><span>Scale</span>
        <label><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Auto Scale (fit to media)</label>
        {!auto && <><input aria-label="Scale percent" type="number" min={1} max={1000} value={scale} onChange={(e) => setScale(e.target.value)} style={{ width: 64 }} />%</>}
      </div>
      <div className="form-row"><span>Fit to Media</span>
        <select aria-label="Alignment" value={align} onChange={(e) => setAlign(Number(e.target.value))}>{ALIGNS.map((a, i) => <option key={i} value={i}>{a[2]}</option>)}</select>
      </div>
      <div className="form-row"><span>Offset</span>
        X <input aria-label="Offset X" type="number" step={0.05} value={dx} onChange={(e) => setDx(e.target.value)} style={{ width: 64 }} />
        Y <input aria-label="Offset Y" type="number" step={0.05} value={dy} onChange={(e) => setDy(e.target.value)} style={{ width: 64 }} /> in
        <button onClick={() => { setDx('0'); setDy('0'); setScale('100'); setAlign(4); }}>Clear</button>
      </div>
      <PagesRow d={d} range={range} setRange={setRange} custom={custom} setCustom={setCustom} />
      <p className="muted small">Current page {(cur.width / 72).toFixed(2)} × {(cur.height / 72).toFixed(2)} in → media {(W / 72).toFixed(2)} × {(H / 72).toFixed(2)} in at {(t.s * 100).toFixed(1)}%. Measurement scales follow the resize.</p>
    </Frame>
  );
}

