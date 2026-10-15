// Tools > Form > Automatically Create Form Fields (Revu): the page content
// is scanned for boxes, check boxes, radio circles and signature lines,
// which become fields named after the text beside them; the Forms Editor
// then opens for review. Scanned sheets have no vector content: OCR first.
import { detectFields, findBoxes, findCircles, type Box } from '../model/autoFields';
import { useApp } from '../model/store';
import { createField, uniqueFieldName, type FieldSpec } from '../pdf/forms';
import { snapGeometry } from '../pdf/geometry';
import { useFormsDialog } from './FormsEditor';
import { pageText } from './toolActions';

export async function autoCreateFormFields() {
  const s = useApp.getState();
  const d = s.docs.find((x) => x.id === s.activeId);
  if (!d) return;
  s.setStatus('Looking for form fields in the page content…');
  const specs: FieldSpec[] = [];
  const names = d.loaded.fields.map((f) => f.name);
  for (let p = 0; p < d.loaded.pages.length; p++) {
    const info = d.loaded.pages[p], vp = info.viewport;
    const pdfPage = await d.loaded.pdf.getPage(p + 1);
    const [g, texts] = await Promise.all([snapGeometry(pdfPage, vp), pageText(pdfPage, vp)]);
    // Areas already holding fields (page space) are left alone.
    const skip: Box[] = d.loaded.fields.flatMap((f) => f.widgets.filter((w) => w.page === p).map((w) => ({ x0: w.rect[0], y0: w.rect[1], x1: w.rect[2], y1: w.rect[3] })));
    const found = detectFields(findBoxes(g.segments), findCircles(g.curves), texts, skip);
    const pageNames = new Map<string, string>();
    for (const f of found) {
      // Names are unique in the document; a radio group keeps one name for all its buttons.
      let name = pageNames.get(f.name);
      if (!name) {
        name = names.includes(f.name) ? uniqueFieldName(names, f.name) : f.name;
        names.push(name);
        pageNames.set(f.name, name);
      }
      const [x0, y0] = vp.convertToPdfPoint(f.rect.x0, f.rect.y0), [x1, y1] = vp.convertToPdfPoint(f.rect.x1, f.rect.y1);
      specs.push({ type: f.type, name, page: p, rect: [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)], multiline: f.multiline, option: f.option });
    }
  }
  if (!specs.length) {
    s.setStatus('No form-like content found. Scanned sheets need OCR (Document > OCR) before fields can be detected.');
    return;
  }
  await s.transformDoc((lib) => { for (const spec of specs) createField(lib, spec); }, `Automatically Create Form Fields: ${specs.length} field${specs.length === 1 ? '' : 's'} added`);
  useFormsDialog.setState({ editor: true });
}
