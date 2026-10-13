import { activeDoc, useApp } from '../model/store';
import { applyRedactions } from './redact';

/** Document > Apply Redactions (Shift+A), after confirmation. */
export async function runApplyRedactions() {
  const d = activeDoc();
  if (!d) return;
  const n = d.markups.filter((m) => m.type === 'redaction').length;
  if (!n) { useApp.getState().setStatus('No redaction marks. Use Mark for Redaction (Shift+R) or Mark Text for Redaction (Shift+K) first.'); return; }
  if (!confirm(`Apply ${n} redaction mark(s)? The content underneath is removed permanently: affected pages become images, and markups overlapping the marks are deleted.`)) return;
  let pages = 0;
  await useApp.getState().transformDoc(async (lib) => { pages = await applyRedactions(d, lib); }, 'Redactions applied');
  useApp.getState().setStatus(`Redactions applied on ${pages} page(s)`);
}
