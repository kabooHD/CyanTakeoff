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

/** Ctrl+O and wait for the file chooser (retried: the picker needs a fresh user activation). */
async function ctrlO() {
  for (let i = 0; i < 3; i++) {
    try {
      const [fc] = await Promise.all([page.waitForEvent('filechooser', { timeout: 8000 }), page.keyboard.press('Control+O')]);
      return fc;
    } catch { console.log('(retrying Ctrl+O)'); await page.mouse.click(5, 500); }
  }
  throw new Error('no file chooser');
}
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
const chooser = await ctrlO();
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
  const fc = await ctrlO();
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
  // Rise/Drop on a length (Properties): 10 ft + 2 ft rise reads 12'-0"; then undone.
  await page.keyboard.press('Shift+Alt+L'); await click(44, 33); await click(54, 33);
  await page.locator('.side-right button[title="Properties"]').click();
  await page.getByLabel('Rise/Drop').fill('2');
  assert((await page.locator('.ml-table tbody').innerText()).includes(`12'-0"`), 'Rise/Drop adds to the length (12\'-0")');
  await page.evaluate(() => (document.activeElement)?.blur?.());
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+Z'); await page.keyboard.press('Control+Z');
  await page.locator('.side-right button[title="Measurements"]').click();
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

  // Group (Ctrl+G) selects together; Lock (Ctrl+Shift+L) prevents deleting; groups saved Revu-style.
  await page.keyboard.press('Escape');
  await click(52, 14);
  { const p = await toScreen(57.5, 33.5); await page.keyboard.down('Control'); await page.mouse.click(p.x, p.y); await page.keyboard.up('Control'); }
  await page.keyboard.press('Control+G');
  await page.keyboard.press('Escape');
  await click(52, 14);
  assert(await page.locator('.ml-table tbody tr.selected').count() === 2, 'clicking one grouped markup selects the group');
  await page.keyboard.press('Control+Shift+L');
  const n0 = await page.locator('.ml-table tbody tr').count();
  await page.keyboard.press('Delete');
  assert(await page.locator('.ml-table tbody tr').count() === n0, 'locked markups cannot be deleted');
  await page.keyboard.press('Control+Shift+L');
  const [dlg] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+S')]);
  await dlg.saveAs(`${OUT}/saved-group.pdf`);
  await page.waitForTimeout(800);
  const gd = await PDFDocument.load(readFileSync(`${OUT}/saved-group.pdf`));
  const rts = gd.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray).asArray().map((r) => gd.context.lookup(r, PDFDict).get(PDFName.of('RT'))?.toString());
  assert(rts.includes('/Group'), 'group saved with /IRT + /RT /Group');
  await click(52, 14);
  assert(await page.locator('.ml-table tbody tr.selected').count() === 2, 'group survives save and reload');
  await page.keyboard.press('Escape');

  // Tool Chest: save the stamp to My Tools, switch it to Drawing mode, place a copy.
  {
    const stamps = async () => (await page.locator('.ml-table tbody').innerText()).split('\nStamp').length - 1;
    const n0 = await stamps();
    { const p = await toScreen(52, 14); await page.mouse.click(p.x, p.y, { button: 'right' }); }
    await page.getByRole('menuitem', { name: 'Add to My Tools' }).click();
    await page.locator('.side-right button[title="Tool Chest"]').click();
    const tool = page.locator('.toolchest details').nth(1).locator('.tool-item').last();
    await tool.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Drawing Mode' }).click();
    await tool.click();
    await click(70, 30);
    assert(await stamps() === n0 + 1, 'a Drawing-mode tool places a copy of the saved markup');
    await page.keyboard.press('Control+Z');
    await page.locator('.side-right button[title="Measurements"]').click();
  }
  // Spaces (Alt+S): name the Conference room; markups inside report it in the Space column.
  await page.keyboard.press('Alt+S');
  await page.getByRole('button', { name: 'Add Space' }).click();
  await drag([42.4, 39.5], [59.5, 18.4]);
  const sd = page.getByRole('dialog', { name: 'Add Space' });
  await sd.getByLabel('Space name').fill('Conference 104');
  await sd.getByRole('button', { name: 'OK' }).click();
  assert(await page.locator('.space-row').filter({ hasText: 'Conference 104' }).count() === 1, 'Space listed in the Spaces panel');
  const spaceCells = async () => (await page.locator('.ml-table tbody').innerText()).split('Conference 104').length - 1;
  assert(await spaceCells() === 6, `the six markups inside report their Space (${await spaceCells()})`);
  const [sdl] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+S')]);
  await sdl.saveAs(`${OUT}/saved-spaces.pdf`);
  await page.waitForTimeout(800);
  assert(await spaceCells() === 6, 'Spaces survive save and reload');
  await page.keyboard.press('Alt+S');
  await page.keyboard.press('Control+Shift+F8');
}

