// PDF forms (AcroForm): read fields with their widgets, write values back.
import {
  PDFCheckBox, PDFDropdown, PDFHexString, PDFName, PDFOptionList, PDFRadioGroup, PDFSignature, PDFTextField, type PDFDocument, type PDFFont,
} from 'pdf-lib';
import { keepPageContents } from './incremental';

export type FieldValue = string | boolean;

export interface FormField {
  name: string;
  type: 'text' | 'checkbox' | 'radio' | 'dropdown' | 'list' | 'signature' | 'button';
  value: FieldValue;
  options?: string[];
  multiline?: boolean;
  readOnly?: boolean;
  /** Required (/Ff bit 2): Revu tints the field red until it is filled. */
  required?: boolean;
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
    const base = { name: f.getName(), widgets, readOnly: f.isReadOnly(), required: f.isRequired() || undefined };
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
    else if (f instanceof PDFSignature) out.push({ ...base, type: 'signature', value: f.acroField.dict.get(PDFName.of('V')) ? 'signed' : '' });
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

// ---------------- Forms editor: create, rename, delete fields ----------------

export type NewFieldType = 'text' | 'checkbox' | 'radio' | 'dropdown' | 'list' | 'signature' | 'button';

export interface FieldSpec {
  type: NewFieldType;
  name: string;
  page: number;
  /** Widget rectangle in PDF space: x0, y0, x1, y1. */
  rect: [number, number, number, number];
  /** Dropdown / list choices. */
  options?: string[];
  multiline?: boolean;
  /** Radio: the value this button sets (buttons sharing a name form one group). */
  option?: string;
  /** Button: its caption. */
  caption?: string;
}

const box = (r: FieldSpec['rect']) => ({ x: Math.min(r[0], r[2]), y: Math.min(r[1], r[3]), width: Math.abs(r[2] - r[0]), height: Math.abs(r[3] - r[1]) });

/** A field name not used yet: `Text1`, `Text2`... */
export function uniqueFieldName(existing: string[], base: string): string {
  const used = new Set(existing);
  for (let i = 1; ; i++) if (!used.has(`${base}${i}`)) return `${base}${i}`;
}

/** Add a form field with one widget (or a button to an existing radio group). */
export function createField(doc: PDFDocument, spec: FieldSpec) {
  const form = doc.getForm();
  const page = doc.getPage(spec.page);
  keepPageContents(page);
  const at = box(spec.rect);
  const existing = form.getFieldMaybe(spec.name);
  if (existing && !(spec.type === 'radio' && existing instanceof PDFRadioGroup)) throw new Error(`A field named "${spec.name}" already exists.`);
  switch (spec.type) {
    case 'text': {
      const f = form.createTextField(spec.name);
      if (spec.multiline) f.enableMultiline();
      f.addToPage(page, at);
      break;
    }
    case 'checkbox': form.createCheckBox(spec.name).addToPage(page, at); break;
    case 'radio': {
      const g = existing instanceof PDFRadioGroup ? existing : form.createRadioGroup(spec.name);
      g.addOptionToPage(spec.option || `Choice${g.getOptions().length + 1}`, page, at);
      break;
    }
    case 'dropdown': {
      const f = form.createDropdown(spec.name);
      f.addOptions(spec.options ?? []);
      f.addToPage(page, at);
      break;
    }
    case 'list': {
      const f = form.createOptionList(spec.name);
      f.addOptions(spec.options ?? []);
      f.addToPage(page, at);
      break;
    }
    case 'button': {
      const b = form.createButton(spec.name);
      b.addToPage(spec.caption ?? spec.name, page, { ...at, borderWidth: 1 });
      break;
    }
    case 'signature': {
      // pdf-lib has no signature-field builder: a terminal field merged with its widget (ISO 32000 12.7.4.5).
      const ctx = doc.context;
      const ref = ctx.register(ctx.obj({
        Type: 'Annot', Subtype: 'Widget', FT: 'Sig', T: PDFHexString.fromText(spec.name), F: 4, P: page.ref,
        Rect: [at.x, at.y, at.x + at.width, at.y + at.height],
        MK: { BC: [0, 0, 0] }, BS: { W: 1 },
      }));
      page.node.addAnnot(ref);
      form.acroForm.addField(ref);
      break;
    }
  }
}

/** Rename a field (its partial name, /T). */
export function renameField(doc: PDFDocument, from: string, to: string) {
  const form = doc.getForm();
  if (form.getFieldMaybe(to)) throw new Error(`A field named "${to}" already exists.`);
  const f = form.getField(from);
  const parts = to.split('.');
  f.acroField.dict.set(PDFName.of('T'), PDFHexString.fromText(parts[parts.length - 1]));
}

/** Delete a field and its widgets. */
export function deleteField(doc: PDFDocument, name: string) {
  const form = doc.getForm();
  const f = form.getField(name);
  // Take the widgets off their pages ourselves: pdf-lib only finds pages through /P.
  const refs = new Set(f.acroField.getWidgets().map((w) => String(doc.context.getObjectRef(w.dict) ?? f.ref)));
  for (const p of doc.getPages()) {
    const annots = p.node.Annots();
    if (!annots) continue;
    for (let i = annots.size() - 1; i >= 0; i--) if (refs.has(String(annots.get(i)))) annots.remove(i);
  }
  form.removeField(f);
}

/** Replace a dropdown's or list's choices. */
export function setFieldOptions(doc: PDFDocument, name: string, options: string[]) {
  const f = doc.getForm().getField(name);
  if (f instanceof PDFDropdown || f instanceof PDFOptionList) f.setOptions(options);
}

// ---------------- Forms panel: field layout and tab order ----------------

/** Move / resize a field's widgets on `page` to `rect` (PDF space) and redraw them. */
export function setWidgetRect(doc: PDFDocument, name: string, page: number, rect: [number, number, number, number], font: PDFFont) {
  const form = doc.getForm();
  const f = form.getField(name);
  const pageRef = doc.getPage(page).ref.toString();
  const annots = doc.getPage(page).node.Annots();
  const onPage = new Set<string>();
  if (annots) for (let i = 0; i < annots.size(); i++) onPage.add(String(annots.get(i)));
  for (const w of f.acroField.getWidgets()) {
    const ref = doc.context.getObjectRef(w.dict);
    const here = w.P() ? w.P()!.toString() === pageRef : ref ? onPage.has(String(ref)) : false;
    if (here) w.setRectangle({ x: Math.min(rect[0], rect[2]), y: Math.min(rect[1], rect[3]), width: Math.abs(rect[2] - rect[0]), height: Math.abs(rect[3] - rect[1]) });
  }
  if (!(f instanceof PDFSignature)) { try { form.updateFieldAppearances(font); } catch { /* fields without an appearance generator keep theirs */ } }
}

/** The page's automatic tab order: by Row, by Column, or Structure order; null removes it (Unspecified: /Annots order). */
export function setPageTabs(doc: PDFDocument, page: number, mode: 'R' | 'C' | 'S' | null) {
  const node = doc.getPage(page).node;
  if (mode) node.set(PDFName.of('Tabs'), PDFName.of(mode)); else node.delete(PDFName.of('Tabs'));
}

/** The page's /Tabs entry as read. */
export function pageTabs(doc: PDFDocument, page: number): 'R' | 'C' | 'S' | null {
  const t = doc.getPage(page).node.get(PDFName.of('Tabs'));
  const v = t instanceof PDFName ? t.decodeText() : null;
  return v === 'R' || v === 'C' || v === 'S' ? v : null;
}

/** Manual tab order (Unspecified): the fields' widgets are put in `names` order at the end of the page's /Annots. */
export function setFieldOrder(doc: PDFDocument, page: number, names: string[]) {
  const form = doc.getForm();
  const pg = doc.getPage(page);
  const annots = pg.node.Annots();
  if (!annots) return;
  const refOf = new Map<string, number>(); // widget ref -> position in names
  names.forEach((n, i) => {
    const f = form.getFieldMaybe(n);
    if (!f) return;
    for (const w of f.acroField.getWidgets()) { const r = doc.context.getObjectRef(w.dict); if (r) refOf.set(String(r), i); }
  });
  const items = Array.from({ length: annots.size() }, (_, i) => annots.get(i));
  const others = items.filter((r) => !refOf.has(String(r)));
  const widgets = items.filter((r) => refOf.has(String(r))).sort((a, b) => refOf.get(String(a))! - refOf.get(String(b))!);
  pg.node.set(PDFName.of('Annots'), doc.context.obj([...others, ...widgets]));
}
