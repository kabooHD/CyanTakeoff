import { markupBounds } from './hit';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { viewerApi } from './Viewer';
import { anchorOf } from '../model/spaces';
import { useApp, useActiveDoc } from '../model/store';
import type { CustomColumn, Markup } from '../model/types';
import { StatusSelect } from './StatusModels';
import { allColumns, exportMarkupsXfdf, exportSummaryCsv, exportSummaryPdf, exportSummaryXlsx, importMarkupsXfdf, type SummaryColumn } from './actions';
import { captureSummary, exportCaptureMedia } from './captureExport';
import { ManageColumns } from './ManageColumns';
import { Icon } from './icons';
import { ContextMenu, type MenuItem } from './ContextMenu';
import { markupMenuItems } from './markupMenu';
import { openCapturePreview } from './Capture';
import { openSummaryDialog } from './SummaryDialog';
import { clampNumber } from '../model/columns';
import { OPS, describeFilter, matchesCustom, type ColumnKind, type CustomFilter } from '../model/listFilter';

/** Saved filter sets (Revu's Saved Filters), kept in the browser. */
interface SavedFilter { name: string; filters: Record<string, string>; search: string; custom?: Record<string, CustomFilter> }
const DATE_COLUMNS = new Set(['date', 'created', 'statusDate']);
const CUSTOM = '__custom__';
const SF_LS = 'cyantakeoff:markups-list-filters';
const loadSaved = (): SavedFilter[] => { try { return JSON.parse(localStorage.getItem(SF_LS) ?? '[]'); } catch { return []; } };
const storeSaved = (l: SavedFilter[]) => { try { localStorage.setItem(SF_LS, JSON.stringify(l)); } catch { /* storage unavailable */ } };
/** Columns whose sort groups the list under section headings (Revu groups under the sorted value). */
const GROUPED = new Set(['subject', 'author', 'status', 'layer', 'space', 'label', 'color', 'units']);

const NO_TOTAL = new Set(['depth', 'angle', 'slope']);
/** Columns that sort by creation date when values tie (Revu does this for Subject and page). */
const TIE_BY_DATE = new Set(['subject', 'page']);
const DEFAULT_HIDDEN = ['label', 'angle', 'depth', 'wallArea', 'rise', 'sequence', 'units', 'slope', 'created', 'lock', 'pageIndex', 'x', 'y', 'xCenter', 'yCenter', 'docWidth', 'docHeight', 'width', 'height'];
const LS = 'cyantakeoff:markups-list';

interface Layout { order: string[]; hidden: string[] }

function loadLayout(): Layout {
  try {
    const l = JSON.parse(localStorage.getItem(LS) ?? 'null') as Layout | null;
    if (l) return l;
  } catch { /* storage unavailable */ }
  return { order: [], hidden: DEFAULT_HIDDEN };
}

/** Saved order, with columns it does not know yet (new or custom) appended. */
const effectiveOrder = (l: Layout, keys: string[]) => [...l.order.filter((k) => keys.includes(k)), ...keys.filter((k) => !l.order.includes(k))];

function saveLayout(l: Layout) {
  try { localStorage.setItem(LS, JSON.stringify(l)); } catch { /* storage unavailable */ }
}

