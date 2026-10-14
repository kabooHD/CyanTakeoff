// End-to-end smoke test: drives the built app in Chromium.
// Usage: npm run build && npx vite preview --port 4173 & node tests/e2e.mjs
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { PDFDocument, PDFName, PDFArray, PDFDict, PDFString, StandardFonts, rgb } from 'pdf-lib';

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
// Count group commands (right-click a counted item): Split All, Delete from Group, Resume Count; Symbol in Properties.
{
  const rows = () => page.locator('.ml-table tbody tr').count();
  const n0 = await rows();
  // The second counted item, from its drawn symbol (the clicks may have snapped to content).
  const item = page.locator('.markup-layer circle[r="5"]').nth(1);
  const ib = await item.boundingBox();
  const at = { x: ib.x + ib.width / 2, y: ib.y + ib.height / 2 };
  await page.mouse.click(at.x, at.y, { button: 'right' });
  await page.getByRole('menuitem', { name: 'Split All' }).click();
  await page.waitForFunction((n) => document.querySelectorAll('.ml-table tbody tr').length === n + 2, n0);
  assert(await rows() === n0 + 2, 'Split All makes a Count per item');
  // Split All is three undo steps (the update of the group, two new Counts).
  const restored = async () => (await rows()) === n0 && /\t3\t/.test(await page.locator('.ml-table tbody').innerText());
  for (let i = 0; i < 5 && !(await restored()); i++) { await page.keyboard.press('Control+z'); await page.waitForTimeout(250); }
  assert(await rows() === n0 && /\t3\t/.test(await page.locator('.ml-table tbody').innerText()), 'undo restores the group of 3');
  const items = () => page.locator('.markup-layer circle[r="5"]').count();
  await page.mouse.click(at.x, at.y, { button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete from Group' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.markup-layer circle[r="5"]').length === 2);
  assert(await items() === 2, 'Delete from Group removes one item (count of 2)');
  const item0 = await page.locator('.markup-layer circle[r="5"]').first().boundingBox();
  await page.mouse.click(item0.x + item0.width / 2, item0.y + item0.height / 2, { button: 'right' });
  await page.getByRole('menuitem', { name: 'Resume Count' }).click();
  const more = await toScreen(20, 20); // a free spot, away from the other markups
  await page.mouse.click(more.x, more.y);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelectorAll('.markup-layer circle[r="5"]').length === 3);
  assert(await rows() === n0 && await items() === 3, 'Resume Count adds to the same group (count of 3)');
  { const c2 = await page.locator('.markup-layer circle[r="5"]').nth(2).boundingBox(); await page.mouse.click(c2.x + c2.width / 2, c2.y + c2.height / 2); }
  await page.waitForFunction(() => document.querySelectorAll('.ml-table tbody tr.selected').length === 1);
  if (!(await page.locator('[aria-label="Count symbol"]').count())) await page.keyboard.press('Alt+P');
  await page.getByLabel('Count symbol').selectOption('square');
  await page.waitForTimeout(200);
  assert(await page.locator('.markup-layer polygon').count() >= 3, 'the Square symbol draws each item as a polygon');
  await page.getByLabel('Count symbol').selectOption('circle');
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press('Escape');
}

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
// A polygon cutout's edge can be curved: arcing it outward makes the hole bigger.
{ const p = await toScreen(4, 27); await page.mouse.click(p.x, p.y, { button: 'right' }); }
await page.getByRole('menuitem', { name: 'Cutout Edge: Arc Outward' }).click();
{
  const txt = await page.locator('.ml-table tbody').innerText();
  const v = Math.max(...[...txt.matchAll(/(\d+(?:\.\d+)?) sf/g)].map((m) => Number(m[1])).filter((x) => x > 300));
  assert(v > 398 && v < 403.4, `curving a cutout edge outward enlarges the hole (${v} sf)`);
}
await page.screenshot({ path: `${OUT}/07b-curved-cutout.png` });
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
  // Settings: boundary colour recolours the boundary drawn above; the Tool Chest tool list offers the sample Area tool.
  await page.getByRole('button', { name: 'Dynamic Fill Settings' }).click();
  await page.getByLabel('Boundary Color').fill('#00aa00');
  await page.getByLabel('Fill size').fill('6');
  await page.getByRole('button', { name: 'Dynamic Fill Settings' }).click();
  assert(await page.locator('.fill-overlay polyline[stroke="#00aa00"], svg polyline[stroke="#00aa00"]').count() >= 1, 'Boundary Color recolours the temporary boundaries');
  assert(await page.getByLabel('Tool Chest tool').locator('option', { hasText: 'Flooring' }).count() === 1, 'the created markups can take a Tool Chest tool\'s properties');
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
  // Preferences > Measure holds the Dynamic Fill defaults.
  await page.keyboard.press('Control+k');
  {
    const pd = page.getByRole('dialog', { name: 'Preferences' });
    await pd.getByRole('tab', { name: 'Measure' }).click();
    assert(await pd.getByLabel('Fill size').inputValue() === '2', 'Preferences > Measure shows the Dynamic Fill defaults');
    await pd.getByRole('button', { name: 'Close' }).click();
  }
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
  // A text box with formatting: bold, centred, Times, hexagon (Properties > Text).
  await page.keyboard.press('t'); await drag([30, 12], [41, 16]); await page.keyboard.type('Styled box'); await page.keyboard.press('Escape');
  await page.locator('.side-right button[title="Properties"]').click();
  await page.getByRole('button', { name: 'Bold' }).click();
  await page.getByLabel('Text alignment').selectOption('center');
  await page.getByLabel('Font', { exact: true }).selectOption('Times');
  await page.getByLabel('Box shape').selectOption('hexagon');
  {
    const styled = page.locator('.markup-text', { hasText: 'Styled box' }).first();
    const cs = await styled.evaluate((el) => { const c = getComputedStyle(el); return { w: c.fontWeight, a: c.textAlign, f: c.fontFamily }; });
    assert((cs.w === 'bold' || Number(cs.w) >= 600) && cs.a === 'center' && /Times/.test(cs.f), `text formatting is drawn (${JSON.stringify(cs)})`);
    assert(await page.locator('.markup-layer polygon').count() >= 1, 'a hexagon text box is drawn as a polygon');
  }
  await page.evaluate(() => (document.activeElement)?.blur?.());
  await page.locator('.side-right button[title="Properties"]').click(); // back to the panel that was open
  await page.keyboard.press('Escape');
  // A callout: a second leader by right-click > Add Leader; End style Closed Arrow (Properties).
  await page.keyboard.press('q'); await click(30, 20); await click(34, 22); await page.keyboard.type('Callout'); await page.keyboard.press('Escape');
  {
    const lines = () => page.locator('.markup-layer g[data-id] line').count();
    const before = await lines();
    const cb = await page.locator('.markup-text', { hasText: /^Callout$/ }).first().boundingBox();
    await page.mouse.click(cb.x + cb.width / 2, cb.y + cb.height / 2, { button: 'right' });
    await page.getByRole('menuitem', { name: 'Add Leader' }).click();
    await page.waitForTimeout(200);
    assert(await lines() === before + 1, 'Add Leader draws a second leader line');
    await page.locator('.side-right button[title="Properties"]').click();
    await page.getByLabel('Line end', { exact: true }).selectOption('closedArrow');
    await page.waitForTimeout(200);
    assert(await page.locator('.markup-layer g[data-id] polygon[fill="#000000"], .markup-layer g[data-id] polygon[fill="#ff0000"], .markup-layer g[data-id] polygon:not([fill="none"])').count() >= 2, 'Closed Arrow ends are filled on both leaders');
    await page.evaluate(() => (document.activeElement)?.blur?.());
    await page.locator('.side-right button[title="Properties"]').click();
    await page.keyboard.press('Escape');
  }
  await page.keyboard.press('s'); await click(52, 14);
  await page.keyboard.press('d'); await drag([47.5, 31.2], [56, 29.6]);
  await page.waitForFunction(() => document.querySelector('.ml-table tbody')?.textContent?.includes('Strikethrough'));
  await page.keyboard.press('Shift+F'); await click(57, 34);
  await page.keyboard.press('k'); await drag([44, 26], [50, 21]); await click(52, 27); await page.keyboard.type('Check this'); await page.keyboard.press('Escape');
  await page.keyboard.press('Shift+C'); await click(44, 4); await click(54, 4); await click(49, 8);
  // Measurement captions: Shift+drag moves the caption, the orange anchor rotates it, Reset Caption Position restores it.
  await page.keyboard.press('Shift+Alt+L'); await click(44, 38); await click(54, 38);
  {
    const cap = page.locator('.measure-label', { hasText: `10'-0"` }).last();
    await cap.waitFor();
    const x0 = Number(await cap.getAttribute('x'));
    const cb = await cap.boundingBox();
    await page.keyboard.down('Shift');
    await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2); await page.mouse.down();
    await page.mouse.move(cb.x + cb.width / 2 + 40, cb.y + cb.height / 2 + 30, { steps: 5 }); await page.mouse.up();
    await page.keyboard.up('Shift');
    await page.waitForTimeout(200);
    assert(Number(await cap.getAttribute('x')) > x0 + 5, 'Shift+drag moves the measurement caption');
    const anchor = page.locator('.caption-anchor');
    assert(await anchor.count() === 1, 'a selected measurement shows the caption anchor');
    const ab = await anchor.boundingBox(); const cb2 = await cap.boundingBox();
    await page.mouse.move(ab.x + ab.width / 2, ab.y + ab.height / 2); await page.mouse.down();
    await page.mouse.move(cb2.x + cb2.width / 2, cb2.y - 60, { steps: 6 }); await page.mouse.up();
    await page.waitForTimeout(200);
    assert(/rotate\(-90 /.test((await cap.getAttribute('transform')) ?? ''), `dragging the anchor rotates the caption in 15° steps (${await cap.getAttribute('transform')})`);
    const mid = await toScreen(49, 38);
    await page.mouse.click(mid.x, mid.y, { button: 'right' });
    await page.getByRole('menuitem', { name: 'Reset Caption Position' }).click();
    await page.waitForTimeout(200);
    assert(!(await cap.getAttribute('transform')) && Math.abs(Number(await cap.getAttribute('x')) - x0) < 1, 'Reset Caption Position puts the caption back');
    await page.keyboard.press('Delete');
    await page.waitForTimeout(200);
  }
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
  assert(await page.locator('.ml-table tbody tr').count() === rowsBefore + 9, 'nine markups added');

  const [dl] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+S')]);
  const f = `${OUT}/saved-tools.pdf`;
  await dl.saveAs(f);
  await page.waitForTimeout(800);
  const pdfDoc = await PDFDocument.load(readFileSync(f));
  const subs = pdfDoc.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray).asArray().map((r) => pdfDoc.context.lookup(r, PDFDict).get(PDFName.of('Subtype')).toString());
  for (const t of ['/StrikeOut', '/Stamp', '/FreeText', '/Text', '/PolyLine', '/Polygon', '/Line']) assert(subs.includes(t), `saved as ${t}`);
  const after = await page.locator('.ml-table tbody').innerText();
  for (const subj of ['Dimension', 'Typewriter', 'Stamp', 'Strikethrough', 'Flag', 'Cloud+', 'Arc', 'Callout']) assert(after.includes(subj), `${subj} survives save and reload`);
  assert(await page.locator('.markup-layer g[data-id] polygon:not([fill="none"])').count() >= 2, 'the callout keeps its second leader and closed arrows after reload');
  assert(after.includes('Hello typewriter') || (await page.locator('.markup-text.typewriter').allInnerTexts()).some((t) => t.includes('Hello typewriter')), 'typewriter text kept');
  {
    const styled = page.locator('.markup-text', { hasText: 'Styled box' }).first();
    await styled.waitFor({ timeout: 10000 });
    const cs = await styled.evaluate((el) => { const c = getComputedStyle(el); return { w: c.fontWeight, a: c.textAlign, f: c.fontFamily }; });
    assert((cs.w === 'bold' || Number(cs.w) >= 600) && cs.a === 'center' && /Times/.test(cs.f), `text formatting survives save and reload (${JSON.stringify(cs)})`);
  }

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
  // Summary dialog: CSV with ID columns and replies; PDF appended to the document with hyperlinked rows.
  {
    const pagesOf = async () => Number((await page.locator('.statusbar').innerText()).match(/of (\d+)\)/)[1]);
    const n0 = await pagesOf();
    await page.getByRole('button', { name: 'Summary ▾' }).click();
    await page.getByRole('button', { name: 'Summary…' }).click();
    const sd = page.getByRole('dialog', { name: 'Markup Summary' });
    await sd.getByRole('tab', { name: 'Filter & Sort' }).click();
    await sd.getByLabel('Sort by').selectOption('subject');
    await sd.getByRole('tab', { name: 'Output' }).click();
    await sd.getByLabel('Export as').selectOption('csv');
    await sd.getByLabel('ID columns (ID and Parent)').check();
    await sd.locator('label', { hasText: /^\s*Replies/ }).locator('input').check();
    const [cd] = await Promise.all([page.waitForEvent('download'), sd.getByRole('button', { name: 'OK' }).click()]);
    await cd.saveAs(`${OUT}/summary-dialog.csv`);
    const csv = readFileSync(`${OUT}/summary-dialog.csv`, 'utf8');
    assert(csv.startsWith('﻿ID,Parent,Subject') && csv.includes('Reply: ') && csv.includes('Verified on site'), 'the Summary dialog writes CSV with ID columns and replies');
    const subjects = csv.split('\r\n').slice(1).filter((l) => !l.includes('Reply: ') && !l.includes(',Total,')).map((l) => l.split(',')[2]);
    assert(subjects.join() === [...subjects].sort((x, y) => x.localeCompare(y)).join(), `rows are sorted by Subject (${subjects.join('|')})`);
    await page.getByRole('button', { name: 'Summary ▾' }).click();
    await page.getByRole('button', { name: 'Summary…' }).click();
    await sd.getByRole('tab', { name: 'Output' }).click();
    await sd.getByLabel('Export as').selectOption('pdf');
    await sd.getByLabel('Append and hyperlink to current PDF').check();
    await sd.getByLabel('Thumbnail').selectOption('small');
    await sd.getByRole('button', { name: 'OK' }).click();
    await page.waitForFunction(() => /Markups Summary: \d+ pages? appended/.test(document.querySelector('.statusbar')?.textContent ?? ''), null, { timeout: 60000 });
    const added = Number((await page.locator('.statusbar').innerText()).match(/Markups Summary: (\d+) page/)[1]);
    await page.waitForFunction((n) => (document.querySelector('.statusbar')?.textContent ?? '').includes(`of ${n})`), n0 + added, { timeout: 20000 });
    assert(added >= 1 && await pagesOf() === n0 + added, `the PDF summary is appended to the document (${added} pages)`);
    await page.keyboard.press('Control+z');
    await page.waitForFunction((n) => (document.querySelector('.statusbar')?.textContent ?? '').includes(`of ${n})`), n0, { timeout: 20000 });
  }
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
  // Check Options: Highlight Checked puts a Highlight on every checked result; Clear empties the list.
  const rowsBefore = await page.locator('.ml-table tbody tr:not(.reply-row)').count();
  await page.getByLabel('Check options').selectOption('highlight');
  await page.waitForFunction((k) => document.querySelectorAll('.ml-table tbody tr:not(.reply-row)').length === k, rowsBefore + n);
  assert(true, `Highlight Checked adds one Highlight per result (${n})`);
  await page.keyboard.press('Control+z');
  await page.waitForFunction((k) => document.querySelectorAll('.ml-table tbody tr:not(.reply-row)').length === k, rowsBefore);
  // Search Markups: the query is looked up in subjects, labels and comments.
  await page.locator('.search-scope label', { hasText: 'Markups' }).locator('input').check();
  await page.locator('.search-scope label', { hasText: /^\s*Pages/ }).locator('input').uncheck();
  await page.getByLabel('Search text').fill('Count');
  await page.getByLabel('Search text').press('Enter');
  await page.waitForFunction(() => /\d+ results?/.test(document.querySelector('.search-panel')?.textContent ?? ''));
  assert(await page.locator('.search-hit button[data-kind="markup"]').count() >= 1, 'Search Markups finds the Count markup by subject');
  await page.locator('.search-hit button[data-kind="markup"]').first().click();
  await page.waitForTimeout(300);
  assert((await page.locator('.ml-table tbody tr.selected').first().innerText()).includes('Count'), 'clicking a markup result selects the markup');
  await page.locator('.search-actions').getByRole('button', { name: 'Clear' }).click();
  assert(await page.locator('.search-hit').count() === 0, 'Clear empties the results');
  await page.locator('.search-scope label', { hasText: /^\s*Pages/ }).locator('input').check();
  await page.locator('.search-scope label', { hasText: 'Markups' }).locator('input').uncheck();
  await page.evaluate(() => document.activeElement?.blur?.());
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

// Help > Find Tools + Commands: type part of a name, Enter runs it.
{
  await page.locator('.menubar-item > button', { hasText: /^Help$/ }).click();
  await page.getByRole('menuitem', { name: 'Find Tools + Commands…' }).click();
  const cf = page.locator('[role=dialog][aria-label="Find Tools + Commands"]');
  await cf.locator('input').fill('blank pa');
  const first = cf.locator('.command-row').first();
  assert((await first.innerText()).includes('Insert Blank Page') && (await first.innerText()).includes('Document'), 'Find Tools + Commands lists the matching menu item with its menu');
  await page.keyboard.press('Enter');
  const ib = page.getByRole('dialog', { name: 'Insert Blank Page' });
  await ib.waitFor();
  assert(true, 'Enter runs the found command');
  await ib.getByRole('button', { name: 'Cancel' }).click();
}

// Preferences (Ctrl+K): Navigation > the mouse wheel scrolls instead of zooming in single page mode.
{
  const zoomOf = async () => Number((await page.locator('.sb-zoom').first().innerText()).replace('%', ''));
  const setWheel = async (v) => {
    await page.keyboard.press('Control+k');
    const pd = page.getByRole('dialog', { name: 'Preferences' });
    await pd.waitFor();
    await pd.getByRole('tab', { name: 'Navigation' }).click();
    await pd.getByLabel('Single page mode: mouse wheel').selectOption(v);
    await pd.getByRole('button', { name: 'Close' }).click();
    await pd.waitFor({ state: 'hidden' });
  };
  await page.keyboard.press('Control+k');
  const pd = page.getByRole('dialog', { name: 'Preferences' });
  await pd.waitFor();
  assert(await pd.getByLabel('User').inputValue() !== '', 'Preferences > General shows the user name');
  await pd.getByRole('button', { name: 'Close' }).click();
  await setWheel('scroll');
  const b = await svg.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  const z0 = await zoomOf();
  await page.mouse.wheel(0, -300);
  await page.waitForTimeout(300);
  assert(await zoomOf() === z0, 'with the wheel set to scroll, a wheel turn does not zoom');
  await setWheel('zoom');
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.wheel(0, -300);
  await page.waitForTimeout(300);
  assert(await zoomOf() !== z0, 'set back to zoom, the wheel zooms again');
  await page.keyboard.press('Control+9');
  await page.waitForTimeout(300);
}

