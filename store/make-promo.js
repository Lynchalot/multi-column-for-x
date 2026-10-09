'use strict';
// The small promo tile the Chrome Web Store asks for (440x280): the icon, the name, a line.  XMC_BROWSER=/path/to/chrome node store/make-promo.js
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');
(async () => {
  const svg = fs.readFileSync(path.join(__dirname, '..', 'icons', 'icon.svg'), 'utf8');
  const browser = await chromium.launch(process.env.XMC_BROWSER ? { executablePath: process.env.XMC_BROWSER, headless: true } : { channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 440, height: 280 }, deviceScaleFactor: 1 });
  await page.setContent(`<style>*{box-sizing:border-box;margin:0}body{width:440px;height:280px;font-family:'Liberation Sans',Arial,sans-serif;color:#fff;background:linear-gradient(160deg,#1d9bf0 0%,#1478c4 55%,#0f4f8a 100%);display:flex;flex-direction:column;justify-content:center;padding:0 34px;gap:14px}
    img{width:76px;height:76px;border-radius:18px;box-shadow:0 6px 20px rgba(0,0,0,.3)}h1{font-size:36px;line-height:40px;font-weight:700;letter-spacing:-.4px}p{font-size:19px;line-height:25px;font-weight:700;opacity:.95}</style>
    <img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}"><h1>Multi-Column<br>for X</h1><p>Your feed, in columns.</p>`);
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(__dirname, 'chrome-promo-440x280.png') });
  await browser.close();
  console.log('store/chrome-promo-440x280.png');
})().catch((e) => { console.error(e); process.exit(1); });
