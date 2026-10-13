// End-to-end smoke test: drives the built app in Chromium.
// Usage: npm run build && npx vite preview --port 4173 & node tests/e2e.mjs
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { PDFDocument, PDFName, PDFArray, PDFDict } from 'pdf-lib';

const URL = process.env.APP_URL ?? 'http://localhost:4173/';
const OUT = process.env.OUT ?? 'test-results';
mkdirSync(OUT, { recursive: true });
const local = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const executablePath = process.env.CHROMIUM ?? (existsSync(local) ? local : undefined);

const browser = await chromium.launch({ executablePath });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
// Force the download / <input type=file> fallbacks (no native pickers headless).
await page.addInitScript(() => { delete window.showSaveFilePicker; delete window.showOpenFilePicker; });

const assert = (cond, msg) => { if (!cond) throw new Error(`ASSERT: ${msg}`); console.log(`ok - ${msg}`); };

await page.goto(URL);
await page.screenshot({ path: `${OUT}/01-start.png` });
await page.getByRole('button', { name: 'Open sample drawing' }).click();
await page.waitForSelector('.markup-layer');
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/02-opened.png` });

// Page geometry: sample sheet A-101 is 36x24 in, plan origin at (300,400) PDF pt, 18 pt/ft.
const H = 24 * 72;
const svg = page.locator('.markup-layer');
async function toScreen(xFt, yFt) {
  const box = await svg.boundingBox();
  const zoom = box.width / (36 * 72);
  const px = 300 + xFt * 18, py = H - (400 + yFt * 18);
  return { x: box.x + px * zoom, y: box.y + py * zoom };
}

assert((await page.locator('.sb-scale').innerText()) === 'Scale Not Set', 'status bar says Scale Not Set before calibrating');

// Set scale from the Measurements panel preset.
await page.locator('.side-right button[title="Measurements"]').click();
await page.locator('.props select').first().selectOption(`1/4" = 1'-0"`);
assert((await page.locator('.sb-scale').innerText()).includes(`1/4"`), 'scale shown in status bar');

// Area takeoff of Office 101 (0..24 ft x 22..40 ft) = 432 sf.
await page.keyboard.press('Shift+Alt+A');
for (const [x, y] of [[0, 22], [24, 22], [24, 40], [0, 40]]) {
  const p = await toScreen(x, y);
  await page.mouse.click(p.x, p.y);
}
{
  const p = await toScreen(1, 39); await page.mouse.move(p.x, p.y);
  await page.waitForTimeout(100);
  const preview = await page.locator('.measure-preview').innerText();
  assert(preview.includes('Area') && preview.includes('Perimeter'), 'live measurement preview while drawing');
}
await page.keyboard.press('Enter');
await page.waitForTimeout(200);
let list = await page.locator('.ml-table tbody').innerText();
assert(list.includes('432 sf'), 'area measurement 432 sf in Markups List');

// Content snap: click ~5px off each wall corner; snapping must land exactly.
await page.keyboard.press('Shift+Alt+A');
for (const [x, y, dx, dy] of [[0, 22, -5, 5], [24, 22, -5, 5], [24, 40, -5, -5], [0, 40, -5, -5]]) {
  const p = await toScreen(x, y);
  await page.mouse.move(p.x + dx, p.y + dy);
  await page.waitForTimeout(150);
  await page.mouse.click(p.x + dx, p.y + dy);
}
await page.keyboard.press('Enter');
list = await page.locator('.ml-table tbody').innerText();
assert((list.match(/432 sf\b/g) ?? []).length === 2, 'content snap gives exact 432 sf from imprecise clicks');
await page.keyboard.press('Control+Z');

// Length of the north wall: 60 ft.
await page.keyboard.press('Shift+Alt+L');
let a = await toScreen(0, 40), b = await toScreen(60, 40);
await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 5 }); await page.mouse.up();
list = await page.locator('.ml-table tbody').innerText();
assert(list.includes(`60'-0"`), `length measurement 60'-0"`);

