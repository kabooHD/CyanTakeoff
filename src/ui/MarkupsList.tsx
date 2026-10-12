import { useMemo, useState } from 'react';
import { useApp, useActiveDoc } from '../model/store';
import type { MarkupStatus } from '../model/types';
import { SUMMARY_COLUMNS, exportSummaryCsv } from './actions';
import { Icon } from './icons';

const STATUSES: MarkupStatus[] = ['None', 'Accepted', 'Rejected', 'Cancelled', 'Completed'];

export function MarkupsList() {
  const s = useApp();
  const doc = useActiveDoc();
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: 'page', dir: 1 });
  const [filter, setFilter] = useState('');
  const [height, setHeight] = useState(220);

  const rows = useMemo(() => {
    if (!doc) return [];
    const col = SUMMARY_COLUMNS.find((c) => c.key === sort.key)!;
    const q = filter.trim().toLowerCase();
    return doc.markups
      .filter((m) => !q || SUMMARY_COLUMNS.some((c) => String(c.value(m, doc)).toLowerCase().includes(q)))
      .map((m) => ({ m, v: SUMMARY_COLUMNS.map((c) => c.value(m, doc)) }))
      .sort((a, b) => {
        const i = SUMMARY_COLUMNS.indexOf(col);
        const x = a.v[i], y = b.v[i];
        if (sort.key === 'page') return (a.m.page - b.m.page) * sort.dir;
        if (typeof x === 'number' || typeof y === 'number') return ((Number(x) || 0) - (Number(y) || 0)) * sort.dir;
        return String(x).localeCompare(String(y)) * sort.dir;
      });
  }, [doc, sort, filter]);

  if (!s.markupsList) return null;
  const sel = new Set(doc?.selection ?? []);
  const totals = SUMMARY_COLUMNS.map((c, i) => c.numeric && c.key !== 'depth' && c.key !== 'angle'
    ? rows.reduce((t, r) => t + (Number(r.v[i]) || 0), 0)
    : null);

  const startResize = (e: React.PointerEvent) => {
    const y0 = e.clientY, h0 = height;
    const move = (ev: PointerEvent) => setHeight(Math.max(80, Math.min(innerHeight * 0.7, h0 - (ev.clientY - y0))));
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div className="markups-list" style={{ height }}>
      <div className="resize-handle" onPointerDown={startResize} />
      <div className="ml-toolbar">
        <strong>Markups List</strong>
        <input className="ml-filter" placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <span className="muted">{rows.length} markup{rows.length === 1 ? '' : 's'}</span>
        <span className="spacer" />
        <button disabled={!doc} onClick={() => exportSummaryCsv(rows.map((r) => r.m))} title="Export the rows shown to CSV (opens in Excel)">
          <Icon name="export" size={14} /> Summary
        </button>
        <button onClick={() => s.setPanels({ markupsList: false })} title="Close"><Icon name="close" size={12} /></button>
      </div>
      <div className="ml-table-wrap">
        <table className="ml-table">
          <thead>
            <tr>
              {SUMMARY_COLUMNS.map((c) => (
                <th key={c.key} className={c.numeric ? 'num' : ''}
                  onClick={() => setSort((p) => ({ key: c.key, dir: p.key === c.key ? (-p.dir as 1 | -1) : 1 }))}>
                  {c.label}{sort.key === c.key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ m, v }) => (
              <tr key={m.id} className={sel.has(m.id) ? 'selected' : ''}
                onClick={(e) => {
                  if (doc && m.page !== doc.page) s.setPage(m.page);
                  s.select([m.id], e.ctrlKey || e.metaKey);
                }}>
                {SUMMARY_COLUMNS.map((c, i) => (
                  <td key={c.key} className={c.numeric ? 'num' : ''}>
                    {c.key === 'color' ? <span className="color-chip" style={{ background: m.style.color }} />
                      : c.key === 'status' ? (
                        <select value={m.status} onClick={(e) => e.stopPropagation()}
                          onChange={(e) => s.updateMarkups([m.id], () => ({ status: e.target.value as MarkupStatus }))}>
                          {STATUSES.map((x) => <option key={x}>{x}</option>)}
                        </select>
                      ) : v[i]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr>
                {SUMMARY_COLUMNS.map((c, i) => (
                  <td key={c.key} className={c.numeric ? 'num' : ''}>
                    {i === 0 ? 'Total' : totals[i] ? Math.round(totals[i]! * 100) / 100 : ''}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
