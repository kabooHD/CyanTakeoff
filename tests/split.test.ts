import { describe, expect, it } from 'vitest';
import { parseRanges, partFileName, splitParts } from '../src/model/split';

const o = { mode: 'count' as const, every: 2, ranges: '', maxMb: 1 };

describe('Split Document', () => {
  it('splits by page count', () => {
    expect(splitParts(5, o).map((p) => p.pages)).toEqual([[0, 1], [2, 3], [4]]);
    expect(splitParts(5, o).map((p) => p.name)).toEqual(['part 1', 'part 2', 'part 3']);
  });
  it('splits by page ranges, leaving unlisted pages out', () => {
    expect(parseRanges('1-2, 4, 9-12', 6)).toEqual([[0, 1], [3]]);
    expect(splitParts(6, { ...o, mode: 'ranges', ranges: '1-2,4' }).map((p) => p.name)).toEqual(['pages 1-2', 'pages 4']);
  });
  it('splits at top-level bookmarks, pages before the first on their own', () => {
    const parts = splitParts(7, { ...o, mode: 'bookmarks' }, [{ title: 'Plans', page: 2 }, { title: 'Details', page: 5 }, { title: 'Web', page: null }]);
    expect(parts.map((p) => [p.name, p.pages])).toEqual([['part 1', [0, 1]], ['Plans', [2, 3, 4]], ['Details', [5, 6]]]);
    expect(splitParts(3, { ...o, mode: 'bookmarks' }, []).map((p) => p.pages)).toEqual([[0, 1, 2]]);
  });
  it('estimates pages per file from the file size', () => {
    // 10 pages, 5 MB: 0.5 MB a page, so 2 pages fit in 1 MB.
    expect(splitParts(10, { ...o, mode: 'size', maxMb: 1 }, [], 5 * 1024 * 1024).map((p) => p.pages.length)).toEqual([2, 2, 2, 2, 2]);
    expect(splitParts(3, { ...o, mode: 'size', maxMb: 1 }, [], 9 * 1024 * 1024).length).toBe(3); // a page over the limit still gets its own file
  });
  it('names the files after the part', () => {
    expect(partFileName('A-101', { pages: [0], name: 'Plans / Level 1' })).toBe('A-101 - Plans Level 1.pdf');
  });
});
