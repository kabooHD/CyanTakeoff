// Unlinked flags (Flags panel) are ours: kept as JSON in the catalog under
// /CTFlags, like custom columns. Linked flags are the Flag annotations.
import { PDFDocument, PDFHexString, PDFName, PDFString } from 'pdf-lib';
import type { UnlinkedFlag } from '../model/flags';

export const FLAGS_KEY = 'CTFlags';

export function readFlags(doc: PDFDocument): UnlinkedFlag[] {
  try {
    const o = doc.catalog.lookup(PDFName.of(FLAGS_KEY));
    const t = o instanceof PDFString || o instanceof PDFHexString ? o.decodeText() : '';
    const v = t ? JSON.parse(t) : [];
    return Array.isArray(v) ? v.filter((f) => f && typeof f.id === 'string' && typeof f.page === 'number' && f.action) : [];
  } catch { return []; }
}

export function writeFlags(doc: PDFDocument, flags: UnlinkedFlag[]) {
  if (flags.length) doc.catalog.set(PDFName.of(FLAGS_KEY), PDFHexString.fromText(JSON.stringify(flags)));
  else doc.catalog.delete(PDFName.of(FLAGS_KEY));
}