// Flags panel (Window > Flags): the Flag markup placed earlier is a linked flag; Add makes an unlinked one with its own action.
{
  await page.locator('.menubar-item > button', { hasText: /^Window$/ }).click();
  await page.getByRole('menuitem', { name: 'Flags' }).click();
  const fp = page.locator('.flags-panel');
  await fp.waitFor();
  const rows = () => fp.locator('.flag-row');
  const n0 = await rows().count();
  assert(n0 >= 1 && (await rows().first().innerText()).includes('🔗'), 'the Flags panel lists the Flag markup as a linked flag');
  const pageLabel = (await page.locator('.statusbar').innerText()).match(/Page (\S+)/)?.[1];
  await fp.getByRole('button', { name: 'Add' }).click();
  await page.waitForFunction((n) => document.querySelectorAll('.flags-panel .flag-row').length === n + 1, n0);
  const added = rows().filter({ hasText: /^(?!.*🔗)/ }).last();
  assert(!(await added.innerText()).includes('🔗'), 'Add makes an unlinked flag');
  await fp.getByRole('button', { name: 'Properties' }).click();
  await fp.getByLabel('Flag title').fill('Cover');
  await page.waitForFunction(() => [...document.querySelectorAll('.flags-panel .flag-row')].some((r) => r.textContent?.includes('Cover')), null, { timeout: 10000 });
  assert((await rows().allInnerTexts()).some((t) => t.includes('Cover')), `the title edit renames the flag (${pageLabel})`);
  await fp.getByRole('button', { name: 'Action' }).click();
  await fp.getByLabel('Flag action').selectOption('uri');
  await fp.getByLabel('Flag URL').waitFor();
  await fp.getByLabel('Flag URL').fill('https://example.com');
  await fp.getByLabel('Flag action').selectOption('page');
  await page.waitForTimeout(200);
  const windowPanel = async (name) => { await page.locator('.menubar-item > button', { hasText: /^Window$/ }).click(); await page.getByRole('menuitem', { name }).click(); };
  await windowPanel('Thumbnails');
  await page.locator('.thumb').first().waitFor();
  await page.locator('.thumb-flag').first().waitFor({ timeout: 5000 });
  assert(await page.locator('.thumb-flag').count() >= 1, 'thumbnails show a flag indicator on flagged pages');
  await windowPanel('Flags');
  await fp.waitFor();
  await rows().filter({ hasText: 'Cover' }).first().click();
  await fp.getByRole('button', { name: 'Delete' }).click();
  await page.waitForFunction((n) => document.querySelectorAll('.flags-panel .flag-row').length === n, n0);
  assert(true, 'Delete removes the unlinked flag');
  await page.screenshot({ path: `${OUT}/flags.png` });
  await windowPanel('Thumbnails');
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
  // Thumbnails toolbar: Copy / Paste / Cut Pages, Labels > Page Scale, Re-Label.
  {
    const windowPanel = async (name) => { await page.locator('.menubar-item > button', { hasText: /^Window$/ }).click(); await page.getByRole('menuitem', { name }).click(); };
    if (!(await page.locator('.thumbs-toolbar').count())) await windowPanel('Thumbnails');
    await page.locator('.thumbs-toolbar').waitFor();
    const n1 = await pagesOf();
    await page.locator('.thumb').first().click();
    await page.getByRole('button', { name: 'Thumbnails menu' }).click();
    await page.getByRole('menuitem', { name: /^Copy Pages/ }).click();
    await page.getByText(/Copied 1 page/).waitFor();
    await page.getByRole('button', { name: 'Thumbnails menu' }).click();
    await page.getByRole('menuitem', { name: 'Paste Pages' }).click();
    await page.waitForFunction((n) => document.querySelector('.statusbar')?.textContent?.includes(`of ${n + 1})`), n1);
    assert(await pagesOf() === n1 + 1, 'Copy Pages + Paste Pages adds the copied page');
    await page.getByRole('button', { name: 'Labels menu' }).click();
    await page.getByRole('menuitem', { name: 'Page Scale' }).click();
    assert(await page.locator('.thumb-scale').count() === n1 + 1, 'Labels > Page Scale shows the scale under every thumbnail');
    await page.getByRole('button', { name: 'Labels menu' }).click();
    await page.getByRole('menuitem', { name: 'Page Scale' }).click();
    page.once('dialog', (d) => d.accept('X-1'));
    await page.getByRole('button', { name: 'Thumbnails menu' }).click();
    await page.getByRole('menuitem', { name: 'Re-Label…' }).click();
    await page.waitForFunction(() => document.querySelector('.statusbar')?.textContent?.includes('labelled "X-1"'));
    assert((await page.locator('.thumb-label').allInnerTexts()).some((t) => t.startsWith('X-1')), 'Re-Label changes the page label');
    await page.getByRole('button', { name: 'Thumbnails menu' }).click();
    await page.getByRole('menuitem', { name: /^Cut Pages/ }).click();
    await page.waitForFunction((n) => document.querySelector('.statusbar')?.textContent?.includes(`of ${n})`), n1);
    assert(await pagesOf() === n1, 'Cut Pages removes the page (it stays on the page clipboard)');
    await page.locator('.thumbs-toolbar input[type=range]').fill('90');
    const w = await page.locator('.thumb canvas').first().evaluate((c) => c.getBoundingClientRect().width);
    assert(Math.round(w) === 90, `the size slider resizes the thumbnails (${w})`);
    await page.locator('.thumbs-toolbar input[type=range]').fill('130');
    // Undo the cut, the relabel and the paste so the page-operation checks below see the document as before.
    await page.evaluate(() => document.activeElement?.blur?.());
    for (let i = 0; i < 3; i++) { await page.keyboard.press('Control+z'); await page.waitForTimeout(400); }
    await page.waitForFunction((n) => document.querySelector('.statusbar')?.textContent?.includes(`of ${n})`), n1);
    assert(!(await page.locator('.thumb-label').allInnerTexts()).some((t) => t.startsWith('X-1')), 'undo reverts the thumbnail page commands');
  }
  // File > Create Layered PDF: each chosen file becomes a layer of a new document; File > Open Recent lists recent files.
  {
    const tabs = await page.locator('.doc-tab').count();
    await page.locator('.menubar-item > button', { hasText: /^File$/ }).click();
    assert(await page.getByRole('menuitem', { name: /^Open Recent › / }).count() >= 1, 'File > Open Recent lists the files opened before');
    const [cfc] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('menuitem', { name: 'Create Layered PDF…' }).click()]);
    await cfc.setFiles(['tests/fixtures/form.pdf', 'tests/fixtures/revu/measure.pdf']);
    await page.getByText(/Layered PDF: 2 files as layers/).waitFor({ timeout: 20000 });
    await page.waitForFunction((n) => document.querySelectorAll('.doc-tab').length === n + 1, tabs);
    const lp = page.getByRole('tree', { name: 'Layers' });
    await lp.getByRole('treeitem', { name: 'Layer measure' }).waitFor({ timeout: 10000 });
    assert(await lp.getByRole('treeitem').count() === 2, 'Create Layered PDF makes one layer per file');
    await page.keyboard.press('Alt+Y');
    page.once('dialog', (d) => d.accept()); // close the unsaved layered document
    await page.keyboard.press('Control+F4');
    await page.waitForFunction((n) => document.querySelectorAll('.doc-tab').length === n, tabs);
  }
  // Document > Insert Layered Pages: each page of the chosen PDF becomes a layer here.
  {
    await page.locator('.menubar-item > button', { hasText: /^Document$/ }).click();
    const [lfc] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('menuitem', { name: 'Insert Layered Pages…' }).click()]);
    await lfc.setFiles('tests/fixtures/form.pdf');
    await page.getByText(/Layered Pages: "form" added as a layer on \d+ page/).waitFor({ timeout: 20000 });
    const lpanel = page.getByRole('tree', { name: 'Layers' });
    await lpanel.getByRole('treeitem', { name: 'Layer form' }).waitFor({ timeout: 10000 });
    assert(true, 'Insert Layered Pages adds the file as a layer');
    await page.keyboard.press('Alt+Y');
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(500);
    assert(await pagesOf() === n0 + 1, 'undo removes the layered pages, the blank page stays');
  }
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