export function MarkupsList() {
  const s = useApp();
  const doc = useActiveDoc();
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: 'page', dir: 1 });
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [custom, setCustom] = useState<Record<string, CustomFilter>>({});
  const [editing, setEditing] = useState<string | null>(null);
  /** The saved filter set applied last (Revu shows it checked, starred once changed). */
  const [engaged, setEngaged] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedFilter[]>(loadSaved);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [showFilters, setShowFilters] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [layout, setLayoutState] = useState(loadLayout);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [height, setHeight] = useState(220);
  const [manage, setManage] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const setLayout = (l: Layout) => { setLayoutState(l); saveLayout(l); };

  const defs = useMemo(() => allColumns(doc), [doc]);
  const kindOf = (key: string): ColumnKind => (defs.find((c) => c.key === key)?.numeric ? 'number' : DATE_COLUMNS.has(key) ? 'date' : 'text');
  const order = effectiveOrder(layout, defs.map((c) => c.key));
  const columns: SummaryColumn[] = order
    .filter((k) => !layout.hidden.includes(k))
    .map((k) => defs.find((c) => c.key === k)!);

  const all = useMemo(() => doc
    ? doc.markups.map((m) => ({ m, v: Object.fromEntries(defs.map((c) => [c.key, c.value(m, doc)])) as Record<string, string | number> }))
    : [], [doc, defs]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const active = Object.entries(filters).filter(([, v]) => v !== '');
    const conds = Object.entries(custom).map(([k, f]) => [k, kindOf(k), f] as const);
    const col = sort.key;
    return all
      .filter((r) => !q || Object.values(r.v).some((x) => String(x).toLowerCase().includes(q)))
      .filter((r) => active.every(([k, v]) => String(r.v[k]) === v))
      .filter((r) => conds.every(([k, kind, f]) => matchesCustom(r.v[k], kind, f)))
      .sort((a, b) => {
        const x = a.v[col], y = b.v[col];
        let d: number;
        if (col === 'page') d = a.m.page - b.m.page;
        else if (typeof x === 'number' || typeof y === 'number') d = (Number(x) || 0) - (Number(y) || 0);
        else d = String(x).localeCompare(String(y));
        if (d === 0 && TIE_BY_DATE.has(col)) return a.m.created.localeCompare(b.m.created);
        return d * sort.dir;
      });
  }, [all, sort, search, filters, custom]); // eslint-disable-line react-hooks/exhaustive-deps

  // The page dims markups the filtered list leaves out (Revu).
  const filtering = search.trim() !== '' || Object.values(filters).some((v) => v !== '') || Object.values(custom).some((f) => f.conds.some((c) => c.value !== ''));
  useEffect(() => {
    useApp.setState({ listVisible: filtering && s.markupsList ? new Set(rows.map((r) => r.m.id)) : null });
  }, [rows, filtering, s.markupsList]);
  useEffect(() => () => useApp.setState({ listVisible: null }), []);

  if (!s.markupsList) return null;
  const sel = new Set(doc?.selection ?? []);

  const startResize = (e: React.PointerEvent) => {
    const y0 = e.clientY, h0 = height;
    const move = (ev: PointerEvent) => setHeight(Math.max(80, Math.min(innerHeight * 0.7, h0 - (ev.clientY - y0))));
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const moveColumn = (from: string, to: string) => {
    if (from === to) return;
    const next = order.filter((k) => k !== from);
    next.splice(next.indexOf(to), 0, from);
    setLayout({ ...layout, order: next });
  };

  /** Select a markup from the list and bring it into view (Revu). */
  const goTo = (m: Markup, add = false) => {
    if (doc && m.page !== doc.page) s.setPage(m.page);
    // A grouped markup is picked on its own here, so it can be edited or removed from its group (Revu).
    s.select([m.id], add, true);
    if (s.prefs.zoomFitOnSelect && m.points.length > 1) { const b = markupBounds(m); setTimeout(() => viewerApi.fitRect({ x: b.minX, y: b.minY }, { x: b.maxX, y: b.maxY }), 60); return; }
    setTimeout(() => viewerApi.centerOn(anchorOf(m)), 60);
  };
  /** Up/Down arrows step through the list. */
  const onListKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    if ((e.target as HTMLElement).closest('input, select, textarea')) return;
    e.preventDefault(); e.stopPropagation();
    const i = rows.findIndex((r) => sel.has(r.m.id));
    const next = rows[Math.max(0, Math.min(rows.length - 1, i < 0 ? 0 : i + (e.key === 'ArrowDown' ? 1 : -1)))];
    if (next) goTo(next.m);
  };

  const distinct = (key: string) => [...new Set(all.map((r) => String(r.v[key])))].filter((x) => x !== '').sort();

  return (
    <div className="markups-list" style={{ height }}>
      {manage && <ManageColumns onClose={() => setManage(false)} />}
      <div className="resize-handle" onPointerDown={startResize} />
      <div className="ml-toolbar">
        <strong>Markups List</strong>
        <div className="ml-columns">
          <button onClick={() => setColumnsOpen(!columnsOpen)} title="Show or hide columns">Columns ▾</button>
          {columnsOpen && (
            <div className="ml-columns-menu" onMouseLeave={() => setColumnsOpen(false)}>
              <button className="ml-manage" onClick={() => { setColumnsOpen(false); setManage(true); }}>Manage Columns…</button>
              {order.map((k) => {
                const c = defs.find((x) => x.key === k)!;
                const on = !layout.hidden.includes(k);
                return (
                  <label key={k}>
                    <input type="checkbox" checked={on} onChange={() => setLayout({
                      ...layout, hidden: on ? [...layout.hidden, k] : layout.hidden.filter((x) => x !== k),
                    })} /> {c.label}
                  </label>
                );
              })}
            </div>
          )}
        </div>
        <button className={showFilters ? 'on' : ''} onClick={() => { setShowFilters(!showFilters); if (showFilters) { setFilters({}); setCustom({}); setEditing(null); } }}
          title="Filter List: filter each column">Filter List</button>
        {showFilters && (
          <select aria-label="Saved Filters" value="" title="Saved Filters" onChange={(e) => {
            const v = e.target.value;
            if (v === 'clear') { setFilters({}); setCustom({}); setSearch(''); setEngaged(null); }
            else if (v === 'save') { const name = prompt('Filter name', 'My filter'); if (name) { const next = [...saved.filter((f) => f.name !== name), { name, filters, search, custom }]; setSaved(next); storeSaved(next); setEngaged(name); } }
            else if (v.startsWith('del:')) { const next = saved.filter((f) => f.name !== v.slice(4)); setSaved(next); storeSaved(next); }
            else if (v.startsWith('use:')) { const f = saved.find((x) => x.name === v.slice(4)); if (f) { setFilters(f.filters); setCustom(f.custom ?? {}); setSearch(f.search); setEngaged(f.name); } }
          }}>
            <option value="">Saved Filters…</option>
            <option value="clear">Clear All</option>
            <option value="save">Save Filter…</option>
            {saved.map((f) => {
              // Revu marks the saved set in use with a check mark, and an asterisk when its filters were changed since.
              const same = JSON.stringify([f.filters, f.search, f.custom ?? {}]) === JSON.stringify([filters, search, custom]);
              const mark = engaged === f.name ? '✓ ' : '';
              return <option key={f.name} value={`use:${f.name}`}>{mark}{f.name}{engaged === f.name && !same ? '*' : ''}</option>;
            })}
            {saved.map((f) => <option key={`d${f.name}`} value={`del:${f.name}`}>Delete "{f.name}"</option>)}
          </select>
        )}
        <button className={s.toggles.hideMarkups ? 'on' : ''} aria-pressed={!!s.toggles.hideMarkups} onClick={() => s.toggle('hideMarkups')}
          title="Hide Markups: take every markup off the drawing and the printout until turned off">Hide Markups</button>
        <input className="ml-filter" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <span className="muted">{rows.length} of {all.length} markup{all.length === 1 ? '' : 's'}</span>
        <span className="spacer" />
        <span className="ml-columns">
          <button disabled={!doc} onClick={() => setExportOpen(!exportOpen)} title="Export the rows and columns shown">
            <Icon name="export" size={14} /> Summary ▾
          </button>
          {exportOpen && (
            <div className="ml-columns-menu right" onMouseLeave={() => setExportOpen(false)}>
              <button onClick={() => { setExportOpen(false); openSummaryDialog(); }}>Summary…</button>
              <button onClick={() => { setExportOpen(false); exportSummaryXlsx(rows.map((r) => r.m), columns); }}>Excel (.xlsx)</button>
              <button onClick={() => { setExportOpen(false); exportSummaryPdf(rows.map((r) => r.m), columns); }}>PDF report</button>
              <button onClick={() => { setExportOpen(false); exportSummaryCsv(rows.map((r) => r.m), columns); }}>CSV</button>
              <div className="menu-sep" />
              <button onClick={() => { setExportOpen(false); importMarkupsXfdf(); }}>Import Markups (XFDF)…</button>
              <button onClick={() => { setExportOpen(false); exportMarkupsXfdf(); }}>Export Markups (XFDF)</button>
              <div className="menu-sep" />
              <button disabled={!doc?.markups.some((m) => m.capture?.length)} onClick={() => { setExportOpen(false); if (doc) captureSummary(doc, rows.map((r) => r.m)); }}>Capture Summary (PDF)</button>
              <button disabled={!doc?.markups.some((m) => m.capture?.length)} onClick={() => { setExportOpen(false); if (doc) exportCaptureMedia(doc, rows.map((r) => r.m)); }}>Export Capture Media (.zip)</button>
            </div>
          )}
        </span>
        <button onClick={() => s.setPanels({ markupsList: false })} title="Close"><Icon name="close" size={12} /></button>
      </div>
      <div className="ml-table-wrap" tabIndex={0} onKeyDown={onListKey}>
        <table className={`ml-table${s.prefs.wrapComments ? ' wrap-comments' : ''}`}>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} className={`${c.numeric ? 'num' : ''} ${dragKey === c.key ? 'dragging' : ''}`}
                  draggable onDragStart={(e) => { setDragKey(c.key); e.dataTransfer.effectAllowed = 'move'; }}
                  onDragOver={(e) => { if (dragKey) e.preventDefault(); }}
                  onDrop={(e) => { e.preventDefault(); e.stopPropagation(); if (dragKey) moveColumn(dragKey, c.key); setDragKey(null); }}
                  onDragEnd={() => setDragKey(null)}
                  onClick={() => setSort((p) => ({ key: c.key, dir: p.key === c.key ? (-p.dir as 1 | -1) : 1 }))}>
                  {c.label}{sort.key === c.key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
                </th>
              ))}
            </tr>
            {showFilters && (
              <tr className="ml-filter-row">
                {columns.map((c) => (
                  <th key={c.key}>
                    {c.key === 'color' ? null : (
                      <select aria-label={`Filter ${c.label}`} value={custom[c.key] ? CUSTOM : filters[c.key] ?? ''} onChange={(e) => {
                        const v = e.target.value;
                        if (v === CUSTOM) {
                          const op = OPS[kindOf(c.key)][0].op;
                          setFilters({ ...filters, [c.key]: '' });
                          setCustom({ ...custom, [c.key]: custom[c.key] ?? { join: 'and', conds: [{ op, value: '' }, { op, value: '' }] } });
                          setEditing(c.key);
                        } else {
                          const { [c.key]: _, ...rest } = custom; void _;
                          setCustom(rest); setEditing(null);
                          setFilters({ ...filters, [c.key]: v });
                        }
                      }}>
                        <option value="">All</option>
                        {distinct(c.key).map((x) => <option key={x} value={x}>{x}</option>)}
                        <option value={CUSTOM}>{custom[c.key] ? describeFilter(custom[c.key], kindOf(c.key)) : 'Custom…'}</option>
                      </select>
                    )}
                    {editing === c.key && custom[c.key] && (
                      <CustomFilterEditor kind={kindOf(c.key)} label={c.label} value={custom[c.key]}
                        onChange={(f) => setCustom({ ...custom, [c.key]: f })}
                        onClose={() => setEditing(null)} />
                    )}
                  </th>
                ))}
              </tr>
            )}
          </thead>
          <tbody>
            {rows.map(({ m, v }, ri) => {
              const group = GROUPED.has(sort.key) ? String(v[sort.key] || '(none)') : null;
              const newGroup = group !== null && (ri === 0 || String(rows[ri - 1].v[sort.key] || '(none)') !== group);
              const hiddenInGroup = group !== null && collapsed.has(group);
              return (
              <Fragment key={m.id}>
              {newGroup && (
                <tr className="ml-section" onClick={() => setCollapsed((c) => { const n = new Set(c); if (n.has(group!)) n.delete(group!); else n.add(group!); return n; })}>
                  <td colSpan={columns.length}><span className="bm-toggle">{collapsed.has(group!) ? '▸' : '▾'}</span> {group} <span className="muted small">({rows.filter((r) => String(r.v[sort.key] || '(none)') === group).length})</span></td>
                </tr>
              )}
              {!hiddenInGroup && <tr className={`${sel.has(m.id) ? 'selected' : ''} ${m.hidden ? 'hidden-markup' : ''}`} title={m.hidden ? 'Hidden (Edit > Show)' : undefined}
                onClick={(e) => goTo(m, e.ctrlKey || e.metaKey)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (!doc) return;
                  if (!sel.has(m.id)) s.select([m.id]);
                  const ids = sel.has(m.id) ? [...sel] : [m.id];
                  const cell = (e.target as HTMLElement).closest('td')?.textContent ?? '';
                  setMenu({ x: e.clientX, y: e.clientY, items: [
                    { label: 'Copy Cell', action: () => { void navigator.clipboard?.writeText(cell); } },
                    { sep: true },
                    ...markupMenuItems(doc, m, ids),
                  ] });
                }}>
                {columns.map((c) => (
                  <td key={c.key} className={c.numeric ? 'num' : ''}>
                    {c.key === 'capture' && m.capture?.length ? <button className="capture-cell" title="Double-click to preview" onDoubleClick={(e) => { e.stopPropagation(); openCapturePreview(m.capture!); }}>📷 {m.capture.length}</button>
                      : c.key === 'color' ? <span className="color-chip" style={{ background: m.style.color }} />
                      : c.key === 'checkmark' ? <input type="checkbox" aria-label="Checkmark" checked={!!m.checked} onClick={(e) => e.stopPropagation()}
                        onChange={(e) => s.updateMarkups([m.id], () => ({ checked: e.target.checked || undefined }))} />
                      : c.key === 'lock' ? <input type="checkbox" aria-label="Lock" checked={!!m.locked} onClick={(e) => e.stopPropagation()}
                        onChange={(e) => s.updateMarkups([m.id], () => ({ locked: e.target.checked || undefined }))} />
                      : c.key === 'status' ? (
                        <StatusSelect m={m} ids={[m.id]} />
                      ) : c.custom && c.custom.type !== 'formula' ? <CustomCell m={m} col={c.custom} />
                        : v[c.key]}
                  </td>
                ))}
              </tr>}
              {!hiddenInGroup && (m.replies ?? []).map((r) => (
                <tr key={r.id} className="reply-row">
                  {columns.map((c, i) => (
                    <td key={c.key}>
                      {i === 0 ? <><span className="reply-mark">↳ Reply</span>
                        <button className="reply-del" title="Delete reply" onClick={() => s.updateMarkups([m.id], (x) => ({ replies: x.replies!.filter((y) => y.id !== r.id) }))}>×</button></>
                        : c.key === 'author' ? r.author : c.key === 'date' || c.key === 'created' ? new Date(r.date).toLocaleString() : c.key === 'comment' ? r.text : ''}
                    </td>
                  ))}
                </tr>
              ))}
              {s.replyTo === m.id && (
                <tr className="reply-row">
                  <td colSpan={columns.length}>
                    <span className="reply-mark">↳ Reply</span>
                    <input autoFocus aria-label="Reply" className="reply-input" placeholder="Type a reply and press Enter"
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        const t = (e.target as HTMLInputElement).value.trim();
                        if (e.key === 'Enter' && t) {
                          s.updateMarkups([m.id], (x) => ({ replies: [...(x.replies ?? []), { id: crypto.randomUUID(), author: s.author, date: new Date().toISOString(), text: t }] }));
                          useApp.setState({ replyTo: null });
                        } else if (e.key === 'Escape') useApp.setState({ replyTo: null });
                      }} onBlur={() => useApp.setState({ replyTo: null })} />
                  </td>
                </tr>
              )}
              </Fragment>
              );
            })}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr>
                {columns.map((c, i) => {
                  const total = c.numeric && !NO_TOTAL.has(c.key) && !c.noTotal ? rows.reduce((t, r) => t + (Number(String(r.v[c.key]).replace(/[^0-9.eE+-]/g, '')) || 0), 0) : 0;
                  return (
                    <td key={c.key} className={c.numeric ? 'num' : ''}>
                      {i === 0 ? 'Total' : total ? Math.round(total * 100) / 100 : ''}
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
    </div>
  );
}

/** Editable cell of a custom column (Text, Number, Checkmark, Choice, Date). */
function CustomCell({ m, col }: { m: Markup; col: CustomColumn }) {
  const s = useApp();
  const value = m.custom?.[col.id];
  const set = (v: string | number | boolean | undefined) => s.updateMarkups([m.id], (x) => {
    const custom = { ...(x.custom ?? {}) };
    if (v === undefined || v === '' || v === false) delete custom[col.id]; else custom[col.id] = v;
    return { custom };
  });
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  switch (col.type) {
    case 'checkmark':
      return <input type="checkbox" aria-label={col.name} checked={!!value} onClick={stop} onChange={(e) => set(e.target.checked)} />;
    case 'choice':
      // Items whose Subject is set are offered to markups with that Subject (Revu); custom text when allowed.
      if (col.allowCustomText) {
        const id = `dl-${col.id}`;
        return (
          <>
            <input className="ml-cell-input" aria-label={col.name} list={id} defaultValue={String(value ?? '')} key={String(value ?? '')} onClick={stop}
              onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
              onBlur={(e) => { if (e.target.value !== String(value ?? '')) set(e.target.value); }} />
            <datalist id={id}>{(col.options ?? []).filter((o) => !col.choiceMeta?.[o]?.subject || col.choiceMeta[o].subject === m.subject).map((o) => <option key={o} value={o} />)}</datalist>
          </>
        );
      }
      return (
        <select aria-label={col.name} value={String(value ?? '')} onClick={stop} onChange={(e) => set(e.target.value)}>
          <option value="" />
          {(col.options ?? []).filter((o) => !col.choiceMeta?.[o]?.subject || col.choiceMeta[o].subject === m.subject || o === value).map((o) => <option key={o}>{o}</option>)}
        </select>
      );
    case 'date':
      return <input type="date" aria-label={col.name} value={String(value ?? '')} onClick={stop} onChange={(e) => set(e.target.value)} />;
    default:
      if (col.type === 'text' && col.multiline) {
        return (
          <textarea className="ml-cell-input" aria-label={col.name} rows={2} defaultValue={String(value ?? '')} key={String(value ?? '')}
            onClick={stop} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) (e.target as HTMLTextAreaElement).blur(); }}
            onBlur={(e) => { if (e.target.value !== String(value ?? '')) set(e.target.value); }} />
        );
      }
      return (
        <input className="ml-cell-input" aria-label={col.name} type={col.type === 'number' ? 'number' : 'text'} min={col.min} max={col.max} defaultValue={String(value ?? '')} key={String(value ?? '')}
          onClick={stop} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          onBlur={(e) => { const t = e.target.value; if (t !== String(value ?? '')) set(col.type === 'number' ? (t === '' ? undefined : clampNumber(col, Number(t))) : t); }} />
      );
  }
}