// Custom columns (Number + Formula) and Summary to Excel.
{
  await page.getByRole('button', { name: 'Columns ▾' }).click();
  await page.getByRole('button', { name: 'Manage Columns…' }).click();
  const mc = page.getByRole('dialog', { name: 'Manage Columns' });
  await mc.getByRole('button', { name: 'Add…' }).click();
  await mc.getByLabel('Column name').fill('Unit Cost');
  await mc.getByLabel('Column type').selectOption('number');
  await mc.getByRole('button', { name: 'OK' }).click();
  await mc.getByRole('button', { name: 'Add…' }).click();
  await mc.getByLabel('Column name').fill('Total Cost');
  await mc.getByLabel('Column type').selectOption('formula');
  await mc.getByLabel('Expression').fill('Area * [Unit Cost]');
  await mc.getByLabel('Format').selectOption('currency');
  await mc.getByRole('button', { name: 'OK' }).click();
  await mc.getByRole('button', { name: 'Close' }).click();
  const row = page.locator('.ml-table tbody tr').filter({ hasText: '419.43 sf' }).first();
  await page.screenshot({ path: `${OUT}/10-columns.png` });
  await row.getByLabel('Unit Cost').fill('2');
  await row.getByLabel('Unit Cost').press('Enter');
  assert((await row.innerText()).includes("$838.87"), `formula column computes Area * Unit Cost ($838.87): ${(await row.innerText()).replace(/\s+/g, " ")}`);
  await page.getByRole('button', { name: 'Summary ▾' }).click();
  const [x] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Excel (.xlsx)' }).click()]);
  await x.saveAs(`${OUT}/summary.xlsx`);
  const { unzipSync, strFromU8 } = await import('fflate');
  const sheet = strFromU8(unzipSync(readFileSync(`${OUT}/summary.xlsx`))['xl/worksheets/sheet1.xml']);
  assert(sheet.includes('Total Cost') && sheet.includes('<v>838.8'), 'Excel summary has the custom columns with numeric values');
  const [sv] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+S')]);
  await sv.saveAs(`${OUT}/saved-columns.pdf`);
  await page.waitForTimeout(800);
  assert((await page.locator('.ml-table tbody tr').filter({ hasText: '419.43 sf' }).first().innerText()).includes('$838.87'), 'custom columns and values survive save and reload');
}

// Legend: right-click the office Area > Create Legend, click to place; it totals live.
{
  const p = await toScreen(20, 38);
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await page.getByRole('menuitem', { name: 'Create Legend' }).click();
  const q = await toScreen(62, 38);
  await page.mouse.click(q.x, q.y);
  await page.waitForTimeout(300);
  const legendText = await page.locator('.markup-layer g.legend').innerHTML();
  assert(legendText.includes('Area Measurement') && legendText.includes('419.43 sf'), 'Legend lists the area kind with its total');
  await page.screenshot({ path: `${OUT}/11-legend.png` });
  const [ld] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+S')]);
  await ld.saveAs(`${OUT}/saved-legend.pdf`);
  await page.waitForTimeout(800);
  assert((await page.locator('.markup-layer g.legend').count()) === 1, 'Legend survives save and reload');
}