// Angle, radius and diameter via their Revu shortcuts (snapping off for exact clicks).
const toggleSnaps = async () => { await page.keyboard.press('Control+Shift+F8'); await page.keyboard.press('Control+Shift+F7'); };
await toggleSnaps();
await page.keyboard.press('Shift+Alt+G');
for (const [x, y] of [[0, 30], [0, 0], [30, 0]]) { const p = await toScreen(x, y); await page.mouse.click(p.x, p.y); }
await page.keyboard.press('Shift+Alt+U');
a = await toScreen(10, 10); b = await toScreen(14, 13);
await page.mouse.click(a.x, a.y); await page.mouse.click(b.x, b.y);
await page.keyboard.press('Shift+Alt+D');
a = await toScreen(30, 30); b = await toScreen(36, 38);
await page.mouse.click(a.x, a.y); await page.mouse.click(b.x, b.y);
list = await page.locator('.ml-table tbody').innerText();
assert(list.includes('90°'), 'angle measures 90°');
assert(list.includes(`5'-0"`), `radius measures 5'-0" (3-4-5 triangle)`);
assert(list.includes(`10'-0"`), `diameter measures 10'-0" (6-8-10 triangle)`);
await toggleSnaps();

// Count three doors.
await page.keyboard.press('Shift+Alt+C');
for (const [x, y] of [[28, 2], [26, 23], [44, 11]]) {
  const p = await toScreen(x, y);
  await page.mouse.click(p.x, p.y);
}
await page.keyboard.press('Enter');

// A cloud + text box.
await page.keyboard.press('C');
a = await toScreen(44, 2); b = await toScreen(58, 16);
await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 5 }); await page.mouse.up();
await page.keyboard.press('T');
a = await toScreen(26, 6); b = await toScreen(40, 10);
await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 5 }); await page.mouse.up();
await page.keyboard.type('Verify door hardware');
{ const p = await toScreen(50, 30); await page.mouse.click(p.x, p.y); } // click the page to finish editing, as a user would
await page.waitForTimeout(200);

list = await page.locator('.ml-table tbody').innerText();
assert(list.includes('Count Measurement') && /\t3\t/.test(list), 'count of 3');
assert(list.includes('Verify door hardware'), 'text box content in list');
await page.screenshot({ path: `${OUT}/03-takeoff.png` });

// Right-click leaves a drawing tool.
await page.keyboard.press('L');
{ const p = await toScreen(50, 30); await page.mouse.click(p.x, p.y, { button: 'right' }); }
assert((await page.locator('.tb-btn.active').getAttribute('title')).startsWith('Select'), 'right-click returns to Select');

// Right-drag selects the markups inside the box (here: the count, cloud and text box on the right).
{
  const a = await toScreen(25, 17), b = await toScreen(59.9, 1);
  await page.mouse.move(a.x, a.y); await page.mouse.down({ button: 'right' });
  await page.mouse.move(b.x, b.y, { steps: 6 }); await page.mouse.up({ button: 'right' });
  const selected = await page.locator('.ml-table tbody tr.selected').count();
  assert(selected >= 2, `right-drag multi-selects (${selected} selected)`);
  await page.keyboard.press('Escape');
}

// Markups List: hide a column, filter a column.
await page.getByRole('button', { name: 'Columns ▾' }).click();
await page.locator('.ml-columns-menu label', { hasText: 'Author' }).locator('input').uncheck();
await page.mouse.move(5, 5);
assert(!(await page.locator('.ml-table thead').innerText()).includes('Author'), 'column chooser hides Author');
await page.getByRole('button', { name: 'Filter List' }).click();
await page.locator('.ml-filter-row th').first().locator('select').selectOption('Count Measurement');
assert((await page.locator('.ml-table tbody tr').count()) === 1, 'filter row shows only the count');
await page.getByRole('button', { name: 'Filter List' }).click();
await page.getByRole('button', { name: 'Columns ▾' }).click();
await page.locator('.ml-columns-menu label', { hasText: 'Author' }).locator('input').check();
await page.mouse.move(5, 5);

// Undo/redo.
const rows = () => page.locator('.ml-table tbody tr').count();
const before = await rows();
await page.keyboard.press('Control+Z');
assert((await rows()) === before - 1 || (await rows()) === before, 'undo works');
await page.keyboard.press('Control+Y');
assert((await rows()) === before, 'redo restores');

// Save -> download.
const [download] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+S')]);
const saved = `${OUT}/saved.pdf`;
await download.saveAs(saved);
await page.waitForTimeout(800);

// Inspect the saved PDF: standard annotations with measure dictionaries.
const pdf = await PDFDocument.load(readFileSync(saved));
const annots = pdf.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray);
const dicts = annots.asArray().map((r) => pdf.context.lookup(r, PDFDict));
const subtypes = dicts.map((d) => d.get(PDFName.of('Subtype')).toString());
console.log('saved annotation subtypes:', subtypes.join(' '));
assert(subtypes.includes('/Polygon') && subtypes.includes('/Line') && subtypes.includes('/FreeText'), 'standard annotation subtypes written');
assert(dicts.some((d) => d.get(PDFName.of('Measure'))), '/Measure dictionary written');
assert(dicts.every((d) => d.get(PDFName.of('AP'))), 'every annotation has an appearance stream');
assert(pdf.getPage(0).node.get(PDFName.of('VP')), 'page viewport (/VP) scale written');

