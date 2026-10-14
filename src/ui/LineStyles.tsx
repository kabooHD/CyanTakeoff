// Line Style and Hatch lists for the Properties panel, and the Manage Line
// Styles / Manage Hatch Patterns dialogs with their editors (Revu's Line
// Style Editor: lines with offsets made of dash, space, dot and text
// components; Hatch Pattern Editor: draw lines and dots on a tile). Sets are
// shared as JSON files (Import / Export).
import { useRef, useState } from 'react';
import { create } from 'zustand';
import { useApp } from '../model/store';
import { guessPatUnits, parsePat, patToHatch } from '../model/pat';
import type { MarkupStyle } from '../model/types';
import {
  HATCH_TYPES, STANDARD_HATCHES, STANDARD_LINE_STYLES, hatchLineWidth, styledStroke,
  type HatchDef, type LineComponent, type LineStyleDef,
} from '../model/lineStyles';

export const useStyleManager = create<{ open: 'lines' | 'hatches' | null }>(() => ({ open: null }));

const MANAGE = '__manage__';

export function LineStyleSelect({ style, onChange }: { style: MarkupStyle; onChange: (p: Partial<MarkupStyle>) => void }) {
  const custom = useApp((s) => s.customLineStyles);
  const value = style.lineDef ? `custom:${style.lineDef.id}` : style.lineStyle;
  const known = style.lineDef && !custom.some((c) => c.id === style.lineDef!.id);
  return (
    <select aria-label="Line Style" value={value} onChange={(e) => {
      const v = e.target.value;
      if (v === MANAGE) { useStyleManager.setState({ open: 'lines' }); return; }
      if (v.startsWith('custom:')) {
        const d = custom.find((c) => `custom:${c.id}` === v);
        if (d) onChange({ lineStyle: d.id, lineDef: d });
      } else onChange({ lineStyle: v, lineDef: undefined });
    }}>
      <optgroup label="Standard">{STANDARD_LINE_STYLES.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</optgroup>
      {(custom.length > 0 || known) && (
        <optgroup label="Custom">
          {custom.map((d) => <option key={d.id} value={`custom:${d.id}`}>{d.name}</option>)}
          {known && <option value={value}>{style.lineDef!.name} (in this file)</option>}
        </optgroup>
      )}
      <option value={MANAGE}>Manage…</option>
    </select>
  );
}

export function HatchSelect({ style, type, onChange }: { style: MarkupStyle; type: string; onChange: (p: Partial<MarkupStyle>) => void }) {
  const custom = useApp((s) => s.customHatches);
  if (!HATCH_TYPES.has(type)) return null;
  const all = [...STANDARD_HATCHES, ...custom];
  const value = style.hatch?.id ?? '';
  const inFile = style.hatch && !all.some((h) => h.id === style.hatch!.id);
  return (
    <>
      <label className="prop-row"><span>Hatch</span>
        <select aria-label="Hatch" value={value} onChange={(e) => {
          const v = e.target.value;
          if (v === MANAGE) { useStyleManager.setState({ open: 'hatches' }); return; }
          const h = all.find((x) => x.id === v);
          onChange({ hatch: h, hatchScale: h ? style.hatchScale ?? 1 : undefined, ...(h && !style.fill ? { fill: style.color } : {}) });
        }}>
          <option value="">None</option>
          <optgroup label="Standard">{STANDARD_HATCHES.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</optgroup>
          {(custom.length > 0 || inFile) && (
            <optgroup label="Custom">
              {custom.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
              {inFile && <option value={value}>{style.hatch!.name} (in this file)</option>}
            </optgroup>
          )}
          <option value={MANAGE}>Manage…</option>
        </select>
      </label>
      {style.hatch && (
        <label className="prop-row"><span>Hatch Scale</span>
          <input aria-label="Hatch scale" type="number" min={0.1} max={20} step={0.1} value={style.hatchScale ?? 1}
            onChange={(e) => onChange({ hatchScale: Math.max(0.1, +e.target.value || 1) })} />
        </label>
      )}
    </>
  );
}

// ---------- previews ----------

export function LinePreview({ def, width = 1.5, w = 220, h = 36 }: { def: LineStyleDef; width?: number; w?: number; h?: number }) {
  const { lines, texts } = styledStroke([{ x: 8, y: h / 2 }, { x: w - 8, y: h / 2 }], false, def, width);
  return (
    <svg width={w} height={h} className="style-preview" aria-label={`${def.name} preview`}>
      {lines.map((l, i) => <polyline key={i} points={l.pts.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#000" strokeWidth={width} strokeLinecap="round" strokeDasharray={l.dash?.join(' ')} />)}
      {texts.map((t, i) => <text key={i} x={t.at.x} y={t.at.y} fontSize={t.size} textAnchor="middle" dominantBaseline="central" fontFamily="Helvetica, Arial, sans-serif">{t.text}</text>)}
    </svg>
  );
}

export function HatchPreview({ h, size = 96, scale = 1.5 }: { h: HatchDef; size?: number; scale?: number }) {
  const t = h.size * scale, th = t * (h.aspect || 1), id = `hp-${h.id}-${Math.round(t * 10)}`;
  return (
    <svg width={size} height={size} className="style-preview" aria-label={`${h.name} preview`}>
      <defs>
        <pattern id={id} patternUnits="userSpaceOnUse" width={t} height={th}>
          {h.lines.map(([a, b, c, d], i) => <line key={i} x1={a * t} y1={b * th} x2={c * t} y2={d * th} stroke="#000" strokeWidth={hatchLineWidth(t)} strokeLinecap="square" />)}
          {h.dots.map(([x, y, r], i) => <circle key={`d${i}`} cx={x * t} cy={y * th} r={Math.max(0.3, r * t)} />)}
        </pattern>
      </defs>
      <rect width={size} height={size} fill={`url(#${id})`} stroke="#888" />
    </svg>
  );
}

// ---------- import / export ----------

function download(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
  Object.assign(document.createElement('a'), { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
function pickJson(onLoad: (data: unknown) => void, onPat?: (text: string, name: string) => void) {
  const input = Object.assign(document.createElement('input'), { type: 'file', accept: onPat ? '.json,.pat,application/json' : '.json,application/json' });
  input.onchange = async () => {
    const f = input.files?.[0];
    if (!f) return;
    const text = await f.text();
    if (onPat && (/\.pat$/i.test(f.name) || /^\s*\*/.test(text))) { onPat(text, f.name); return; }
    try { onLoad(JSON.parse(text)); } catch { useApp.getState().setStatus('Not a CyanTakeoff style file'); }
  };
  input.click();
}

/** Import every pattern of an AutoCAD .pat file as custom hatches (metric files are spaced in mm, others in inches). */
export function importPat(text: string, custom: HatchDef[]): HatchDef[] {
  const pats = parsePat(text);
  if (!pats.length) { useApp.getState().setStatus('No hatch patterns in that .pat file'); return custom; }
  const mm = pats.filter((p) => guessPatUnits(p) === 'mm').length > pats.length / 2;
  const list = pats.map((p) => patToHatch(p, mm ? 72 / 25.4 : 72));
  useApp.getState().setStatus(`Imported ${list.length} hatch pattern${list.length === 1 ? '' : 's'} (${mm ? 'millimetre' : 'inch'} units; adjust with Hatch Scale)`);
  return [...custom.filter((c) => !list.some((x) => x.id === c.id)), ...list];
}

// ---------- dialogs ----------

export function StyleManagerDialog() {
  const open = useStyleManager((x) => x.open);
  if (!open) return null;
  return open === 'lines' ? <LineStyleManager /> : <HatchManager />;
}

const close = () => useStyleManager.setState({ open: null });

function Frame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal style-manager" role="dialog" aria-label={title} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') close(); }}>
        <div className="modal-title">{title}</div>
        {children}
      </div>
    </div>
  );
}

function LineStyleManager() {
  const custom = useApp((s) => s.customLineStyles);
  const save = (list: LineStyleDef[]) => useApp.getState().setView({ customLineStyles: list });
  const [sel, setSel] = useState<string | null>(null);
  const [edit, setEdit] = useState<LineStyleDef | null>(null);
  if (edit) {
    return <Frame title="Line Style Editor"><LineStyleEditor def={edit} onDone={(d) => {
      if (d) save(custom.some((c) => c.id === d.id) ? custom.map((c) => (c.id === d.id ? d : c)) : [...custom, d]);
      setEdit(null);
    }} /></Frame>;
  }
  const all = [...STANDARD_LINE_STYLES.map((d) => ({ d, std: true })), ...custom.map((d) => ({ d, std: false }))];
  const cur = custom.find((c) => c.id === sel);
  return (
    <Frame title="Manage Line Styles">
      <div className="style-list" role="listbox" aria-label="Line styles">
        {all.map(({ d, std }) => (
          <div key={d.id} role="option" aria-selected={sel === d.id} className={`style-item ${sel === d.id ? 'selected' : ''}`}
            onClick={() => setSel(d.id)} onDoubleClick={() => !std && setEdit(d)}>
            <span className="style-name">{d.name}{std ? <span className="muted"> · Standard</span> : ''}</span>
            <LinePreview def={d} w={160} h={24} />
          </div>
        ))}
      </div>
      <p className="muted small">The Standard set cannot be changed. Changing a style does not change markups already drawn with it.</p>
      <div className="modal-actions">
        <button onClick={() => setEdit({ id: crypto.randomUUID(), name: 'New Line Style', scale: true, lines: [{ offset: 0, components: [{ kind: 'dash', len: 6 }, { kind: 'space', len: 3 }] }] })}>Add…</button>
        <button disabled={!cur} onClick={() => cur && setEdit(cur)}>Modify…</button>
        <button disabled={!cur} onClick={() => { save(custom.filter((c) => c.id !== sel)); setSel(null); }}>Delete</button>
        <button onClick={() => pickJson((data) => {
          const list = (data as { lineStyles?: LineStyleDef[] }).lineStyles;
          if (!Array.isArray(list)) { useApp.getState().setStatus('No line styles in that file'); return; }
          save([...custom.filter((c) => !list.some((x) => x.id === c.id)), ...list]);
        })}>Import…</button>
        <button disabled={!custom.length} onClick={() => download('Line Styles.json', { type: 'cyantakeoff-line-styles', lineStyles: custom })}>Export…</button>
        <span className="spacer" />
        <button className="primary" onClick={close}>Close</button>
      </div>
    </Frame>
  );
}

function LineStyleEditor({ def, onDone }: { def: LineStyleDef; onDone: (d: LineStyleDef | null) => void }) {
  const [d, setD] = useState<LineStyleDef>(structuredClone(def));
  const [line, setLine] = useState(0);
  const ln = d.lines[line];
  const setLn = (p: Partial<LineStyleDef['lines'][number]>) => setD({ ...d, lines: d.lines.map((x, i) => (i === line ? { ...x, ...p } : x)) });
  const setComp = (i: number, c: LineComponent | null) => setLn({ components: c ? ln.components.map((x, k) => (k === i ? c : x)) : ln.components.filter((_, k) => k !== i) });
  return (
    <div className="scale-dialog">
      <div className="form-row"><span>Name</span><input aria-label="Line style name" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} /></div>
      <div className="form-row"><span>Preview</span><LinePreview def={d} w={280} h={40} /></div>
      <div className="form-row"><span>Lines</span>
        <select aria-label="Line" value={line} onChange={(e) => setLine(+e.target.value)}>
          {d.lines.map((x, i) => <option key={i} value={i}>Line {i + 1} (offset {x.offset})</option>)}
        </select>
        <button onClick={() => { setD({ ...d, lines: [...d.lines, { offset: 2, components: [] }] }); setLine(d.lines.length); }}>+</button>
        <button disabled={d.lines.length < 2} onClick={() => { setD({ ...d, lines: d.lines.filter((_, i) => i !== line) }); setLine(0); }}>−</button>
      </div>
      {ln && <>
        <div className="form-row"><span>Offset</span>
          <input aria-label="Offset" type="number" min={-10} max={10} step={0.5} value={ln.offset} onChange={(e) => setLn({ offset: Math.max(-10, Math.min(10, +e.target.value)) })} />
          <span className="muted small">line widths from the middle</span>
        </div>
        <div className="form-row"><span>Components</span>
          <div className="components">
            {!ln.components.length && <span className="muted small">Solid line. Add dashes, spaces, dots or text.</span>}
            {ln.components.map((c, i) => (
              <div key={i} className="component">
                <select aria-label={`Component ${i + 1}`} value={c.kind} onChange={(e) => setComp(i, { kind: e.target.value as LineComponent['kind'], len: c.len ?? 4, text: c.text ?? 'X' })}>
                  <option value="dash">Dash</option><option value="space">Space</option><option value="dot">Dot</option><option value="text">Text</option>
                </select>
                {(c.kind === 'dash' || c.kind === 'space') && <input aria-label={`Length ${i + 1}`} type="number" min={0.5} max={100} step={0.5} value={c.len ?? 4} onChange={(e) => setComp(i, { ...c, len: Math.max(0.5, +e.target.value) })} />}
                {c.kind === 'text' && <input aria-label={`Text ${i + 1}`} value={c.text ?? ''} maxLength={12} onChange={(e) => setComp(i, { ...c, text: e.target.value })} />}
                <button aria-label={`Remove component ${i + 1}`} onClick={() => setComp(i, null)}>×</button>
              </div>
            ))}
            <span>
              {(['dash', 'space', 'dot', 'text'] as const).map((k) => (
                <button key={k} onClick={() => setLn({ components: [...ln.components, k === 'text' ? { kind: k, text: 'X' } : k === 'dot' ? { kind: k } : { kind: k, len: k === 'dash' ? 6 : 2 }] })}>+ {k[0].toUpperCase() + k.slice(1)}</button>
              ))}
            </span>
          </div>
        </div>
      </>}
      <div className="form-row"><label><input type="checkbox" checked={d.scale} onChange={(e) => setD({ ...d, scale: e.target.checked })} /> Scale with line thickness</label></div>
      <div className="form-row"><span>Description</span><input aria-label="Description" value={d.description ?? ''} onChange={(e) => setD({ ...d, description: e.target.value })} /></div>
      <div className="modal-actions"><span className="spacer" />
        <button className="primary" disabled={!d.name.trim()} onClick={() => onDone({ ...d, name: d.name.trim() })}>OK</button>
        <button onClick={() => onDone(null)}>Cancel</button>
      </div>
    </div>
  );
}

function HatchManager() {
  const custom = useApp((s) => s.customHatches);
  const save = (list: HatchDef[]) => useApp.getState().setView({ customHatches: list });
  const [sel, setSel] = useState<string | null>(null);
  const [edit, setEdit] = useState<HatchDef | null>(null);
  if (edit) {
    return <Frame title="Hatch Pattern Editor"><HatchEditor h={edit} onDone={(h) => {
      if (h) save(custom.some((c) => c.id === h.id) ? custom.map((c) => (c.id === h.id ? h : c)) : [...custom, h]);
      setEdit(null);
    }} /></Frame>;
  }
  const cur = custom.find((c) => c.id === sel);
  return (
    <Frame title="Manage Hatch Patterns">
      <div className="hatch-grid" role="listbox" aria-label="Hatch patterns">
        {[...STANDARD_HATCHES.map((h) => ({ h, std: true })), ...custom.map((h) => ({ h, std: false }))].map(({ h, std }) => (
          <div key={h.id} role="option" aria-selected={sel === h.id} className={`hatch-item ${sel === h.id ? 'selected' : ''}`}
            onClick={() => setSel(h.id)} onDoubleClick={() => !std && setEdit(h)} title={std ? `${h.name} (Standard)` : h.name}>
            <HatchPreview h={h} size={64} />
            <span className="small">{h.name}</span>
          </div>
        ))}
      </div>
      <div className="modal-actions">
        <button onClick={() => setEdit({ id: crypto.randomUUID(), name: 'New Hatch', size: 8, lines: [], dots: [] })}>Add…</button>
        <button disabled={!cur} onClick={() => cur && setEdit(cur)}>Modify…</button>
        <button disabled={!cur} onClick={() => { save(custom.filter((c) => c.id !== sel)); setSel(null); }}>Delete</button>
        <button onClick={() => pickJson((data) => {
          const list = (data as { hatches?: HatchDef[] }).hatches;
          if (!Array.isArray(list)) { useApp.getState().setStatus('No hatch patterns in that file'); return; }
          save([...custom.filter((c) => !list.some((x) => x.id === c.id)), ...list]);
        }, (text) => save(importPat(text, custom)))}>Import…</button>
        <button disabled={!custom.length} onClick={() => download('Hatch Patterns.json', { type: 'cyantakeoff-hatches', hatches: custom })}>Export…</button>
        <span className="spacer" />
        <button className="primary" onClick={close}>Close</button>
      </div>
    </Frame>
  );
}

const GRID = 8, CELL = 24, TILE = GRID * CELL;

function HatchEditor({ h, onDone }: { h: HatchDef; onDone: (h: HatchDef | null) => void }) {
  const [d, setD] = useState<HatchDef>(structuredClone(h));
  const [tool, setTool] = useState<'line' | 'small' | 'large' | 'delete'>('line');
  const [from, setFrom] = useState<[number, number] | null>(null);
  const [hover, setHover] = useState<[number, number] | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const snap = (e: React.PointerEvent): [number, number] => {
    const r = svg.current!.getBoundingClientRect();
    return [Math.round(((e.clientX - r.left) / TILE) * GRID) / GRID, Math.round(((e.clientY - r.top) / TILE) * GRID) / GRID].map((v) => Math.max(0, Math.min(1, v))) as [number, number];
  };
  const down = (e: React.PointerEvent) => {
    const p = snap(e);
    if (tool === 'line') { setFrom(p); return; }
    if (tool === 'delete') {
      const near = (x: number, y: number) => Math.hypot(x - p[0], y - p[1]) < 0.6 / GRID;
      const onLine = ([a, b, c, dd]: number[]) => {
        const l2 = (c - a) ** 2 + (dd - b) ** 2, t = l2 ? Math.max(0, Math.min(1, ((p[0] - a) * (c - a) + (p[1] - b) * (dd - b)) / l2)) : 0;
        return near(a + t * (c - a), b + t * (dd - b));
      };
      setD({ ...d, lines: d.lines.filter((l) => !onLine(l)), dots: d.dots.filter(([x, y]) => !near(x, y)) });
      return;
    }
    setD({ ...d, dots: [...d.dots, [p[0], p[1], tool === 'small' ? 0.04 : 0.09]] });
  };
  const up = (e: React.PointerEvent) => {
    if (tool !== 'line' || !from) return;
    const p = snap(e);
    if (p[0] !== from[0] || p[1] !== from[1]) setD({ ...d, lines: [...d.lines, [from[0], from[1], p[0], p[1]]] });
    setFrom(null);
  };
  return (
    <div className="scale-dialog">
      <div className="form-row"><span>Name</span><input aria-label="Hatch name" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} /></div>
      <div className="form-row"><span>Tile size</span><input aria-label="Tile size" type="number" min={2} max={72} value={d.size} onChange={(e) => setD({ ...d, size: Math.max(2, Math.min(72, +e.target.value || 8)) })} /> pt</div>
      <div className="form-row"><span>Draw</span>
        {(['line', 'small', 'large', 'delete'] as const).map((t) => (
          <button key={t} className={tool === t ? 'active' : ''} aria-pressed={tool === t} onClick={() => setTool(t)}>
            {t === 'line' ? 'Line' : t === 'small' ? 'Small Dot' : t === 'large' ? 'Large Dot' : 'Delete'}
          </button>
        ))}
        <button onClick={() => setD({ ...d, lines: [], dots: [] })}>Clear</button>
      </div>
      <div className="hatch-editor">
        <svg ref={svg} width={TILE} height={TILE} aria-label="Hatch tile" className="hatch-tile"
          onPointerDown={down} onPointerUp={up} onPointerMove={(e) => setHover(snap(e))} onPointerLeave={() => { setHover(null); setFrom(null); }}>
          {Array.from({ length: GRID + 1 }, (_, i) => (
            <g key={i} stroke="#ddd"><line x1={i * CELL} y1={0} x2={i * CELL} y2={TILE} /><line x1={0} y1={i * CELL} x2={TILE} y2={i * CELL} /></g>
          ))}
          {d.lines.map(([a, b, c, dd], i) => <line key={i} x1={a * TILE} y1={b * TILE} x2={c * TILE} y2={dd * TILE} stroke="#000" strokeWidth={2} />)}
          {d.dots.map(([x, y, r], i) => <circle key={`d${i}`} cx={x * TILE} cy={y * TILE} r={Math.max(2, r * TILE)} />)}
          {from && hover && <line x1={from[0] * TILE} y1={from[1] * TILE} x2={hover[0] * TILE} y2={hover[1] * TILE} stroke="#1a73e8" strokeWidth={2} />}
          {hover && <circle cx={hover[0] * TILE} cy={hover[1] * TILE} r={3} fill="#1a73e8" />}
        </svg>
        <HatchPreview h={d} size={TILE} />
      </div>
      <div className="modal-actions"><span className="spacer" />
        <button className="primary" disabled={!d.name.trim() || (!d.lines.length && !d.dots.length)} onClick={() => onDone({ ...d, name: d.name.trim() })}>OK</button>
        <button onClick={() => onDone(null)}>Cancel</button>
      </div>
    </div>
  );
}
