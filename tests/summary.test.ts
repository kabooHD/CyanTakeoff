import { describe, expect, it } from 'vitest';
import { csvText, filterRows, groupRows, sortRows, summaryTitle, totalsRow, xmlText, type SummaryCol, type SummaryRow } from '../src/model/summary';

const cols: SummaryCol[] = [{ key: 'subject', label: 'Subject' }, { key: 'page', label: 'Page Label' }, { key: 'area', label: 'Area', numeric: true, unit: 'sf' }, { key: 'depth', label: 'Depth', numeric: true }];
const row = (id: string, subject: string, page: number, area: number | string, extra: Partial<SummaryRow> = {}): SummaryRow => ({ id, page, v: { subject, page: String(page + 1), area, depth: 2 }, replies: [], ...extra });
const rows = [row('a', 'Wall', 1, 10), row('b', 'Floor', 0, '5.5', { replies: [{ author: 'Sam', date: '2026-10-14', text: 'ok, "done"' }] }), row('c', 'Wall', 0, 2.5, { parent: 'a' })];

describe('Markup Summary', () => {
  it('sorts by one key then another, filters, and totals numeric columns', () => {
    expect(sortRows(rows, [{ key: 'subject', dir: 1 }, { key: 'area', dir: -1 }]).map((r) => r.id)).toEqual(['b', 'a', 'c']);
    expect(sortRows(rows, [{ key: 'page', dir: 1 }]).map((r) => r.id)).toEqual(['b', 'c', 'a']);
    expect(filterRows(rows, { subject: 'Wall', page: '' }).map((r) => r.id)).toEqual(['a', 'c']);
    expect(totalsRow(cols, rows)).toEqual(['Total', '', 18, '']); // depth is never totalled
  });
  it('writes CSV with headers, ID columns, units, replies and totals', () => {
    const csv = csvText(cols, rows.slice(0, 2), { include: 'both', headers: true, idColumns: true, units: true, replies: true });
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('ID,Parent,Subject,Page Label,Area,Depth');
    expect(lines[1]).toBe('a,,Wall,2,10 sf,2');
    expect(lines[3]).toBe(',b,Reply: Sam,2026-10-14,"ok, ""done"""');
    expect(lines[4]).toBe(',,Total,,15.5,');
    expect(csvText(cols, rows, { include: 'totals', headers: false, idColumns: false, units: false, replies: false })).toBe('Total,,18,');
  });
  it('writes XML with safe tag names', () => {
    const xml = xmlText(cols, rows.slice(1, 2), { include: 'markups', units: false, replies: true });
    expect(xml).toContain('<Markup id="b">');
    expect(xml).toContain('<Page_Label>1</Page_Label>');
    expect(xml).toContain('<Reply author="Sam" date="2026-10-14">ok, &quot;done&quot;</Reply>');
    expect(xml).not.toContain('<Totals>');
  });
  it('groups rows for page breaks and titles the report', () => {
    expect(groupRows(rows, 'subject').map((g) => [g.value, g.rows.length])).toEqual([['Wall', 2], ['Floor', 1]]);
    expect(groupRows(rows, null)[0].rows).toHaveLength(3);
    expect(summaryTitle('Markups Summary', true, new Date(2026, 9, 14))).toBe('Markups Summary 2026-10-14');
  });
});
