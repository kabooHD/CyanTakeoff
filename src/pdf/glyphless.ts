// A "glyphless" font for invisible text layers (OCR): a Type0 font with
// Identity-H encoding whose characters are UTF-16 code units, all drawn
// with one empty glyph, and a ToUnicode map back to the text. Any script
// (Cyrillic, Greek, Arabic, Chinese...) can then be searched and copied.
// The idea is the one Tesseract uses for its own PDF output; the font file
// here is built from scratch: a minimal TrueType with .notdef and one
// blank glyph, both half an em wide.
import { PDFString, type PDFDocument, type PDFRef } from 'pdf-lib';

/** Advance width of every character (1/1000 em). */
export const GLYPHLESS_WIDTH = 500;

function table(tag: string, data: number[]): { tag: string; data: Uint8Array } {
  return { tag, data: Uint8Array.from(data) };
}
const u16 = (v: number) => [(v >> 8) & 255, v & 255];
const i16 = (v: number) => u16(v < 0 ? v + 0x10000 : v);
const u32 = (v: number) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];

/** The TrueType font program (sfnt) with two empty glyphs. */
export function glyphlessTtf(): Uint8Array {
  const upm = 1000, adv = GLYPHLESS_WIDTH;
  const tables = [
    table('OS/2', [
      ...u16(3), ...i16(adv), ...u16(400), ...u16(5), ...u16(0), // version, xAvgCharWidth, weight, width, fsType
      ...i16(650), ...i16(600), ...i16(0), ...i16(75), ...i16(650), ...i16(600), ...i16(0), ...i16(350), // sub/superscript
      ...i16(50), ...i16(250), ...i16(0), // strikeout, family class
      ...new Array(10).fill(0), // panose
      ...u32(0), ...u32(0), ...u32(0), ...u32(0), // unicode ranges
      ...[0x43, 0x54, 0x4b, 0x46], // vendor "CTKF"
      ...u16(0x40), ...u16(0x20), ...u16(0xfffd), // fsSelection (regular), first/last char
      ...i16(800), ...i16(-200), ...i16(0), ...u16(800), ...u16(200), // typo asc/desc/gap, win asc/desc
      ...u32(1), ...u32(0), // code page ranges
      ...i16(500), ...i16(700), ...u16(0), ...u16(32), ...u16(0), // xHeight, capHeight, default, break, maxContext
    ]),
    table('cmap', [
      ...u16(0), ...u16(1), // version, one subtable
      ...u16(3), ...u16(1), ...u32(12), // Windows Unicode BMP at offset 12
      // format 4, a single segment mapping nothing but the required 0xFFFF end.
      ...u16(4), ...u16(24), ...u16(0), ...u16(2), ...u16(2), ...u16(0), ...u16(0),
      ...u16(0xffff), ...u16(0), ...u16(0xffff), ...i16(1), ...u16(0),
    ]),
    table('glyf', []),
    table('head', [
      ...u32(0x00010000), ...u32(0x00010000), ...u32(0), ...u32(0x5f0f3cf5), // version, revision, checksum adj (fixed later), magic
      ...u16(0x000b), ...u16(upm), ...u32(0), ...u32(0), ...u32(0), ...u32(0), // flags, unitsPerEm, created, modified
      ...i16(0), ...i16(-200), ...i16(adv), ...i16(800), // bbox
      ...u16(0), ...u16(3), ...i16(2), ...i16(0), ...i16(0), // macStyle, lowestRecPPEM, direction, indexToLocFormat (short), glyphDataFormat
    ]),
    table('hhea', [
      ...u32(0x00010000), ...i16(800), ...i16(-200), ...i16(0), ...u16(adv), // ascender, descender, gap, advanceWidthMax
      ...i16(0), ...i16(0), ...i16(adv), ...i16(1), ...i16(0), ...i16(0), // minLSB, minRSB, xMaxExtent, caretRise, caretRun, caretOffset
      ...new Array(8).fill(0), ...i16(0), ...u16(2), // reserved, metricDataFormat, numberOfHMetrics
    ]),
    table('hmtx', [...u16(adv), ...i16(0), ...u16(adv), ...i16(0)]),
    table('loca', [...u16(0), ...u16(0), ...u16(0)]), // short offsets: both glyphs empty
    table('maxp', [...u32(0x00010000), ...u16(2), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u16(2), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u16(0)]),
    table('name', (() => {
      const name = 'CyanTakeoffGlyphless';
      const utf16 = [...name].flatMap((c) => u16(c.charCodeAt(0)));
      const ids = [1, 2, 4, 6];
      const strs = ids.map((id) => (id === 2 ? [...'Regular'].flatMap((c) => u16(c.charCodeAt(0))) : utf16));
      const recs: number[] = [];
      let off = 0;
      ids.forEach((id, k) => { recs.push(...u16(3), ...u16(1), ...u16(0x409), ...u16(id), ...u16(strs[k].length), ...u16(off)); off += strs[k].length; });
      return [...u16(0), ...u16(ids.length), ...u16(6 + recs.length), ...recs, ...strs.flat()];
    })()),
    table('post', [...u32(0x00030000), ...u32(0), ...i16(-100), ...i16(50), ...u32(1), ...u32(0), ...u32(0), ...u32(0), ...u32(0)]),
  ].sort((a, b) => (a.tag < b.tag ? -1 : 1));
  const n = tables.length;
  const pad = (l: number) => (l + 3) & ~3;
  let offset = 12 + 16 * n;
  const dir: number[] = [], body: number[] = [];
  const sum = (d: Uint8Array) => { let s = 0; for (let i = 0; i < d.length; i += 4) s = (s + ((d[i] << 24) | ((d[i + 1] ?? 0) << 16) | ((d[i + 2] ?? 0) << 8) | (d[i + 3] ?? 0))) >>> 0; return s; };
  for (const t of tables) {
    dir.push(...[...t.tag].map((c) => c.charCodeAt(0)), ...u32(sum(t.data)), ...u32(offset), ...u32(t.data.length));
    body.push(...t.data, ...new Array(pad(t.data.length) - t.data.length).fill(0));
    offset += pad(t.data.length);
  }
  let es = 1, sel = 0; while (es * 2 <= n) { es *= 2; sel++; }
  const out = Uint8Array.from([...u32(0x00010000), ...u16(n), ...u16(es * 16), ...u16(sel), ...u16(n * 16 - es * 16), ...dir, ...body]);
  // head.checkSumAdjustment makes the whole file sum to 0xB1B0AFBA.
  const headAt = 12 + 16 * n + tables.slice(0, tables.findIndex((t) => t.tag === 'head')).reduce((t, x) => t + pad(x.data.length), 0);
  const adj = (0xb1b0afba - sum(out)) >>> 0;
  out.set(u32(adj), headAt + 8);
  return out;
}

