// A long run of the built extension in a real Chromium against the stand-in x.com: scrolling, opening and closing posts and the viewer, folding the menu,
// the settings panel, for the minutes it is given, with the heap, the DOM and the listeners sampled so that a leak shows as a slope. Not part of CI.
// (Wait with page.waitForFunction, not page.waitForSelector: the handle waitForSelector returns keeps the element, and everything under it, alive for the length of the run,
// which reads as a leak of a few hundred nodes for every post opened.)
//   XMC_BROWSER=/path/to/chromium node test/real/soak.js [minutes=25] [out.jsonl]
'use strict';
const fs = require('node:fs');
const { setup } = require('./rig.js');

(async () => {
  const minutes = Number(process.argv[2]) || 25;
  const out = process.argv[3] || 'soak.jsonl';
  const r = await setup({ pages: 600 });
  if (!r) { console.error('no Chromium (set XMC_BROWSER)'); process.exit(2); }
  const page = await r.open();
  await page.waitForSelector('.xmc-card', { timeout: 30000 });
  const cdp = await r.context.newCDPSession(page);
  await cdp.send('Performance.enable');
  const sample = async (label) => {
    await cdp.send('HeapProfiler.collectGarbage').catch(() => {});
    const m = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
    const dom = await page.evaluate(() => ({ cards: document.querySelectorAll('.xmc-card').length, recycled: document.querySelectorAll('.xmc-card[data-recycled]').length, scrollTop: Math.round(document.querySelector('.xmc-scroller').scrollTop), hiddenY: Math.round(scrollY) }));
    const row = { t: Math.round((Date.now() - t0) / 1000), label, heapMB: +(m.JSHeapUsedSize / 1048576).toFixed(1), nodes: m.Nodes, listeners: m.JSEventListeners, docs: m.Documents, errors: r.errors.length, ...dom };
    fs.appendFileSync(out, JSON.stringify(row) + '\n');
    console.log(JSON.stringify(row));
  };
  fs.writeFileSync(out, '');
  const t0 = Date.now();
  await sample('start');
  let step = 0, last = Date.now();
  const every = (ms, key, fn) => { every.at = every.at || {}; if (Date.now() - (every.at[key] || 0) >= ms) { every.at[key] = Date.now(); console.log('step ' + key + ' at ' + Math.round((Date.now() - t0) / 1000) + 's'); return fn(); } };
  while (Date.now() - t0 < minutes * 60000) {
    step++;
    await page.mouse.move(700 + (step % 5) * 20, 500);
    await page.mouse.wheel(0, 700);
    await page.waitForTimeout(1500);
    await every(25000, 'post', async () => { // a post in the panel, then back
      const c = page.locator('.xmc-card .xmc-text').nth(step % 6);
      if (await c.count()) { await c.click({ timeout: 3000 }).catch(() => {}); await page.waitForFunction(() => !!document.querySelector('.xmc-view'), null, { timeout: 4000 }).catch(() => {}); await page.waitForTimeout(1200); await page.keyboard.press('Escape'); await page.waitForTimeout(500); }
    });
    await every(70000, 'viewer', async () => { // a photo full size, stepped, closed
      const p = page.locator('.xmc-card [data-lb]').nth(step % 4);
      if (await p.count()) { await p.click({ timeout: 3000 }).catch(() => {}); await page.waitForFunction(() => !!document.getElementById('xmc-lightbox'), null, { timeout: 3000 }).catch(() => {}); await page.keyboard.press('ArrowRight'); await page.waitForTimeout(600); await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
    });
    await every(90000, 'fold', async () => { const logo = page.locator('header[role="banner"] h1 a[data-xmc-logo]'); if (await logo.count()) { await logo.click().catch(() => {}); await page.waitForTimeout(900); await logo.click().catch(() => {}); await page.waitForTimeout(600); } });
    await every(120000, 'settings', async () => { await page.locator('.xmc-gear').click().catch(() => {}); await page.waitForTimeout(1500); await page.keyboard.press('Escape'); await page.waitForTimeout(400); });
    await every(60000, 'top', async () => { await page.locator('.xmc-scroller').evaluate((s) => { s.scrollTop = 0; }); await page.waitForTimeout(800); }); // (back to the top now and then, as a person does: the recycler works both ways)
    await every(30000, 'sample', () => sample('run'));
  }
  await sample('end');
  await r.teardown();
  console.log('done');
})().catch((e) => { console.error(e); process.exit(1); });