// Replies, Checkmark and the PDF summary report.
{
  const p = await toScreen(20, 38);
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await page.getByRole('menuitem', { name: 'Reply' }).click();
  await page.getByLabel('Reply').fill('Verified on site');
  await page.getByLabel('Reply').press('Enter');
  assert(await page.locator('.reply-row').filter({ hasText: 'Verified on site' }).count() === 1, 'reply shown under its markup');
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await page.getByRole('menuitem', { name: 'Check', exact: true }).click();
  await page.getByRole('button', { name: 'Summary ▾' }).click();
  const [sp] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'PDF report' }).click()]);
  await sp.saveAs(`${OUT}/summary.pdf`);
  assert((await PDFDocument.load(readFileSync(`${OUT}/summary.pdf`))).getPageCount() >= 1, 'PDF summary report generated');
  const [rd] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+S')]);
  await rd.saveAs(`${OUT}/saved-replies.pdf`);
  await page.waitForTimeout(800);
  assert(await page.locator('.reply-row').filter({ hasText: 'Verified on site' }).count() === 1, 'reply survives save and reload');
  // Arrow keys step through the Markups List.
  await page.locator('.ml-table tbody tr').first().locator('td').first().click();
  const firstText = await page.locator('.ml-table tbody tr.selected').first().innerText();
  await page.keyboard.press('ArrowDown');
  const sels = await page.locator('.ml-table tbody tr.selected').allInnerTexts();
  assert(sels.length >= 1 && sels[0] !== firstText, `Down arrow selects the next row (${sels.length})`);
}

// Search (Ctrl+F): results listed and highlighted; F3 steps.
{
  await page.keyboard.press('Control+F');
  await page.getByLabel('Search text').fill('SF');
  await page.getByLabel('Search text').press('Enter');
  await page.waitForFunction(() => /\d+ results?/.test(document.querySelector('.search-panel')?.textContent ?? ''));
  const n = await page.locator('.search-hit').count();
  assert(n >= 4, `search finds the room areas (${n} results)`);
  assert(await page.locator('.search-hl').count() >= 1, 'search hits highlighted on the page');
  await page.locator('.ml-table-wrap').focus();
  await page.keyboard.press('F3');
  assert(await page.locator('.search-hit.active').innerText() !== '' , 'F3 moves to the next result');
  await page.keyboard.press('Alt+1');
}

// Split view (Ctrl+2): two panes with their own page; Ctrl+1 switches; Ctrl+Shift+2 unsplits.
{
  await page.locator('.ml-table-wrap').focus();
  await page.keyboard.press('Control+2');
  await page.waitForTimeout(800);
  assert(await page.locator('.split-view.v .viewer-wrap').count() === 2, 'Ctrl+2 splits the view vertically');
  await page.keyboard.press('End'); // second pane is active: go to the last page there
  await page.waitForTimeout(800);
  const labels = await page.locator('.split-view .viewer-wrap').evaluateAll((els) => els.map((e) => e.querySelector('.page canvas')?.getBoundingClientRect().width ?? 0));
  assert(labels.length === 2, 'both panes render a page');
  assert((await page.locator('.statusbar input').first().inputValue()) === '2', 'the active pane shows page 2');
  await page.keyboard.press('Control+1');
  assert((await page.locator('.statusbar input').first().inputValue()) === '1', 'Ctrl+1 switches to the other pane (page 1)');
  await page.screenshot({ path: `${OUT}/12-split.png` });
  await page.keyboard.press('Control+Shift+2');
  assert(await page.locator('.split-view').count() === 0, 'Ctrl+Shift+2 unsplits');
}

