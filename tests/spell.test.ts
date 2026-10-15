import { describe, expect, it } from 'vitest';
import { replaceAll, words } from '../src/model/spellText';

describe('spell check words', () => {
  it('finds words, skipping codes, numbers and addresses', () => {
    const t = "Verify door hardware at A-101, see 3rd floor; email bob@example.com or www.site.org. Don't";
    expect(words(t).map((w) => w.word)).toEqual(['Verify', 'door', 'hardware', 'at', 'see', 'floor', 'email', 'or', "Don't"]);
  });
  it('replaces whole words only', () => {
    expect(replaceAll('teh cat, tehre teh', 'teh', 'the')).toBe('the cat, tehre the');
  });
});

describe('dictionary', () => {
  it('flags misspellings and suggests the right word', async () => {
    const { readFileSync } = await import('node:fs');
    const { default: nspell } = await import('nspell');
    const sp = nspell(readFileSync('node_modules/dictionary-en/index.aff', 'utf8'), readFileSync('node_modules/dictionary-en/index.dic', 'utf8'));
    const bad = words('VERIFY the door hardwre before installation').filter((w) => !sp.correct(w.word)).map((w) => w.word);
    expect(bad).toEqual(['hardwre']);
    expect(sp.suggest('hardwre')).toContain('hardware');
  });
});

describe('other languages', () => {
  it('French and German dictionaries are served and spell their words', { timeout: 60000 }, async () => {
    const { readFileSync, existsSync } = await import('node:fs');
    const { default: nspell } = await import('nspell');
    const load = (l: string) => nspell(readFileSync(`node_modules/dictionary-${l}/index.aff`, 'utf8'), readFileSync(`node_modules/dictionary-${l}/index.dic`, 'utf8'));
    const fr = load('fr');
    expect(fr.correct('fenêtre')).toBe(true);
    expect(fr.correct('fenetre')).toBe(false);
    const de = load('de');
    expect(de.correct('Fenster')).toBe(true);
    for (const l of ['en', 'en-gb', 'fr', 'de', 'es', 'it', 'nl', 'pt', 'pl', 'sv', 'da']) {
      expect(existsSync(`node_modules/dictionary-${l}/index.dic`), l).toBe(true);
      expect(existsSync(`node_modules/dictionary-${l}/license`), l).toBe(true);
    }
  });
});
