import { describe, expect, it } from 'vitest';
import { DEFAULT_SEQUENCE, formatSequence, letters, nextInSequence } from '../src/model/sequence';

describe('sequences', () => {
  it('formats numbers and letters', () => {
    expect(formatSequence({ ...DEFAULT_SEQUENCE, digits: 3, prefix: 'D-' }, 7)).toBe('D-007');
    expect([1, 26, 27, 52, 703].map(letters)).toEqual(['A', 'Z', 'AA', 'AZ', 'AAA']);
    expect(formatSequence({ ...DEFAULT_SEQUENCE, format: 'lower', suffix: ')' }, 3)).toBe('c)');
  });
  it('continues the current run; Reset starts again', () => {
    const def = { ...DEFAULT_SEQUENCE, start: 10, step: 5 };
    const m = (n: number, run = 1) => ({ seq: { id: 't', run, n } }) as never;
    expect(nextInSequence([], 't', def)).toBe(10);
    expect(nextInSequence([m(10), m(15)], 't', def)).toBe(20);
    expect(nextInSequence([m(10), m(15)], 't', { ...def, run: 2 })).toBe(10);
  });
});
