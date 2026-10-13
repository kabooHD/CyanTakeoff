// Apply Redactions (Revu Shift+A): pages with redaction marks are replaced
// by an image of their content with the marked areas blacked out, so no
// text or vector content survives underneath. Annotations overlapping a
// redacted area are removed; the redaction marks themselves go away.
import { PDFArray, PDFDict, PDFName, PDFNumber, PDFRef, type PDFDocument } from 'pdf-lib';
import { rectPairs, bounds } from '../model/measure';
import type { DocState } from '../model/store';

const N = (s: string) => PDFName.of(s);

export async function applyRedactions(d: DocState, lib: PDFDocument): Promise<number> {
  const byPage = new Map<number, [number, number, number, number][]>();
  for (const m of d.markups.filter((x) => x.type === 'redaction')) {
    const vp = d.loaded.pages[m.page].viewport;
    for (const [a, b] of rectPairs(m.points)) {
      const [ax, ay] = vp.convertToPdfPoint(a.x, a.y), [bx, by] = vp.convertToPdfPoint(b.x, b.y);
      const list = byPage.get(m.page) ?? [];
      list.push([Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)]);
      byPage.set(m.page, list);
    }
  }
  for (const [pageIdx, rects] of byPage) {
    const page = await d.loaded.pdf.getPage(pageIdx + 1);
    // Unrotated rendering, so the image lines up with PDF space; /Rotate stays as it was.
    const base = page.getViewport({ scale: 1, rotation: 0 });
    const k = Math.min(200 / 72, Math.sqrt(24e6 / (base.width * base.height)));
    const vp = page.getViewport({ scale: k, rotation: 0 });
    const canvas = Object.assign(document.createElement('canvas'), { width: Math.ceil(vp.width), height: Math.ceil(vp.height) });
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, viewport: vp, annotationMode: 0 }).promise;
    ctx.fillStyle = '#000';
    for (const r of rects) {
      const [x0, y0] = vp.convertToViewportPoint(r[0], r[1]), [x1, y1] = vp.convertToViewportPoint(r[2], r[3]);
      ctx.fillRect(Math.min(x0, x1) - 1, Math.min(y0, y1) - 1, Math.abs(x1 - x0) + 2, Math.abs(y1 - y0) + 2);
    }
    const jpg = await new Promise<Blob>((res) => canvas.toBlob((b) => res(b!), 'image/jpeg', 0.92));
    const img = await lib.embedJpg(new Uint8Array(await jpg.arrayBuffer()));
    const p = lib.getPage(pageIdx);
    const [vx0, vy0, vx1, vy1] = (page.view as number[]);
    // Replace the page content with the image; nothing of the old content stream remains.
    const imgName = 'RedactedPage';
    p.node.set(N('Resources'), lib.context.obj({ XObject: { [imgName]: img.ref } }));
    p.node.set(N('Contents'), lib.context.register(lib.context.flateStream(`q ${vx1 - vx0} 0 0 ${vy1 - vy0} ${vx0} ${vy0} cm /${imgName} Do Q`)));
    // Drop redaction marks and any annotation overlapping a redacted area.
    const annots = p.node.lookup(N('Annots'));
    if (annots instanceof PDFArray) {
      const keep = annots.asArray().filter((ref) => {
        const a = lib.context.lookup(ref);
        if (!(a instanceof PDFDict)) return true;
        if (String(a.get(N('Subtype'))) === '/Redact') return false;
        const rr = a.lookup(N('Rect'));
        if (!(rr instanceof PDFArray)) return true;
        const [x0, y0, x1, y1] = rr.asArray().map((v) => (v instanceof PDFRef ? lib.context.lookup(v) : v) as PDFNumber).map((n) => n.asNumber());
        const b = bounds([{ x: x0, y: y0 }, { x: x1, y: y1 }]);
        return !rects.some((r) => b.minX < r[2] && b.maxX > r[0] && b.minY < r[3] && b.maxY > r[1]);
      });
      p.node.set(N('Annots'), lib.context.obj(keep));
    }
  }
  return byPage.size;
}
