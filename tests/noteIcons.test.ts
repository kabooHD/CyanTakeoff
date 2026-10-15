import { describe, expect, it } from 'vitest';
import { NOTE_ICONS, noteGlyph, noteIconOf } from '../src/model/noteIcons';

describe('note icons', () => {
  it('maps PDF names to icons, falling back to Comment', () => {
    expect(noteIconOf('Star')).toBe('Star');
    expect(noteIconOf('Bogus')).toBe('Comment');
    expect(noteIconOf(undefined)).toBe('Comment');
  });
  it('has a glyph for every icon', () => {
    for (const icon of NOTE_ICONS) {
      const g = noteGlyph(icon);
      expect(g.stroke.length + g.fill.length).toBeGreaterThan(0);
      for (const d of [...g.stroke, ...g.fill]) expect(d).toMatch(/^M/);
    }
    expect(noteGlyph('Star').fill).toHaveLength(1);
  });
});
