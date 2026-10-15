import { describe, expect, it } from 'vitest';
import { matchSetFiles, parseSetFile, setFileFrom } from '../src/model/setFile';
import { DEFAULT_SET_OPTIONS } from '../src/model/revisions';

describe('Set files', () => {
  it('round-trips the files and options', () => {
    const f = setFileFrom('Tower A.ctset.json', ['A-101.pdf', 'A-102.pdf', 'A-101.pdf'], { ...DEFAULT_SET_OPTIONS, previous: 'hide' });
    expect(f.name).toBe('Tower A');
    expect(f.files).toEqual(['A-101.pdf', 'A-102.pdf']);
    const back = parseSetFile(JSON.stringify(f));
    expect(back).toEqual(f);
    expect(back!.options.previous).toBe('hide');
  });
  it('rejects other JSON', () => {
    expect(parseSetFile('{"format":"cyantakeoff-toolset"}')).toBeNull();
    expect(parseSetFile('not json')).toBeNull();
  });
  it('matches picked files by name and lists the missing ones in order', () => {
    const f = setFileFrom('S', ['A-101.pdf', 'A-102.pdf', 'E-1.pdf'], DEFAULT_SET_OPTIONS);
    const r = matchSetFiles(f, [{ name: 'e-1.pdf' }, { name: 'A-101.pdf' }, { name: 'other.pdf' }]);
    expect(r.found.map((x) => x.name)).toEqual(['A-101.pdf', 'e-1.pdf']);
    expect(r.missing).toEqual(['A-102.pdf']);
  });
});
