// Markups List > Capture Summary (a PDF report with every embedded photo)
// and Export Capture Media (a .zip of the photos), as in Revu.
import { zipSync } from 'fflate';
import type { DocState } from '../model/store';
import { useApp } from '../model/store';
import { captureFiles } from '../model/captureExport';
import { buildSummaryPdf } from '../pdf/summary';
import type { Markup } from '../model/types';

function download(blob: Blob, name: string) {
  const href = URL.createObjectURL(blob);
  Object.assign(document.createElement('a'), { href, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

/** The Capture Summary PDF (every embedded photo with its markup), or null without photos. */
export async function captureSummaryPdf(d: DocState, markups: Markup[], title = `${d.name.replace(/\.pdf$/i, '')} - Capture Summary`): Promise<Uint8Array | null> {
  const files = captureFiles(markups);
  if (!files.length) return null;
  return buildSummaryPdf({
    title,
    subtitle: `${files.length} photo${files.length === 1 ? '' : 's'}, ${new Date().toLocaleString()}, CyanTakeoff`,
    header: ['Subject', 'Page', 'Author', 'Photo', 'Comments'],
    rows: [], numeric: [false, false, false, false, false], thumb: 96,
    sections: [{ rows: files.map((f) => [f.markup.subject, d.loaded.pages[f.markup.page]?.label ?? f.markup.page + 1, f.markup.author, f.name, f.markup.comment]), thumbs: files.map((f) => f.bytes) }],
  });
}

export async function captureSummary(d: DocState, markups: Markup[]) {
  const files = captureFiles(markups);
  if (!files.length) { useApp.getState().setStatus('No markup has a Capture photo.'); return; }
  const bytes = await buildSummaryPdf({
    title: `${d.name.replace(/\.pdf$/i, '')} - Capture Summary`,
    subtitle: `${files.length} photo${files.length === 1 ? '' : 's'}, ${new Date().toLocaleString()}, CyanTakeoff`,
    header: ['Subject', 'Page', 'Author', 'Photo', 'Comments'],
    rows: [], numeric: [false, false, false, false, false], thumb: 96,
    sections: [{ rows: files.map((f) => [f.markup.subject, d.loaded.pages[f.markup.page]?.label ?? f.markup.page + 1, f.markup.author, f.name, f.markup.comment]), thumbs: files.map((f) => f.bytes) }],
  });
  download(new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' }), `${d.name.replace(/\.pdf$/i, '')} - Capture Summary.pdf`);
  useApp.getState().setStatus(`Capture Summary: ${files.length} photo${files.length === 1 ? '' : 's'}`);
}

export function exportCaptureMedia(d: DocState, markups: Markup[]) {
  const files = captureFiles(markups);
  if (!files.length) { useApp.getState().setStatus('No markup has a Capture photo.'); return; }
  const zip = zipSync(Object.fromEntries(files.map((f) => [f.name, f.bytes])), { level: 0 });
  download(new Blob([zip as unknown as BlobPart], { type: 'application/zip' }), `${d.name.replace(/\.pdf$/i, '')} - Capture Media.zip`);
  useApp.getState().setStatus(`Export Capture Media: ${files.length} photo${files.length === 1 ? '' : 's'} zipped`);
}
