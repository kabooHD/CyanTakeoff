import { describe, expect, it } from 'vitest';
import { cellDay, cellNumber, describeFilter, matchesCustom } from '../src/model/listFilter';

describe('Markups List custom filters', () => {
  it('reads numbers out of cells', () => {
    expect(cellNumber('$1,258.30')).toBe(1258.3);
    expect(cellNumber('419.43 sf')).toBe(419.43);
    expect(cellNumber(7)).toBe(7);
    expect(cellNumber('none')).toBeNull();
  });
  it('compares numbers with AND / OR', () => {
    const f = { join: 'and' as const, conds: [{ op: 'gt' as const, value: '100' }, { op: 'lt' as const, value: '500' }] };
    expect(matchesCustom('419.43 sf', 'number', f)).toBe(true);
    expect(matchesCustom('600 sf', 'number', f)).toBe(false);
    expect(matchesCustom('600 sf', 'number', { ...f, join: 'or' })).toBe(true);
    expect(matchesCustom('n/a', 'number', { join: 'and', conds: [{ op: 'ne', value: '1' }] })).toBe(true);
    expect(matchesCustom('5', 'number', { join: 'and', conds: [{ op: 'eq', value: '' }] })).toBe(true); // an empty condition is ignored
  });
  it('compares dates by day and text by containing or matching', () => {
    expect(cellDay('2026-10-14T10:00:00Z')).toBe(cellDay('2026-10-14T23:00:00'));
    expect(matchesCustom('2026-10-14T10:00:00Z', 'date', { join: 'and', conds: [{ op: 'after', value: '2026-10-01' }] })).toBe(true);
    expect(matchesCustom('2026-10-14T10:00:00Z', 'date', { join: 'and', conds: [{ op: 'before', value: '2026-10-01' }] })).toBe(false);
    expect(matchesCustom('2026-10-14T10:00:00Z', 'date', { join: 'and', conds: [{ op: 'eq', value: '2026-10-14' }] })).toBe(true);
    expect(matchesCustom('Area Measurement', 'text', { join: 'and', conds: [{ op: 'contains', value: 'area' }] })).toBe(true);
    expect(matchesCustom('Area Measurement', 'text', { join: 'and', conds: [{ op: 'ne', value: 'area measurement' }] })).toBe(false);
  });
  it('describes a filter in one line', () => {
    expect(describeFilter({ join: 'and', conds: [{ op: 'gt', value: '100' }, { op: 'lt', value: '500' }] }, 'number')).toBe('> 100 and < 500');
    expect(describeFilter({ join: 'or', conds: [] }, 'text')).toBe('Custom…');
  });
});
