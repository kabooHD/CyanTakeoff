import { useMemo, useState } from 'react';
import { useApp, useActiveDoc } from '../model/store';
import type { MarkupStatus } from '../model/types';
import { SUMMARY_COLUMNS, exportSummaryCsv, type SummaryColumn } from './actions';
import { Icon } from './icons';

const STATUSES: MarkupStatus[] = ['None', 'Accepted', 'Rejected', 'Cancelled', 'Completed'];
const NO_TOTAL = new Set(['depth', 'angle', 'slope']);
/** Columns that sort by creation date when values tie (Revu does this for Subject and page). */
const TIE_BY_DATE = new Set(['subject', 'page']);
const DEFAULT_HIDDEN = ['label', 'angle', 'depth', 'units', 'slope'];
const LS = 'cyantakeoff:markups-list';

interface Layout { order: string[]; hidden: string[] }

function loadLayout(): Layout {
  const all = SUMMARY_COLUMNS.map((c) => c.key);
  try {
    const l = JSON.parse(localStorage.getItem(LS) ?? 'null') as Layout | null;
    if (l) return { order: [...l.order.filter((k) => all.includes(k)), ...all.filter((k) => !l.order.includes(k))], hidden: l.hidden };
  } catch { /* storage unavailable */ }
  return { order: all, hidden: DEFAULT_HIDDEN };
}

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
  const setLayout = (l: Layout) => { setLayoutState(l); saveLayout(l); };

  const columns: SummaryColumn[] = layout.order
    .filter((k) => !layout.hidden.includes(k))
    .map((k) => SUMMARY_COLUMNS.find((c) => c.key === k)!);

  const all = useMemo(() => doc
    ? doc.markups.map((m) => ({ m, v: Object.fromEntries(SUMMARY_COLUMNS.map((c) => [c.key, c.value(m, doc)])) as Record<string, string | number> }))
    : [], [doc]);

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
    const order = layout.order.filter((k) => k !== from);
    order.splice(order.indexOf(to), 0, from);
    setLayout({ ...layout, order });
  };

  const distinct = (key: string) => [...new Set(all.map((r) => String(r.v[key])))].filter((x) => x !== '').sort();

  return (
    <div className="markups-list" style={{ height }}>
      <div className="resize-handle" onPointerDown={startResize} />
      <div className="ml-toolbar">
        <strong>Markups List</strong>
        <div className="ml-columns">
          <button onClick={() => setColumnsOpen(!columnsOpen)} title="Show or hide columns">Columns ▾</button>
          {columnsOpen && (
            <div className="ml-columns-menu" onMouseLeave={() => setColumnsOpen(false)}>
              {layout.order.map((k) => {
                const c = SUMMARY_COLUMNS.find((x) => x.key === k)!;
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
        <button disabled={!doc} onClick={() => exportSummaryCsv(rows.map((r) => r.m), columns)} title="Export the rows and columns shown to CSV (opens in Excel)">
          <Icon name="export" size={14} /> Summary
        </button>
        <button onClick={() => s.setPanels({ markupsList: false })} title="Close"><Icon name="close" size={12} /></button>
      </div>
      <div className="ml-table-wrap">
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
              <tr key={m.id} className={sel.has(m.id) ? 'selected' : ''}
                onClick={(e) => {
                  if (doc && m.page !== doc.page) s.setPage(m.page);
                  s.select([m.id], e.ctrlKey || e.metaKey);
                }}>
                {columns.map((c) => (
                  <td key={c.key} className={c.numeric ? 'num' : ''}>
                    {c.key === 'color' ? <span className="color-chip" style={{ background: m.style.color }} />
                      : c.key === 'status' ? (
                        <select value={m.status} onClick={(e) => e.stopPropagation()}
                          onChange={(e) => s.updateMarkups([m.id], () => ({ status: e.target.value as MarkupStatus }))}>
                          {STATUSES.map((x) => <option key={x}>{x}</option>)}
                        </select>
                      ) : v[c.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr>
                {columns.map((c, i) => {
                  const total = c.numeric && !NO_TOTAL.has(c.key) ? rows.reduce((t, r) => t + (Number(r.v[c.key]) || 0), 0) : 0;
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
