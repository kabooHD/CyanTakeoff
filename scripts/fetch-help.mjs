// Fetches Bluebeam help pages with every collapsible section expanded, for
// reference while matching Revu behaviour (needs support.bluebeam.com allowed).
// Usage: node scripts/fetch-help.mjs <url>... ; output goes to $OUT (default /tmp/bb).
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync } from 'node:fs';
import { writeFileSync } from 'node:fs';
const OUT = process.env.OUT ?? '/tmp/bb';
mkdirSync(OUT, { recursive: true });
const local = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: existsSync(local) ? local : undefined });
const page = await browser.newPage();
for (const url of process.argv.slice(2)) {
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
    // Expand collapsible sections: <details>, MadCap dropdowns/togglers, aria-expanded buttons
    await page.evaluate(() => {
      document.querySelectorAll('details').forEach((d) => (d.open = true));
      document.querySelectorAll('.MCDropDown, .MCDropDown_Closed, .dropDown, [class*="DropDown"]').forEach((e) => { e.classList.remove('MCDropDown_Closed'); e.classList.add('MCDropDown_Open'); });
      document.querySelectorAll('.MCDropDownBody, [class*="dropDownBody"], [class*="DropDownBody"]').forEach((e) => { e.style.display = 'block'; e.style.height = 'auto'; });
    });
    for (const b of await page.$$('[aria-expanded="false"], a.MCDropDownHotSpot, .MCDropDownHotSpot, .accordion-button.collapsed')) { try { await b.click({ timeout: 1000 }); } catch {} }
    await page.waitForTimeout(800);
    await page.evaluate(() => document.querySelectorAll('[hidden], .collapse:not(.show)').forEach((e) => { e.removeAttribute('hidden'); e.classList.add('show'); e.style.display = 'block'; }));
    const text = await page.evaluate(() => {
      const root = document.querySelector('#mc-main-content, main, article, .content') ?? document.body;
      const out = [];
      const blocks = root.querySelectorAll('h1,h2,h3,h4,h5,p,li,tr,dt,dd,caption,.MCDropDownHotSpot');
      for (const b of blocks) {
        if (b.closest('nav, header, footer')) continue;
        // skip blocks nested in another collected block (avoid duplicates)
        if (b.parentElement && b.parentElement.closest('p,li,tr,dt,dd') && !b.matches('tr')) continue;
        const t = b.matches('tr') ? [...b.children].map((c) => c.textContent.trim().replace(/\s+/g, ' ')).join(' | ') : b.textContent.trim().replace(/\s+/g, ' ');
        if (!t) continue;
        const tag = b.tagName;
        out.push(/^H\d$/.test(tag) ? `\n## ${t}` : tag === 'LI' ? `- ${t}` : t);
      }
      return out.join('\n');
    });
    const links = await page.evaluate(() => [...document.querySelectorAll('main a, article a, #mc-main-content a, .content a')].map((a) => `${a.innerText.trim()} | ${a.href}`).filter((l) => l.includes('bluebeam.com')));
    const slug = url.replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/gi, '_').slice(-80);
    writeFileSync(`${OUT}/${slug}.txt`, `${url}\n\n${text}\n\nLINKS\n${links.join('\n')}`);
    console.log(`== ${url} -> ${slug}.txt (${text.length} chars)`);
    console.log(links.slice(0, 40).join('\n'));
  } catch (e) { console.log(`!! ${url}: ${e.message.split('\n')[0]}`); }
}
await browser.close();
