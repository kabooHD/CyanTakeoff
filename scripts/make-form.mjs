// Generates tests/fixtures/form.pdf: a small PDF form (text, checkbox,
// dropdown, radio group) used to test form filling.
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { writeFileSync } from 'node:fs';

const doc = await PDFDocument.create();
const page = doc.addPage([612, 792]);
const font = await doc.embedFont(StandardFonts.Helvetica);
const form = doc.getForm();
page.drawText('Inspection Form', { x: 50, y: 740, size: 18, font });
page.drawText('Inspector', { x: 50, y: 700, size: 11, font });
form.createTextField('inspector').addToPage(page, { x: 150, y: 690, width: 200, height: 22 });
page.drawText('Passed', { x: 50, y: 660, size: 11, font });
form.createCheckBox('passed').addToPage(page, { x: 150, y: 655, width: 16, height: 16 });
page.drawText('Trade', { x: 50, y: 620, size: 11, font });
const dd = form.createDropdown('trade');
dd.addOptions(['Electrical', 'Mechanical', 'Plumbing']);
dd.addToPage(page, { x: 150, y: 612, width: 140, height: 22 });
page.drawText('Priority', { x: 50, y: 580, size: 11, font });
const rg = form.createRadioGroup('priority');
rg.addOptionToPage('low', page, { x: 150, y: 575, width: 14, height: 14 });
rg.addOptionToPage('high', page, { x: 200, y: 575, width: 14, height: 14 });
writeFileSync('tests/fixtures/form.pdf', await doc.save());
console.log('wrote tests/fixtures/form.pdf');
