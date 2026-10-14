import { describe, expect, it } from 'vitest';
import { findUrls } from '../src/model/urls';

describe('Create Hyperlinks from URLs', () => {
  it('finds web addresses, bare www and emails, without trailing punctuation', () => {
    const t = 'See https://example.com/specs. Or www.city.gov/permits, mail bob@acme.co.uk!';
    const u = findUrls(t);
    expect(u.map((x) => x.uri)).toEqual(['https://example.com/specs', 'https://www.city.gov/permits', 'mailto:bob@acme.co.uk']);
    expect(t.slice(u[0].start, u[0].end)).toBe('https://example.com/specs');
    expect(t.slice(u[2].start, u[2].end)).toBe('bob@acme.co.uk');
  });
  it('ignores plain text', () => {
    expect(findUrls('FLOOR PLAN A-101 scale 1/4" = 1\'-0"')).toEqual([]);
  });
});