/** ToUnicode CMap: each 2-byte code is the UTF-16 code unit it shows. */
export function identityToUnicode(): string {
  const ranges: string[] = [];
  for (let hi = 0; hi < 256; hi++) {
    if (hi >= 0xd8 && hi <= 0xdf) continue; // surrogate halves are not characters on their own
    const h = hi.toString(16).padStart(2, '0').toUpperCase();
    ranges.push(`<${h}00> <${h}FF> <${h}00>`);
  }
  const chunks: string[] = [];
  for (let i = 0; i < ranges.length; i += 100) chunks.push(`${Math.min(100, ranges.length - i)} beginbfrange\n${ranges.slice(i, i + 100).join('\n')}\nendbfrange`);
  return `/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def
/CMapName /Adobe-Identity-UCS def
/CMapType 2 def
1 begincodespacerange
<0000> <FFFF>
endcodespacerange
${chunks.join('\n')}
endcmap
CMapName currentdict /CMap defineresource pop
end
end`;
}

const cache = new WeakMap<PDFDocument, PDFRef>();

/** The glyphless Type0 font in `doc` (added once per document). */
export function glyphlessFont(doc: PDFDocument): PDFRef {
  const have = cache.get(doc);
  if (have) return have;
  const ctx = doc.context;
  const file = ctx.register(ctx.flateStream(glyphlessTtf()));
  // Every CID shows glyph 1 (blank).
  const map = new Uint8Array(65536 * 2);
  for (let i = 1; i < map.length; i += 2) map[i] = 1;
  const cidToGid = ctx.register(ctx.flateStream(map));
  const descriptor = ctx.register(ctx.obj({
    Type: 'FontDescriptor', FontName: 'CyanTakeoffGlyphless', Flags: 4, FontBBox: [0, -200, GLYPHLESS_WIDTH, 800],
    ItalicAngle: 0, Ascent: 800, Descent: -200, CapHeight: 700, StemV: 80, FontFile2: file,
  }));
  const cid = ctx.register(ctx.obj({
    Type: 'Font', Subtype: 'CIDFontType2', BaseFont: 'CyanTakeoffGlyphless',
    CIDSystemInfo: { Registry: PDFString.of('Adobe'), Ordering: PDFString.of('Identity'), Supplement: 0 },
    FontDescriptor: descriptor, DW: GLYPHLESS_WIDTH, CIDToGIDMap: cidToGid,
  }));
  const toUni = ctx.register(ctx.flateStream(identityToUnicode()));
  const ref = ctx.register(ctx.obj({ Type: 'Font', Subtype: 'Type0', BaseFont: 'CyanTakeoffGlyphless', Encoding: 'Identity-H', DescendantFonts: [cid], ToUnicode: toUni }));
  cache.set(doc, ref);
  return ref;
}

/** Hex string of `text` as UTF-16BE codes for the glyphless font. */
export function glyphlessHex(text: string): string {
  let s = '';
  for (let i = 0; i < text.length; i++) s += text.charCodeAt(i).toString(16).padStart(4, '0');
  return `<${s}>`;
}