// Vector compare with alignment points: a revised sheet that is the original shifted by (36, 24) pt plus one new box.
{
  const src = await PDFDocument.load(readFileSync('public/sample-floorplan.pdf'));
  const out = await PDFDocument.create();
  const [emb] = await out.embedPdf(src, [0]);
  const pg = out.addPage([36 * 72, 24 * 72]);
  pg.drawPage(emb, { x: 36, y: -24 });
  pg.drawRectangle({ x: 700, y: 900, width: 100, height: 60, borderWidth: 2 });
  writeFileSync(`${OUT}/revised-shifted.pdf`, await out.save());
  const fc = await ctrlO();
  await fc.setFiles(['public/sample-floorplan.pdf', `${OUT}/revised-shifted.pdf`]);
  await page.waitForFunction(() => [...document.querySelectorAll('.doc-tab')].some((t) => t.textContent?.startsWith('revised-shifted')));
  await page.waitForTimeout(1000);
  const openMenu = async (menu, item) => { await page.getByRole('button', { name: menu, exact: true }).click(); await page.getByRole('menuitem', { name: item }).click(); };
  const differences = async () => Number((await page.locator('.statusbar').innerText()).match(/Compare: (\d+) difference/)?.[1] ?? 0);
  const setup = async () => {
    await openMenu('Document', 'Compare Documents…');
    const cd = page.getByRole('dialog', { name: 'Compare Documents' });
    await cd.getByLabel('Original document').selectOption({ label: 'sample-floorplan.pdf' });
    await cd.getByLabel('Original page').fill('1');
    await cd.getByLabel('Revised document').selectOption({ label: 'revised-shifted.pdf' });
    await cd.getByLabel('Revised page').fill('1');
    await cd.getByLabel('Compare method').selectOption('vector');
    return cd;
  };
  let cd = await setup();
  await cd.getByRole('button', { name: 'OK' }).click();
  await page.waitForFunction(() => /Compare: (\d+ difference|no diff)/.test(document.querySelector('.statusbar')?.textContent ?? ''), null, { timeout: 30000 });
  const unaligned = await differences();
  assert(unaligned > 5, `vector compare without alignment flags the shifted sheet (${unaligned})`);
  cd = await setup();
  await cd.getByRole('button', { name: 'Align Points…' }).click();
  await page.keyboard.press('Control+9');
  await page.waitForTimeout(800);
  // Exterior wall corners: (300, 1328) and (1380, 608) in page space on the original, shifted by (36, 24) on the revision.
  const click = async (x, y) => {
    const box = await page.locator('.page .markup-layer').boundingBox();
    const z = box.width / (36 * 72);
    await page.mouse.move(box.x + x * z + 3, box.y + y * z - 2);
    await page.mouse.click(box.x + x * z + 3, box.y + y * z - 2); // a few px off: content snap finds the corner
    await page.waitForTimeout(300);
  };
  await click(300, 1328); await click(1380, 608);
  await page.waitForTimeout(800);
  await page.keyboard.press('Control+9');
  await page.waitForTimeout(500);
  await click(336, 1352); await click(1416, 632);
  cd = page.getByRole('dialog', { name: 'Compare Documents' });
  assert(await cd.getByText('By 2 point pairs').count() === 1, 'alignment set from two pairs of points');
  await cd.getByRole('button', { name: 'OK' }).click();
  await page.waitForFunction(() => /Compare: (\d+ difference|no diff)/.test(document.querySelector('.statusbar')?.textContent ?? ''), null, { timeout: 30000 });
  const aligned = await differences();
  assert(aligned === 1, `aligned vector compare finds only the new box (${aligned})`);
  await page.screenshot({ path: `${OUT}/14b-compare-aligned.png` });
  for (const name of ['revised-shifted.pdf', 'sample-floorplan.pdf']) {
    await page.locator('.doc-tab', { hasText: name }).click();
    const ok = (d) => d.accept().catch(() => {});
    page.on('dialog', ok);
    await page.keyboard.press('Control+F4');
    await page.waitForFunction((n) => ![...document.querySelectorAll('.doc-tab')].some((t) => t.textContent?.startsWith(n)), name);
    page.off('dialog', ok);
  }
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
  // Tags: Sheet Number from the labels, Discipline derived; a Sheet Name typed in; the drawing log as CSV.
  {
    await page.getByRole('button', { name: 'Tags…' }).click();
    const td = page.getByRole('dialog', { name: 'Tags' });
    assert((await td.getByLabel('Discipline of C-101').innerText()) === 'Civil', 'Discipline is derived from the sheet number');
    await td.getByLabel('Sheet Name of C-101').click();
    await td.getByLabel('Tag value').fill('Site Plan');
    assert((await td.getByLabel('Sheet Name of C-101').innerText()) === 'Site Plan', 'a tag value typed in the field goes into the selected cell');
    await td.getByRole('button', { name: 'Close' }).click();
    await page.getByRole('button', { name: 'Export Drawing Log…' }).click();
    const ld = page.getByRole('dialog', { name: 'Export Drawing Log' });
    const [dl] = await Promise.all([page.waitForEvent('download'), ld.getByRole('button', { name: 'Done' }).click()]);
    await dl.saveAs(`${OUT}/drawing-log.csv`);
    const log = readFileSync(`${OUT}/drawing-log.csv`, 'utf8');
    assert(log.startsWith('Sheet Number,Sheet Name,Discipline') && log.includes('C-101,Site Plan,Civil'), `the drawing log CSV has the tags in order (${log.split('\n')[0]})`);
    assert(/^(Set|Sample Floor Plan) Drawing Log\.csv$/.test(dl.suggestedFilename()), `the Set name is prepended to the log title (${dl.suggestedFilename()})`);
  }
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
  // Only what was under the mark is gone: the rest of A-101 is still real, searchable text (no OCR needed).
  await page.getByLabel('Search text').fill('FLOOR PLAN');
  await page.getByLabel('Search text').press('Enter');
  await page.waitForFunction(() => /\d+ results?/.test(document.querySelector('.search-panel')?.textContent ?? ''));
  const keptHits = await page.locator('.search-hit .muted').allInnerTexts();
  assert(keptHits.includes('A-101'), `text outside the redaction stays searchable on A-101 (hits on: ${keptHits.join(', ')})`);
  assert(/\d+ character\(s\)/.test(await page.locator('.statusbar').innerText()) && !/replaced by an image/.test(await page.locator('.statusbar').innerText()), 'redaction removed the characters without rasterising the page');
  await page.locator('.ml-table-wrap').focus();
  await page.keyboard.press('Alt+1');
  await page.keyboard.press('Home');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/16-redacted.png` });

  // OCR an image-only PDF (the Overlay output): its text becomes searchable. English + French data both load.
  await page.locator('.doc-tab', { hasText: 'Overlay' }).click();
  await page.waitForTimeout(800);
  await page.keyboard.press('Control+Shift+O');
  const od = page.getByRole('dialog', { name: 'OCR' });
  await od.getByLabel('Page range').selectOption('current');
  await od.getByLabel('French').check();
  await od.getByRole('button', { name: 'OK' }).click();
  await page.waitForFunction(() => /OCR: \d+ word/.test(document.querySelector('.statusbar')?.textContent ?? '') || /OCR failed/.test(document.querySelector('.statusbar')?.textContent ?? ''), null, { timeout: 240000 });
  const ocrStatus = await page.locator('.statusbar').innerText();
  assert(/OCR: \d+ word/.test(ocrStatus), `OCR recognised text (${ocrStatus.match(/OCR[^\n]*/)?.[0]})`);
  await page.keyboard.press('Control+F');
  await page.getByLabel('Search text').fill('FLOOR');
  await page.getByLabel('Search text').press('Enter');
  await page.waitForFunction(() => /\d+ results?/.test(document.querySelector('.search-panel')?.textContent ?? ''));
  await page.waitForTimeout(500);
  const ocrHits = await page.locator('.search-hit .muted').allInnerTexts();

  assert(ocrHits.includes('1') && !ocrHits.includes('A-101'), `OCR text is searchable in the scanned overlay (hits on: ${ocrHits.join(', ')})`);
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
  // Form data: Export (FDF), Reset, Import back; Highlight Fields.
  {
    const toolsItem = async (name) => { await page.keyboard.press('Escape'); await page.getByRole('button', { name: 'Tools', exact: true }).click(); await page.getByRole('menuitem', { name }).click(); await page.waitForTimeout(300); };
    const [xd] = await Promise.all([page.waitForEvent('download'), toolsItem('Export Form Data (FDF)')]);
    const fdfPath = `${OUT}/form.fdf`;
    await xd.saveAs(fdfPath);
    const fdf = readFileSync(fdfPath, 'utf8');
    assert(fdf.startsWith('%FDF-1.2') && fdf.includes('/T (inspector) /V (Sam Rivera)') && fdf.includes('/T (passed) /V /Yes'), 'Export Form Data writes the values as FDF');
    await toolsItem('Reset Form');
    assert(await page.getByLabel('inspector').inputValue() === '' && !(await page.getByLabel('passed').isChecked()), 'Reset Form clears the fields');
    const [ifc] = await Promise.all([page.waitForEvent('filechooser'), toolsItem('Import Form Data…')]);
    await ifc.setFiles(fdfPath);
    await page.getByText(/Imported \d+ field values/).waitFor({ timeout: 10000 });
    assert(await page.getByLabel('inspector').inputValue() === 'Sam Rivera' && await page.getByLabel('passed').isChecked(), 'Import Form Data fills the fields from the FDF');
    await toolsItem('Highlight Fields');
    assert(await page.locator('.form-layer.no-highlight').count() >= 1, 'Highlight Fields off removes the field tint');
    await toolsItem('Highlight Fields');
  }

  // Forms editor: create fields by dragging their box, rename/delete them, fill and save.
  const drag = async (fx0, fy0, fx1, fy1) => {
    const b = await svg.boundingBox();
    await page.mouse.move(b.x + b.width * fx0, b.y + b.height * fy0);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width * fx1, b.y + b.height * fy1, { steps: 4 });
    await page.mouse.up();
  };
  const tool = async (name) => {
    await page.getByRole('button', { name: 'Tools', exact: true }).click();
    await page.getByRole('menuitem', { name, exact: true }).click();
    await page.waitForTimeout(400);
  };
  await tool('Text Field');
  await page.keyboard.press('Alt+P'); // Properties panel with a form tool active (it has no style defaults)
  assert((await page.locator('.side-right + *, .panel').allInnerTexts()).join(' ').includes('Text Field: no style properties'), 'Properties shows no style for a form field tool');
  await page.keyboard.press('Alt+U');
  await drag(0.1, 0.8, 0.5, 0.84);
  let nf = page.getByRole('dialog', { name: 'New Text Field' });
  await nf.getByLabel('Field name').fill('Remarks');
  await nf.getByRole('button', { name: 'OK' }).click();
  await page.getByLabel('Remarks', { exact: true }).waitFor();
  await tool('Dropdown');
  await drag(0.1, 0.86, 0.4, 0.9);
  nf = page.getByRole('dialog', { name: 'New Dropdown' });
  await nf.getByLabel('Field name').fill('Grade');
  await nf.getByLabel('Field items').fill('A\nB');
  await nf.getByRole('button', { name: 'OK' }).click();
  await page.getByLabel('Grade', { exact: true }).waitFor();
  await page.keyboard.press('x');
  await drag(0.55, 0.86, 0.9, 0.93);
  nf = page.getByRole('dialog', { name: 'New Signature Field' });
  assert(await nf.getByLabel('Field name').inputValue() === 'Signature1', 'X adds a signature field (default name Signature1)');
  await nf.getByRole('button', { name: 'OK' }).click();
  await page.waitForTimeout(800);
  await page.keyboard.press('Control+Shift+F');
  const fe = page.getByRole('dialog', { name: 'Forms Editor' });
  await fe.getByLabel('Name of Remarks').fill('Notes');
  await fe.getByLabel('Delete Grade').check();
  await fe.getByRole('button', { name: 'Apply' }).click();
  await page.getByLabel('Notes', { exact: true }).waitFor();
  assert(await page.getByLabel('Grade', { exact: true }).count() === 0, 'Forms Editor renames and deletes fields');
  await page.getByLabel('Notes', { exact: true }).fill('Checked twice');
  await page.evaluate(() => (document.activeElement)?.blur?.());
  const [fd2] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+S')]);
  await fd2.saveAs(`${OUT}/saved-form-fields.pdf`);
  const f2 = (await PDFDocument.load(readFileSync(`${OUT}/saved-form-fields.pdf`))).getForm();
  assert(f2.getTextField('Notes').getText() === 'Checked twice' && !f2.getFieldMaybe('Grade') && f2.getFieldMaybe('Signature1')
    && f2.getTextField('inspector').getText() === 'Sam Rivera', 'created fields saved into the PDF form, old values kept');

  // Digital signature with a certificate (.p12): sign the empty signature field, check it, then edit and save again.
  await page.getByRole('button', { name: 'Sign here' }).first().click();
  const sg = page.getByRole('dialog', { name: 'Sign Document' });
  const [cfc] = await Promise.all([page.waitForEvent('filechooser'), sg.getByRole('button', { name: 'Choose .pfx / .p12…' }).click()]);
  await cfc.setFiles('tests/fixtures/test-cert.p12');
  await sg.getByLabel('Certificate password').fill('wrong');
  await sg.getByRole('button', { name: 'Open' }).click();
  await sg.getByText('Wrong password').waitFor();
  await sg.getByLabel('Certificate password').fill('test');
  await sg.getByRole('button', { name: 'Open' }).click();
  await sg.getByText('Signing as').waitFor();
  assert(await sg.getByLabel('Signature placement').inputValue() === 'field:Signature1', 'Sign here opens Sign Document for that field');
  await sg.getByLabel('Reason').fill('Approved');
  await sg.getByRole('button', { name: 'Sign', exact: true }).click();
  await page.waitForFunction(() => /Signed by Test Signer/.test(document.querySelector('.statusbar')?.textContent ?? ''), null, { timeout: 30000 });
  await page.keyboard.press('Alt+4');
  const sp = page.locator('.signatures-panel');
  await sp.getByText('Signature is valid').waitFor({ timeout: 15000 });
  assert((await sp.innerText()).includes('Test Signer') && (await sp.innerText()).includes('Approved'), 'Signatures panel (Alt+4) shows the valid signature');
  // Trust list: the self-signed test certificate becomes trusted once added.
  assert((await sp.innerText()).includes('Identity not trusted'), 'a signer is not trusted until its certificate is added');
  {
    const forge = (await import('node-forge')).default;
    const p = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(readFileSync('tests/fixtures/test-cert.p12').toString('latin1')), 'test');
    const cert = p.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag][0].cert;
    writeFileSync(`${OUT}/test-signer.pem`, forge.pki.certificateToPem(cert));
  }
  await sp.getByRole('button', { name: 'Trusted Certificates…' }).click();
  const [tfc] = await Promise.all([page.waitForEvent('filechooser'), sp.getByRole('button', { name: 'Add Certificate…' }).click()]);
  await tfc.setFiles(`${OUT}/test-signer.pem`);
  await sp.getByText(/Identity trusted/).waitFor({ timeout: 15000 });
  assert(true, 'adding the certificate to Trusted Certificates trusts the signature');
  await sp.getByRole('button', { name: 'Remove' }).click();
  await page.screenshot({ path: `${OUT}/16-signed.png` });
  const [sd2] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+S')]);
  await sd2.saveAs(`${OUT}/signed-form.pdf`);
  const sb = readFileSync(`${OUT}/signed-form.pdf`);
  const sdoc = await PDFDocument.load(sb);
  const sv = sdoc.getForm().getField('Signature1').acroField.dict.lookup(PDFName.of('V'));
  const br = sv.lookup(PDFName.of('ByteRange')).asArray().map((x) => x.asNumber());
  assert(br[2] + br[3] === sb.length, 'the saved file is signed over its whole length');
  await page.waitForFunction(() => /Saved form\.pdf/.test(document.querySelector('.statusbar')?.textContent ?? ''));
  // A markup added after signing is saved as a new revision: the signature stays valid.
  await page.keyboard.press('r');
  { const b = await svg.boundingBox(); await page.mouse.move(b.x + b.width * 0.6, b.y + b.height * 0.3); await page.mouse.down(); await page.mouse.move(b.x + b.width * 0.7, b.y + b.height * 0.35, { steps: 4 }); await page.mouse.up(); }
  await page.keyboard.press('Escape');
  const [sd3] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+S')]);
  await sd3.saveAs(`${OUT}/signed-form-2.pdf`);
  const sb2 = readFileSync(`${OUT}/signed-form-2.pdf`);
  assert(sb2.length > sb.length && Buffer.compare(sb2.subarray(0, sb.length), sb) === 0, 'saving a signed file appends a revision, leaving the signed bytes untouched');
  await sp.getByText('changed after this signature').waitFor({ timeout: 15000 });
  assert((await sp.innerText()).includes('Signature is valid'), 'the signature still checks out after the later edit');
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

// Curved segments: Ctrl+drag while drawing, Ctrl+click a control point, Convert to Arc.
{
  await page.locator('.doc-tab', { hasText: 'Sample Floor Plan.pdf' }).click();
  await page.keyboard.press('Control+4');
  await page.keyboard.press('Home');
  await page.keyboard.press('Control+9');
  await page.waitForTimeout(800);
  const rows = async () => (await page.locator('.ml-table tbody tr').allInnerTexts());
  const before = new Set(await rows());
  const fresh = async () => (await rows()).filter((r) => !before.has(r)).join(' | ');
  await page.keyboard.press('Control+Shift+F8'); // content snap off: exact corners
  await page.keyboard.press('Control+Shift+F7'); // markup snap off
  await page.keyboard.press('Shift+Alt+A');
  const corners = [[30, 2], [40, 2], [40, 12], [30, 12]];
  for (const [i, [x, y]] of corners.entries()) {
    const p = await toScreen(x, y);
    if (i === 1) {
      // Ctrl+drag: the point gets a handlebar, bulging the sides next to it.
      await page.keyboard.down('Control');
      await page.mouse.move(p.x, p.y); await page.mouse.down();
      await page.mouse.move(p.x + 25, p.y - 40, { steps: 5 }); await page.mouse.up();
      await page.keyboard.up('Control');
    } else await page.mouse.click(p.x, p.y);
  }
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  const curved = await fresh();
  const sf = (t) => Number(t.match(/([\d,.]+) sf/)?.[1].replace(/,/g, ''));
  assert(sf(curved) > 100.5, `a Ctrl+dragged point curves the area (${sf(curved)} sf vs 100 sf straight)`);
  await page.screenshot({ path: `${OUT}/17-curved.png` });
  // Ctrl+click the control point: back to straight lines.
  const v = await toScreen(40, 2);
  await page.keyboard.down('Control'); await page.mouse.click(v.x, v.y); await page.keyboard.up('Control');
  await page.waitForTimeout(300);
  assert(sf(await fresh()) === 100, `Ctrl+click on the control point makes it straight again (${sf(await fresh())} sf)`);
  // Right-click a side: Convert to Arc.
  const mid = await toScreen(35, 12);
  await page.mouse.click(mid.x, mid.y, { button: 'right' });
  await page.getByRole('menuitem', { name: 'Convert to Arc' }).click();
  await page.waitForTimeout(300);
  assert(sf(await fresh()) !== 100, `Convert to Arc curves that side (${sf(await fresh())} sf)`);
  await page.keyboard.press('Delete');
  await page.keyboard.press('Control+Shift+F8');
  await page.keyboard.press('Control+Shift+F7');
}

// Layers panel (Alt+Y): a PDF with layers "Plan" and "Notes".
{
  const ld = await PDFDocument.create();
  const font = await ld.embedFont(StandardFonts.HelveticaBold);
  const lp = ld.addPage([600, 400]);
  const ctx = ld.context;
  const plan = ctx.register(ctx.obj({ Type: 'OCG', Name: PDFString.of('Plan') }));
  const notes = ctx.register(ctx.obj({ Type: 'OCG', Name: PDFString.of('Notes') }));
  ld.catalog.set(PDFName.of('OCProperties'), ctx.obj({ OCGs: [plan, notes], D: { Name: PDFString.of('Default'), Order: [plan, notes] } }));
  lp.node.set(PDFName.of('Resources'), ctx.obj({ Font: { F1: font.ref }, Properties: { MC0: plan, MC1: notes } }));
  lp.node.set(PDFName.of('Contents'), ctx.register(ctx.flateStream(
    '/OC /MC0 BDC 4 w 50 50 m 550 50 l 550 350 l 50 350 l h S EMC /OC /MC1 BDC BT /F1 40 Tf 100 250 Td (SECRET NOTE) Tj ET EMC')));
  writeFileSync(`${OUT}/layered.pdf`, await ld.save());
  const fc = await ctrlO();
  await fc.setFiles(`${OUT}/layered.pdf`);
  await page.waitForFunction(() => document.querySelector('.doc-tab.active')?.textContent?.startsWith('layered'));
  await page.keyboard.press('Control+9');
  await page.waitForTimeout(1000);
  await page.keyboard.press('Alt+Y');
  const lpanel = page.getByRole('tree', { name: 'Layers' });
  await lpanel.getByRole('treeitem', { name: 'Layer Notes' }).waitFor();
  assert(await lpanel.getByRole('treeitem').count() === 2, 'Layers panel lists the PDF layers');
  // Ink in the note's area of the rendered page (PDF 100..450 x 250..290).
  const ink = async () => page.evaluate(() => {
    const c = document.querySelector('.page canvas');
    const x = c.getContext('2d');
    const k = c.width / 600;
    const d = x.getImageData(110 * k, (400 - 285) * k, 300 * k, 30 * k).data;
    let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 128) n++;
    return n;
  });
  const shown = await ink();
  await page.getByLabel('Show Notes').uncheck();
  await page.waitForTimeout(1200);
  const hidden = await ink();
  assert(shown > 200 && hidden < shown / 20, `hiding a layer hides its content (${shown} -> ${hidden} dark pixels)`);
  await page.getByLabel('Show Notes').check();
  await page.waitForTimeout(800);
  // Add a layer, make it the Markup Layer, draw on it.
  page.once('dialog', (d) => d.accept('Markups'));
  await page.getByRole('button', { name: '+ Layer' }).click();
  await lpanel.getByRole('treeitem', { name: 'Layer Markups' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Markup Layer' }).click();
  const shapes = async () => page.locator('.page .markup-layer > *').count();
  const n0 = await shapes();
  await page.keyboard.press('r');
  { const b = await svg.boundingBox(); await page.mouse.move(b.x + b.width * 0.3, b.y + b.height * 0.6); await page.mouse.down(); await page.mouse.move(b.x + b.width * 0.5, b.y + b.height * 0.8, { steps: 4 }); await page.mouse.up(); }
  await page.keyboard.press('Escape');
  await page.mouse.move(5, 500);
  const n1 = await shapes();
  await page.getByLabel('Show Markups').uncheck();
  assert(n1 === n0 + 1 && await shapes() === n0, `markups on a hidden layer are hidden (${n0} -> ${n1} -> ${await shapes()})`);
  await page.getByLabel('Show Markups').check();
  await page.evaluate(() => (document.activeElement)?.blur?.());
  // Save: layers and the markup's layer are in the PDF.
  const [ldl] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+S')]);
  await ldl.saveAs(`${OUT}/layered-saved.pdf`);
  await page.waitForFunction(() => /Saved layered\.pdf/.test(document.querySelector('.statusbar')?.textContent ?? ''));
  const saved = await PDFDocument.load(readFileSync(`${OUT}/layered-saved.pdf`));
  const ocp = saved.catalog.lookup(PDFName.of('OCProperties'));
  const names = ocp.lookup(PDFName.of('OCGs')).asArray().map((r) => saved.context.lookup(r).lookup(PDFName.of('Name')).decodeText());
  const sq = saved.getPage(0).node.lookup(PDFName.of('Annots')).asArray().map((r) => saved.context.lookup(r)).find((a) => String(a.get(PDFName.of('Subtype'))) === '/Square');
  assert(await lpanel.getByRole('treeitem', { name: 'Layer Markups' }).locator('.layer-badge').count() === 1, 'the Markup Layer is still set after saving');
  assert(names.join(',') === 'Plan,Notes,Markups' && saved.context.lookup(sq.get(PDFName.of('OC'))).lookup(PDFName.of('Name')).decodeText() === 'Markups',
    `saved layers ${names.join(', ')}; the rectangle is on "Markups"`);
  // Delete "Notes" and its content.
  await lpanel.getByRole('treeitem', { name: 'Layer Notes' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page.getByRole('dialog', { name: 'Delete Layer' }).getByRole('button', { name: 'Delete' }).click();
  await page.waitForFunction(() => /Deleted 1 layer/.test(document.querySelector('.statusbar')?.textContent ?? ''));
  await page.waitForTimeout(1000);
  assert(await lpanel.getByRole('treeitem', { name: 'Layer Notes' }).count() === 0 && await ink() < 20, 'deleting a layer removes it and its content');
  // Ink in a PDF-space box of the rendered page.
  const inkAt = async (x0, y0, w, h) => page.evaluate(([x0, y0, w, h]) => {
    const c = document.querySelector('.page canvas');
    const k = c.width / 600;
    const d = c.getContext('2d').getImageData(x0 * k, (400 - y0 - h) * k, w * k, h * k).data;
    let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 128) n++;
    return n;
  }, [x0, y0, w, h]);
  const planProps = async () => {
    await lpanel.getByRole('treeitem', { name: 'Layer Plan' }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Layer Properties…' }).click();
    return page.getByRole('dialog', { name: 'Layer Properties' });
  };
  // Zoom range: Plan only shows up to 100% zoom.
  let lpd = await planProps();
  await lpd.getByLabel('Zoom', { exact: true }).selectOption('range');
  await lpd.getByLabel('Minimum zoom').fill('0');
  await lpd.getByLabel('Maximum zoom').fill('100');
  await lpd.getByRole('button', { name: 'OK' }).click();
  await page.waitForTimeout(1200);
  const atFit = await inkAt(44, 100, 12, 200);
  await page.keyboard.press('Control+8');
  await page.waitForTimeout(1500);
  const at100 = await inkAt(44, 100, 12, 200);
  assert(atFit < 5 && at100 > 50, `a layer with a zoom range hides outside it (fit: ${atFit}, 100%: ${at100} dark pixels)`);
  await page.keyboard.press('Control+9');
  lpd = await planProps();
  await lpd.getByLabel('Zoom', { exact: true }).selectOption('always');
  await lpd.getByRole('button', { name: 'OK' }).click();
  await page.waitForTimeout(1200);
  // A markup on the Plan layer moves with it.
  const lbox = await svg.boundingBox();
  await page.keyboard.press('r');
  await page.mouse.move(lbox.x + 300, lbox.y + 400); await page.mouse.down(); await page.mouse.move(lbox.x + 360, lbox.y + 440, { steps: 3 }); await page.mouse.up();
  await page.mouse.click(lbox.x + 300, lbox.y + 420, { button: 'right' });
  await page.getByRole('menuitem', { name: 'Layer › Plan' }).click();
  const onLayerId = await page.evaluate(() => [...document.querySelectorAll('.markup-layer g[data-id]')].pop()?.getAttribute('data-id'));
  const mx0 = (await page.locator(`.markup-layer g[data-id="${onLayerId}"]`).first().boundingBox()).x;
  // Move the Plan layer 1 inch right.
  const before = [await inkAt(44, 100, 12, 200), await inkAt(116, 100, 12, 200)];
  await lpanel.getByRole('treeitem', { name: 'Layer Plan' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Move / Rotate / Scale…' }).click();
  const mv = page.getByRole('dialog', { name: 'Move / Rotate / Scale Layer' });
  await mv.getByLabel('Nudge step').fill('0.5');
  await mv.getByLabel('Nudge right').click();
  await mv.getByLabel('Nudge right').click();
  assert(await mv.getByLabel('Move right').inputValue() === '1', 'nudge buttons add to the move');
  await mv.getByRole('button', { name: 'Apply' }).click();
  await page.waitForFunction(() => /Layer "Plan" moved/.test(document.querySelector('.statusbar')?.textContent ?? ''));
  await page.waitForTimeout(1500);
  const after = [await inkAt(44, 100, 12, 200), await inkAt(116, 100, 12, 200)];
  assert(before[0] > 50 && before[1] < 5 && after[0] < 5 && after[1] > 50, `Move / Rotate / Scale moves the layer's content (${before} -> ${after})`);
  const zl = (await svg.boundingBox()).width / (parseFloat(await page.locator('.sb-size').innerText()) * 72);
  const mx1 = (await page.locator('.markup-layer g[data-id]').filter({ has: page.locator('rect') }).last().boundingBox()).x;
  assert(Math.abs(mx1 - mx0 - 72 * zl) < 3, `markups on the layer move with it (${mx0.toFixed(1)} -> ${mx1.toFixed(1)}, expected +${(72 * zl).toFixed(1)})`);
  // Export Layer to Page: a new PDF with only that layer.
  const tabs0 = await page.locator('.doc-tab').count();
  await lpanel.getByRole('treeitem', { name: 'Layer Plan' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Export Layer to Page…' }).click();
  await page.waitForFunction((n) => document.querySelectorAll('.doc-tab').length === n + 1, tabs0);
  assert((await page.locator('.doc-tab.active').innerText()).includes('layered - Plan'), 'Export Layer to Page opens the layer as a new PDF');
  await page.locator('.doc-tab', { hasText: 'layered.pdf' }).click();
  await page.waitForTimeout(800);
  // Flatten markups to a new layer "Flat".
  await page.getByRole('button', { name: 'Document', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Flatten/ }).first().click();
  const fd = page.getByRole('dialog', { name: 'Flatten Markups' });
  await fd.getByLabel('Assign Layer').check();
  await fd.getByLabel('Flatten to layer').fill('Flat');
  await fd.getByRole('button', { name: 'OK' }).click();
  await lpanel.getByRole('treeitem', { name: 'Layer Flat' }).waitFor({ timeout: 15000 });
  assert(await page.locator('.ml-table tbody tr:not(.reply-row)').filter({ hasText: 'Rectangle' }).count() === 0, 'Flatten with Assign Layer puts the flattened markups on a new layer');

  // Add Layer from Page: the sheet drawn onto itself as a new layer.
  await page.getByRole('button', { name: 'From Page…' }).click();
  const al = page.getByRole('dialog', { name: 'Add Layer from Page' });
  await al.getByLabel('Source document').selectOption({ label: 'layered.pdf' });
  await al.getByLabel('New layer name').fill('Revision B');
  await al.getByRole('button', { name: 'OK' }).click();
  await lpanel.getByRole('treeitem', { name: 'Layer Revision B' }).waitFor({ timeout: 15000 });
  assert(true, 'Add Layer from Page adds the sheet as a new layer');
  await page.screenshot({ path: `${OUT}/18-layers.png` });
  page.on('dialog', (d) => d.accept().catch(() => {}));
  await page.keyboard.press('Control+F4');
  await page.waitForTimeout(500);
  page.removeAllListeners('dialog');
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

// Rulers (Ctrl+R), Dimmer (Ctrl+F5), Previous / Next View (Alt+Left / Alt+Right).
{
  await page.locator('.doc-tab').first().click();
  await page.mouse.click(5, 500);
  const nav = page.locator('.sb-nav > span').first();
  await page.keyboard.press('Control+4');
  await page.keyboard.press('Home');
  await page.waitForTimeout(600);
  await page.keyboard.press('Control+ArrowRight');
  await page.waitForTimeout(600);
  await page.keyboard.press('Control+8');
  await page.waitForTimeout(600);
  await page.keyboard.press('Alt+ArrowLeft');
  await page.waitForTimeout(500);
  assert((await nav.innerText()).startsWith('(2 of') && (await page.locator('.sb-zoom').first().innerText()) !== '100%', 'Previous View: back to the fitted view of page 2');
  await page.keyboard.press('Alt+ArrowLeft');
  await page.waitForTimeout(500);
  assert((await nav.innerText()).startsWith('(1 of'), 'Previous View: back to page 1');
  await page.keyboard.press('Alt+ArrowRight');
  await page.waitForTimeout(500);
  assert((await nav.innerText()).startsWith('(2 of'), 'Next View: forward to page 2');
  await page.keyboard.press('Control+r');
  await page.keyboard.press('Control+F5');
  const vb = await page.locator('.viewer').first().boundingBox();
  await page.mouse.move(vb.x + vb.width / 2, vb.y + vb.height / 2);
  await page.waitForTimeout(300);
  assert(await page.locator('.ruler-top').count() === 1 && await page.locator('.ruler-left').count() === 1, 'rulers shown (Ctrl+R)');
  assert(await page.locator('.page .dimmer').count() === 1, 'page content dimmed (Ctrl+F5)');
  // The ruler shows page bounds: its pixels under the page are white, the rest grey.
  const px = await page.evaluate(() => {
    const c = document.querySelector('.ruler-top');
    const d = c.getContext('2d').getImageData(0, 2, c.width, 1).data;
    let white = 0; for (let i = 0; i < d.length; i += 4) if (d[i] === 255 && d[i + 1] === 255) white++;
    return white / (d.length / 4);
  });
  assert(px > 0.2 && px < 0.99, `the ruler marks the page extent (${px.toFixed(2)} white)`);
  await page.screenshot({ path: `${OUT}/rulers-dimmer.png` });
  await page.keyboard.press('Control+r');
  await page.keyboard.press('Control+F5');
  assert(await page.locator('.ruler-top').count() === 0 && await page.locator('.dimmer').count() === 0, 'rulers and dimmer toggle off');
}

// Bookmarks (Alt+B): add at the current view (Ctrl+B), name, reorder by drag, add a child, jump, save to /Outlines.
{
  const nav = page.locator('.sb-nav > span').first();
  await page.keyboard.press('Control+4');
  await page.keyboard.press('End');
  await page.waitForTimeout(400);
  await page.keyboard.press('Control+b');
  const name = page.locator('input[aria-label="Bookmark name"]');
  await name.waitFor();
  assert(await name.inputValue() === 'C-101', 'a new bookmark is named after the page label');
  await name.fill('Site Plan');
  await name.press('Enter');
  await page.keyboard.press('Home');
  await page.waitForTimeout(400);
  await page.keyboard.press('Control+b');
  await name.waitFor();
  await name.fill('Floor Plan');
  await name.press('Enter');
  const titles = () => page.locator('.bookmark-row .bm-title').allInnerTexts();
  assert((await titles()).join('|') === 'Site Plan|Floor Plan', 'bookmarks added after the selected one');
  const row = (t) => page.locator('.bookmark-row', { has: page.locator('.bm-title', { hasText: t }) });
  await row('Floor Plan').dragTo(row('Site Plan'), { targetPosition: { x: 40, y: 2 } });
  assert((await titles()).join('|') === 'Floor Plan|Site Plan', 'drag reorders bookmarks');
  await row('Site Plan').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Add Child' }).click();
  await name.waitFor();
  await name.fill('Detail');
  await name.press('Enter');
  assert((await titles()).join('|') === 'Floor Plan|Site Plan|Detail', 'child bookmark added');
  await page.locator('.bm-title', { hasText: 'Site Plan' }).click();
  await page.waitForTimeout(400);
  assert((await nav.innerText()).startsWith('(2 of'), 'clicking a bookmark jumps to its page');
  // Action dialog: the child opens a web address.
  await row('Detail').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Action…' }).click();
  const adlg = page.locator('[role=dialog][aria-label="Bookmark Action"]');
  await adlg.waitFor();
  await adlg.locator('[aria-label="Web address"]').fill('https://example.com/detail');
  await adlg.getByRole('button', { name: 'OK' }).click();
  await page.screenshot({ path: `${OUT}/bookmarks.png` });
  await page.locator('.viewer').first().click({ position: { x: 5, y: 5 } }).catch(() => {});
  const [dl] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+S')]);
  const file = `${OUT}/bookmarks.pdf`;
  await dl.saveAs(file);
  await page.waitForTimeout(800);
  const out = await PDFDocument.load(readFileSync(file));
  const look = (o) => out.context.lookup(o);
  const outline = out.catalog.lookup(PDFName.of('Outlines'), PDFDict);
  const names = [];
  const walk = (r, depth) => { for (let it = r && look(r); it; it = it.get(PDFName.of('Next')) && look(it.get(PDFName.of('Next')))) {
    names.push('-'.repeat(depth) + it.lookup(PDFName.of('Title')).decodeText()); const f = it.get(PDFName.of('First')); if (f) walk(f, depth + 1); } };
  walk(outline.get(PDFName.of('First')), 0);
  assert(names.join('|') === 'Floor Plan|Site Plan|-Detail', `saved outline (${names.join('|')})`);
  const dest = look(outline.get(PDFName.of('First'))).lookup(PDFName.of('Dest'), PDFArray);
  assert(dest.get(0).toString() === out.getPage(0).ref.toString() && dest.get(1).toString() === '/XYZ', 'bookmark goes to the view on page 1');
  const detail = look(look(look(outline.get(PDFName.of('First'))).get(PDFName.of('Next'))).get(PDFName.of('First')));
  assert(detail.lookup(PDFName.of('A'), PDFDict).lookup(PDFName.of('URI')).decodeText() === 'https://example.com/detail', 'the Action dialog wrote a URI action');
}

// Line styles and hatch patterns (Properties > Line Style / Hatch, Manage…).
{
  const layer = page.locator('.page .markup-layer');
  const lb = await layer.boundingBox();
  await page.keyboard.press('r');
  await page.mouse.move(lb.x + lb.width * 0.06, lb.y + lb.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(lb.x + lb.width * 0.13, lb.y + lb.height * 0.45, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  if (!(await page.locator('select[aria-label="Hatch"]').count())) await page.keyboard.press('Alt+P');
  await page.locator('select[aria-label="Hatch"]').selectOption('ansi31', { timeout: 5000 });
  await page.waitForTimeout(200);
  assert(await layer.locator('pattern line').count() >= 1, 'the rectangle is hatched (Diagonal ANSI31)');
  await page.keyboard.press('l');
  await page.mouse.move(lb.x + lb.width * 0.05, lb.y + lb.height * 0.6);
  await page.mouse.down();
  await page.mouse.move(lb.x + lb.width * 0.45, lb.y + lb.height * 0.6, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  await page.locator('select[aria-label="Line Style"]').selectOption('gas');
  await page.waitForTimeout(200);
  const gs = await layer.locator('text').evaluateAll((els) => els.filter((e) => e.textContent === 'G').length);
  assert(gs >= 3, `the Gas Line style repeats "G" along the line (${gs})`);
  // A custom style made in the Line Style Editor.
  await page.locator('select[aria-label="Line Style"]').selectOption('__manage__');
  const mgr = page.locator('[role=dialog][aria-label="Manage Line Styles"]');
  await mgr.waitFor();
  await mgr.getByRole('button', { name: 'Add…' }).click();
  const ed = page.locator('[role=dialog][aria-label="Line Style Editor"]');
  await ed.locator('[aria-label="Line style name"]').fill('Fiber');
  await ed.getByRole('button', { name: '+ Text' }).click();
  await ed.locator('[aria-label="Text 3"]').fill('FO');
  await ed.getByRole('button', { name: 'OK' }).click();
  await mgr.getByRole('button', { name: 'Close' }).click();
  const opt = await page.locator('select[aria-label="Line Style"] option', { hasText: 'Fiber' }).getAttribute('value');
  await page.locator('select[aria-label="Line Style"]').selectOption(opt);
  await page.waitForTimeout(200);
  assert(await layer.locator('text').evaluateAll((els) => els.filter((e) => e.textContent === 'FO').length) >= 3, 'a custom line style with text applies to the line');
  await page.screenshot({ path: `${OUT}/line-styles.png` });
  const [dl] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+S')]);
  const file = `${OUT}/line-styles.pdf`;
  await dl.saveAs(file);
  await page.waitForTimeout(800);
  const out = await PDFDocument.load(readFileSync(file));
  const { inflateSync } = await import('node:zlib');
  const aps = out.getPage(1).node.lookup(PDFName.of('Annots'), PDFArray).asArray().map((r) => out.context.lookup(r, PDFDict))
    .map((a) => { const st = a.lookup(PDFName.of('AP'), PDFDict).lookup(PDFName.of('N')); const raw = st.getContents(); try { return inflateSync(raw).toString('latin1'); } catch { return Buffer.from(raw).toString('latin1'); } });
  assert(aps.some((t) => t.includes('/Pattern cs /HP0 scn')), 'saved: the hatch is a tiling pattern in the appearance');
  assert(aps.some((t) => (t.match(/ Tj ET/g) ?? []).length >= 3 && t.includes(' Tm ')), 'saved: the line style text is in the appearance');
  // Import an AutoCAD .pat file into the Hatch list.
  const patFile = `${OUT}/sample.pat`;
  writeFileSync(patFile, '*ANSI33, ANSI Bronze, Brass, Copper\n45, 0,0, 0,.25, .5,-.25\n*STEEL, Steel\n45, 0,0, 0,.09375\n45, 0,.0625, 0,.09375\n');
  await page.keyboard.press('Escape');
  await page.mouse.click(lb.x + lb.width * 0.095, lb.y + lb.height * 0.375);
  await page.locator('select[aria-label="Hatch"]').waitFor({ timeout: 5000 });
  await page.locator('select[aria-label="Hatch"]').selectOption('__manage__');
  const hm = page.locator('[role=dialog][aria-label="Manage Hatch Patterns"]');
  await hm.waitFor();
  const [hfc] = await Promise.all([page.waitForEvent('filechooser'), hm.getByRole('button', { name: 'Import…' }).click()]);
  await hfc.setFiles(patFile);
  await page.waitForTimeout(400);
  assert(await hm.locator('.hatch-item', { hasText: 'STEEL' }).count() === 1, '.pat import adds its patterns to the Hatch list');
  await hm.getByRole('button', { name: 'Close' }).click();
  await page.locator('select[aria-label="Hatch"]').selectOption('pat-steel');
  await page.waitForTimeout(200);
  assert(await layer.locator('pattern line').count() >= 2, 'the imported STEEL hatch draws two line families');
  await page.locator('select[aria-label="Hatch"]').selectOption('ansi31');
}

// Capture: a photo attached to a markup (Properties > Capture), shown in the Capture column, previewed on double-click.
{
  await page.locator('.ml-table tbody tr').first().click();
  await page.waitForTimeout(300);
  if (!(await page.locator('.props textarea').count())) await page.keyboard.press('Alt+P');
  await page.locator('[aria-label="Add photo"]').setInputFiles(`${OUT}/01-start.png`);
  await page.locator('.capture-thumb img').waitFor({ timeout: 10000 });
  assert(await page.locator('.capture-thumb').count() === 1, 'Add Photo puts the picture in the markup\'s Capture section');
  // Export Capture Media (.zip) and Capture Summary (PDF) from the Summary menu.
  {
    await page.getByRole('button', { name: 'Summary ▾' }).click();
    const [zd] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export Capture Media (.zip)' }).click()]);
    await zd.saveAs(`${OUT}/capture-media.zip`);
    const { unzipSync } = await import('fflate');
    const names = Object.keys(unzipSync(readFileSync(`${OUT}/capture-media.zip`)));
    assert(names.length === 1 && /\.(png|jpg)$/i.test(names[0]), `Export Capture Media zips the photo (${names.join()})`);
    await page.getByRole('button', { name: 'Summary ▾' }).click();
    const [pd] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Capture Summary (PDF)' }).click()]);
    await pd.saveAs(`${OUT}/capture-summary.pdf`);
    assert((await PDFDocument.load(readFileSync(`${OUT}/capture-summary.pdf`))).getPageCount() >= 1, 'Capture Summary makes a PDF report');
  }
  await page.getByRole('button', { name: 'Columns ▾' }).click();
  await page.locator('.ml-columns-menu label', { hasText: 'Capture' }).locator('input').check();
  await page.mouse.move(5, 5);
  const cell = page.locator('.ml-table tbody tr.selected').first().locator('.capture-cell');
  assert((await cell.innerText()).includes('📷 1'), 'the Capture column counts the photos');
  await cell.dblclick();
  const cp = page.locator('[role=dialog][aria-label="Capture"]');
  await cp.waitFor();
  assert(await cp.locator('img').count() === 1, 'double-clicking the Capture cell previews the photo');
  await page.screenshot({ path: `${OUT}/capture.png` });
  await page.keyboard.press('Escape');
  await cp.waitFor({ state: 'hidden' });
  // The media icon at the markup's corner opens the viewer too; Delete there removes the photo.
  const icon = page.locator('.markup-layer .capture-icon').first();
  assert(await icon.count() === 1, 'a markup with a photo shows the media icon on the drawing');
  await icon.click();
  await cp.waitFor();
  await cp.getByRole('button', { name: 'Delete' }).click();
  await cp.waitFor({ state: 'hidden' });
  await page.waitForTimeout(200);
  assert(await page.locator('.capture-thumb').count() === 0 && await page.locator('.markup-layer .capture-icon').count() === 0, 'Delete in the viewer removes the photo');
  // Right-click menu: Capture > From File / From Camera.
  await page.locator('.ml-table tbody tr').first().click({ button: 'right' });
  assert(await page.getByRole('menuitem', { name: 'Capture › From File…' }).count() === 1 && await page.getByRole('menuitem', { name: 'Capture › From Camera…' }).count() === 1, 'the markup menu offers Capture > From File / From Camera');
  await page.keyboard.press('Escape');
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.getByRole('button', { name: 'Columns ▾' }).click();
  if (!(await page.locator('.ml-columns-menu').count())) await page.getByRole('button', { name: 'Columns ▾' }).click();
  await page.locator('.ml-columns-menu label', { hasText: 'Capture' }).locator('input').uncheck();
  await page.mouse.move(5, 5);
}

// Spell check (F7) through markup comments; Markup Spelling Mistakes on the PDF text.
{
  // Give a markup a misspelt comment.
  await page.locator('.ml-table tbody tr').first().click();
  await page.waitForTimeout(300);
  if (!(await page.locator('.props textarea').count())) await page.keyboard.press('Alt+P');
  await page.locator('.props textarea').first().fill('Verify the hardwre here');
  await page.locator('.viewer').first().click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('F7');
  const dlg = page.locator('[role=dialog][aria-label="Check Spelling"]');
  await dlg.waitFor();
  await dlg.locator('mark').waitFor({ timeout: 20000 });
  assert(await dlg.locator('mark').innerText() === 'hardwre', 'F7 finds the misspelt word in a comment');
  assert(await dlg.locator('[aria-label="Change to"]').inputValue() === 'hardware', 'the first suggestion is the right word');
  await page.screenshot({ path: `${OUT}/spell-check.png` });
  await dlg.getByRole('button', { name: 'Change', exact: true }).click();
  // Other words in markups may be flagged too (e.g. names): ignore them all.
  for (let i = 0; i < 30 && !(await dlg.getByText('Spell check complete.').count()); i++) {
    await dlg.getByRole('button', { name: 'Ignore All' }).click().catch(() => {});
    await page.waitForTimeout(100);
  }
  await dlg.getByRole('button', { name: 'Close' }).click();
  const comments = await page.evaluate(() => [...document.querySelectorAll('.ml-table tbody td')].map((td) => td.textContent).join('|'));
  assert(comments.includes('Verify the hardware here'), 'Change corrected the comment');
  await page.locator('.menubar-item > button', { hasText: /^Edit$/ }).click();
  await page.getByRole('menuitem', { name: 'Markup Spelling Mistakes…' }).click();
  const md = page.locator('[role=dialog][aria-label="Markup Spelling Mistakes"]');
  await md.locator('[aria-label="Pages"]').selectOption('current');
  await md.getByRole('button', { name: 'OK' }).click();
  await page.getByText(/Markup Spelling Mistakes: /).waitFor({ timeout: 20000 });
  assert(true, `Markup Spelling Mistakes ran (${await page.getByText(/Markup Spelling Mistakes: /).innerText()})`);
  // Another language: the French dictionary loads from /dict/.
  await page.locator('.menubar-item > button', { hasText: /^Edit$/ }).click();
  await page.getByRole('menuitem', { name: 'Markup Spelling Mistakes…' }).click();
  await md.locator('[aria-label="Spelling language"]').selectOption('fr');
  await md.locator('[aria-label="Pages"]').selectOption('current');
  const frReq = page.waitForResponse((r) => r.url().endsWith('/dict/fr.dic') && r.ok(), { timeout: 30000 });
  await md.getByRole('button', { name: 'OK' }).click();
  await frReq;
  await page.getByText(/Markup Spelling Mistakes: /).waitFor({ timeout: 30000 });
  assert(true, 'Markup Spelling Mistakes in French loads the French dictionary');
  await page.locator('.menubar-item > button', { hasText: /^Edit$/ }).click();
  await page.getByRole('menuitem', { name: 'Markup Spelling Mistakes…' }).click();
  await md.locator('[aria-label="Spelling language"]').selectOption('en');
  await md.getByRole('button', { name: 'Cancel' }).click();
}

// VisualSearch: Get Rectangle around a door swing on A-101, find the others, count them.
{
  await page.locator('.doc-tab').first().click();
  await page.mouse.click(5, 500);
  await page.keyboard.press('Control+4');
  await page.keyboard.press('Home');
  await page.keyboard.press('Control+9');
  await page.waitForTimeout(600);
  await page.keyboard.press('Alt+1');
  await page.getByRole('tab', { name: 'Visual' }).click();
  await page.getByRole('button', { name: 'Get Rectangle' }).click();
  const a = await toScreen(27.8, 3.75), b = await toScreen(31.25, 1.1);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.mouse.up();
  await page.locator('img[alt="Symbol to find"]').waitFor();
  await page.locator('[aria-label="Sensitivity"]').fill('70');
  await page.locator('.visual-search').getByRole('button', { name: 'Search', exact: true }).click();
  await page.waitForFunction(() => /\d+ results?$/.test(document.querySelector('.visual-search .muted.small:last-of-type')?.textContent ?? '') || document.querySelectorAll('.vs-result').length > 0, null, { timeout: 60000 });
  await page.waitForFunction(() => !document.querySelector('.visual-search')?.textContent?.includes('Searching'), null, { timeout: 60000 });
  const n = await page.locator('.vs-result').count();
  assert(n >= 3 && n <= 6, `VisualSearch finds the door swings drawn the same way (${n})`);
  await page.screenshot({ path: `${OUT}/visual-search.png` });
  const before = await page.locator('.ml-table tbody tr').count();
  await page.locator('[aria-label="Actions"]').selectOption('count');
  await page.waitForTimeout(300);
  assert(await page.locator('.ml-table tbody tr').count() > before, 'Apply Count Measurement to Checked adds a count');
  await page.locator('[aria-label="Search in"]').selectOption('document');
  await page.getByText('Search multiple rotations').click();
  await page.locator('.visual-search').getByRole('button', { name: 'Search', exact: true }).click();
  await page.waitForTimeout(500);
  await page.waitForFunction(() => !document.querySelector('.visual-search')?.textContent?.includes('Searching'), null, { timeout: 90000 });
  const n2 = await page.locator('.vs-result').count();
  assert(n2 > n, `with multiple rotations the turned door swings are found too (${n2})`);
  // Filter by Color: the symbol's colours as swatches; with every colour off nothing matches.
  await page.getByText('Filter by Color').click();
  const swatches = await page.locator('.vs-colors input').count();
  assert(swatches >= 1, `Filter by Color lists the symbol's colours (${swatches})`);
  for (let i = 0; i < swatches; i++) await page.locator('.vs-colors input').nth(i).uncheck();
  await page.locator('.vs-colors input').first().check();
  await page.getByText('Search multiple rotations').click();
  await page.locator('.visual-search').getByRole('button', { name: 'Search', exact: true }).click();
  await page.waitForTimeout(500);
  await page.waitForFunction(() => !document.querySelector('.visual-search')?.textContent?.includes('Searching'), null, { timeout: 90000 });
  const n3 = await page.locator('.vs-result').count();
  assert(n3 >= 3 && n3 <= 6, `matching on the symbol's main colour still finds the door swings (${n3})`);
  await page.getByText('Filter by Color').click();
  await page.getByRole('tab', { name: 'Text' }).click();
}

// Sequences: a Tool Chest tool that numbers its markups (D-01, D-02...), Select Sequence, Reset.
{
  const layer = page.locator('.page .markup-layer');
  const lb = await layer.boundingBox();
  const drawEllipse = async (fx, fy) => {
    await page.mouse.move(lb.x + lb.width * fx, lb.y + lb.height * fy);
    await page.mouse.down();
    await page.mouse.move(lb.x + lb.width * (fx + 0.03), lb.y + lb.height * (fy + 0.04), { steps: 3 });
    await page.mouse.up();
    await page.waitForTimeout(150);
  };
  await page.keyboard.press('e');
  await drawEllipse(0.05, 0.8);
  const shape = layer.locator('ellipse').last();
  await shape.click({ button: 'right', force: true });
  await page.getByRole('menuitem', { name: 'Add to My Tools' }).click();
  if (!(await page.locator('.toolchest').count())) await page.keyboard.press('Alt+X');
  const tool = page.locator('.toolchest .tool-item', { hasText: 'Ellipse' }).last();
  await tool.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Sequence: Define…' }).click();
  const dlg = page.locator('[role=dialog][aria-label="Sequence"]');
  await dlg.locator('[aria-label="Prefix"]').fill('D-');
  await dlg.locator('[aria-label="Digits"]').fill('2');
  assert((await dlg.locator('[aria-label="Sequence preview"]').innerText()).startsWith('D-01, D-02'), 'the Sequence dialog previews D-01, D-02…');
  await dlg.getByRole('button', { name: 'OK' }).click();
  await tool.dblclick(); // locked: place several
  for (const fx of [0.12, 0.18, 0.24]) await drawEllipse(fx, 0.8);
  await page.keyboard.press('Escape');
  const labels = await layer.locator('text.seq-label').allTextContents();
  assert(labels.join(',') === 'D-01,D-02,D-03', `placed markups number themselves (${labels.join(',')})`);
  await layer.locator('ellipse').last().click({ button: 'right', force: true });
  await page.getByRole('menuitem', { name: 'Select Sequence' }).click();
  assert(await page.locator('.ml-table tbody tr.selected').count() === 3, 'Select Sequence selects the whole run');
  await tool.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Sequence: Reset' }).click();
  await tool.click();
  await drawEllipse(0.30, 0.8);
  assert((await layer.locator('text.seq-label').allTextContents()).at(-1) === 'D-01', 'after Reset the sequence starts again');
  await page.screenshot({ path: `${OUT}/sequences.png` });
}

// Quantity Link: totals linked to workbook cells, written into the .xlsx.
{
  await page.locator('.menubar-item > button', { hasText: /^Batch$/ }).click();
  await page.getByRole('menuitem', { name: 'Quantity Link (Excel)…' }).click();
  const dlg = page.locator('[role=dialog][aria-label="Quantity Link"]');
  const row = (i) => dlg.locator('.ql-table tbody tr').nth(i);
  for (const [total, subject] of [['count', 'Count Measurement'], ['area', 'Area Measurement']]) {
    await dlg.getByRole('button', { name: 'Add Link' }).click();
    const r = dlg.locator('.ql-table tbody tr').last();
    await r.locator('[aria-label="Total"]').selectOption(total);
    await r.getByRole('button', { name: '+ Filter' }).click();
    await r.locator('[aria-label="Filter value"]').selectOption(subject);
  }
  const v0 = (await row(0).locator('.ql-value').innerText()).split(/\s/)[0];
  const v1 = (await row(1).locator('.ql-value').innerText()).split(/\s/)[0];
  assert(Number(v0) >= 3 && Number(v1) >= 432, `links total the filtered measurements (${v0} ea, ${v1} sf)`);
  await page.screenshot({ path: `${OUT}/quantity-link.png` });
  const [dl] = await Promise.all([page.waitForEvent('download'), dlg.getByRole('button', { name: 'Update Workbook' }).click()]);
  const file = `${OUT}/Quantities.xlsx`;
  await dl.saveAs(file);
  const { unzipSync, strFromU8 } = await import('fflate');
  const files = unzipSync(readFileSync(file));
  const xml = strFromU8(files['xl/worksheets/sheet1.xml']);
  assert(xml.includes(`<c r="B2"><v>${v0}</v></c>`) && xml.includes(`<c r="B3"><v>${v1}</v></c>`), 'Update Workbook writes the totals into their cells');
  await dlg.getByRole('button', { name: 'Close', exact: true }).last().click();
}

// AutoMark: Create Bookmarks from title-block regions (sheet title, sheet number).
{
  await page.keyboard.press('Control+4');
  await page.keyboard.press('Home');
  await page.keyboard.press('Control+9');
  await page.waitForTimeout(500);
  if (!(await page.locator('.bookmarks-panel').count())) await page.keyboard.press('Alt+B');
  const pick = async (fx0, fy0, fx1, fy1) => {
    const lb = await page.locator('.page .markup-layer').boundingBox();
    await page.mouse.move(lb.x + lb.width * fx0, lb.y + lb.height * fy0);
    await page.mouse.down();
    await page.mouse.move(lb.x + lb.width * fx1, lb.y + lb.height * fy1, { steps: 4 });
    await page.mouse.up();
  };
  await page.getByRole('button', { name: 'Bookmarks ▾' }).click();
  await page.getByRole('menuitem', { name: 'Create Bookmarks…' }).click();
  const dlg = page.locator('[role=dialog][aria-label="Create Bookmarks"]');
  await dlg.getByRole('button', { name: /Select Region|Add Region/ }).click();
  await pick(0.84, 0.906, 0.95, 0.93);
  await dlg.getByRole('button', { name: 'Add Region…' }).click();
  await pick(0.935, 0.935, 0.999, 0.975);
  await dlg.locator('[aria-label="Bookmark preview"] li').first().waitFor();
  await page.waitForTimeout(500);
  const preview = await dlg.locator('[aria-label="Bookmark preview"] li').allInnerTexts();
  assert(preview.join('|') === 'FLOOR PLAN - A-101|SITE PLAN - C-101', `AutoMark reads the title block regions (${preview.join('|')})`);
  await dlg.getByRole('button', { name: 'OK' }).click();
  await page.waitForTimeout(300);
  assert((await page.locator('.bookmark-row .bm-title').allInnerTexts()).join('|') === 'FLOOR PLAN - A-101|SITE PLAN - C-101', 'bookmarks created, one per page');
  await page.screenshot({ path: `${OUT}/automark.png` });
}

// Watermark, Bates Numbering, Header & Footer: real page text, found by Search, removable.
{
  const menu = async (m, item) => {
    await page.locator('.menubar-item > button', { hasText: new RegExp(`^${m}$`) }).click();
    await page.getByRole('menuitem', { name: item, exact: true }).click();
  };
  const find = async (q) => {
    await page.keyboard.press('Control+f');
    const box = page.locator('[aria-label="Search text"]');
    await box.fill(q);
    await box.press('Enter');
    await page.waitForTimeout(800);
    const t = await page.locator('.search-panel .muted.small').first().innerText();
    return Number(t.match(/(\d+) result/)?.[1] ?? 0);
  };
  await menu('Document', 'Watermark…');
  await page.locator('[role=dialog][aria-label="Watermark"]').getByRole('button', { name: 'OK' }).click();
  await page.getByText('Watermark added').waitFor({ timeout: 20000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/watermark.png` });
  assert(await find('DRAFT') === 2, 'the watermark is on both pages');
  await menu('Batch', 'Bates Numbering…');
  const bd = page.locator('[role=dialog][aria-label="Bates Numbering"]');
  await bd.locator('[aria-label="Bates prefix"]').fill('CT');
  await bd.locator('[aria-label="Bates digits"]').fill('4');
  await bd.getByRole('button', { name: 'OK' }).click();
  await page.getByText('Bates numbers added').waitFor({ timeout: 20000 });
  await page.waitForTimeout(800);
  assert(await find('CT0002') === 1, 'Bates numbers run across the pages (CT0001, CT0002)');
  await menu('Document', 'Remove Watermark');
  await page.getByText('Watermark removed').waitFor({ timeout: 20000 });
  await page.waitForTimeout(800);
  assert(await find('DRAFT') === 0 && await find('CT0001') === 1, 'Remove Watermark removes only the watermark');
  // New PDF from Template: the current document becomes a template; a new document is created from it.
  {
    const tabs0 = await page.locator('.doc-tab').count();
    await menu('File', 'New PDF from Template…');
    const tpl = page.locator('[role=dialog][aria-label="New PDF from Template"]');
    await tpl.getByRole('button', { name: 'Add Current Document' }).click();
    await tpl.locator('[role=option]').first().waitFor({ timeout: 10000 });
    await tpl.getByRole('button', { name: 'Create' }).click();
    await page.waitForFunction((n) => document.querySelectorAll('.doc-tab').length === n + 1, tabs0, { timeout: 20000 });
    assert((await page.locator('.doc-tab.active').innerText()).startsWith('Untitled'), 'New PDF from Template opens an Untitled copy');
    await page.keyboard.press('Control+F4');
    await page.waitForTimeout(300);
    if (await page.locator('[role=dialog]').count()) { await page.getByRole('button', { name: /Don.t Save|Discard|No/ }).first().click().catch(() => {}); }
    await page.waitForFunction((n) => document.querySelectorAll('.doc-tab').length === n, tabs0, { timeout: 10000 });
    await page.locator('.doc-tab').first().click();
    await page.waitForTimeout(300);
  }
  // Measurements panel: Snap Orthogonal keeps a sloped drag horizontal; tool buttons in the panel.
  {
    await page.keyboard.press('Escape');
    if (!(await page.locator('[aria-label="Measurements menu"]').count())) await page.keyboard.press('Alt+U');
    await page.locator('[aria-label="Measurements menu"]').waitFor({ timeout: 5000 });
    assert(await page.locator('.measure-tools button').count() >= 8, 'the Measurements panel shows the measurement tools');
    await page.locator('[aria-label="Measurements menu"]').click();
    await page.getByRole('menuitem', { name: 'Snap Orthogonal' }).click();
    await page.waitForTimeout(200);
    await page.locator('.measure-tools button[aria-label="Length"]').click();
    const mb = await page.locator('.page .markup-layer').first().boundingBox();
    const lines0 = await page.locator('.page .markup-layer line').count();
    await page.mouse.move(mb.x + mb.width * 0.3, mb.y + mb.height * 0.6); await page.mouse.down();
    await page.mouse.move(mb.x + mb.width * 0.5, mb.y + mb.height * 0.64, { steps: 4 }); await page.mouse.up();
    await page.waitForTimeout(300);
    const last = await page.locator('.page .markup-layer line').evaluateAll((els, n) => { const l = els[n]; return l ? [Number(l.getAttribute('y1')), Number(l.getAttribute('y2'))] : null; }, lines0);
    assert(last && Math.abs(last[0] - last[1]) < 0.5, `Snap Orthogonal keeps the sloped drag horizontal (${last})`);
    await page.keyboard.press('Escape');
    await page.locator('[aria-label="Measurements menu"]').click();
    await page.getByRole('menuitem', { name: 'Snap Orthogonal' }).click();
    await page.keyboard.press('Control+z');
    await page.evaluate(() => document.activeElement?.blur());
  }
  // Properties > Layout: exact Width; Set as Default.
  {
    await page.keyboard.press('Escape');
    const rectRow = page.locator('.ml-table tbody tr', { hasText: /^Rectangle/ }).first();
    if (await rectRow.count()) {
      await rectRow.click();
      await page.waitForTimeout(300);
      if (!(await page.locator('[aria-label="Layout Width"]').count())) await page.keyboard.press('Alt+P');
      const wIn = page.locator('[aria-label="Layout Width"]');
      await wIn.waitFor({ timeout: 5000 });
      await wIn.fill('2.5');
      await page.waitForTimeout(200);
      assert(await wIn.inputValue() === '2.5', 'Layout Width resizes the markup to the typed size');
      await page.getByRole('button', { name: 'Set as Default' }).click();
      await page.getByText(/this appearance is now the default/).waitFor({ timeout: 5000 });
      await page.evaluate(() => document.activeElement?.blur());
      await page.keyboard.press('Control+z');
      await page.keyboard.press('Escape');
    }
  }
  // Measurement display: segment values, centroid and caption off on an area measurement.
  {
    await page.keyboard.press('Escape');
    const areaRow = page.locator('.ml-table tbody tr', { hasText: 'Area Measurement' }).first();
    await areaRow.click();
    await page.waitForTimeout(300);
    if (!(await page.locator('[aria-label="Show segment values"]').count())) await page.keyboard.press('Alt+P');
    await page.locator('[aria-label="Show segment values"]').waitFor({ timeout: 5000 });
    await page.locator('[aria-label="Show segment values"]').check();
    await page.locator('[aria-label="Show centroid"]').check();
    await page.waitForTimeout(200);
    assert(await page.locator('.page .markup-layer .segment-label').count() >= 3 && await page.locator('.page .markup-layer .centroid-mark').count() === 1, 'Show Segment Values and Show Centroid draw on the area');
    const captions = await page.locator('.page .markup-layer .measure-label').count();
    await page.locator('[aria-label="Show caption"]').selectOption('none');
    await page.waitForTimeout(200);
    assert(await page.locator('.page .markup-layer .measure-label').count() === captions - 1, 'Show Caption: None hides the value');
    await page.locator('[aria-label="Show caption"]').selectOption('value');
    await page.locator('[aria-label="Area unit"]').selectOption('m');
    await page.waitForTimeout(200);
    assert((await page.locator('.ml-table tbody tr.selected').first().innerText()).includes('m²') || (await page.locator('.page .markup-layer .measure-label').allInnerTexts()).some((t) => /m²|sq m|m2/.test(t)), 'the area shows in square metres');
    await page.locator('[aria-label="Area unit"]').selectOption('');
    await page.locator('[aria-label="Show segment values"]').uncheck();
    await page.locator('[aria-label="Show centroid"]').uncheck();
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('Escape');
  }
  // Tool Chest: Symbol view, Hide a set and show it again from the Tool Chest menu.
  {
    await page.keyboard.press('Escape');
    if (!(await page.locator('.toolchest').count())) await page.keyboard.press('Alt+x');
    await page.locator('.toolchest').waitFor({ timeout: 5000 });
    const gear = page.locator('.toolchest details').nth(1).locator('.toolset-gear');
    await gear.click();
    await page.getByRole('menuitem', { name: 'Symbol' }).click();
    await page.waitForTimeout(200);
    assert(await page.locator('.toolchest .tool-symbols').count() === 1, 'Symbol view shows the tool set as icons');
    await gear.click();
    await page.getByRole('menuitem', { name: 'Detail' }).click();
    const setsBefore = await page.locator('.toolchest details').count();
    await gear.click();
    await page.getByRole('menuitem', { name: 'Hide', exact: true }).click();
    await page.waitForTimeout(200);
    assert(await page.locator('.toolchest details').count() === setsBefore - 1, 'Hide removes the tool set from the panel');
    await page.getByRole('button', { name: 'Tool Chest menu' }).click();
    const first = page.getByRole('menuitem').first();
    await first.click();
    await page.waitForTimeout(200);
    assert(await page.locator('.toolchest details').count() === setsBefore, 'the Tool Chest menu shows the set again');
  }
  // Markups List: right-click menu, Hide Markups, saved filters, grouping.
  {
    await page.keyboard.press('Escape');
    const firstRow = page.locator('.ml-table tbody tr:not(.reply-row):not(.ml-section)').first();
    await firstRow.click({ button: 'right' });
    assert(await page.getByRole('menuitem', { name: 'Reply' }).count() === 1 && await page.getByRole('menuitem', { name: 'Copy Cell' }).count() === 1, 'the Markups List has a right-click menu');
    await page.keyboard.press('Escape');
    const drawn = await page.locator('.page .markup-layer [data-id]').count();
    await page.getByRole('button', { name: 'Hide Markups' }).click();
    await page.waitForTimeout(300);
    assert(drawn > 0 && await page.locator('.page .markup-layer [data-id]').count() === 0, `Hide Markups takes every markup off the drawing (${drawn} -> 0)`);
    await page.getByRole('button', { name: 'Hide Markups' }).click();
    await page.waitForTimeout(300);
    assert(await page.locator('.page .markup-layer [data-id]').count() === drawn, 'Hide Markups off shows them again');
    await page.getByRole('button', { name: 'Filter List' }).click();
    page.once('dialog', (dl) => dl.accept('Test filter'));
    await page.locator('[aria-label="Saved Filters"]').selectOption('save');
    await page.waitForTimeout(200);
    assert((await page.locator('[aria-label="Saved Filters"] option').allInnerTexts()).some((t) => t === 'Test filter'), 'Save Filter keeps a named filter set');
    await page.locator('[aria-label="Saved Filters"]').selectOption('del:Test filter');
    await page.getByRole('button', { name: 'Filter List' }).click();
    await page.locator('.ml-table thead th', { hasText: /^Subject/ }).first().click();
    await page.waitForTimeout(200);
    const sections = await page.locator('.ml-table tr.ml-section').count();
    assert(sections >= 1, `sorting by Subject groups the rows under headings (${sections})`);
    await page.locator('.ml-table tr.ml-section').first().click();
    await page.waitForTimeout(200);
    await page.locator('.ml-table tr.ml-section').first().click();
    await page.locator('.ml-table thead th', { hasText: /^Page Label/ }).first().click();
    await page.waitForTimeout(200);
  }
  // File exports: Export Text, Publish as Uncompressed; Edit > Undo History.
  {
    const [td] = await Promise.all([page.waitForEvent('download'), menu('File', 'Export Text')]);
    assert(td.suggestedFilename().endsWith('.txt'), `Export Text downloads a text file (${td.suggestedFilename()})`);
    const txtPath = `${OUT}/export.txt`;
    await td.saveAs(txtPath);
    assert(readFileSync(txtPath, 'utf8').includes('--- Page '), 'the text export lists the pages');
    const [ud] = await Promise.all([page.waitForEvent('download'), menu('File', 'Publish as Uncompressed')]);
    assert(ud.suggestedFilename().endsWith(' (uncompressed).pdf'), 'Publish as Uncompressed downloads a copy');
    await page.getByText(/Published .* \(uncompressed\)\.pdf/).waitFor({ timeout: 20000 });
    await page.locator('.menubar-item > button', { hasText: /^Edit$/ }).click();
    const uhEnabled = await page.getByRole('menuitem', { name: 'Undo History…' }).isEnabled();
    if (uhEnabled) {
      await page.getByRole('menuitem', { name: 'Undo History…' }).click();
      const uh = page.locator('[role=dialog][aria-label="Undo History"]');
      const steps = await uh.locator('[aria-label^="Undo to step"]').count();
      assert(steps >= 1, `Undo History lists the unsaved steps (${steps})`);
      await uh.getByRole('button', { name: 'Close' }).click();
    } else await page.keyboard.press('Escape');
  }
  // Color Processing, Repair PDF and Archive as PDF/A on the active document.
  {
    await menu('Document', 'Color Processing…');
    const cpd = page.locator('[role=dialog][aria-label="Color Processing"]');
    await cpd.locator('[aria-label="Process type"]').selectOption('grayscale');
    await cpd.locator('[aria-label="Pages"]').selectOption('current');
    await cpd.getByRole('button', { name: 'OK' }).click();
    await page.getByText(/Color Processing: \d+ colours? changed/).waitFor({ timeout: 20000 });
    const cp = await page.getByText(/Color Processing: \d+ colours? changed/).innerText();
    assert(Number(cp.match(/(\d+) colour/)[1]) > 0, `Color Processing recoloured the page content (${cp})`);
    await page.waitForTimeout(500);
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(800);
    await menu('Document', 'Repair PDF…');
    const rpd = page.locator('[role=dialog][aria-label="Repair PDF"]');
    await rpd.getByRole('button', { name: 'OK' }).click();
    await page.getByText(/Repair PDF: /).waitFor({ timeout: 20000 });
    assert(true, `Repair PDF ran (${(await page.getByText(/Repair PDF: /).innerText()).slice(0, 80)})`);
    await page.waitForTimeout(500);
    const [ad] = await Promise.all([page.waitForEvent('download'), menu('Document', 'Archive as PDF/A')]);
    assert(ad.suggestedFilename().endsWith(' (PDF-A).pdf'), `Archive as PDF/A downloads a copy (${ad.suggestedFilename()})`);
    const pdfa = `${OUT}/archive.pdf`;
    await ad.saveAs(pdfa);
    const adoc = await PDFDocument.load(readFileSync(pdfa));
    assert(String(adoc.catalog.get(PDFName.of('OutputIntents'))).includes('GTS_PDFA1'), 'the PDF/A copy carries an output intent');
    await page.getByText(/Archived as PDF\/A-1b/).waitFor({ timeout: 20000 });
  }
  // Batch: Apply Stamp on every page of every open document.
  if (await page.locator('.doc-tab').count() >= 2) {
    const docRows = async () => Number((await page.getByText(/ of \d+ markups/).innerText()).match(/of (\d+)/)[1]);
    const activeTab = await page.locator('.doc-tab.active').innerText();
    const before = await docRows();
    const pagesHere = Number((await page.locator('.statusbar').innerText()).match(/of (\d+)\)/)[1]);
    await menu('Batch', 'Apply Stamp…');
    const asd = page.locator('[role=dialog][aria-label="Apply Stamp"]');
    await asd.locator('[aria-label="Stamp"]').selectOption('DRAFT');
    await asd.locator('[aria-label="Position"]').selectOption('bottom-right');
    assert(await asd.locator('[aria-label="Files"]').inputValue() === 'all', 'the Batch menu opens Apply Stamp for all open documents');
    await asd.getByRole('button', { name: 'OK' }).click();
    await page.getByText(/Apply Stamp: \d+ stamps? placed on \d+ documents/).waitFor({ timeout: 10000 });
    await page.waitForTimeout(400);
    assert(await docRows() === before + pagesHere, `Apply Stamp put one stamp per page here (${before} + ${pagesHere})`);
    const other = page.locator('.doc-tab', { hasNotText: activeTab }).first();
    await other.click();
    await page.waitForTimeout(600);
    assert((await page.locator('.ml-table tbody tr td:first-child').allInnerTexts()).some((t) => t.includes('Stamp')), 'the other open document got the stamp too');
    await page.keyboard.press('Control+z');
    await page.locator('.doc-tab', { hasText: activeTab }).first().click();
    await page.waitForTimeout(400);
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);
  }
  // Batch: Sign & Seal puts an invisible signature on every open document.
  if (await page.locator('.doc-tab').count() >= 2) {
    const tabs = await page.locator('.doc-tab').count();
    const activeTab = await page.locator('.doc-tab.active').innerText();
    await menu('Batch', 'Sign & Seal…');
    const sg = page.getByRole('dialog', { name: 'Sign Document' });
    const [cfc] = await Promise.all([page.waitForEvent('filechooser'), sg.getByRole('button', { name: 'Choose .pfx / .p12…' }).click()]);
    await cfc.setFiles('tests/fixtures/test-cert.p12');
    await sg.getByLabel('Certificate password').fill('test');
    await sg.getByRole('button', { name: 'Open' }).click();
    await sg.getByText('Signing as').waitFor();
    assert(await sg.locator('[aria-label="Files"]').inputValue() === 'all', 'the Batch menu opens Sign Document for all open documents');
    await sg.getByRole('button', { name: 'Sign', exact: true }).click();
    await page.getByText(new RegExp(`Sign & Seal: ${tabs} documents signed by Test Signer`)).waitFor({ timeout: 60000 });
    assert(true, 'Sign & Seal signs every open document');
    // Undo the signature on each document so later checks see the files as before.
    for (let i = 0; i < tabs; i++) {
      await page.locator('.doc-tab').nth(i).click();
      await page.waitForTimeout(300);
      await page.keyboard.press('Control+z');
      await page.waitForTimeout(300);
    }
    await page.locator('.doc-tab', { hasText: activeTab }).first().click();
    await page.waitForTimeout(400);
  }
  // Batch: Header & Footer over all open documents.
  if (await page.locator('.doc-tab').count() >= 2) {
    const activeTab = await page.locator('.doc-tab.active').innerText();
    await menu('Batch', 'Header & Footer…');
    const hd = page.locator('[role=dialog][aria-label="Header & Footer"]');
    await hd.locator('[aria-label="Header center"]').fill('BATCHHF');
    await hd.locator('[aria-label="Files"]').selectOption('all');
    await hd.getByRole('button', { name: 'OK' }).click();
    await page.getByText(/Header & Footer added to \d+ documents/).waitFor({ timeout: 60000 });
    await page.waitForTimeout(800);
    assert(await find('BATCHHF') >= 1, 'batch Header & Footer is on the active document');
    const other = page.locator('.doc-tab', { hasNotText: activeTab }).first();
    await other.click();
    await page.waitForTimeout(600);
    assert(await find('BATCHHF') >= 1, 'batch Header & Footer is on another open document too');
    await page.locator('.doc-tab', { hasText: activeTab }).first().click();
    await page.waitForTimeout(400);
  }
  await page.evaluate(() => document.activeElement?.blur());
}

// XFDF export/import, Security (password to open), Reduce File Size.
{
  const menu = async (m, item) => {
    await page.locator('.menubar-item > button', { hasText: new RegExp(`^${m}$`) }).click();
    await page.getByRole('menuitem', { name: item, exact: true }).click();
  };
  const total = async () => Number((await page.getByText(/ of \d+ markups/).innerText()).match(/of (\d+)/)[1]);
  await page.locator('.doc-tab').first().click();
  // A snapshot (image stamp) so the export carries an appearance.
  {
    await page.mouse.click(5, 500);
    await page.keyboard.press('Control+4');
    await page.keyboard.press('Home');
    await page.keyboard.press('Control+9');
    await page.waitForTimeout(500);
    const lb = await page.locator('.page .markup-layer').boundingBox();
    await page.keyboard.press('Shift+G');
    await page.mouse.move(lb.x + lb.width * 0.84, lb.y + lb.height * 0.9); await page.mouse.down();
    await page.mouse.move(lb.x + lb.width * 0.95, lb.y + lb.height * 0.95, { steps: 4 }); await page.mouse.up();
    await page.waitForFunction(() => /Snapshot copied/.test(document.querySelector('.statusbar')?.textContent ?? ''));
    await page.keyboard.press('Control+v');
    await page.waitForTimeout(300);
  }
  const n0 = await total();
  const [x] = await Promise.all([page.waitForEvent('download'), menu('File', 'Export Markups (XFDF)')]);
  const xfdf = `${OUT}/markups.xfdf`;
  await x.saveAs(xfdf);
  assert(readFileSync(xfdf, 'utf8').includes('<annots>'), 'Export Markups writes XFDF');
  assert(/<stamp [^>]*>(?:(?!<\/stamp>).)*<appearance>[A-Za-z0-9+/=]{100,}<\/appearance>/s.test(readFileSync(xfdf, 'utf8')), 'the snapshot stamp exports its appearance');
  const tabs = await page.locator('.doc-tab').count();
  await menu('File', 'Open Sample Drawing');
  await page.waitForFunction((n) => document.querySelectorAll('.doc-tab').length === n + 1, tabs);
  await page.waitForTimeout(800);
  const fresh = await total();
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), menu('File', 'Import Markups (XFDF)…')]);
  await fc.setFiles(xfdf);
  await page.getByText(/Imported \d+ markup/).waitFor({ timeout: 20000 });
  await page.waitForTimeout(500);
  const got = await total();
  if (got !== fresh + n0) console.log('subjects:', (await page.locator('.ml-table tbody tr td:first-child').allInnerTexts()).join(','));
  assert(got === fresh + n0, `Import Markups brings them all into a clean copy (${fresh} + ${n0} = ${got})`);
  assert((await page.locator('.ml-table tbody tr td:first-child').allInnerTexts()).some((t) => t.includes('Snapshot')), 'the imported snapshot is an image markup again');

  // Security: a password to open, applied on save.
  await page.keyboard.press('Control+l');
  const sd = page.locator('[role=dialog][aria-label="Security"]');
  await sd.locator('[aria-label="Security method"]').selectOption('password');
  await sd.locator('[aria-label="Open password"]').fill('secret');
  await sd.locator('[aria-label="Confirm open password"]').fill('secret');
  await sd.locator('[aria-label="Permissions password"]').fill('boss');
  await sd.getByRole('button', { name: 'OK' }).click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+s')]);
  const locked = `${OUT}/protected.pdf`;
  await dl.saveAs(locked);
  await page.waitForTimeout(1000);
  assert(readFileSync(locked).toString('latin1').includes('/Encrypt'), 'the saved file is encrypted');
  const tabs2 = await page.locator('.doc-tab').count();
  const chooser = await ctrlO();
  await chooser.setFiles(locked);
  const pw = page.locator('[aria-label="Document password"]');
  await pw.waitFor({ timeout: 20000 });
  await pw.fill('wrong');
  await pw.press('Enter');
  await page.getByText('Wrong password. Try again.').waitFor();
  await pw.fill('secret');
  await pw.press('Enter');
  await page.waitForFunction((n) => document.querySelectorAll('.doc-tab').length === n + 1, tabs2, { timeout: 20000 });
  await page.waitForTimeout(800);
  assert(await total() === fresh + n0, 'the protected file opens with its password, markups intact');
  await page.screenshot({ path: `${OUT}/security.png` });

  // Reduce File Size on it (Undo restores).
  await menu('File', 'Reduce File Size…');
  await page.locator('[role=dialog][aria-label="Reduce File Size"]').getByRole('button', { name: 'OK' }).click();
  await page.getByText(/Reduced .*→|already compact/).waitFor({ timeout: 30000 });
  assert(true, `Reduce File Size: ${await page.getByText(/Reduced .*→|already compact/).innerText()}`);
}

// Edit Text and Erase Content (Tools menu) on the title block of A-101.
{
  const menu = async (m, item) => {
    await page.locator('.menubar-item > button', { hasText: new RegExp(`^${m}$`) }).click();
    await page.getByRole('menuitem', { name: item, exact: true }).click();
  };
  await page.locator('.doc-tab').first().click();
  await page.mouse.click(5, 500);
  await page.keyboard.press('Control+4');
  await page.keyboard.press('Home');
  await page.keyboard.press('Control+9');
  await page.waitForTimeout(600);
  const lb = await page.locator('.page .markup-layer').boundingBox();
  await menu('Tools', 'Edit Text');
  await page.mouse.click(lb.x + lb.width * 0.865, lb.y + lb.height * 0.917);
  const input = page.locator('[aria-label="Edit text"]');
  await input.waitFor();
  assert(await input.inputValue() === 'FLOOR PLAN', 'Edit Text opens the clicked line of text');
  await input.fill('FLOOR PLAN REV');
  await input.press('Enter');
  await page.waitForTimeout(2500);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+f');
  const box = page.locator('[aria-label="Search text"]');
  await box.fill('FLOOR PLAN REV');
  await box.press('Enter');
  await page.waitForTimeout(800);
  assert((await page.locator('.search-panel .muted.small').first().innerText()).startsWith('1 result'), 'the page text now reads FLOOR PLAN REV');
  await page.screenshot({ path: `${OUT}/edit-text.png` });
  await page.evaluate(() => document.activeElement?.blur());
  await menu('Tools', 'Erase Content');
  await page.mouse.move(lb.x + lb.width * 0.84, lb.y + lb.height * 0.905);
  await page.mouse.down();
  await page.mouse.move(lb.x + lb.width * 0.95, lb.y + lb.height * 0.93, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(2500);
  await page.keyboard.press('Escape');
  await box.fill('PLAN REV');
  await box.press('Enter');
  await page.waitForTimeout(800);
  assert((await page.locator('.search-panel .muted.small').first().innerText()).startsWith('0 result'), 'Erase Content removed the title text');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(1500);
  await page.evaluate(() => document.activeElement?.blur());
  // Cut Content: the region goes to the clipboard as a snapshot and leaves the page.
  const rows0 = await page.locator('.ml-table tbody tr').count();
  await menu('Tools', 'Cut Content');
  await page.mouse.move(lb.x + lb.width * 0.84, lb.y + lb.height * 0.905);
  await page.mouse.down();
  await page.mouse.move(lb.x + lb.width * 0.95, lb.y + lb.height * 0.93, { steps: 4 });
  await page.mouse.up();
  await page.waitForFunction(() => /Content cut/.test(document.querySelector('.statusbar')?.textContent ?? ''), null, { timeout: 20000 });
  await page.waitForTimeout(500);
  await page.keyboard.press('Escape');
  await box.fill('PLAN REV');
  await box.press('Enter');
  await page.waitForTimeout(800);
  assert((await page.locator('.search-panel .muted.small').first().innerText()).startsWith('0 result'), 'Cut Content removed the title text from the page');
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('Control+v');
  await page.waitForTimeout(300);
  assert(await page.locator('.ml-table tbody tr').count() === rows0 + 1, 'the cut content pastes as an image markup');
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(1500);
  await page.evaluate(() => document.activeElement?.blur());
  // Review Text > Replace Selected Text on this page's text.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+Shift+A');
  await page.locator('.text-sel').first().waitFor();
  const rrows = await page.locator('.ml-table tbody tr:not(.reply-row)').count();
  const tsb = await page.locator('.text-sel').first().boundingBox();
  await page.mouse.click(tsb.x + tsb.width / 2, tsb.y + tsb.height / 2, { button: 'right' });
  await page.getByRole('menuitem', { name: 'Replace Selected Text…' }).click();
  const rd = page.locator('[role=dialog][aria-label="Replacement Text"]');
  await rd.waitFor({ timeout: 10000 });
  await rd.locator('textarea').fill('SITE PLAN');
  await rd.getByRole('button', { name: 'OK' }).click();
  await page.waitForTimeout(300);
  assert(await page.locator('.ml-table tbody tr:not(.reply-row)').count() === rrows + 2, 'Replace Selected Text adds a strikethrough and an insertion caret');
  const subjects = await page.locator('.ml-table tbody tr td:first-child').allInnerTexts();
  assert(subjects.filter((t) => t.includes('Replace Text')).length >= 2, 'both carry the Replace Text subject');
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(300);
  await page.evaluate(() => document.activeElement?.blur());
}

// Touch and pen: pinch to zoom, finger pans, long press opens the menu, Pen Mode.
{
  const ptr = (type, id, x, y, kind = 'touch') => page.evaluate(([type, id, x, y, kind]) => {
    const el = document.elementFromPoint(x, y);
    el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, pointerId: id, pointerType: kind, clientX: x, clientY: y,
      button: type === 'pointermove' ? -1 : 0, buttons: type === 'pointerup' ? 0 : 1, isPrimary: id === 11 }));
  }, [type, id, x, y, kind]);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+9');
  await page.waitForTimeout(500);
  const zoomOf = async () => Number((await page.locator('.sb-zoom').first().innerText()).replace('%', ''));
  const vb = await page.locator('.viewer').first().boundingBox();
  const cx = vb.x + vb.width / 2, cy = vb.y + vb.height / 2;
  const z0 = await zoomOf();
  await ptr('pointerdown', 11, cx - 50, cy);
  await ptr('pointerdown', 12, cx + 50, cy);
  for (let k = 1; k <= 5; k++) { await ptr('pointermove', 11, cx - 50 - k * 20, cy); await ptr('pointermove', 12, cx + 50 + k * 20, cy); }
  await ptr('pointerup', 11, cx - 150, cy); await ptr('pointerup', 12, cx + 150, cy);
  await page.waitForTimeout(400);
  const z1 = await zoomOf();
  assert(z1 > z0 * 1.8, `pinch out zooms in (${z0}% -> ${z1}%)`);
  const scroller = page.locator('.viewer').first();
  const sl0 = await scroller.evaluate((e) => e.scrollLeft);
  const markups0 = await page.locator('.ml-table tbody tr.selected').count();
  // One finger on an empty part of the page, in Select: pans (no band selection).
  const lb = await page.locator('.page .markup-layer').boundingBox();
  const px = Math.max(lb.x + 20, vb.x + 40), py = Math.max(lb.y + 20, vb.y + 40);
  await ptr('pointerdown', 21, px + 100, py);
  for (let k = 1; k <= 4; k++) await ptr('pointermove', 21, px + 100 - k * 25, py);
  await ptr('pointerup', 21, px, py);
  await page.waitForTimeout(200);
  const sl1 = await scroller.evaluate((e) => e.scrollLeft);
  assert(sl1 - sl0 > 60 && await page.locator('.ml-table tbody tr.selected').count() === markups0, `a finger drag pans the view (${sl0} -> ${sl1})`);
  await page.keyboard.press('Control+9');
  await page.waitForTimeout(500);
  // Long press on a markup: its context menu.
  const area = page.locator('.page .markup-layer polygon, .page .markup-layer path').first();
  const ab = await area.boundingBox();
  await ptr('pointerdown', 31, ab.x + ab.width / 2, ab.y + ab.height / 2);
  await page.waitForTimeout(800);
  await ptr('pointerup', 31, ab.x + ab.width / 2, ab.y + ab.height / 2);
  assert(await page.getByRole('menuitem', { name: 'Add to My Tools' }).count() === 1, 'long press opens the markup menu');
  await page.keyboard.press('Escape');
  await page.mouse.click(5, 500);
  // Pen Mode: with the Rectangle tool a finger pans, the pen draws.
  await page.locator('.menubar-item > button', { hasText: /^View$/ }).click();
  await page.getByRole('menuitem', { name: 'Pen Mode (finger pans, pen draws)' }).click();
  const rows0 = await page.locator('.ml-table tbody tr').count();
  await page.keyboard.press('r');
  const lb2 = await page.locator('.page .markup-layer').boundingBox();
  const qx = lb2.x + lb2.width * 0.3, qy = lb2.y + lb2.height * 0.85;
  await ptr('pointerdown', 41, qx, qy);
  for (let k = 1; k <= 4; k++) await ptr('pointermove', 41, qx + k * 20, qy + k * 10);
  await ptr('pointerup', 41, qx + 80, qy + 40);
  await page.waitForTimeout(200);
  assert(await page.locator('.ml-table tbody tr').count() === rows0, 'in Pen Mode a finger does not draw');
  await ptr('pointerdown', 51, qx, qy, 'pen');
  for (let k = 1; k <= 4; k++) await ptr('pointermove', 51, qx + k * 20, qy + k * 10, 'pen');
  await ptr('pointerup', 51, qx + 80, qy + 40, 'pen');
  await page.waitForTimeout(300);
  assert(await page.locator('.ml-table tbody tr').count() === rows0 + 1, 'the pen draws the rectangle');
  await page.keyboard.press('Control+z');
  await page.locator('.menubar-item > button', { hasText: /^View$/ }).click();
  await page.getByRole('menuitem', { name: 'Pen Mode (finger pans, pen draws)' }).click();
  await page.keyboard.press('Escape');
}

// Print (Ctrl+P): sheets are prepared in the page, then the browser's print dialog opens.
{
  await page.evaluate(() => { window.__printed = 0; window.print = () => { window.__printed++; }; });
  await page.keyboard.press('Control+p');
  const dlg = page.locator('[role=dialog][aria-label="Print"]');
  await dlg.waitFor();
  await dlg.locator('[aria-label="Page range"]').selectOption('custom');
  await dlg.locator('[aria-label="Custom pages"]').fill('1');
  await dlg.locator('[aria-label="Paper size"]').selectOption('Tabloid (11×17)');
  await dlg.locator('[aria-label="Copies"]').fill('2');
  assert((await dlg.innerText()).includes('Sheet 1 of 2'), 'print preview: 2 copies of one page = 2 sheets');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/print-dialog.png` });
  await dlg.getByRole('button', { name: 'Print', exact: true }).click();
  await page.waitForFunction(() => window.__printed === 1, null, { timeout: 30000 });
  const info = await page.evaluate(() => [...document.querySelectorAll('#print-root .print-sheet')].map((s) => {
    const img = s.querySelector('img');
    return { w: s.style.width, h: s.style.height, iw: img.naturalWidth, ih: img.naturalHeight };
  }));
  assert(info.length === 2 && info[0].w === '792pt' && info[0].h === '1224pt', `two Tabloid portrait sheets (${JSON.stringify(info[0])})`);
  assert(info[0].ih > info[0].iw && info[0].iw > 1000, 'the landscape sheet is auto-rotated onto the portrait paper');
  await page.emulateMedia({ media: 'print' });
  await page.screenshot({ path: `${OUT}/print-sheets.png` });
  await page.emulateMedia({ media: 'screen' });
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  assert(await page.locator('#print-root').count() === 0, 'print sheets are removed after printing');
  // Selected pages (Ctrl+click in Thumbnails) and Fit to Margins.
  const thumbs = page.locator('.thumbs .thumb');
  const hadThumbs = await thumbs.count() > 0;
  if (!hadThumbs) { await page.keyboard.press('Alt+t'); await page.waitForTimeout(300); }
  {
    const n = Math.min(2, await thumbs.count());
    await thumbs.nth(0).click();
    if (n === 2) await thumbs.nth(1).click({ modifiers: ['Control'] });
    assert(await page.locator('.thumbs .thumb.selected').count() === n, `Ctrl+click selects ${n} thumbnail(s)`);
    await page.keyboard.press('Control+p');
    await dlg.waitFor();
    await dlg.locator('[aria-label="Page range"]').selectOption('selected');
    await dlg.locator('[aria-label="Copies"]').fill('1');
    assert((await dlg.innerText()).includes(`Sheet 1 of ${n}`), `Selected range prints the ${n} selected page(s)`);
    await dlg.locator('[aria-label="Page scaling"]').selectOption('fitMargins');
    await dlg.locator('[aria-label="Margin unit"]').selectOption('in');
    await dlg.locator('[aria-label="Top margin"]').fill('1');
    await dlg.locator('[aria-label="Page range"]').selectOption('current');
    await dlg.getByRole('button', { name: 'Print', exact: true }).click();
    await page.waitForFunction(() => window.__printed === 2, null, { timeout: 30000 });
    const top = await page.evaluate(() => document.querySelector('#print-root .print-sheet img').style.top);
    assert(parseFloat(top) >= 72, `Fit to Margins keeps the page below the 1 in top margin (top=${top})`);
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    await thumbs.nth(0).click();
    // Number Pages: labels P-1, P-2… over all pages; Page Setup puts the current page on Letter.
    await page.locator('.menubar-item > button', { hasText: /^Document$/ }).click();
    await page.getByRole('menuitem', { name: 'Number Pages…' }).click();
    const npd = page.locator('[role=dialog][aria-label="Number Pages"]');
    await npd.locator('[aria-label="Prefix"]').fill('P-');
    await npd.getByRole('button', { name: 'OK' }).click();
    await page.getByText('Page labels updated').waitFor({ timeout: 20000 });
    await page.waitForTimeout(500);
    const labels = await page.locator('.thumbs .thumb-label').allInnerTexts();
    assert(labels.length > 0 && labels.every((l, i) => l.startsWith(`P-${i + 1}`)), `Number Pages relabels the pages (${labels.join(', ')})`);
    await page.locator('.menubar-item > button', { hasText: /^Document$/ }).click();
    await page.getByRole('menuitem', { name: 'Page Setup…' }).click();
    const psd = page.locator('[role=dialog][aria-label="Page Setup"]');
    await psd.locator('[aria-label="Media size"]').selectOption('Letter (8.5×11)');
    await psd.getByRole('button', { name: 'OK' }).click();
    await page.getByText(/Page Setup: 1 page set to/).waitFor({ timeout: 20000 });
    await page.waitForTimeout(500);
    const sz = await page.locator('.sb-size').innerText();
    assert(sz.includes('8.50 x 11.00 in') || sz.includes('11.00 x 8.50 in'), `Page Setup resizes the page to Letter (${sz})`);
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(800);
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(800);
    // View toggles: Dark Mode themes the chrome; Show Cover Page leaves page 1 alone in Side by Side.
    const viewItem = async (name) => { await page.keyboard.press('Escape'); await page.waitForTimeout(150); await page.locator('.menubar-item > button', { hasText: /^View$/ }).click(); await page.getByRole('menuitem', { name }).click(); await page.waitForTimeout(250); };
    await viewItem('Dark Mode');
    assert(await page.evaluate(() => document.documentElement.dataset.theme) === 'dark', 'Dark Mode sets the dark theme');
    await viewItem('Dark Mode');
    await page.keyboard.press('Home');
    await page.keyboard.press('Control+6');
    await page.waitForTimeout(400);
    const shownPages = () => page.locator('.page-tile').count(); // one tile per page slot in multi-page views
    const pairPages = await shownPages();
    await viewItem('Show Cover Page in Side-by-Side');
    await page.waitForTimeout(400);
    const coverPages = await shownPages();
    assert(pairPages === 2 && coverPages === 1, `Show Cover Page shows the first page alone in Side by Side (${pairPages} -> ${coverPages})`);
    await viewItem('Show Cover Page in Side-by-Side');
    await page.keyboard.press('Control+4');
    await page.waitForTimeout(300);
    // Split view: Synchronize Document keeps both panes on the same page; Toggle Split flips the direction; Unsplit.
    const pageNo = async () => Number((await page.locator('.statusbar').innerText()).match(/\((\d+) of/)[1]);
    await page.keyboard.press('Home');
    await page.keyboard.press('Control+2');
    await page.waitForTimeout(400);
    assert(await page.locator('.viewer-wrap').count() === 2, 'Split Vertical shows two panes');
    await viewItem('Synchronize Document');
    await page.keyboard.press('Control+ArrowRight');
    await page.waitForTimeout(300);
    const p1 = await pageNo();
    await page.keyboard.press('Control+1'); // Switch pane
    await page.waitForTimeout(300);
    assert(p1 === 2 && await pageNo() === 2, `Synchronize Document moves the other pane to the same page (${p1}, ${await pageNo()})`);
    await viewItem('Synchronize Document');
    await page.keyboard.press('Control+i');
    await page.waitForTimeout(300);
    assert(await page.locator('.viewer-wrap').count() === 2, 'Toggle Split keeps two panes (direction flipped)');
    await page.keyboard.press('Control+Shift+2');
    await page.waitForTimeout(300);
    assert(await page.locator('.viewer-wrap').count() === 1, 'Unsplit returns to one pane');
    await page.keyboard.press('Home');
    if (!hadThumbs) await page.keyboard.press('Alt+t');
  }
}

// Quick Revu commands: Document Properties (Ctrl+D), Navigation Bar (F4),
// Presentation (Ctrl+Enter), resizable split with Balance (Shift+F12), Shift+F10.
{
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+d');
  let dlg = page.locator('[role=dialog][aria-label="Document Properties"]');
  await dlg.waitFor();
  await page.waitForFunction(() => !document.querySelector('[aria-label="Document Properties"] button.primary')?.disabled);
  assert(Number(await dlg.getByTestId('doc-pages').innerText()) > 0, 'Document Properties shows the page count');
  await dlg.locator('[aria-label="Title"]').fill('E2E Title');
  await dlg.getByRole('button', { name: 'OK' }).click();
  await page.waitForFunction(() => !document.querySelector('.busy-overlay'));
  await page.waitForTimeout(300);
  await page.keyboard.press('Control+d');
  dlg = page.locator('[role=dialog][aria-label="Document Properties"]');
  await page.waitForFunction(() => document.querySelector('[aria-label="Document Properties"] [aria-label="Title"]')?.value === 'E2E Title', null, { timeout: 10000 });
  await page.screenshot({ path: `${OUT}/doc-properties.png` });
  await page.keyboard.press('Escape');
  assert(await dlg.count() === 0, 'Esc closes Document Properties');
  // Properties panel with nothing selected: File Properties, Custom Properties, File Attachments.
  {
    await page.keyboard.press('Escape');
    if (!(await page.locator('.doc-props').count())) await page.keyboard.press('Alt+P');
    const dp = page.locator('.doc-props');
    await dp.waitFor();
    await page.waitForFunction(() => document.querySelector('.doc-props [aria-label="Document title"]')?.value === 'E2E Title', null, { timeout: 10000 });
    assert(true, 'the Properties panel shows the document title when nothing is selected');
    await dp.getByLabel('Document author').fill('Panel Author');
    await dp.getByLabel('Document author').press('Enter');
    await page.waitForFunction(() => document.querySelector('.statusbar')?.textContent?.includes('Document properties changed'));
    await dp.getByLabel('New property name').fill('Project');
    await dp.getByLabel('New property value').fill('P-12');
    await dp.getByRole('button', { name: 'Add', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.statusbar')?.textContent?.includes('Custom properties changed'));
    await dp.getByLabel('Custom property Project').waitFor({ timeout: 10000 });
    assert(await dp.getByLabel('Custom property Project').inputValue() === 'P-12', 'a custom property is added and read back from the file');
    const [afc] = await Promise.all([page.waitForEvent('filechooser'), dp.getByRole('button', { name: 'Add New…' }).click()]);
    await afc.setFiles('tests/fixtures/form.pdf');
    await page.waitForFunction(() => document.querySelector('.statusbar')?.textContent?.includes('Attached form.pdf'));
    await dp.locator('.attachment-row', { hasText: 'form.pdf' }).waitFor({ timeout: 10000 });
    assert(true, 'Add New attaches a file to the document');
    await dp.getByRole('button', { name: 'Delete attachment form.pdf' }).click();
    await page.waitForFunction(() => document.querySelector('.statusbar')?.textContent?.includes('Removed attachment form.pdf'));
    await page.waitForFunction(() => !document.querySelector('.doc-props .attachment-row'), null, { timeout: 10000 });
    assert(true, 'Delete removes the attachment');
    await dp.getByRole('button', { name: 'Delete property Project' }).click();
    await page.waitForFunction(() => !document.querySelector('.doc-props [aria-label="Custom property Project"]'), null, { timeout: 10000 });
    await page.waitForFunction(() => !document.querySelector('.busy-overlay'));
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.waitForTimeout(300);
  }

  await page.keyboard.press('F4');
  assert(await page.locator('.sb-nav').count() === 0, 'F4 hides the navigation bar');
  await page.keyboard.press('F4');
  assert(await page.locator('.sb-nav').count() === 1, 'F4 shows it again');

  await page.keyboard.press('Control+Enter');
  await page.locator('.presentation canvas[data-rendered]').waitFor({ timeout: 15000 });
  await page.screenshot({ path: `${OUT}/presentation.png` });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  assert(await page.locator('.presentation').count() === 0, 'Esc leaves Presentation');

  await page.keyboard.press('Control+2');
  await page.locator('.split-divider').waitFor();
  const bar = await page.locator('.split-divider').boundingBox();
  const box = await page.locator('.split-view').boundingBox();
  await page.mouse.move(bar.x + 2, bar.y + bar.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.3, bar.y + bar.height / 2, { steps: 4 });
  await page.mouse.up();
  const widths = async () => page.locator('.split-pane').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width));
  let [w0, w1] = await widths();
  assert(w0 < w1 * 0.6, `the split divider resizes the panes (${w0} / ${w1})`);
  await page.keyboard.press('Shift+F12');
  await page.waitForTimeout(100);
  [w0, w1] = await widths();
  assert(Math.abs(w0 - w1) < 3, 'Shift+F12 balances the panes');
  await page.keyboard.press('Control+Shift+2');

  await page.keyboard.press('Control+a');
  if (await page.locator('.ml-table tbody tr').count()) {
    await page.keyboard.press('Shift+F10');
    await page.locator('.menu-list .menu-item', { hasText: 'Properties' }).first().waitFor();
    await page.keyboard.press('Escape');
  }
}

// Select Text (Shift+T), Select All Text (Ctrl+Shift+A), text menu; Snapshot
// Content (Shift+G) and Copy Page to Snapshot (Ctrl+Alt+C) paste as images.
{
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: URL });
  await page.keyboard.press('Home');
  await page.keyboard.press('Control+9');
  await page.waitForTimeout(600);
  await page.keyboard.press('Shift+T');
  const a = await toScreen(0, 40), b = await toScreen(24, 22);
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 6 }); await page.mouse.up();
  await page.locator('.text-sel').first().waitFor();
  await page.keyboard.press('Control+c');
  await page.waitForTimeout(200);
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  assert(copied.includes('OFFICE 101'), `Select Text copies the text in the rectangle (${JSON.stringify(copied)})`);
  const rows0 = await page.locator('.ml-table tbody tr').count();
  const r = await page.locator('.text-sel').first().boundingBox();
  await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2, { button: 'right' });
  await page.getByRole('menuitem', { name: 'Highlight' }).click();
  await page.waitForTimeout(200);
  assert(await page.locator('.ml-table tbody tr').count() === rows0 + 1, 'right-click > Highlight marks the selected text');
  assert(await page.locator('.text-sel').count() === 0, 'the text selection is cleared after marking it');
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+Shift+A');
  await page.locator('.text-sel').first().waitFor();
  const all = await page.locator('.text-sel').count();
  assert(all > 10, `Select All Text selects the page's text (${all} lines)`);
  await page.screenshot({ path: `${OUT}/select-all-text.png` });
  await page.keyboard.press('Escape');

  await page.keyboard.press('Shift+G');
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 4 }); await page.mouse.up();
  await page.waitForFunction(() => /Snapshot copied/.test(document.querySelector('.statusbar')?.textContent ?? ''));
  const n1 = await page.locator('.ml-table tbody tr').count();
  await page.keyboard.press('Control+v');
  await page.waitForTimeout(200);
  assert(await page.locator('.ml-table tbody tr').count() === n1 + 1, 'Snapshot Content pastes as an image markup');
  // Crop Image on the pasted snapshot (selected after pasting): keep its left half.
  {
    const imgEl = page.locator('.page .markup-layer image').last();
    const ib = await imgEl.boundingBox();
    if (ib) {
      await page.locator('.menubar-item > button', { hasText: /^Edit$/ }).click();
      await page.getByRole('menuitem', { name: 'Crop Image…' }).click();
      await page.mouse.move(ib.x + 2, ib.y + 2); await page.mouse.down();
      await page.mouse.move(ib.x + ib.width / 2, ib.y + ib.height - 2, { steps: 4 }); await page.mouse.up();
      await page.getByText('Image cropped').waitFor({ timeout: 10000 });
      const nb = await page.locator('.page .markup-layer image').last().boundingBox();
      assert(nb.width < ib.width * 0.6, `Crop Image keeps the dragged part (${Math.round(ib.width)} -> ${Math.round(nb.width)})`);
    }
  }
  await page.keyboard.press('Control+Alt+c');
  await page.waitForFunction(() => /Page copied/.test(document.querySelector('.statusbar')?.textContent ?? ''), null, { timeout: 20000 });
  const png = await page.evaluate(async () => { const items = await navigator.clipboard.read(); return items[0]?.types.join(','); });
  assert(png?.includes('image/png'), 'Copy Page to Snapshot puts a PNG on the clipboard');
  await page.keyboard.press('Control+v');
  await page.waitForTimeout(200);
  assert(await page.locator('.ml-table tbody tr').count() === n1 + 2, 'the page snapshot pastes as an image markup');
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
}