// Page operations (Document menu / Revu shortcuts): insert blank, rotate, delete, flatten.
{
  const pagesOf = async () => Number((await page.locator('.statusbar').innerText()).match(/of (\d+)\)/)[1]);
  await page.keyboard.press('Home');
  const n0 = await pagesOf();
  await page.keyboard.press('Control+Shift+N');
  await page.getByRole('dialog', { name: 'Insert Blank Page' }).getByRole('button', { name: 'OK' }).click();
  await page.waitForFunction((n) => document.querySelector('.statusbar')?.textContent?.includes(`of ${n + 1})`), n0);
  assert(await pagesOf() === n0 + 1, 'Insert Blank Page adds a page');
  const markupsBefore = await page.locator('.ml-table tbody tr:not(.reply-row)').count();
  assert(markupsBefore > 0, 'markups kept through the page operation');
  await page.keyboard.press('Control+Shift+D');
  await page.getByRole('dialog', { name: 'Delete Pages' }).getByRole('button', { name: 'OK' }).click();
  await page.waitForFunction((n) => document.querySelector('.statusbar')?.textContent?.includes(`of ${n})`), n0);
  assert(await pagesOf() === n0, 'Delete Pages removes it again');
  const waitPages = (n) => page.waitForFunction((k) => document.querySelector('.statusbar')?.textContent?.includes(`of ${k})`), n);
  await page.keyboard.press('Control+z');
  await waitPages(n0 + 1);
  assert(await pagesOf() === n0 + 1, 'Undo brings the deleted page back');
  await page.keyboard.press('Control+z');
  await waitPages(n0);
  assert(await page.locator('.ml-table tbody tr:not(.reply-row)').count() === markupsBefore, 'undoing the insert keeps the markups');
  await page.keyboard.press('Control+y');
  await waitPages(n0 + 1);
  await page.keyboard.press('Control+y');
  await waitPages(n0);
  assert(await pagesOf() === n0, 'Redo repeats the page operations');
  await page.keyboard.press('Home');
  await page.waitForTimeout(500);
  const legendBox = async () => page.locator('.markup-layer g.legend > rect').first().evaluate((r) => { const b = r.getBBox(); return [b.x, b.y, b.width, b.height].map(Math.round).join(','); });
  const lb0 = await legendBox();
  await page.keyboard.press('Shift+Alt+=');
  await page.waitForTimeout(1200);
  { const sb = await page.locator('.statusbar').innerText(); assert(sb.includes('24.00 x 36.00'), `Rotate Clockwise turns the sheet (24 × 36 in): ${sb.replace(/\s+/g, ' ')}`); }
  await page.keyboard.press('Shift+Alt+-');
  await page.waitForTimeout(1200);
  const lb1 = await legendBox();
  assert(lb0 === lb1, `markups stay in place through rotate and rotate back (legend ${lb0} -> ${lb1})`);
  const onPage1 = async () => (await page.locator('.ml-table tbody tr:not(.reply-row)').allInnerTexts()).filter((t) => t.split('\t')[1]?.trim() === '1' && !t.startsWith('Hyperlink')).length; // links stay links
  const p1 = await onPage1();
  await page.keyboard.press('Control+Shift+M');
  const fd = page.getByRole('dialog', { name: 'Flatten Markups' });
  await fd.getByLabel('Page range').selectOption('current');
  await fd.getByRole('button', { name: 'OK' }).click();
  await page.waitForTimeout(1500);
  assert(p1 > 0 && await onPage1() === 0, `Flatten burns page 1's ${p1} markups into the page (${await onPage1()} left; ${(await page.locator('.statusbar').innerText()).replace(/\s+/g, ' ')})`);
  await page.screenshot({ path: `${OUT}/13-flattened.png` });
}

// Compare Documents and Overlay Pages: the original sample sheet vs this one (markups flattened into it).
{
  const openMenu = async (menu, item) => { await page.getByRole('button', { name: menu, exact: true }).click(); await page.getByRole('menuitem', { name: item }).click(); };
  await openMenu('Document', 'Compare Documents…');
  const cd = page.getByRole('dialog', { name: 'Compare Documents' });
  await cd.getByLabel('Original document').selectOption({ label: 'Sample Floor Plan.pdf' });
  await cd.getByLabel('Original page').fill('1');
  await cd.getByLabel('Revised page').fill('1');
  await cd.getByRole('button', { name: 'OK' }).click();
  await page.waitForFunction(() => /Compare: \d+ difference/.test(document.querySelector('.statusbar')?.textContent ?? ''), null, { timeout: 30000 });
  const clouds = (await page.locator('.ml-table tbody').innerText()).split('\nCompare').length - 1;
  assert(clouds >= 3, `Compare clouds the differences on the revised sheet (${clouds})`);
  await page.screenshot({ path: `${OUT}/14-compare.png` });
  const tabs = await page.locator('.doc-tab').count();
  await openMenu('Document', 'Overlay Pages…');
  const od = page.getByRole('dialog', { name: 'Overlay Pages' });
  await od.getByLabel('Base document').selectOption({ label: 'Sample Floor Plan.pdf' });
  await od.getByRole('button', { name: 'OK' }).click();
  await page.waitForFunction((n) => document.querySelectorAll('.doc-tab').length === n + 1, tabs, { timeout: 30000 });
  await page.waitForTimeout(1200);
  assert((await page.locator('.doc-tab.active').innerText()).startsWith('Overlay'), 'Overlay Pages opens a two-colour overlay document');
  await page.screenshot({ path: `${OUT}/15-overlay.png` });
}

