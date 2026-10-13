import type { PDFArray as PA, PDFDict as PD } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { arcSegment, flattenPath, fromPdfPath, pdfPath, svgPath, toggleCurve, type Handles } from '../src/model/curves';
import { measure } from '../src/model/measure';

// A circle of radius 100 from four cubic arcs (standard kappa).
const K = 0.5522847498 * 100;
const P = [{ x: 100, y: 0 }, { x: 0, y: 100 }, { x: -100, y: 0 }, { x: 0, y: -100 }];
const H: Handles = [
  { in: { x: 0, y: -K }, out: { x: 0, y: K } },
  { in: { x: K, y: 0 }, out: { x: -K, y: 0 } },
  { in: { x: 0, y: K }, out: { x: 0, y: -K } },
  { in: { x: -K, y: 0 }, out: { x: K, y: 0 } },
];
const scale = { factor: 1, unit: 'in' as const, label: '1:1' };

describe('curved segments', () => {
  it('measure along the curve: area and perimeter of a Bézier circle', () => {
    const area = measure({ type: 'area', points: P, handles: H, scale } as never)!;
    // The 4-arc Bézier circle is 0.03% larger than a true circle.
    expect(Math.abs(area.area! / (Math.PI * 100 * 100) - 1)).toBeLessThan(5e-4);
    expect(area.length!).toBeCloseTo(2 * Math.PI * 100, 0);
    const straight = measure({ type: 'area', points: P, scale } as never)!;
    expect(straight.area).toBeCloseTo(20000, 6);
    const pl = measure({ type: 'polylength', points: P.slice(0, 2), handles: H.slice(0, 2), scale } as never)!;
    expect(pl.length!).toBeCloseTo((2 * Math.PI * 100) / 4, 0);
  });

  it('flattens only curved segments and draws real curves', () => {
    const h: Handles = [null, { in: { x: 0, y: 0 }, out: { x: 10, y: 0 } }, null];
    const pts = flattenPath([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 10 }], h, false, 8);
    expect(pts).toHaveLength(2 + 8);
    expect(svgPath([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 10 }], h, false)).toBe('M0 0L10 0C20 0 20 10 20 10');
  });

  it('Ctrl+click toggles a control point between straight and smooth curve', () => {
    const tri = [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 0 }];
    const h = toggleCurve(tri, undefined, 1, false);
    expect(h[1]!.out.x).toBeGreaterThan(0);
    expect(h[1]!.in.x).toBeLessThan(0);
    expect(h[1]!.out.y).toBeCloseTo(0); // tangent parallel to the neighbours' chord
    expect(toggleCurve(tri, h, 1, false)[1]).toBeNull();
    const arc = arcSegment(tri, undefined, 0, false);
    expect(arc[0]!.out).toBeTruthy();
    expect(arc[1]!.in).toBeTruthy();
  });

  it('round-trips through a PDF 2.0 /Path', () => {
    const id = (p: { x: number; y: number }): [number, number] => [p.x, p.y];
    const path = pdfPath(P, H, true, id);
    expect(path).toHaveLength(5);
    expect(path[1]).toHaveLength(6);
    const back = fromPdfPath(path, (x, y) => ({ x, y }), true);
    expect(back.points).toHaveLength(4);
    back.points.forEach((p, i) => { expect(p.x).toBeCloseTo(P[i].x); expect(p.y).toBeCloseTo(P[i].y); });
    back.handles!.forEach((h, i) => { expect(h!.in.x).toBeCloseTo(H[i]!.in.x); expect(h!.out.y).toBeCloseTo(H[i]!.out.y); });
  });
});

describe('curved markups in the PDF', () => {
  it('save writes /Path, curved appearance and flattened /Vertices; reopening restores the curves', async () => {
    const { PDFDocument, PDFName, PDFArray } = await import('pdf-lib');
    const { savePdf } = await import('../src/pdf/save');
    const { importAnnotations } = await import('../src/pdf/importAnnots');
    const doc = await PDFDocument.create();
    doc.addPage([600, 600]);
    const bytes = await doc.save();
    const identity = { convertToPdfPoint: (x: number, y: number) => [x, y] };
    const pages = [{ index: 0, label: '1', width: 600, height: 600, viewport: identity }] as never;
    const pts = P.map((p) => ({ x: p.x + 300, y: p.y + 300 }));
    const m = {
      id: 'c1', type: 'area', page: 0, points: pts, handles: H, scale,
      style: { color: '#ff0000', fill: '#ffcc00', width: 1, opacity: 1, fillOpacity: 0.3, lineStyle: 'solid', fontSize: 10 },
      subject: 'Area Measurement', label: '', comment: '', author: 'A', created: new Date().toISOString(), modified: new Date().toISOString(), status: 'None',
    };
    const out = await savePdf({ original: bytes, pages, markups: [m as never], importedRefs: new Set(), calibrations: [null], dirtyCalibrations: new Set() });
    const again = await PDFDocument.load(out);
    const annot = again.context.lookup(again.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray).get(0)) as PD;
    expect((annot.lookup(PDFName.of('Path')) as PA).size()).toBe(5);
    expect((annot.lookup(PDFName.of('Vertices')) as PA).size()).toBeGreaterThan(40);
    const imp = importAnnotations(again);
    const r = imp.raws[0];
    expect(r.pdfPoints).toHaveLength(4);
    expect(r.markup.handles?.[0]?.out.y).toBeCloseTo(K);
    expect(Math.abs(Number(String(r.displayed).replace(/[^0-9.]/g, '')) / (Math.PI * 10000) - 1)).toBeLessThan(0.01);
  });
});