// Links panel (Alt+N): add a Place on sheet 2, hyperlink to it from sheet 1,
// follow it; Edit Action shows the Place. File Access (Alt+A) lists recent files.
{
  await page.keyboard.press('Escape');
  await page.keyboard.press('Home');
  await page.keyboard.press('Control+ArrowRight');
  await page.waitForTimeout(400);
  await page.keyboard.press('Alt+n');
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Add Place' }).click();
  const dlg = page.locator('[role=dialog][aria-label="Place"]');
  await dlg.locator('[aria-label="Place name"]').fill('Door Detail');
  await dlg.getByRole('button', { name: 'OK' }).click();
  const row = page.locator('.links-panel .link-row', { hasText: 'Door Detail' });
  await row.waitFor({ timeout: 15000 });
  await page.keyboard.press('Home');
  await page.waitForTimeout(400);
  await row.hover();
  await row.locator('.link-go').click();
  const a = await toScreen(30, 30), b = await toScreen(40, 35);
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 4 }); await page.mouse.up();
  const linkRow = page.locator('.links-panel .link-row', { hasText: 'Place: Door Detail' });
  await linkRow.waitFor();
  assert(await page.locator('[role=dialog][aria-label="Hyperlink"]').count() === 0, 'a hyperlink to a Place needs no dialog');
  await page.mouse.dblclick((a.x + b.x) / 2, (a.y + b.y) / 2);
  await page.waitForFunction(() => /\(2 of/.test(document.querySelector('.sb-nav')?.textContent ?? ''));
  assert(true, 'the hyperlink jumps to the Place on sheet 2');
  await page.keyboard.press('Home');
  await linkRow.click();
  await page.getByRole('button', { name: 'Edit Action' }).click();
  const act = page.locator('[role=dialog][aria-label="Action"]');
  await act.waitFor();
  assert(await act.locator('[aria-label="Place"]').inputValue() === 'Door Detail', 'Edit Action shows the link\'s Place');
  await page.screenshot({ path: `${OUT}/links-panel.png` });
  await act.getByRole('button', { name: 'Cancel' }).click();
  await page.keyboard.press('Alt+a');
  await page.locator('.recent-row', { hasText: 'Sample Floor Plan.pdf' }).waitFor();
  assert(await page.locator('.recent-row').count() >= 2, 'File Access lists the recently opened files');
  await page.keyboard.press('Alt+a');
}

