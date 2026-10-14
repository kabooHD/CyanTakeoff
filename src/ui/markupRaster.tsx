// Draw markups onto a canvas (Snapshot, Copy Page to Snapshot): the markup
// SVG is rendered off-screen and drawn as an image. Text boxes use HTML in
// <foreignObject>, which would taint the canvas, so their text is turned
// into SVG <text> lines first.
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { Markup } from '../model/types';
import { MarkupShape } from './renderMarkup';
import { textWidth } from './quickCommands';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Lines of `text` wrapped to `width` points at `size`. */
function wrap(text: string, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/(\s+)/)) {
      if (line && textWidth((line + word).trimEnd(), size) > width) { out.push(line.trimEnd()); line = word.trimStart(); }
      else line += word;
    }
    out.push(line);
  }
  return out;
}

/** SVG markup (a string) of the markups, page space, viewBox x y w h. */
export function markupsSvg(markups: Markup[], x: number, y: number, w: number, h: number, px: number, py: number): string {
  const host = document.createElement('div');
  const root = createRoot(host);
  flushSync(() => root.render(
    <svg xmlns="http://www.w3.org/2000/svg" width={px} height={py} viewBox={`${x} ${y} ${w} ${h}`}>
      {markups.map((m) => <MarkupShape key={m.id} m={m} />)}
    </svg>,
  ));
  const svg = host.querySelector('svg')!;
  for (const fo of [...svg.querySelectorAll('foreignObject')]) {
    const div = fo.querySelector('div') as HTMLElement | null;
    const fx = Number(fo.getAttribute('x')), fy = Number(fo.getAttribute('y')), fw = Number(fo.getAttribute('width'));
    const size = parseFloat(div?.style.fontSize || '10');
    const color = div?.style.color || '#000';
    const lines = wrap(div?.textContent ?? '', size, fw - 6);
    const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    t.setAttribute('font-family', 'Helvetica, Arial, sans-serif');
    t.setAttribute('font-size', String(size));
    t.setAttribute('fill', color);
    t.innerHTML = lines.map((l, i) => `<tspan x="${fx + 3}" y="${fy + 2 + size * (0.92 + i * 1.15)}">${esc(l)}</tspan>`).join('');
    fo.replaceWith(t);
  }
  const out = new XMLSerializer().serializeToString(svg);
  root.unmount();
  return out;
}

/** Draw the markups over a canvas that shows page region (x, y, w, h). */
export async function drawMarkups(canvas: HTMLCanvasElement, markups: Markup[], x: number, y: number, w: number, h: number) {
  if (!markups.length) return;
  const url = URL.createObjectURL(new Blob([markupsSvg(markups, x, y, w, h, canvas.width, canvas.height)], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
  } finally { URL.revokeObjectURL(url); }
}
