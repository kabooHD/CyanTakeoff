// Legend commands (Revu right-click on a Legend): Apply to All Pages,
// Copy Legend to Snapshot, and Legend > <title> on other markups (add them
// to an existing Legend).
import { legendKey } from '../model/legend';
import { useApp } from '../model/store';
import type { Markup } from '../model/types';
import { markupsSvg } from './markupRaster';

/** A dynamic copy of the Legend on every other page, in the same position; each counts its own page. */
export function applyLegendToAllPages(m: Markup) {
  const s = useApp.getState(), d = s.docs.find((x) => x.id === s.activeId);
  if (!d || !m.legend) return;
  const t = new Date().toISOString();
  const copies: Markup[] = [];
  for (let p = 0; p < d.loaded.pages.length; p++) {
    if (p === m.page) continue;
    copies.push({ ...m, id: crypto.randomUUID(), page: p, created: t, modified: t, source: undefined, legend: { ...m.legend, source: m.legend.source === 'custom' ? 'custom' : 'page' } });
  }
  if (copies.length) s.addMarkups(copies);
  s.setStatus(`Legend applied to ${copies.length} other page${copies.length === 1 ? '' : 's'}.`);
}

/** The Legend as a static image (a Snapshot) on the clipboard: paste it with Ctrl+V. */
export async function copyLegendToSnapshot(m: Markup) {
  const s = useApp.getState();
  const [a, c] = m.points;
  if (!c) return;
  const x = Math.min(a.x, c.x), y = Math.min(a.y, c.y), w = Math.abs(c.x - a.x), h = Math.abs(c.y - a.y);
  const k = 3;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(w * k); canvas.height = Math.ceil(h * k);
  const url = URL.createObjectURL(new Blob([markupsSvg([m], x, y, w, h, canvas.width, canvas.height)], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
  } finally { URL.revokeObjectURL(url); }
  const t = new Date().toISOString();
  const snap: Markup = {
    id: crypto.randomUUID(), type: 'image', page: m.page, points: [{ x, y }, { x: x + w, y: y + h }],
    style: s.toolDefaults.image, subject: 'Snapshot', label: '', comment: '', author: s.author, created: t, modified: t, status: 'None', image: canvas.toDataURL('image/png'),
  };
  useApp.setState({ clipboard: [snap] });
  s.setStatus('Legend copied as a snapshot. Paste with Ctrl+V (Ctrl+Shift+V pastes in place).');
}

/** Add the kinds of the given markups to an existing Legend. */
export function addToLegend(legendId: string, markups: Markup[]) {
  const s = useApp.getState();
  const keys = [...new Set(markups.filter((m) => m.type !== 'legend').map(legendKey))];
  s.updateMarkups([legendId], (x) => ({ legend: x.legend ? { ...x.legend, keys: [...new Set([...x.legend.keys, ...keys])] } : x.legend }));
}
