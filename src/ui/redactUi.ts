import { activeDoc, useApp } from '../model/store';
import { applyRedactions, type RedactResult } from './redact';

/** Document > Apply Redactions (Shift+A), after confirmation. */
export async function runApplyRedactions() {
  const d = activeDoc();
  if (!d) return;
  const n = d.markups.filter((m) => m.type === 'redaction').length;
  if (!n) { useApp.getState().setStatus('No redaction marks. Use Mark for Redaction (Shift+R) or Mark Text for Redaction (Shift+K) first.'); return; }
  if (!confirm(`Apply ${n} redaction mark(s)? The text, linework and image pixels underneath are removed permanently, and markups overlapping the marks are deleted. The rest of the page is unchanged.`)) return;
  let r: RedactResult = { pages: 0, glyphs: 0, images: 0, rasterised: 0 };
  const ok = await useApp.getState().transformDoc(async (lib) => { r = await applyRedactions(d, lib); }, 'Redactions applied');
  if (ok) {
    useApp.getState().setStatus(`Redactions applied on ${r.pages} page(s): ${r.glyphs} character(s) and ${r.images} image(s) redacted`
      + (r.rasterised ? `; ${r.rasterised} page(s) could not be edited and were replaced by an image` : ''));
  }
}
