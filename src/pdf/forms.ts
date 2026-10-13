// PDF forms (AcroForm): read fields with their widgets, write values back.
import {
  PDFCheckBox, PDFDropdown, PDFOptionList, PDFRadioGroup, PDFSignature, PDFTextField, type PDFDocument, type PDFFont,
} from 'pdf-lib';

export type FieldValue = string | boolean;

export interface FormField {
  name: string;
  type: 'text' | 'checkbox' | 'radio' | 'dropdown' | 'list' | 'signature' | 'button';
  value: FieldValue;
  options?: string[];
  multiline?: boolean;
  readOnly?: boolean;
  /** Widget rectangles in PDF space; radio widgets carry their option. */
  widgets: { page: number; rect: [number, number, number, number]; option?: string }[];
}

export function readFields(doc: PDFDocument): FormField[] {
  let fields;
  try { fields = doc.getForm().getFields(); } catch { return []; }
  const pageOf = new Map(doc.getPages().map((p, i) => [p.ref.toString(), i]));
  // Widgets without /P: find their page through the page /Annots arrays.
  const annotPage = new Map<string, number>();
  doc.getPages().forEach((p, i) => {
    const a = p.node.Annots();
    if (a) for (let k = 0; k < a.size(); k++) annotPage.set(String(a.get(k)), i);
  });
  const out: FormField[] = [];
  for (const f of fields) {
    const widgets = f.acroField.getWidgets().map((w) => {
      const r = w.getRectangle();
      const ref = doc.context.getObjectRef(w.dict);
      const page = w.P() ? pageOf.get(w.P()!.toString()) : ref ? annotPage.get(String(ref)) : undefined;
      const on = w.getOnValue?.();
      return { page: page ?? -1, rect: [r.x, r.y, r.x + r.width, r.y + r.height] as [number, number, number, number], option: on ? on.decodeText() : undefined };
    }).filter((w) => w.page >= 0);
    const base = { name: f.getName(), widgets, readOnly: f.isReadOnly() };
    if (f instanceof PDFTextField) out.push({ ...base, type: 'text', value: f.getText() ?? '', multiline: f.isMultiline() });
    else if (f instanceof PDFCheckBox) out.push({ ...base, type: 'checkbox', value: f.isChecked() });
    else if (f instanceof PDFRadioGroup) {
      // With /Opt, widgets' on-states are indexes into the option list.
      const options = f.getOptions();
      const ws = widgets.map((w) => ({ ...w, option: w.option !== undefined && /^\d+$/.test(w.option) && options[Number(w.option)] !== undefined ? options[Number(w.option)] : w.option }));
      out.push({ ...base, widgets: ws, type: 'radio', value: f.getSelected() ?? '', options });
    }
    else if (f instanceof PDFDropdown) out.push({ ...base, type: 'dropdown', value: f.getSelected()[0] ?? '', options: f.getOptions() });
    else if (f instanceof PDFOptionList) out.push({ ...base, type: 'list', value: f.getSelected()[0] ?? '', options: f.getOptions() });
    else if (f instanceof PDFSignature) out.push({ ...base, type: 'signature', value: '' });
    else out.push({ ...base, type: 'button', value: '' });
  }
  return out;
}

/** Set field values and regenerate their appearances. */
export function writeFields(doc: PDFDocument, values: Record<string, FieldValue>, font: PDFFont) {
  const form = doc.getForm();
  for (const [name, v] of Object.entries(values)) {
    const f = form.getFieldMaybe(name);
    if (!f || f.isReadOnly()) continue;
    if (f instanceof PDFTextField) f.setText(String(v));
    else if (f instanceof PDFCheckBox) { if (v) f.check(); else f.uncheck(); }
    else if (f instanceof PDFRadioGroup) { if (v) f.select(String(v)); else f.clear(); }
    else if (f instanceof PDFDropdown) { if (v) f.select(String(v)); else f.clear(); }
    else if (f instanceof PDFOptionList) { if (v) f.select(String(v)); else f.clear(); }
  }
  form.updateFieldAppearances(font);
}
