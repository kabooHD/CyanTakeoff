import { describe, expect, it } from 'vitest';
import { stampText, templateDefaults } from '../src/model/stamps';

describe('stamp dynamic text and templates', () => {
  const date = new Date(2026, 9, 14, 9, 5, 7);
  it('fills Revu\'s dynamic text tokens', () => {
    const v = { author: 'Sam', date, file: 'Plan A.pdf' };
    expect(stampText('{User} {File} {FileName} {Path}', v)).toBe('Sam Plan A.pdf Plan A Plan A.pdf');
    expect(stampText('{Day}/{Month}/{Year} {Year2} {Month3} {MonthName}', v)).toBe('14/10/2026 26 Oct October');
    expect(stampText('{Hour}:{Minutes}:{Seconds}', v)).toBe('09:05:07');
    expect(stampText('{Author} {Nope}', { author: 'Sam', date })).toBe('Sam {Nope}');
    expect(stampText('{File}', { author: 'Sam', date })).toBe('');
  });
  it('seeds a new stamp from its template', () => {
    expect(templateDefaults('blank', 'X')).toEqual({ title: '', subtitle: '', border: 'none' });
    expect(templateDefaults('dateBorder', 'REVIEWED')).toEqual({ title: 'REVIEWED', subtitle: '{Date}', border: 'rect' });
    expect(templateDefaults('rounded', 'OK').border).toBe('rounded');
  });
});