/** Revu's custom column filter: up to two conditions on one column, joined with AND or OR. */
function CustomFilterEditor({ kind, label, value, onChange, onClose }: { kind: ColumnKind; label: string; value: CustomFilter; onChange: (f: CustomFilter) => void; onClose: () => void }) {
  const ops = OPS[kind];
  const setCond = (i: number, c: Partial<CustomFilter['conds'][number]>) => onChange({ ...value, conds: value.conds.map((x, j) => (j === i ? { ...x, ...c } : x)) });
  return (
    <div className="ml-custom" role="dialog" aria-label={`Custom filter: ${label}`} onClick={(e) => e.stopPropagation()}>
      <div className="form-row"><span>Show rows where {label}</span></div>
      {value.conds.map((c, i) => (
        <div className="form-row" key={i}>
          {i > 0 && (
            <select aria-label="Join" value={value.join} onChange={(e) => onChange({ ...value, join: e.target.value as CustomFilter['join'] })}>
              <option value="and">and</option><option value="or">or</option>
            </select>
          )}
          <select aria-label={`Condition ${i + 1}`} value={c.op} onChange={(e) => setCond(i, { op: e.target.value as CustomFilter['conds'][number]['op'] })}>
            {ops.map((o) => <option key={o.op} value={o.op}>{o.label}</option>)}
          </select>
          <input aria-label={`Value ${i + 1}`} type={kind === 'date' ? 'date' : 'text'} value={c.value} onChange={(e) => setCond(i, { value: e.target.value })}
            onKeyDown={(e) => { if (e.key === 'Enter') onClose(); e.stopPropagation(); }} />
        </div>
      ))}
      <div className="form-actions">
        <button onClick={() => onChange({ ...value, conds: value.conds.map((c) => ({ ...c, value: '' })) })}>Clear</button>
        <button className="primary" onClick={onClose}>OK</button>
      </div>
    </div>
  );
}