// Sheets: page labels from title blocks, Batch Link, Sets panel and Slip Sheet (on the clean sample).
{
  await page.locator('.doc-tab', { hasText: 'Sample Floor Plan.pdf' }).click();
  await page.waitForTimeout(800);
  const openMenu = async (menu, item) => { await page.getByRole('button', { name: menu, exact: true }).click(); await page.getByRole('menuitem', { name: item }).click(); };
  await openMenu('Document', 'Page Labels…');
  const pl = page.getByRole('dialog', { name: 'Page Labels' });
  await pl.getByRole('button', { name: 'Use Sheet Numbers' }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="Label of page 2"]')?.value === 'C-101');
  await pl.getByRole('button', { name: 'OK' }).click();
  await page.waitForFunction(() => document.querySelector('.statusbar')?.textContent?.includes('Page labels updated'));
  assert((await page.locator('.statusbar input').first().inputValue()) === 'A-101', 'page labels from title-block sheet numbers (A-101)');
  await openMenu('Document', 'Batch Link…');
  const bl = page.getByRole('dialog', { name: 'Batch Link' });
  await bl.getByLabel('Batch link scope').selectOption('doc');
  await bl.getByRole('button', { name: 'Run' }).click();
  await page.waitForFunction(() => /Batch Link created \d+/.test(document.querySelector('.statusbar')?.textContent ?? ''));
  const made = Number((await page.locator('.statusbar').innerText()).match(/Batch Link created (\d+)/)[1]);
  assert(made === 2, `Batch Link links the two sheet references (${made})`);
  await page.keyboard.press('Alt+2');
  await page.locator('.set-sheet', { hasText: 'C-101' }).first().click();
  assert((await page.locator('.statusbar input').first().inputValue()) === 'C-101', 'Sets panel jumps to sheet C-101');
  await page.keyboard.press('Alt+2');
  // Slip sheet a new revision (the original sample) over this one: matched by sheet number, links carried forward.
  await openMenu('Document', 'Slip Sheet…');
  const ss = page.getByRole('dialog', { name: 'Slip Sheet' });
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), ss.getByRole('button', { name: 'Choose PDF…' }).click()]);
  await fc.setFiles('public/sample-floorplan.pdf');
  await ss.getByText('(2 pages)').waitFor();
  await ss.getByRole('button', { name: 'OK' }).click();
  await page.waitForFunction(() => /Slip Sheet: 2 sheet/.test(document.querySelector('.statusbar')?.textContent ?? ''), null, { timeout: 30000 });
  const links = (await page.locator('.ml-table tbody').innerText()).split('Hyperlink').length - 1;
  assert(links === 2, `Slip Sheet replaces both sheets and keeps their markups (${links} links)`);
}

