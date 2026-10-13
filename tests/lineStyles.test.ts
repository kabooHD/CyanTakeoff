import { describe, expect, it } from 'vitest';
import type { PDFDict as PD, PDFStream as PS } from 'pdf-lib';
import { STANDARD_LINE_STYLES, dashArray, isSimpleStyle, offsetPath, styledStroke } from '../src/model/lineStyles';

const byId = (id: string) => STANDARD_LINE_STYLES.find((s) => s.id === id)!;

describe('line styles', () => {
  it('dash patterns scale with the line width', () => {
    expect(dashArray(byId('solid'), 2)).toBeNull();
    expect(dashArray(byId('dashed'), 2)).toEqual([8, 6]);
    expect(dashArray(byId('dash-dot'), 1)).toEqual([6, 2, 0, 2]);
    expect(isSimpleStyle(byId('center'))).toBe(true);
    expect(isSimpleStyle(byId('gas'))).toBe(false);
  });

  it('offsets parallel lines, with mitred corners', () => {
    const sq = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
    const o = offsetPath(sq, false, 1);
    expect(o[0]).toEqual({ x: 0, y: 1 });
    expect(o[1].x).toBeCloseTo(9); expect(o[1].y).toBeCloseTo(1);
    const dbl = styledStroke(sq, false, byId('double'), 1);
    expect(dbl.lines).toHaveLength(2);
  });

  it('places text along the line in gaps, upright', () => {
    const { lines, texts } = styledStroke([{ x: 100, y: 0 }, { x: 0, y: 0 }], false, byId('gas'), 1);
    const [dash, gap] = lines[0].dash!;
    expect(dash).toBe(20);
    expect(gap).toBeGreaterThan(5); // two 1-width spaces and the text
    expect(texts.length).toBe(Math.floor((100 - dash - 1) / (dash + gap)) + 1);
    expect(texts[0].text).toBe('G');
    expect(Math.abs(texts[0].angle)).toBeLessThan(1e-9); // right-to-left line, text still reads left to right
    expect(texts[0].at.x).toBeCloseTo(100 - 20 - gap / 2, 6);
  });
});

describe('line styles and hatches in the saved PDF', () => {
  it('writes a tiling pattern and text along the line, and reads both back', async () => {
    const { PDFDocument, PDFName, PDFArray } = await import('pdf-lib');
    const { savePdf } = await import('../src/pdf/save');
    const { importAnnotations } = await import('../src/pdf/importAnnots');
    const { STANDARD_HATCHES } = await import('../src/model/lineStyles');
    const { streamBytes } = await import('../src/pdf/redactContent');
    const doc = await PDFDocument.create();
    doc.addPage([600, 600]);
    const identity = { convertToPdfPoint: (x: number, y: number) => [x, 600 - y] };
    const pages = [{ index: 0, label: '1', width: 600, height: 600, viewport: identity }] as never;
    const base = { subject: '', label: '', comment: '', author: 'A', created: new Date().toISOString(), modified: new Date().toISOString(), status: 'None', page: 0 };
    const style = { color: '#ff0000', fill: '#0000ff', width: 1, opacity: 1, fillOpacity: 0.5, lineStyle: 'solid', fontSize: 10 };
    const custom = { id: 'c1', name: 'Mine', scale: true, lines: [{ offset: 0, components: [{ kind: 'dash' as const, len: 10 }, { kind: 'text' as const, text: 'Q' }] }] };
    const markups = [
      { ...base, id: 'r', type: 'rectangle', points: [{ x: 100, y: 100 }, { x: 300, y: 200 }], style: { ...style, hatch: STANDARD_HATCHES[0], hatchScale: 2 } },
      { ...base, id: 'g', type: 'line', points: [{ x: 50, y: 400 }, { x: 450, y: 400 }], style: { ...style, fill: null, lineStyle: 'c1', lineDef: custom } },
    ];
    const out = await savePdf({ original: await doc.save(), pages, markups: markups as never, importedRefs: new Set(), calibrations: [null], dirtyCalibrations: new Set() });
    const again = await PDFDocument.load(out);
    const annots = again.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray).asArray().map((r) => again.context.lookup(r) as PD);
    const ap = (a: PD) => (a.lookup(PDFName.of('AP')) as PD).lookup(PDFName.of('N')) as PS;
    const text = (st: PS) => new TextDecoder('latin1').decode(streamBytes(st as never));
    const rect = ap(annots[0]);
    expect(text(rect)).toContain('/Pattern cs /HP0 scn');
    const pat = (rect.dict.lookup(PDFName.of('Resources')) as PD).lookup(PDFName.of('Pattern')) as PD;
    const hp = pat.lookup(PDFName.of('HP0')) as PS;
    expect(hp.dict.get(PDFName.of('XStep'))?.toString()).toBe('16');
    const line = text(ap(annots[1]));
    expect(line.match(/ Tj ET/g)!.length).toBeGreaterThan(10); // many "Q" along 400 pt
    const imp = importAnnotations(again).raws.map((r) => r.markup.style);
    expect(imp[0].hatch?.id).toBe('ansi31');
    expect(imp[0].hatchScale).toBe(2);
    expect(imp[1].lineDef?.name).toBe('Mine');
  });
});
