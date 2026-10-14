// Tools > Form: Import Data (FDF, XFDF/XML, CSV), Export Data, Merge Data
// over the open documents, Reset, Highlight Fields, Migrate Typewritten
// Text — as in Revu.
import { useApp, type DocState } from '../model/store';
import { applyValues, currentValues, migrateTypewriter, parseCsv, parseFdf, parseXfdfFields, resetValues, toCsv, toFdf, toXfdfFields } from '../model/formData';
import { pickFile } from './toolActions';

const active = () => { const s = useApp.getState(); return s.docs.find((d) => d.id === s.activeId); };

function download(name: string, data: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  Object.assign(document.createElement('a'), { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
const stem = (d: DocState) => d.name.replace(/\.pdf$/i, '');

export function exportFormData(format: 'fdf' | 'xml' | 'csv') {
  const d = active();
  if (!d) return;
  const values = currentValues(d.loaded.fields, d.formValues);
  if (!Object.keys(values).length) { useApp.getState().setStatus('This document has no form fields to export.'); return; }
  if (format === 'fdf') download(`${stem(d)}.fdf`, toFdf(values, d.name), 'application/vnd.fdf');
  else if (format === 'xml') download(`${stem(d)}.xml`, toXfdfFields(values, d.name), 'application/xml');
  else download(`${stem(d)}.csv`, toCsv([{ file: d.name, values }]), 'text/csv');
  useApp.getState().setStatus(`Exported ${Object.keys(values).length} field value${Object.keys(values).length === 1 ? '' : 's'} (${format.toUpperCase()})`);
}

/** Merge Data: one CSV (or XML per Revu's choice) row per open document. */
export function mergeFormData(format: 'csv' | 'xml') {
  const s = useApp.getState();
  const docs = s.docs.map((d) => ({ file: d.name, values: currentValues(d.loaded.fields, d.formValues) })).filter((d) => Object.keys(d.values).length);
  if (!docs.length) { s.setStatus('No open document has form fields.'); return; }
  if (format === 'csv') download('Merged Form Data.csv', toCsv(docs), 'text/csv');
  else {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<documents>${docs.map((d) => toXfdfFields(d.values, d.file).replace(/^<\?xml[^>]*>\n?/, '')).join('')}</documents>\n`;
    download('Merged Form Data.xml', xml, 'application/xml');
  }
  s.setStatus(`Merged the form data of ${docs.length} document${docs.length === 1 ? '' : 's'}`);
}

export async function importFormData(file?: File) {
  const d = active();
  if (!d) return;
  const f = file ?? await pickFile('.fdf,.xfdf,.xml,.csv');
  if (!f) return;
  const s = useApp.getState();
  try {
    const t = await f.text();
    const raw = /\.fdf$/i.test(f.name) || t.startsWith('%FDF') ? parseFdf(t) : /\.csv$/i.test(f.name) ? parseCsv(t) : parseXfdfFields(t);
    const values = applyValues(d.loaded.fields, raw);
    for (const [name, v] of Object.entries(values)) s.setFieldValue(name, v);
    const n = Object.keys(values).length;
    s.setStatus(n ? `Imported ${n} field value${n === 1 ? '' : 's'} from ${f.name}` : `No matching field names in ${f.name}`);
  } catch (e) { s.setStatus(`Import Data failed: ${(e as Error).message}`); }
}

export function resetForm() {
  const d = active();
  if (!d) return;
  const s = useApp.getState();
  const values = resetValues(d.loaded.fields);
  for (const [name, v] of Object.entries(values)) s.setFieldValue(name, v);
  s.setStatus(Object.keys(values).length ? 'Form reset: every field cleared' : 'This document has no form fields.');
}

export function migrateTypewrittenText() {
  const d = active();
  if (!d) return;
  const s = useApp.getState();
  const toPage = (page: number, x: number, y: number) => { const [px, py] = d.loaded.pages[page].viewport.convertToViewportPoint(x, y); return { x: px, y: py }; };
  const { values, used } = migrateTypewriter(d.loaded.fields, d.markups, toPage);
  if (!used.length) { s.setStatus('Migrate Typewritten Text: no Typewriter markup lies inside a text field.'); return; }
  for (const [name, v] of Object.entries(values)) s.setFieldValue(name, v);
  s.deleteMarkups(used);
  s.setStatus(`Migrate Typewritten Text: ${Object.keys(values).length} field${Object.keys(values).length === 1 ? '' : 's'} filled from ${used.length} markup${used.length === 1 ? '' : 's'}`);
}
