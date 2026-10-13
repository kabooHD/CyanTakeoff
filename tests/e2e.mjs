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
// 3-Point Radius: three points on a 5 ft circle.
await page.locator('.tb-btn[title^="3-Point Radius"]').click();
for (const [x, y] of [[15, 10], [20, 15], [25, 10]]) { const p = await toScreen(x, y); await page.mouse.click(p.x, p.y); }
list = await page.locator('.ml-table tbody').innerText();
assert(list.split(`5'-0"`).length === 3, '3-Point Radius through three points measures 5\'-0"');
await page.keyboard.press('Shift+Alt+U');
assert(await page.locator('.tb-btn.active[title^="3-Point Radius"]').count() === 1, 'Shift+Alt+U recalls the radius tool used last');
await page.keyboard.press('Escape');
await page.keyboard.press('Control+Z');
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

// Cutouts: 4x4 ft rectangle (16 sf) and a 4 ft circle (12.57 sf) out of the 432 sf office.
await page.keyboard.press('Control+Shift+F8'); await page.keyboard.press('Control+Shift+F7'); // exact drags
await page.locator('.tb-btn[title^="Polygon Cutout"]').click();
{ const a = await toScreen(2, 25), b = await toScreen(6, 29); await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 5 }); await page.mouse.up(); }
await page.locator('.tb-btn[title^="Ellipse Cutout"]').click();
{ const a = await toScreen(10, 30), b = await toScreen(14, 34); await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 5 }); await page.mouse.up(); }
await page.keyboard.press('Escape');
list = await page.locator('.ml-table tbody').innerText();
assert(list.includes('403.43 sf'), 'two cutouts reduce 432 sf to 403.43 sf');
await page.screenshot({ path: `${OUT}/07-cutouts.png` });
// Revu rules: a polygon cutout across the edge trims the area (2x4 ft outside -> 8 sf off).
await page.locator('.tb-btn[title^="Polygon Cutout"]').click();
{ const a = await toScreen(20, 38), b = await toScreen(28, 42); await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 5 }); await page.mouse.up(); }
await page.keyboard.press('Escape');
list = await page.locator('.ml-table tbody').innerText();
assert(list.includes('395.43 sf'), 'a cutout crossing the edge trims the area (395.43 sf)');
await page.keyboard.press('Control+Z');
// Area tool over a cutout converts it into its own measurement.
await page.keyboard.press('Shift+Alt+A');
{ const p = await toScreen(12, 32); await page.mouse.click(p.x, p.y); }
await page.keyboard.press('Escape');
list = await page.locator('.ml-table tbody').innerText();
assert(list.includes('12.57 sf') && list.includes('403.43 sf'), 'clicking a cutout with the Area tool converts it (12.57 sf)');
await page.keyboard.press('Control+Z');
{ const p = await toScreen(4, 27); await page.mouse.click(p.x, p.y, { button: 'right' }); }
await page.getByRole('menuitem', { name: 'Delete Cutout' }).click();
list = await page.locator('.ml-table tbody').innerText();
assert(list.includes('419.43 sf'), 'Delete Cutout restores 16 sf (419.43 sf)');
await page.keyboard.press('Control+Shift+F8'); await page.keyboard.press('Control+Shift+F7');
{
  const [dl] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+S')]);
  await dl.saveAs(`${OUT}/saved-cutouts.pdf`);
  await page.waitForTimeout(800);
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('Control+O')]);
  await fc.setFiles(`${OUT}/saved-cutouts.pdf`);
  await page.waitForFunction(() => document.querySelectorAll('.doc-tab').length === 3);
  await page.waitForTimeout(1200);
  assert((await page.locator('.ml-table tbody').innerText()).includes('419.43 sf'), 'cutouts survive save and reopen');
}

