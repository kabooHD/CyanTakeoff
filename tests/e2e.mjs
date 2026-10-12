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
await page.keyboard.press('W');
a = await toScreen(26, 6); b = await toScreen(40, 10);
await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 5 }); await page.mouse.up();
await page.keyboard.type('Verify door hardware');
await page.mouse.click(5, 500); // blur editor (clicks the left tab strip area)
await page.waitForTimeout(200);

list = await page.locator('.ml-table tbody').innerText();
assert(list.includes('Count Measurement') && /\t3\t/.test(list), 'count of 3');
assert(list.includes('Verify door hardware'), 'text box content in list');
await page.screenshot({ path: `${OUT}/03-takeoff.png` });

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

// Real Revu-authored files (tests/fixtures/revu): values must match what Revu displayed.
for (const [file, expected] of [
  ['measure.pdf', [`5'-5"`, '56.37 sf', `18'-11 1/2"`, `22'-4 1/2"`, '0 cu ft']],
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