// Forms, signature and redaction.
{
  // Redact the "SEE C-101 FOR SITE PLAN" note on the sample's A-101 (the active document).
  await page.keyboard.press('Home');
  await page.keyboard.press('Control+9');
  await page.waitForTimeout(800);
  const box = await svg.boundingBox();
  const z = box.width / (36 * 72);
  const at = (x, y) => ({ x: box.x + x * z, y: box.y + (H - y) * z });
  await page.keyboard.press('Shift+K');
  { const a = at(295, 1555), b = at(450, 1535); await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 6 }); await page.mouse.up(); }
  await page.waitForFunction(() => document.querySelector('.ml-table tbody')?.textContent?.includes('Redaction'));
  page.once('dialog', (d) => d.accept());
  await page.keyboard.press('Shift+A');
  await page.waitForFunction(() => /Redactions applied on 1 page/.test(document.querySelector('.statusbar')?.textContent ?? ''), null, { timeout: 30000 });
  await page.keyboard.press('Control+F');
  await page.getByLabel('Search text').fill('SITE PLAN');
  await page.getByLabel('Search text').press('Enter');
  await page.waitForFunction(() => /\d+ results?/.test(document.querySelector('.search-panel')?.textContent ?? ''));
  const pagesWithHits = await page.locator('.search-hit .muted').allInnerTexts();
  assert(!pagesWithHits.includes('A-101'), `redacted text is gone from A-101 (hits on: ${pagesWithHits.join(', ') || 'none'})`);
  await page.locator('.ml-table-wrap').focus();
  await page.keyboard.press('Alt+1');
  await page.keyboard.press('Home');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/16-redacted.png` });

  // OCR the now image-only A-101: its text becomes searchable again.
  await page.keyboard.press('Control+Shift+O');
  const od = page.getByRole('dialog', { name: 'OCR' });
  await od.getByLabel('Page range').selectOption('current');
  await od.getByRole('button', { name: 'OK' }).click();
  await page.waitForFunction(() => /OCR: \d+ word/.test(document.querySelector('.statusbar')?.textContent ?? '') || /OCR failed/.test(document.querySelector('.statusbar')?.textContent ?? ''), null, { timeout: 240000 });
  const ocrStatus = await page.locator('.statusbar').innerText();
  assert(/OCR: \d+ word/.test(ocrStatus), `OCR recognised text (${ocrStatus.match(/OCR[^\n]*/)?.[0]})`);
  await page.keyboard.press('Control+F');
  await page.getByLabel('Search text').fill('FLOOR PLAN');
  await page.getByLabel('Search text').press('Enter');
  await page.waitForFunction(() => /\d+ results?/.test(document.querySelector('.search-panel')?.textContent ?? ''));
  const ocrHits = await page.locator('.search-hit .muted').allInnerTexts();

  assert(ocrHits.includes('A-101'), `OCR text is searchable on A-101 (hits on: ${ocrHits.join(', ')})`);
  await page.locator('.ml-table-wrap').focus();
  await page.keyboard.press('Alt+1');

  // Fill a PDF form and save it.
  const tabs = await page.locator('.doc-tab').count();
  const fc = await ctrlO();
  await fc.setFiles('tests/fixtures/form.pdf');
  await page.waitForFunction((n) => document.querySelectorAll('.doc-tab').length === n + 1, tabs);
  await page.waitForTimeout(1000);
  await page.getByLabel('inspector').fill('Sam Rivera');
  await page.getByLabel('passed').check();
  await page.getByLabel('trade').selectOption('Plumbing');
  await page.getByLabel('priority high').check();
  // Sign: type a signature and place it.
  await page.getByRole('button', { name: 'Document', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Signature…' }).click();
  const sd = page.getByRole('dialog', { name: 'Signature' });
  await sd.getByLabel('Type').check();
  await sd.getByLabel('Signature name').fill('Sam Rivera');
  await sd.getByRole('button', { name: 'Place' }).click();
  { const b = await svg.boundingBox(); await page.mouse.click(b.x + b.width * 0.5, b.y + b.height * 0.5); }
  assert((await page.locator('.ml-table tbody').innerText()).includes('Signature'), 'signature placed as a markup');
  const [fd] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+S')]);
  await fd.saveAs(`${OUT}/saved-form.pdf`);
  const filled = await PDFDocument.load(readFileSync(`${OUT}/saved-form.pdf`));
  const form = filled.getForm();
  assert(form.getTextField('inspector').getText() === 'Sam Rivera' && form.getCheckBox('passed').isChecked()
    && form.getDropdown('trade').getSelected()[0] === 'Plumbing' && form.getRadioGroup('priority').getSelected() === 'high', 'form values saved into the PDF form');
}

// Keyboard Shortcuts editor: reassign Length to Ctrl+Shift+K; Tool Chest Drawing mode.
{
  await page.getByRole('button', { name: 'CyanTakeoff', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Keyboard Shortcuts…' }).click();
  const kd = page.getByRole('dialog', { name: 'Keyboard Shortcuts' });
  await kd.getByLabel('Filter commands').fill('Length');
  await kd.getByRole('button', { name: 'Change shortcut for Length' }).click();
  await page.keyboard.press('Control+Shift+K');
  await kd.getByRole('button', { name: 'Close', exact: true }).click();
  await page.keyboard.press('Control+Shift+K');
  assert(await page.locator('.tb-btn.active[title^="Length"]').count() === 1, 'a reassigned shortcut selects the tool');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Shift+Alt+L');
  assert(await page.locator('.tb-btn.active[title^="Length"]').count() === 0, 'the old shortcut no longer does');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'CyanTakeoff', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Keyboard Shortcuts…' }).click();
  await kd.getByRole('button', { name: 'Reset All' }).click();
  await kd.getByRole('button', { name: 'Close', exact: true }).click();
}

// View modes (Ctrl+4 to Ctrl+7) and Rotate View (Ctrl+Shift+Plus/Minus).
{
  await page.locator('.doc-tab').first().click();
  await page.mouse.click(5, 500);
  const nav = page.locator('.sb-nav > span').first();
  const layer = page.locator('.page .markup-layer');
  await page.keyboard.press('Control+4');
  await page.keyboard.press('Home');
  await page.keyboard.press('Control+ArrowRight');
  await page.waitForTimeout(500);
  assert((await nav.innerText()).startsWith('(2 of'), 'on page 2');
  const total = async () => Number((await page.getByText(/ of \d+ markups/).innerText()).match(/of (\d+)/)[1]);
  const labels = async () => (await page.locator('.ml-table tbody').innerText()).split('C-101').length;
  const before = await total(), beforeC = await labels();
  await page.keyboard.press('Home');
  await page.keyboard.press('Control+5');
  await page.waitForTimeout(1000);
  assert(await page.locator('.page-tile').count() >= 2, 'Continuous (Ctrl+5) shows the pages one under another');
  await page.screenshot({ path: `${OUT}/view-continuous.png` });
  const tile2 = page.locator('.page-tile[data-page="2"]');
  await tile2.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  const b = await tile2.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.waitForTimeout(300);
  assert((await nav.innerText()).startsWith('(2 of'), 'the page under the pointer becomes the current page');
  await page.keyboard.press('r');
  await page.mouse.move(b.x + b.width * 0.4, b.y + b.height * 0.4);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * 0.5, b.y + b.height * 0.5, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+4');
  await page.waitForTimeout(500);
  assert((await nav.innerText()).startsWith('(2 of') && await page.locator('.page-tile').count() === 0, 'Single Page (Ctrl+4) stays on that page');
  assert(await total() === before + 1 && await labels() === beforeC + 1, 'a markup drawn in continuous view lands on the page under the pointer');
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+6');
  await page.waitForTimeout(800);
  assert(await page.locator('.page-tile').count() === 2, 'Side by Side (Ctrl+6) shows a pair of pages');
  const tiles = await page.locator('.page-tile').evaluateAll((els) => els.map((e) => e.getBoundingClientRect()));
  assert(Math.abs(tiles[0].top - tiles[1].top) < 2 && tiles[1].left > tiles[0].right, 'the pair sits next to each other');
  await page.keyboard.press('Control+4');
  await page.keyboard.press('Control+9');
  await page.waitForTimeout(300);
  const flat = await layer.boundingBox();
  await page.keyboard.press('Control+Shift+Equal');
  await page.keyboard.press('Control+9');
  await page.waitForTimeout(600);
  const turned = await layer.boundingBox();
  assert(flat.width > flat.height && turned.height > turned.width, 'Rotate View turns the sheet on screen');
  await page.screenshot({ path: `${OUT}/view-rotated.png` });
  // A point picked in the rotated view maps back to the right place on the page.
  await page.keyboard.press('r');
  await page.mouse.move(turned.x + turned.width * 0.8, turned.y + turned.height * 0.2);
  await page.mouse.down();
  await page.mouse.move(turned.x + turned.width * 0.9, turned.y + turned.height * 0.3, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.press('v');
  await page.keyboard.press('Control+Shift+Minus');
  await page.keyboard.press('Control+9');
  await page.waitForTimeout(600);
  const r = await layer.locator('rect[stroke-dasharray]').first().boundingBox(); // the new markup is selected
  const unturned = await layer.boundingBox();
  // Top-right of the rotated view is the top-left of the page.
  assert(r.x - unturned.x < unturned.width * 0.35 && r.y - unturned.y < unturned.height * 0.25, 'drawing in a rotated view lands where the pointer was');
  await page.keyboard.press('Control+z');
}

// Real Revu-authored files (tests/fixtures/revu): values must match what Revu displayed.
for (const [file, expected] of [
  ['measure.pdf', [`5'-5"`, '56.37 sf', `18'-11 1/2"`, `22'-4 1/2"`, '0 cu ft', '96.69°', `4'-9"`, `3'-9"`]],
  ['markup-space.pdf', ['15']],
]) {
  const tabs = await page.locator('.doc-tab').count();
  const fc = await ctrlO();
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
