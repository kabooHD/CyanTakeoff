import { describe, expect, it } from 'vitest';
import { findUrls, urlAt, urlRects } from '../src/model/urls';

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

describe('Find Hyperlinks in PDF Content', () => {
  const boxes = [
    { x0: 100, y0: 700, x1: 400, y1: 712, str: 'Visit www.example.com today' }, // 27 chars over 300 pt
    { x0: 100, y0: 720, x1: 200, y1: 732, str: 'No address here' },
  ];
  it('places each address over its share of the text run', () => {
    const r = urlRects(boxes);
    expect(r).toHaveLength(1);
    expect(r[0].uri).toBe('https://www.example.com');
    // "Visit " is 6 of 27 characters; the address ends after 21.
    expect(r[0].x0).toBeCloseTo(100 + (300 * 6) / 27, 5);
    expect(r[0].x1).toBeCloseTo(100 + (300 * 21) / 27, 5);
    expect(r[0].y0).toBe(700);
  });
  it('finds the address under a point and nothing beside it', () => {
    const r = urlRects(boxes);
    expect(urlAt(r, { x: 250, y: 706 })?.uri).toBe('https://www.example.com');
    expect(urlAt(r, { x: 110, y: 706 })).toBeNull(); // on "Visit"
    expect(urlAt(r, { x: 250, y: 726 })).toBeNull(); // the other run
    expect(urlAt(r, { x: 250, y: 714 }, 3)?.uri).toBe('https://www.example.com'); // within the tolerance
  });
});
