// Low-end machine measurements: a 100-sheet vector drawing set opened and
// browsed in Chromium with the CPU slowed 4x and 4 GB of reported memory.
// Usage: npm run build && npx vite preview --port 4173 & node scripts/perf.mjs
// Writes test-results/perf.json and prints a Markdown table.
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { PDFDocument, PDFName, StandardFonts } from 'pdf-lib';

const URL = process.env.APP_URL ?? 'http://localhost:4173/';
const OUT = 'test-results';
const SHEETS = Number(process.env.SHEETS ?? 100), THROTTLE = Number(process.env.THROTTLE ?? 4), MEM = Number(process.env.MEM ?? 4);
mkdirSync(OUT, { recursive: true });

/** A 36x24 in sheet with a few thousand vector strokes and some text, like a floor plan. */
async function makeSet(n) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  let seed = 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let p = 0; p < n; p++) {
    const page = doc.addPage([36 * 72, 24 * 72]);
    const ops = ['0.5 w 0 G'];
    for (let i = 0; i < 3000; i++) {
      const x = 100 + rnd() * 2300, y = 100 + rnd() * 1500;
      ops.push(`${x.toFixed(1)} ${y.toFixed(1)} m ${(x + rnd() * 120 - 60).toFixed(1)} ${(y + rnd() * 120 - 60).toFixed(1)} l S`);
    }
    for (let i = 0; i < 150; i++) ops.push(`BT /F1 8 Tf ${(100 + rnd() * 2300).toFixed(1)} ${(100 + rnd() * 1500).toFixed(1)} Td (ROOM ${p}-${i}) Tj ET`);
    ops.push(`BT /F1 24 Tf 2300 60 Td (A-${String(p + 1).padStart(3, '0')}) Tj ET`);
    page.node.set(PDFName.of('Resources'), doc.context.obj({ Font: { F1: font.ref } }));
    page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.flateStream(ops.join('\n'))));
  }
  return doc.save();
}

const file = `${OUT}/perf-${SHEETS}.pdf`;
if (!existsSync(file)) writeFileSync(file, await makeSet(SHEETS));

const local = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? (existsSync(local) ? local : undefined) });
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
await page.addInitScript((mem) => {
  Object.defineProperty(navigator, 'deviceMemory', { get: () => mem });
  delete window.showOpenFilePicker; delete window.showSaveFilePicker;
}, MEM);
const cdp = await page.context().newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
await cdp.send('Performance.enable');
const heap = async () => { await cdp.send('HeapProfiler.collectGarbage').catch(() => {}); const m = (await cdp.send('Performance.getMetrics')).metrics; return Math.round(m.find((x) => x.name === 'JSHeapUsedSize').value / 2 ** 20); };
const rendered = (n) => page.waitForFunction((k) => document.querySelector('.page')?.getAttribute('data-rendered') === String(k), n, { timeout: 120000 });
const results = {};
// First load on a slow connection (10 Mbit/s, 60 ms): when something appears, and when the app is usable.
{
  const p2 = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  const c2 = await p2.context().newCDPSession(p2);
  await c2.send('Network.enable');
  await c2.send('Network.setCacheDisabled', { cacheDisabled: true });
  await c2.send('Network.emulateNetworkConditions', { offline: false, latency: 60, downloadThroughput: 10e6 / 8, uploadThroughput: 2e6 / 8 });
  await c2.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
  const t0 = Date.now();
  await p2.goto(URL);
  await p2.locator('.app-loading, .menubar, .start-page').first().waitFor();
  results.slowNetFirstPaintMs = Date.now() - t0;
  await p2.locator('.menubar').waitFor({ timeout: 120000 });
  results.slowNetReadyMs = Date.now() - t0;
  await p2.close();
}
let t = Date.now();
await page.goto(URL);
await page.locator('.menubar').waitFor();
results.appLoadMs = Date.now() - t;
results.heapEmptyMB = await heap();

t = Date.now();
await page.mouse.click(5, 500);
const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('Control+O')]);
await fc.setFiles(file);
await rendered(1);
results.openMs = Date.now() - t;
results.heapOpenMB = await heap();

const nav = [];
for (let i = 2; i <= 11; i++) {
  t = Date.now();
  await page.keyboard.press('Control+ArrowRight');
  await rendered(i);
  nav.push(Date.now() - t);
}
results.nextPageMsAvg = Math.round(nav.reduce((a, b) => a + b, 0) / nav.length);
results.nextPageMsMax = Math.max(...nav);

const zoom = [];
for (let i = 0; i < 4; i++) {
  t = Date.now();
  await page.keyboard.press('NumpadAdd');
  await page.waitForTimeout(50);
  await rendered(11);
  zoom.push(Date.now() - t);
}
results.zoomStepMsAvg = Math.round(zoom.reduce((a, b) => a + b, 0) / zoom.length);

// Continuous view through 20 sheets.
await page.keyboard.press('Control+9');
await page.keyboard.press('Control+5');
await page.waitForTimeout(1000);
t = Date.now();
await page.evaluate(async () => {
  const el = document.querySelector('.viewer');
  for (let i = 0; i < 40; i++) { el.scrollTop += el.clientHeight / 2; await new Promise((r) => requestAnimationFrame(() => r())); }
});
results.scroll20SheetsMs = Date.now() - t;
results.heapAfterBrowsingMB = await heap();
await page.keyboard.press('Control+4');

// Page operations then undo: memory with the undo history.
for (let i = 0; i < 3; i++) {
  await page.keyboard.press('Control+Shift+R'); // Rotate Pages dialog
  await page.locator('[role=dialog]').getByRole('button', { name: 'OK' }).click().catch(() => {});
  await page.waitForFunction(() => !document.querySelector('.busy-overlay'), null, { timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(1500);
}
results.heapAfter3PageOpsMB = await heap();
t = Date.now();
await page.keyboard.press('Control+z');
await page.waitForTimeout(300);
await page.waitForFunction(() => !document.querySelector('.busy-overlay'), null, { timeout: 120000 }).catch(() => {});
results.undoPageOpMs = Date.now() - t;

results.env = { sheets: SHEETS, cpuThrottle: `${THROTTLE}x`, deviceMemoryGB: MEM, fileMB: +(Buffer.byteLength(Buffer.from(await (await import('node:fs')).promises.readFile(file))) / 2 ** 20).toFixed(1) };
writeFileSync(`${OUT}/perf.json`, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
await browser.close();
