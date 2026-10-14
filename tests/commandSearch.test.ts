import { describe, expect, it } from 'vitest';
import { matchScore, rankCommands } from '../src/model/commandSearch';

const E = [
  { label: 'Fit Page', path: 'View' },
  { label: 'Fit Width', path: 'View' },
  { label: 'Insert Blank Page', path: 'Document' },
  { label: 'Pages from Document', path: 'Document > Insert' },
  { label: 'Page Setup', path: 'Document' },
];

describe('Find Tools + Commands ranking', () => {
  it('prefers labels that start with the query, then word starts, then substrings', () => {
    expect(matchScore(E[0], 'fit')).toBe(4);
    expect(matchScore(E[2], 'page')).toBe(3);
    expect(matchScore(E[3], 'ages')).toBe(2);
    expect(matchScore(E[3], 'insert pages')).toBe(1); // words found across label and menu path
    expect(matchScore(E[0], 'xyz')).toBe(0);
  });
  it('ranks best first and keeps menu order on ties; an empty query lists everything', () => {
    expect(rankCommands(E, 'page').map((e) => e.label)).toEqual(['Pages from Document', 'Page Setup', 'Fit Page', 'Insert Blank Page']);
    expect(rankCommands(E, '')).toHaveLength(5);
    expect(rankCommands(E, 'Fit…').map((e) => e.label)).toEqual(['Fit Page', 'Fit Width']);
  });
});
