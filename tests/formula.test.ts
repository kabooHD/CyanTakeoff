import { describe, expect, it } from 'vitest';
import { checkFormula, evaluate } from '../src/model/formula';

describe('formula columns', () => {
  const v = { Area: 432, Length: 84, Count: 3, Measurement: 432, 'Unit Cost': 2.5, Depth: undefined };
  it('arithmetic with precedence and parentheses', () => {
    expect(evaluate('1 + 2 * 3', {})).toBe(7);
    expect(evaluate('(1 + 2) * 3', {})).toBe(9);
    expect(evaluate('2 ^ 3 ^ 2', {})).toBe(512);
    expect(evaluate('-3 + 5', {})).toBe(2);
  });
  it('column names, case-insensitive, with spaces or brackets', () => {
    expect(evaluate('Area * Unit Cost', v)).toBe(1080);
    expect(evaluate('area * [Unit Cost] * 1.1', v)).toBeCloseTo(1188, 9);
    expect(evaluate('Measurement / 10', v)).toBeCloseTo(43.2, 9);
  });
  it('functions', () => {
    expect(evaluate('round(Area / 7, 2)', v)).toBe(61.71);
    expect(evaluate('max(Count, 5) + min(1, 2)', v)).toBe(6);
  });
  it('errors and blanks give NaN', () => {
    expect(evaluate('Area *', v)).toBeNaN();
    expect(evaluate('Nope + 1', v)).toBeNaN();
    expect(evaluate('Depth + 1', v)).toBeNaN();
    expect(checkFormula('Area * Unit Cost', Object.keys(v))).toBeNull();
    expect(checkFormula('Area * Price', Object.keys(v))).not.toBeNull();
  });
});
