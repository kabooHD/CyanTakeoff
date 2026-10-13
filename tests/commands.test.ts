import { describe, expect, it } from 'vitest';
import { effectiveCombo, resolveCombo, usersOf } from '../src/ui/commands';

describe('custom keyboard shortcuts', () => {
  it('defaults pass through', () => {
    expect(resolveCombo('Ctrl+S', {})).toBe('Ctrl+S');
    expect(effectiveCombo('tool:length', {})).toBe('Shift+Alt+L');
  });
  it('a reassigned command runs from its new keys and no longer from the old', () => {
    const custom = { 'tool:length': 'Ctrl+L', 'Ctrl+S': 'F12' };
    expect(resolveCombo('Ctrl+L', custom)).toBe('tool:length');
    expect(resolveCombo('Shift+Alt+L', custom)).toBe('');
    expect(resolveCombo('F12', custom)).toBe('Ctrl+S');
    expect(resolveCombo('Ctrl+S', custom)).toBe('');
  });
  it('lists who uses a combo', () => {
    expect(usersOf('Ctrl+L', { 'tool:length': 'Ctrl+L' }).map((x) => x.label)).toEqual(['Length']);
  });
});