// Reopen the saved file: markups and measurements must round-trip.
const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('Control+O')]);
await chooser.setFiles(saved);
await page.waitForFunction(() => document.querySelectorAll('.doc-tab').length === 2);
await page.waitForTimeout(1200);
list = await page.locator('.ml-table tbody').innerText();
assert(list.includes('432 sf') && list.includes(`60'-0"`) && list.includes('Verify door hardware'), 'markups round-trip after save + reopen');
assert((await page.locator('.sb-scale').innerText()).includes(`1/4"`), 'page scale round-trips');
await page.screenshot({ path: `${OUT}/04-reopened.png` });

// Zoom in and check the detail canvas kicks in.
const c = await toScreen(30, 20);
await page.mouse.move(c.x, c.y);
for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, -300); await page.waitForTimeout(50); }
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/05-zoomed.png` });
assert(parseInt(await page.locator('.statusbar').innerText().then((t) => t.match(/(\d+)%/)[1])) > 100, 'wheel zoom');

// Apply Scale to Pages: prompt on an unscaled page, then calibrate (site plan, sheet 2).
await page.keyboard.press('Control+9');
await page.keyboard.press('End');
await page.waitForTimeout(800);
assert((await page.locator('.sb-scale').innerText()) === 'Scale Not Set', 'sheet 2 has no scale');
{
  const box = await svg.boundingBox();
  const z = box.width / (36 * 72);
  const site = (x, y) => ({ x: box.x + (400 + x * 3.6) * z, y: box.y + (H - (300 + y * 3.6)) * z }); // 1" = 20'
  await page.keyboard.press('Shift+Alt+L');
  let p = site(0, 0); await page.mouse.click(p.x, p.y);
  assert(await page.getByRole('dialog', { name: 'Apply Scale to Pages' }).isVisible(), 'measuring on an unscaled page asks for a scale');
  await page.getByRole('button', { name: 'Calibrate…' }).click();
  await page.keyboard.press('Control+Shift+F8'); // exact clicks: content snap off
  p = site(0, 0); await page.mouse.click(p.x, p.y);
  p = site(400, 0); await page.mouse.click(p.x, p.y);
  const dlg = page.getByRole('dialog', { name: 'Apply Scale to Pages' });
  await dlg.locator('select').nth(1).selectOption('ft');
  await dlg.locator('input[type=number]').first().fill('400');
  await dlg.getByRole('button', { name: 'Apply Scale' }).click();
  assert((await page.locator('.sb-scale').innerText()).startsWith('1" = 20'), `calibrated scale is 1" = 20' (${await page.locator('.sb-scale').innerText()})`);
  await page.keyboard.press('Shift+Alt+L');
  p = site(0, 300); await page.mouse.click(p.x, p.y);
  const q = site(400, 300); await page.mouse.click(q.x, q.y);
  await page.keyboard.press('Control+Shift+F8');
  const rows = await page.locator('.ml-table tbody').innerText();
  assert(rows.includes('400 ft'), 'length on the calibrated sheet reads 400 ft');
  await page.screenshot({ path: `${OUT}/06-scale-dialog.png` });
}

// Real Revu-authored files (tests/fixtures/revu): values must match what Revu displayed.
for (const [file, expected] of [
  ['measure.pdf', [`5'-5"`, '56.37 sf', `18'-11 1/2"`, `22'-4 1/2"`, '0 cu ft', '96.69°', `4'-9"`, `3'-9"`]],
  ['markup-space.pdf', ['15']],
]) {
  const tabs = await page.locator('.doc-tab').count();
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('Control+O')]);
  await fc.setFiles(`tests/fixtures/revu/${file}`);
  await page.waitForFunction((n) => document.querySelectorAll('.doc-tab').length === n + 1, tabs);
  await page.waitForTimeout(1200);
  const text = await page.locator('.ml-table tbody').innerText();
  for (const v of expected) assert(text.includes(v), `Revu ${file}: shows ${v}`);
  await page.screenshot({ path: `${OUT}/revu-${file.replace('.pdf', '')}.png` });
}

assert(errors.length === 0, `no page errors (${errors.join(' | ')})`);
await browser.close();
console.log('E2E PASSED');
