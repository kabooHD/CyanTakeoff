import { describe, expect, it } from 'vitest';
import { overBudget, renderLimits, undoBudget } from '../src/model/device';

describe('low-end machine limits', () => {
  it('scales the undo budget and canvas sizes with memory', () => {
    expect(undoBudget(2)).toBe(96 * 2 ** 20);
    expect(undoBudget(4)).toBe(192 * 2 ** 20);
    expect(undoBudget(8)).toBe(384 * 2 ** 20);
    expect(renderLimits(4).base).toBeLessThan(renderLimits(8).base);
    expect(renderLimits(2).tile).toBeLessThan(renderLimits(4).tile);
  });
  it('drops the oldest file copies beyond the count or the budget, never the newest', () => {
    const MB = 2 ** 20;
    expect(overBudget([10, 10, 10].map((x) => x * MB), 100 * MB)).toBe(0);
    expect(overBudget([50, 50, 50].map((x) => x * MB), 100 * MB)).toBe(1);
    expect(overBudget([300].map((x) => x * MB), 100 * MB)).toBe(0);
    expect(overBudget(Array(12).fill(MB), 100 * MB)).toBe(2);
  });
});
