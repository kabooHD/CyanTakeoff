import { Fragment, useMemo, useState } from 'react';
import { viewerApi } from './Viewer';
import { anchorOf } from '../model/spaces';
import { useApp, useActiveDoc } from '../model/store';
import type { CustomColumn, Markup, MarkupStatus } from '../model/types';
import { allColumns, exportSummaryCsv, exportSummaryPdf, exportSummaryXlsx, type SummaryColumn } from './actions';
import { ManageColumns } from './ManageColumns';
import { Icon } from './icons';

const STATUSES: MarkupStatus[] = ['None', 'Accepted', 'Rejected', 'Cancelled', 'Completed'];
const NO_TOTAL = new Set(['depth', 'angle', 'slope']);
/** Columns that sort by creation date when values tie (Revu does this for Subject and page). */
const TIE_BY_DATE = new Set(['subject', 'page']);
const DEFAULT_HIDDEN = ['label', 'angle', 'depth', 'units', 'slope', 'created', 'lock', 'pageIndex'];
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
  const [showFilters, setShowFilters] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [layout, setLayoutState] = useState(loadLayout);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [height, setHeight] = useState(220);
  const [manage, setManage] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const setLayout = (l: Layout) => { setLayoutState(l); saveLayout(l); };

  const defs = useMemo(() => allColumns(doc), [doc]);
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
    const col = sort.key;
    return all
      .filter((r) => !q || Object.values(r.v).some((x) => String(x).toLowerCase().includes(q)))
      .filter((r) => active.every(([k, v]) => String(r.v[k]) === v))
      .sort((a, b) => {
        const x = a.v[col], y = b.v[col];
        let d: number;
        if (col === 'page') d = a.m.page - b.m.page;
        else if (typeof x === 'number' || typeof y === 'number') d = (Number(x) || 0) - (Number(y) || 0);
        else d = String(x).localeCompare(String(y));
        if (d === 0 && TIE_BY_DATE.has(col)) return a.m.created.localeCompare(b.m.created);
        return d * sort.dir;
      });
  }, [all, sort, search, filters]);

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
        <button className={showFilters ? 'on' : ''} onClick={() => { setShowFilters(!showFilters); if (showFilters) setFilters({}); }}
          title="Filter List: filter each column">Filter List</button>
        <input className="ml-filter" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <span className="muted">{rows.length} of {all.length} markup{all.length === 1 ? '' : 's'}</span>
        <span className="spacer" />
        <span className="ml-columns">
          <button disabled={!doc} onClick={() => setExportOpen(!exportOpen)} title="Export the rows and columns shown">
            <Icon name="export" size={14} /> Summary ▾
          </button>
          {exportOpen && (
            <div className="ml-columns-menu right" onMouseLeave={() => setExportOpen(false)}>
              <button onClick={() => { setExportOpen(false); exportSummaryXlsx(rows.map((r) => r.m), columns); }}>Excel (.xlsx)</button>
              <button onClick={() => { setExportOpen(false); exportSummaryPdf(rows.map((r) => r.m), columns); }}>PDF report</button>
              <button onClick={() => { setExportOpen(false); exportSummaryCsv(rows.map((r) => r.m), columns); }}>CSV</button>
            </div>
          )}
        </span>
        <button onClick={() => s.setPanels({ markupsList: false })} title="Close"><Icon name="close" size={12} /></button>
      </div>
      <div className="ml-table-wrap" tabIndex={0} onKeyDown={onListKey}>
        <table className="ml-table">
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
                      <select value={filters[c.key] ?? ''} onChange={(e) => setFilters({ ...filters, [c.key]: e.target.value })}>
                        <option value="">All</option>
                        {distinct(c.key).map((x) => <option key={x} value={x}>{x}</option>)}
                      </select>
                    )}
                  </th>
                ))}
              </tr>
            )}
          </thead>
          <tbody>
            {rows.map(({ m, v }) => (
              <Fragment key={m.id}>
              <tr className={sel.has(m.id) ? 'selected' : ''}
                onClick={(e) => goTo(m, e.ctrlKey || e.metaKey)}>
                {columns.map((c) => (
                  <td key={c.key} className={c.numeric ? 'num' : ''}>
                    {c.key === 'color' ? <span className="color-chip" style={{ background: m.style.color }} />
                      : c.key === 'checkmark' ? <input type="checkbox" aria-label="Checkmark" checked={!!m.checked} onClick={(e) => e.stopPropagation()}
                        onChange={(e) => s.updateMarkups([m.id], () => ({ checked: e.target.checked || undefined }))} />
                      : c.key === 'lock' ? <input type="checkbox" aria-label="Lock" checked={!!m.locked} onClick={(e) => e.stopPropagation()}
                        onChange={(e) => s.updateMarkups([m.id], () => ({ locked: e.target.checked || undefined }))} />
                      : c.key === 'status' ? (
                        <select value={m.status} onClick={(e) => e.stopPropagation()}
                          onChange={(e) => s.updateMarkups([m.id], () => ({ status: e.target.value as MarkupStatus }))}>
                          {STATUSES.map((x) => <option key={x}>{x}</option>)}
                        </select>
                      ) : c.custom && c.custom.type !== 'formula' ? <CustomCell m={m} col={c.custom} />
                        : v[c.key]}
                  </td>
                ))}
              </tr>
              {(m.replies ?? []).map((r) => (
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
            ))}
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
      return (
        <select aria-label={col.name} value={String(value ?? '')} onClick={stop} onChange={(e) => set(e.target.value)}>
          <option value="" />
          {(col.options ?? []).map((o) => <option key={o}>{o}</option>)}
        </select>
      );
    case 'date':
      return <input type="date" aria-label={col.name} value={String(value ?? '')} onClick={stop} onChange={(e) => set(e.target.value)} />;
    default:
      return (
        <input className="ml-cell-input" aria-label={col.name} type={col.type === 'number' ? 'number' : 'text'} defaultValue={String(value ?? '')} key={String(value ?? '')}
          onClick={stop} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          onBlur={(e) => { const t = e.target.value; if (t !== String(value ?? '')) set(col.type === 'number' ? (t === '' ? undefined : Number(t)) : t); }} />
      );
  }
}