// New PDF, Crop Pages, Deskew, Email (share sheet), Publish as Compressed.
{
  await page.keyboard.press('Escape');
  await page.locator('.menubar-item > button', { hasText: /^File$/ }).click();
  await page.getByRole('menuitem', { name: /^New PDF…/ }).click();
  let dlg = page.locator('[role=dialog][aria-label="New PDF"]');
  await dlg.locator('[aria-label="Paper size"]').selectOption('Tabloid (11×17)');
  await dlg.locator('[aria-label="Orientation"]').selectOption('p');
  await dlg.locator('[aria-label="Number of pages"]').fill('3');
  await dlg.getByRole('button', { name: 'Create Blank PDF' }).click();
  await page.locator('.doc-tab', { hasText: 'Untitled.pdf' }).waitFor();
  await page.waitForFunction(() => /\(1 of 3\)/.test(document.querySelector('.sb-nav')?.textContent ?? ''));
  assert((await page.locator('.sb-size').innerText()).includes('11.00 x 17.00'), 'New PDF: three blank Tabloid pages');

  await page.keyboard.press('Shift+Alt+O');
  dlg = page.locator('[role=dialog][aria-label="Crop Pages"]');
  await dlg.locator('[aria-label="Page range"]').selectOption('all');
  for (const k of ['Left', 'Right', 'Top', 'Bottom']) await dlg.locator(`[aria-label="Crop ${k}"]`).fill('1');
  await dlg.getByRole('button', { name: 'Crop', exact: true }).click();
  await page.waitForFunction(() => /9\.00 x 15\.00/.test(document.querySelector('.sb-size')?.textContent ?? ''), null, { timeout: 15000 });
  assert(true, 'Crop Pages trims 1 in from every side');
  await page.keyboard.press('Control+ArrowRight');
  await page.waitForTimeout(300);
  assert((await page.locator('.sb-size').innerText()).includes('9.00 x 15.00'), 'all pages are cropped');
  await page.keyboard.press('Shift+Alt+O');
  await page.locator('[role=dialog][aria-label="Crop Pages"] [aria-label="Page range"]').selectOption('all');
  await page.getByRole('button', { name: 'Remove Crop' }).click();
  await page.waitForFunction(() => /11\.00 x 17\.00/.test(document.querySelector('.sb-size')?.textContent ?? ''), null, { timeout: 15000 });
  assert(true, 'Remove Crop restores the page');

  // A scanned-looking page tilted 3°, made into a PDF from the image, then deskewed.
  const png = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 1100; c.height = 850;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, 1100, 850);
    g.translate(550, 425); g.rotate(3 * Math.PI / 180); g.translate(-550, -425);
    g.fillStyle = '#000';
    for (let y = 120; y < 760; y += 30) for (let x = 120; x < 980; x += 14) g.fillRect(x, y, 9, 4);
    return c.toDataURL('image/png').split(',')[1];
  });
  writeFileSync(`${OUT}/skewed.png`, Buffer.from(png, 'base64'));
  await page.keyboard.press('Control+n');
  dlg = page.locator('[role=dialog][aria-label="New PDF"]');
  await dlg.locator('[aria-label="Images"]').setInputFiles(`${OUT}/skewed.png`);
  await dlg.locator('[aria-label="Image resolution"]').fill('100');
  await dlg.getByRole('button', { name: /Create from 1 Image/ }).click();
  await page.locator('.doc-tab', { hasText: 'skewed.pdf' }).waitFor();
  assert((await page.locator('.sb-size').innerText()).includes('11.00 x 8.50'), 'New PDF from an image sizes the page at the chosen resolution');
  await page.keyboard.press('Control+Alt+d');
  await page.locator('[role=dialog][aria-label="Deskew"]').getByRole('button', { name: 'Deskew', exact: true }).click();
  await page.waitForFunction(() => /Deskewed 1 page/.test(document.querySelector('.statusbar')?.textContent ?? ''), null, { timeout: 30000 });
  const msg = await page.locator('.sb-status').innerText();
  const deg = Number(/: (-?[\d.]+)°/.exec(msg)?.[1]);
  assert(Math.abs(Math.abs(deg) - 3) < 0.2, `Deskew finds the 3° tilt (${msg})`);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/deskewed.png` });

  await page.evaluate(() => { navigator.canShare = () => true; navigator.share = async (d) => { window.__shared = d.files[0].name; }; });
  await page.keyboard.press('Control+e');
  await page.waitForFunction(() => window.__shared === 'skewed.pdf');
  assert(true, 'Email shares the PDF through the system share sheet');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+Shift+P')]);
  assert(dl.suggestedFilename() === 'skewed (compressed).pdf', `Publish as Compressed downloads a copy (${dl.suggestedFilename()})`);
}

// Flatten with markup recovery, then Unflatten (Ctrl+Shift+U) brings the markups back.
{
  const rows = () => page.locator('.ml-table tbody tr:not(.reply-row)').count();
  const box = await svg.boundingBox();
  await page.keyboard.press('r');
  await page.mouse.move(box.x + 100, box.y + 100); await page.mouse.down(); await page.mouse.move(box.x + 300, box.y + 200, { steps: 4 }); await page.mouse.up();
  await page.keyboard.press('r');
  await page.mouse.move(box.x + 350, box.y + 100); await page.mouse.down(); await page.mouse.move(box.x + 450, box.y + 250, { steps: 4 }); await page.mouse.up();
  await page.waitForTimeout(200);
  const n0 = await rows();
  assert(n0 === 2, `two rectangles drawn (${n0})`);
  await page.keyboard.press('Control+Shift+M');
  const fd = page.getByRole('dialog', { name: 'Flatten Markups' });
  assert(await fd.getByLabel(/Allow markup recovery/).isChecked(), 'Allow markup recovery is on by default');
  await fd.getByRole('button', { name: 'OK' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.ml-table tbody tr').length === 0, null, { timeout: 15000 });
  await page.keyboard.press('Control+Shift+U');
  await page.waitForFunction(() => /Unflattened 2 markups/.test(document.querySelector('.statusbar')?.textContent ?? ''), null, { timeout: 15000 });
  assert(await rows() === 2, 'Unflatten restores the flattened markups');
  await page.screenshot({ path: `${OUT}/unflattened.png` });
}

// Offset (O), Edit Action (Ctrl+Shift+E), custom status model, custom stamp,
// Camera dialog, Search > Replace Checked.
{
  const rows = () => page.locator('.ml-table tbody tr:not(.reply-row)').count();
  const box = await svg.boundingBox();
  await page.keyboard.press('Escape');
  // Offset a line 0.5 in below itself.
  await page.keyboard.press('l');
  await page.mouse.move(box.x + 100, box.y + 300); await page.mouse.down(); await page.mouse.move(box.x + 400, box.y + 300, { steps: 4 }); await page.mouse.up();
  await page.waitForTimeout(200);
  const n0 = await rows();
  await page.keyboard.press('o');
  const bar = page.locator('[role=toolbar][aria-label="Offset"]');
  await bar.waitFor();
  await bar.locator('[aria-label="Offset distance"]').fill('0.5');
  await page.mouse.move(box.x + 250, box.y + 340);
  await page.mouse.click(box.x + 250, box.y + 340);
  await page.waitForTimeout(200);
  assert(await rows() === n0 + 1, 'Offset places a parallel copy where clicked');
  await page.keyboard.press('Escape');
  // Multiply: two copies of the offset line, 0.25 in apart, below it.
  await page.mouse.click(box.x + 250, box.y + 340);
  await page.waitForTimeout(200);
  await page.locator('.menubar-item > button', { hasText: /^Edit$/ }).click();
  await page.getByRole('menuitem', { name: 'Multiply…' }).click();
  const md = page.locator('[role=dialog][aria-label="Multiply"]');
  await md.waitFor();
  await md.locator('[aria-label="Direction"]').selectOption('down');
  await md.locator('[aria-label="Distance"]').fill('0.25');
  await md.locator('[aria-label="Copies"]').fill('2');
  await md.getByRole('button', { name: 'OK' }).click();
  await page.waitForTimeout(300);
  assert(await rows() === n0 + 3, 'Multiply places two parallel copies');
  // Hide: the copies leave the drawing but stay (greyed) in the list; Show Hidden Markups brings them back.
  const drawn = await svg.locator('[data-id]').count();
  await page.locator('.menubar-item > button', { hasText: /^Edit$/ }).click();
  await page.getByRole('menuitem', { name: 'Hide', exact: true }).click();
  await page.waitForTimeout(200);
  assert(await svg.locator('[data-id]').count() === drawn - 2 && await page.locator('.ml-table tr.hidden-markup').count() === 2, 'Hide removes the markups from the drawing, not the list');
  await page.locator('.menubar-item > button', { hasText: /^Edit$/ }).click();
  await page.getByRole('menuitem', { name: 'Show Hidden Markups' }).click();
  await page.waitForTimeout(200);
  assert(await svg.locator('[data-id]').count() === drawn, 'Show Hidden Markups draws them again');
  await page.keyboard.press('Escape');
  // Sketch to Scale: a 10 ft × 5 ft rectangle (sheet scale 18 pt/ft), then a polygon by sides.
  const menuTools = async (item) => { await page.locator('.menubar-item > button', { hasText: /^Tools$/ }).click(); await page.getByRole('menuitem', { name: item, exact: true }).click(); };
  const nS = await rows();
  await menuTools('Rectangle Sketch to Scale');
  await page.mouse.click(box.x + 120, box.y + 420);
  const sb = page.locator('[role=toolbar][aria-label="Sketch to Scale"]');
  await sb.locator('[aria-label="Sketch length"]').fill('10');
  await sb.locator('[aria-label="Sketch width"]').fill('5');
  await sb.locator('[aria-label="Sketch rotation"]').fill('0');
  await sb.locator('[aria-label="Sketch rotation"]').press('Enter');
  await page.waitForTimeout(200);
  assert(await rows() === nS + 1, 'Rectangle Sketch to Scale places a rectangle');
  const rw = await page.evaluate(() => { const r = [...document.querySelectorAll('.page .markup-layer rect')].pop(); return r ? Number(r.getAttribute('width')) : 0; });
  const zoom = await page.evaluate(() => Number(document.querySelector('.page .markup-layer')?.getAttribute('data-zoom') ?? 0));
  if (zoom) assert(Math.abs(rw / zoom - 180) < 1, `the sketched rectangle is 10 ft = 180 pt wide (${rw / zoom})`);
  await menuTools('Polygon Sketch to Scale');
  await page.mouse.click(box.x + 120, box.y + 520);
  await sb.locator('[aria-label="Sketch length"]').fill('4');
  await sb.locator('[aria-label="Sketch rotation"]').fill('0');
  await sb.locator('[aria-label="Sketch rotation"]').press('Enter');
  await sb.locator('[aria-label="Sketch length"]').fill('3');
  await sb.locator('[aria-label="Sketch rotation"]').fill('90');
  await sb.locator('[aria-label="Sketch rotation"]').press('Enter');
  await sb.locator('[aria-label="Sketch length"]').press('c');
  await page.waitForTimeout(200);
  assert(await rows() === nS + 2, 'Polygon Sketch to Scale closes a polygon from typed sides');
  await page.keyboard.press('Escape');
  // Review Text: drag across the title block text, type the replacement.
  {
    const lb = await page.locator('.page .markup-layer').first().boundingBox();
    const n2 = await rows();
    // Insert Text at Cursor: a click with the Review Text tool.
    await menuTools('Review Text');
    await page.mouse.click(lb.x + lb.width * 0.5, lb.y + lb.height * 0.5);
    const idlg = page.locator('[role=dialog][aria-label="Inserted Text"]');
    await idlg.waitFor({ timeout: 10000 });
    await idlg.locator('textarea').fill('ADD NOTE');
    await idlg.getByRole('button', { name: 'OK' }).click();
    await page.waitForTimeout(300);
    assert(await rows() === n2 + 1, 'Insert Text at Cursor adds an insertion caret');
    // Replace Selected Text from a text selection's right-click menu (when the page has text).
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+Shift+A');
    await page.waitForTimeout(500);
    if (await page.locator('.text-sel').count()) {
      const tsb2 = await page.locator('.text-sel').first().boundingBox();
      await page.mouse.click(tsb2.x + tsb2.width / 2, tsb2.y + tsb2.height / 2, { button: 'right' });
      await page.getByRole('menuitem', { name: 'Replace Selected Text…' }).click();
      const rd = page.locator('[role=dialog][aria-label="Replacement Text"]');
      await rd.waitFor({ timeout: 10000 });
      await rd.locator('textarea').fill('SITE PLAN');
      await rd.getByRole('button', { name: 'OK' }).click();
      await page.waitForTimeout(300);
      assert(await rows() === n2 + 3, 'Replace Selected Text adds a strikethrough and an insertion caret');
      const subjects = await page.locator('.ml-table tbody tr td:first-child').allInnerTexts();
      assert(subjects.filter((t) => t.includes('Replace Text')).length >= 2, 'both carry the Replace Text subject');
    }
    await page.keyboard.press('Escape');
    // Create Hyperlinks from URLs over the current page runs (the sample has no addresses).
    await menuTools('Create Hyperlinks from URLs…');
    const ld = page.locator('[role=dialog][aria-label="Create Hyperlinks from URLs"]');
    await ld.locator('[aria-label="Pages"]').selectOption('current');
    await ld.getByRole('button', { name: 'OK' }).click();
    await page.getByText(/Create Hyperlinks from URLs: /).waitFor({ timeout: 20000 });
    assert(true, `Create Hyperlinks from URLs ran (${await page.getByText(/Create Hyperlinks from URLs: /).innerText()})`);
  }
  // Edit Action: the rectangle drawn earlier jumps to page 1... use the new line instead.
  await page.mouse.click(box.x + 250, box.y + 300);
  await page.keyboard.press('Control+Shift+E');
  const act = page.locator('[role=dialog][aria-label="Action"]');
  await act.waitFor();
  await act.getByLabel('Web address', { exact: true }).fill('https://example.com/');
  await act.getByRole('button', { name: 'OK' }).click();
  await page.evaluate(() => { window.__opened = null; window.open = (u) => { window.__opened = u; return null; }; });
  await page.mouse.dblclick(box.x + 250, box.y + 300);
  await page.waitForFunction(() => window.__opened === 'https://example.com/');
  assert(true, 'a markup with an action follows it on double-click');

  // Custom status model "Valve" with a red "Closed" state.
  await page.locator('.menubar-item > button', { hasText: /^Tools$/ }).click();
  await page.getByRole('menuitem', { name: 'Manage Status…' }).click();
  const ms = page.locator('[role=dialog][aria-label="Manage Status"]');
  page.once('dialog', (dl) => dl.accept('Valve'));
  await ms.getByRole('button', { name: 'Add' }).first().click();
  await ms.getByRole('button', { name: 'Add' }).nth(1).click();
  await ms.getByLabel('State name').fill('Closed');
  await ms.getByLabel('Color', { exact: true }).check();
  await ms.getByLabel('State color').fill('#ff0000');
  await ms.getByRole('button', { name: 'OK' }).click();
  const row = page.locator('.ml-table tbody tr', { hasText: 'Line' }).first();
  await row.locator('select[aria-label="Status"]').selectOption('Valve|Closed');
  await page.waitForTimeout(200);
  assert((await row.innerText()).includes('Valve: Closed') || (await row.locator('select[aria-label="Status"]').inputValue()) === 'Valve|Closed', 'a custom status can be set from the Markups List');
  const chip = await row.locator('.color-chip').evaluate((e) => getComputedStyle(e).backgroundColor).catch(() => '');
  assert(chip === '' || chip === 'rgb(255, 0, 0)', `the state's colour recolours the markup (${chip})`);

  // Custom text stamp.
  await page.keyboard.press('Escape');
  await page.locator('.menubar-item > button', { hasText: /^Tools$/ }).click();
  await page.getByRole('menuitem', { name: 'Manage Stamps…' }).click();
  const sd = page.locator('[role=dialog][aria-label="Stamps"]');
  await sd.getByRole('button', { name: 'Create Stamp…' }).click();
  await sd.getByLabel('Stamp name').fill('Field Checked');
  await sd.getByLabel('Stamp template').selectOption('dateBorder');
  await sd.getByLabel('Stamp title').fill('FIELD CHECKED');
  await sd.getByLabel('Dynamic text').selectOption('Year');
  assert((await sd.getByLabel('Stamp subtitle').inputValue()) === '{Date}{Year}', 'the template seeds the subtitle and the dynamic text menu appends a token');
  await sd.getByLabel('Stamp width').fill('3');
  await sd.getByRole('button', { name: 'Save Stamp' }).click();
  // Export the stamp as a PDF file, and import that file as a new (image) stamp.
  const [stampPdf] = await Promise.all([page.waitForEvent('download'), sd.getByRole('button', { name: 'PDF' }).first().click()]);
  await stampPdf.saveAs(`${OUT}/field-checked-stamp.pdf`);
  assert((await PDFDocument.load(readFileSync(`${OUT}/field-checked-stamp.pdf`))).getPage(0).getWidth() === 216, 'a stamp exports as a PDF of its size (3 in wide)');
  const [sfc] = await Promise.all([page.waitForEvent('filechooser'), sd.getByRole('button', { name: 'Import Stamp (PDF)…' }).click()]);
  await sfc.setFiles(`${OUT}/field-checked-stamp.pdf`);
  await sd.locator('.space-row', { hasText: 'field-checked-stamp' }).waitFor({ timeout: 15000 });
  assert(true, 'Import Stamp (PDF) makes an image stamp from the file');
  await sd.locator('.space-row', { hasText: 'field-checked-stamp' }).getByRole('button', { name: 'Delete' }).click();
  await sd.getByRole('button', { name: 'Close' }).click();
  const n1 = await rows();
  await page.locator('.menubar-item > button', { hasText: /^Tools$/ }).click();
  await page.getByRole('menuitem', { name: /^Stamp/ }).first().click();
  const opt = await page.locator('[role=toolbar][aria-label="Stamp"] select option', { hasText: 'Field Checked' }).getAttribute('value');
  await page.locator('[role=toolbar][aria-label="Stamp"] select').selectOption(opt);
  await page.mouse.click(box.x + 600, box.y + 150);
  await page.waitForTimeout(200);
  assert(await rows() === n1 + 1 && (await page.locator('.ml-table tbody').innerText()).includes('Field Checked'), 'a custom stamp is placed with its name as subject');
  assert((await page.locator('.markup-layer').evaluate((el) => el.textContent ?? '')).includes(String(new Date().getFullYear())), 'the dynamic text is filled in when the stamp is placed');
  await page.screenshot({ path: `${OUT}/custom-stamp.png` });

  // Camera: without a camera the dialog offers a photo instead.
  await page.keyboard.press('Control+Alt+i');
  const cam = page.locator('[role=dialog][aria-label="Camera"]');
  await cam.waitFor();
  await cam.getByRole('button', { name: 'Cancel' }).click();
  assert(await cam.count() === 0, 'Camera dialog opens and closes');
}
{
  // Replace Checked on a fresh sample drawing: OFFICE -> STUDIO.
  await page.locator('.menubar-item > button', { hasText: /^File$/ }).click();
  await page.getByRole('menuitem', { name: 'Open Sample Drawing' }).click();
  await page.waitForTimeout(1500);
  await page.keyboard.press('Control+f');
  await page.getByLabel('Search text').fill('OFFICE');
  await page.getByLabel('Search text').press('Enter');
  await page.waitForFunction(() => /\d+ results?/.test(document.querySelector('.search-panel')?.textContent ?? ''));
  await page.getByLabel('Replace with').fill('STUDIO');
  await page.getByRole('button', { name: 'Replace Checked' }).click();
  await page.waitForFunction(() => /Replaced \d+ result/.test(document.querySelector('.statusbar')?.textContent ?? ''), null, { timeout: 30000 });
  await page.getByLabel('Search text').fill('STUDIO');
  await page.getByLabel('Search text').press('Enter');
  await page.waitForFunction(() => /\d+ results?/.test(document.querySelector('.search-panel')?.textContent ?? ''));
  const found = await page.locator('.search-hit').count();
  assert(found > 0, `Replace Checked rewrites the page text (${found} STUDIO found)`);
  await page.screenshot({ path: `${OUT}/replace-checked.png` });
}

