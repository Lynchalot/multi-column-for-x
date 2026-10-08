'use strict';
// Chrome does not take an SVG as the extension's icon: makes the PNG sizes it wants from icons/icon.svg, with the browser that is already here for the tests.
//   XMC_BROWSER=/path/to/chrome node scripts/make-chrome-icons.js   ->  chrome/icons/icon-16.png ... icon-128.png
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');
const root = path.join(__dirname, '..');
(async () => {
  const svg = fs.readFileSync(path.join(root, 'icons', 'icon.svg'), 'utf8');
  const browser = await chromium.launch(process.env.XMC_BROWSER ? { executablePath: process.env.XMC_BROWSER, headless: true } : { channel: 'chrome', headless: true });
  fs.mkdirSync(path.join(root, 'chrome', 'icons'), { recursive: true });
  for (const n of [16, 32, 48, 128]) {
    const page = await browser.newPage({ viewport: { width: n, height: n }, deviceScaleFactor: 1 });
    await page.setContent(`<style>html,body{margin:0;background:transparent}img{display:block;width:${n}px;height:${n}px}</style><img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}">`);
    await page.waitForTimeout(100);
    await page.screenshot({ path: path.join(root, 'chrome', 'icons', `icon-${n}.png`), omitBackground: true });
    await page.close();
    console.log('icon-' + n + '.png');
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