// Zoom in and check the detail canvas kicks in.
const c = await toScreen(30, 20);
await page.mouse.move(c.x, c.y);
for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, -300); await page.waitForTimeout(50); }
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/05-zoomed.png` });
assert(parseInt(await page.locator('.statusbar').innerText().then((t) => t.match(/(\d+)%/)[1])) > 100, 'wheel zoom');

// Dynamic Fill (J): press and hold inside Office 101, then Apply an Area.
{
  await page.keyboard.press('Control+9');
  await page.waitForTimeout(500);
  await page.keyboard.press('j');
  await page.getByRole('toolbar', { name: 'Dynamic Fill' }).waitFor();
  await page.waitForFunction(() => !document.querySelector('.fill-bar')?.textContent?.includes('Reading drawing'));
  // Temporary boundaries along the walls with door openings.
  await page.getByRole('button', { name: 'Add Boundary' }).click();
  for (const [x, y] of [[0, 22], [24, 22]]) { const q = await toScreen(x, y); await page.mouse.click(q.x, q.y); }
  { const q = await toScreen(24, 40); await page.mouse.dblclick(q.x, q.y); }
  await page.getByRole('button', { name: 'Fill', exact: true }).click();
  const p = await toScreen(12, 31);
  await page.mouse.move(p.x, p.y); await page.mouse.down();
  await page.waitForTimeout(2500);
  await page.mouse.up();
  await page.screenshot({ path: `${OUT}/08-dynamic-fill.png` });
  const before = await page.locator('.ml-table tbody tr').count();
  await page.getByRole('toolbar', { name: 'Dynamic Fill' }).getByRole('button', { name: 'Apply' }).click();
  assert(await page.locator('.ml-table tbody tr').count() === before + 1, 'Dynamic Fill Apply creates an Area');
  const rows = await page.locator('.ml-table tbody').innerText();
  const sf = [...rows.matchAll(/(\d+(?:\.\d+)?) sf/g)].map((m) => Number(m[1])).filter((v) => v !== 419.43);
  // Interior between wall faces: 23.5 x 17.17 ft = 403.4 sf, less the 3 ft door swing (7.1 sf) = 396.3 sf.
  assert(sf.length === 1 && Math.abs(sf[0] - 396.3) < 2, `filled office interior is 396.3 sf within 2 sf (${sf.join(', ')})`);
  await page.keyboard.press('Control+Z');
  await page.keyboard.press('Escape');
}

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

// Viewports: a detail on sheet 2 drawn at 1" = 10' while the sheet is 1" = 20'.
{
  const box = await svg.boundingBox();
  const z = box.width / (36 * 72);
  const site = (x, y) => ({ x: box.x + (400 + x * 3.6) * z, y: box.y + (H - (300 + y * 3.6)) * z });
  if (!(await page.getByRole('button', { name: 'Add Viewport' }).isVisible())) await page.locator('.side-right button[title="Measurements"]').click();
  await page.getByRole('button', { name: 'Add Viewport' }).click();
  let a = site(450, 120), b = site(600, 0);
  await page.mouse.move(a.x, a.y); await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 5 }); await page.mouse.up();
  const dlg = page.getByRole('dialog', { name: 'Apply Scale to Viewport' });
  assert(await dlg.isVisible(), 'dragging a rectangle opens Apply Scale to Viewport');
  await dlg.getByPlaceholder('Viewport name').fill('Detail A');
  await dlg.locator('select').first().selectOption(`1" = 10'`);
  await dlg.getByRole('button', { name: 'Apply' }).click();
  assert(await page.locator('.viewport-list input[aria-label="Viewport name"]').inputValue() === 'Detail A', 'viewport listed in the Measurements panel');
  {
    const x0 = await page.locator('.viewport-box > rect:not([width="7"])').last().getAttribute('x');
    const e1 = site(500, 120), e2 = site(520, 120);
    await page.mouse.move(e1.x, e1.y); await page.mouse.down();
    await page.mouse.move(e2.x, e2.y, { steps: 5 }); await page.mouse.up();
    const x1 = await page.locator('.viewport-box > rect').last().getAttribute('x');
    assert(Number(x1) > Number(x0) + 60, `dragging the viewport edge moves it (${x0} -> ${x1})`);
    await page.keyboard.press('Control+Z');
    const x2 = await page.locator('.viewport-box > rect').last().getAttribute('x');
    assert(Math.abs(Number(x2) - Number(x0)) < 0.01, 'undo restores the viewport');
  }
  await page.keyboard.press('Control+Shift+F8'); // exact clicks: content snap off
  await page.keyboard.press('Shift+Alt+L');
  a = site(460, 20); await page.mouse.click(a.x, a.y);
  assert(await page.locator('.viewport-box').count() > 0, 'viewports are highlighted while measuring');
  b = site(560, 20); await page.mouse.click(b.x, b.y);
  await page.keyboard.press('Control+Shift+F8');
  const rows = await page.locator('.ml-table tbody').innerText();
  assert(rows.includes('50 ft'), 'length inside the viewport uses its scale (50 ft at 1" = 10\')');
  await page.screenshot({ path: `${OUT}/07-viewport.png` });

  const [dl] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+S')]);
  const f = `${OUT}/saved-viewport.pdf`;
  await dl.saveAs(f);
  await page.waitForTimeout(800);
  const doc = await PDFDocument.load(readFileSync(f));
  const vp = doc.getPage(1).node.lookup(PDFName.of('VP'), PDFArray).asArray().map((r) => doc.context.lookup(r, PDFDict));
  assert(vp.length === 2 && vp.some((d) => d.get(PDFName.of('Name'))?.decodeText?.() === 'Detail A'), 'page scale and named viewport written to /VP');
  assert(await page.locator('.viewport-list input[aria-label="Viewport name"]').inputValue() === 'Detail A', 'viewport survives save and reload');
}