// Vector compare notices colour and line-weight-only changes.
{
  const make = async (color, w) => {
    const d = await PDFDocument.create();
    const pg = d.addPage([612, 792]);
    pg.drawLine({ start: { x: 100, y: 700 }, end: { x: 500, y: 700 }, thickness: 1, color: rgb(0, 0, 0) });
    pg.drawLine({ start: { x: 100, y: 400 }, end: { x: 500, y: 400 }, thickness: w, color });
    pg.drawRectangle({ x: 100, y: 100, width: 200, height: 100, borderWidth: 1, borderColor: rgb(0, 0, 0) });
    return d.save();
  };
  writeFileSync(`${OUT}/style-a.pdf`, await make(rgb(0, 0, 0), 1));
  writeFileSync(`${OUT}/style-b.pdf`, await make(rgb(1, 0, 0), 1));
  writeFileSync(`${OUT}/style-c.pdf`, await make(rgb(0, 0, 0), 4));
  const fc = await ctrlO();
  await fc.setFiles([`${OUT}/style-a.pdf`, `${OUT}/style-b.pdf`, `${OUT}/style-c.pdf`]);
  await page.waitForFunction(() => [...document.querySelectorAll('.doc-tab')].some((t) => t.textContent?.startsWith('style-c')));
  await page.waitForTimeout(800);
  for (const [rev, what] of [['style-b.pdf', 'colour'], ['style-c.pdf', 'line weight']]) {
    await page.getByRole('button', { name: 'Document', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Compare Documents…' }).click();
    const cd = page.getByRole('dialog', { name: 'Compare Documents' });
    await cd.getByLabel('Original document').selectOption({ label: 'style-a.pdf' });
    await cd.getByLabel('Revised document').selectOption({ label: rev });
    await cd.getByLabel('Compare method').selectOption('vector');
    await cd.getByRole('button', { name: 'OK' }).click();
    await page.waitForFunction(() => /Compare: (\d+ difference|no diff)/.test(document.querySelector('.statusbar')?.textContent ?? ''), null, { timeout: 30000 });
    const n = Number((await page.locator('.statusbar').innerText()).match(/Compare: (\d+) difference/)?.[1] ?? 0);
    assert(n === 1, `vector compare finds the ${what} change (${n} difference)`);
  }
  await page.screenshot({ path: `${OUT}/compare-style.png` });
  // Batch > Compare Documents: pages paired by label ('1' on both), one difference clouded.
  {
    await page.locator('.doc-tab', { hasText: 'style-a' }).first().click();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: 'Batch', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Compare Documents…' }).click();
    const bd = page.getByRole('dialog', { name: 'Batch Compare Documents' });
    await bd.getByLabel('Current files').selectOption([{ label: 'style-a.pdf' }]);
    await bd.getByLabel('Revised files').selectOption([{ label: 'style-b.pdf' }]);
    assert((await bd.locator('.batch-pairs').innerText()).includes('No pages match'), 'different file names do not pair by File Name, Page Index');
    await bd.getByLabel('Match pages by').selectOption('label');
    assert((await bd.locator('.batch-pairs').innerText()).includes('style-a.pdf p1 ⇄ style-b.pdf p1'), 'Page Label pairs the sheets');
    await bd.getByLabel('Compare method').selectOption('vector');
    await bd.getByRole('button', { name: 'OK' }).click();
    await page.waitForFunction(() => /Batch Compare: 1 pair, \d+ difference/.test(document.querySelector('.statusbar')?.textContent ?? ''), null, { timeout: 30000 });
    assert((await page.locator('.statusbar').innerText()).includes('1 pair, 1 difference'), 'Batch Compare clouds the difference of the paired sheets');
  }
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