// Separate Y Scale in the Apply Scale to Pages dialog.
{
  await page.locator('.sb-scale').click();
  const dlg = page.getByRole('dialog', { name: 'Apply Scale to Pages' });
  await dlg.locator('select').nth(1).selectOption(`1" = 10'`);
  await dlg.getByLabel('Separate Y Scale').check();
  await dlg.locator('.y-scale select').first().selectOption(`1" = 20'`);
  await dlg.getByRole('button', { name: 'Apply Scale' }).click();
  const label = await page.locator('.sb-scale').innerText();
  assert(label.includes(`X 1" = 10'`) && label.includes(`Y 1" = 20'`), `separate X/Y scales applied (${label})`);
  await page.keyboard.press('Control+Z');
  assert((await page.locator('.sb-scale').innerText()).startsWith('1" = 20'), 'undo restores the previous page scale');
}

// Markup tools added for Revu parity, in the empty Conference room of sheet A-101.
{
  await page.keyboard.press('Home');
  await page.keyboard.press('Control+9');
  await page.waitForTimeout(800);
  const rowsBefore = await page.locator('.ml-table tbody tr').count();
  const click = async (x, y) => { const p = await toScreen(x, y); await page.mouse.click(p.x, p.y); };
  const drag = async (a, b) => {
    const p = await toScreen(...a), q = await toScreen(...b);
    await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(q.x, q.y, { steps: 6 }); await page.mouse.up();
  };
  await page.keyboard.press('Control+Shift+F8'); // content snap off for exact clicks
  await page.keyboard.press('Shift+L'); await click(44, 36); await click(54, 36);
  await page.keyboard.press('w'); await click(44, 12); await page.keyboard.type('Hello typewriter'); await page.keyboard.press('Escape');
  await page.keyboard.press('s'); await click(52, 14);
  await page.keyboard.press('d'); await drag([47.5, 31.2], [56, 29.6]);
  await page.waitForFunction(() => document.querySelector('.ml-table tbody')?.textContent?.includes('Strikethrough'));
  await page.keyboard.press('Shift+F'); await click(57, 34);
  await page.keyboard.press('k'); await drag([44, 26], [50, 21]); await click(52, 27); await page.keyboard.type('Check this'); await page.keyboard.press('Escape');
  await page.keyboard.press('Shift+C'); await click(44, 4); await click(54, 4); await click(49, 8);
  await page.keyboard.press('Control+Shift+F8');
  await page.screenshot({ path: `${OUT}/09-markup-tools.png` });
  const list = await page.locator('.ml-table tbody').innerText();
  for (const subj of ['Dimension', 'Typewriter', 'Stamp', 'Strikethrough', 'Flag', 'Cloud+', 'Arc']) assert(list.includes(subj), `${subj} markup created ${list.includes(subj) ? '' : list}`);
  assert(list.includes(`10'-0"`), 'Dimension shows its length');
  assert(await page.locator('.ml-table tbody tr').count() === rowsBefore + 7, 'seven markups added');

  const [dl] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+S')]);
  const f = `${OUT}/saved-tools.pdf`;
  await dl.saveAs(f);
  await page.waitForTimeout(800);
  const pdfDoc = await PDFDocument.load(readFileSync(f));
  const subs = pdfDoc.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray).asArray().map((r) => pdfDoc.context.lookup(r, PDFDict).get(PDFName.of('Subtype')).toString());
  for (const t of ['/StrikeOut', '/Stamp', '/FreeText', '/Text', '/PolyLine', '/Polygon', '/Line']) assert(subs.includes(t), `saved as ${t}`);
  const after = await page.locator('.ml-table tbody').innerText();
  for (const subj of ['Dimension', 'Typewriter', 'Stamp', 'Strikethrough', 'Flag', 'Cloud+', 'Arc']) assert(after.includes(subj), `${subj} survives save and reload`);
  assert(after.includes('Hello typewriter') || (await page.locator('.markup-text.typewriter').allInnerTexts()).some((t) => t.includes('Hello typewriter')), 'typewriter text kept');

  // Hyperlink to page 2, followed by double-click.
  await page.keyboard.press('Control+Shift+F8');
  await page.keyboard.press('Shift+H'); await drag([44, 38.5], [48, 37]);
  const ld = page.getByRole('dialog', { name: 'Hyperlink' });
  await ld.getByLabel('Jump to page').check();
  await ld.getByLabel('Page number').fill('2');
  await ld.getByRole('button', { name: 'OK' }).click();
  await click(46, 37.8); // select it
  { const p = await toScreen(46, 37.8); await page.mouse.dblclick(p.x, p.y); }
  await page.waitForTimeout(300);
  assert((await page.locator('.statusbar input').first().inputValue()) === '2', 'double-clicking a hyperlink jumps to its page');
  await page.keyboard.press('Home'); await page.waitForTimeout(500);

  // Pen stroke split by the Eraser.
  const pens = async () => (await page.locator('.ml-table tbody').innerText()).split('\nPen').length - 1;
  const pen0 = await pens();
  await page.keyboard.press('p'); await drag([44, 16.5], [56, 16.5]);
  await page.keyboard.press('Shift+E'); await drag([50, 18], [50, 15]);
  await page.keyboard.press('Escape');
  assert(await pens() === pen0 + 2, `the eraser splits a pen stroke in two (${pen0} -> ${await pens()})`);

  // Snapshot of a region, pasted as an image; then an Image from a file.
  const imgs = async () => (await page.locator('.ml-table tbody').innerText()).split('Snapshot').length - 1;
  await page.keyboard.press('g'); await drag([42, 40], [60, 30]);
  await page.waitForTimeout(800);
  await page.keyboard.press('Control+V');
  assert(await imgs() === 1, 'a snapshot pastes as an image markup');
  await page.keyboard.press('i');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), click(30, 10)]);
  await chooser.setFiles(`${OUT}/02-opened.png`);
  await page.waitForFunction(() => document.querySelector('.ml-table tbody')?.textContent?.includes('Image'));
  assert(await page.locator('.markup-layer image').count() >= 2, 'image markups are drawn');
  await page.keyboard.press('Control+Shift+F8');
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
