// The extension as Chrome loads it: built by scripts/build-chrome.js, run in a real Chromium against the stand-in x.com. Only what the in-page
// tests cannot see: the isolated world, chrome.storage, the service worker, and pages of the extension's own.
// Run: XMC_BROWSER=/path/to/chromium npm run test:chrome
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./rig.js');

let rig = null;
test.before(async () => { rig = await setup(); });
test.after(async () => { if (rig) await rig.teardown(); });
const chrome = (name, fn, timeout = 60000) => test(name, { timeout }, async (t) => { if (!rig) return t.skip('no Chromium (set XMC_BROWSER)'); await fn(rig); });

chrome('the extension loads: its service worker is up, the first install opened the settings at the presets, and the columns are drawn on x.com', async (r) => {
  for (let i = 0; i < 50 && !r.context.pages().some((p) => /options\.html/.test(p.url())); i++) await new Promise((x) => setTimeout(x, 100)); // (it opens a moment after the install)
  assert.ok(r.context.pages().some((p) => /options\.html#sec-presets/.test(p.url())), 'the install opened the settings page at the presets: ' + r.context.pages().map((p) => p.url()).join(' '));
  const page = await r.open();
  await page.waitForSelector('.xmc-card', { timeout: 20000 });
  assert.ok((await page.locator('.xmc-col').count()) >= 1, 'columns');
  assert.equal((await page.locator('#xmc-pill').innerText()).trim(), 'Turn Columns Off');
  assert.deepEqual(r.errors, [], 'no script errors');
  await page.close();
});

chrome('settings made on the options page go through chrome.storage and reach the page at once', async (r) => {
  const page = await r.open();
  await page.waitForSelector('.xmc-card', { timeout: 20000 });
  const before = await page.locator('.xmc-col').count();
  const opts = await r.context.newPage();
  await opts.goto(r.ext('options.html'));
  await opts.waitForSelector('#opt-cols');
  const want = before === 2 ? 3 : 2;
  await opts.locator('#opt-cols').fill(String(want));
  await opts.locator('#opt-cols').dispatchEvent('change');
  const stored = await opts.evaluate(() => chrome.storage.local.get('cols'));
  assert.equal(stored.cols, want, 'saved in chrome.storage.local, not in the page\'s localStorage');
  await page.waitForFunction((n) => document.querySelectorAll('.xmc-col').length === n, want, { timeout: 8000 });
  await opts.close(); await page.close();
});

chrome('the gear opens the settings panel, which is a page of the extension framed over x.com (no fallback tab)', async (r) => {
  const page = await r.open();
  await page.waitForSelector('.xmc-card', { timeout: 20000 });
  const tabs = r.context.pages().length;
  await page.locator('.xmc-gear').click();
  await page.waitForSelector('#xmc-settings iframe');
  const frame = await (async () => { for (let i = 0; i < 50; i++) { const f = page.frames().find((x) => x.url().startsWith('chrome-extension://')); if (f) return f; await page.waitForTimeout(100); } return null; })();
  assert.ok(frame, 'the panel is the extension\'s own page');
  await frame.waitForSelector('#sections h2 button.fold', { timeout: 8000 });
  await page.waitForTimeout(3600); // (longer than the wait for it to say it is up, after which the panel gives up and opens a tab)
  assert.equal(await page.locator('#xmc-settings').count(), 1, 'still there: it said it was up');
  assert.equal(r.context.pages().length, tabs, 'and no tab opened');
  await frame.locator('#sections h2 button.fold', { hasText: 'Look' }).click();
  await frame.locator('#opt-textSize').selectOption('large');
  await page.waitForFunction(() => getComputedStyle(document.getElementById('xmc-root')).getPropertyValue('--xmc-ts').trim() === '1.15', null, { timeout: 8000 });
  await page.keyboard.press('Escape');
  await page.waitForSelector('#xmc-settings', { state: 'detached', timeout: 4000 });
  await page.close();
});

chrome('the toolbar panel (popup.html) opens as its own page and saves to chrome.storage', async (r) => {
  const pop = await r.context.newPage();
  await pop.goto(r.ext('popup.html'));
  await pop.waitForSelector('#sections h2 button.fold');
  await pop.locator('#sections h2 button.fold', { hasText: 'Algorithmic content' }).click();
  await pop.locator('#opt-onlyFollowed').check();
  const got = await pop.evaluate(() => chrome.storage.local.get('onlyFollowed'));
  assert.equal(got.onlyFollowed, true);
  await pop.close();
});

chrome('the service worker answers messages (open the options page; refuse a download that is not one of X\'s media)', async (r) => {
  const pop = await r.context.newPage();
  for (const p of r.context.pages()) if (/options\.html/.test(p.url())) await p.close(); // (the one the install opened: asked for the options page, Chrome shows a tab that has it instead of opening another)
  await pop.goto(r.ext('popup.html'));
  assert.deepEqual(await pop.evaluate(() => chrome.runtime.sendMessage({ type: 'xmc-download', files: [{ url: 'https://example.com/a.jpg', filename: 'X/a.jpg' }] })), { ok: false, error: 'nothing to download' });
  const opened = r.context.waitForEvent('page', { timeout: 8000 });
  assert.deepEqual(await pop.evaluate(() => chrome.runtime.sendMessage({ type: 'xmc-open-options' })), { ok: true });
  const tab = await opened;
  assert.match(tab.url(), /options\.html/);
  await tab.close(); await pop.close();
});

chrome('keys that move X\'s hidden page move the columns (the extension\'s own world: its scroll wrapper is not the page\'s)', async (r) => {
  const page = await r.open();
  await page.waitForSelector('.xmc-card', { timeout: 20000 });
  await page.evaluate(() => { // what Vimium does with no click: it scrolls the page itself, from its own world, not through this extension's
    document.addEventListener('keydown', (ev) => { if (ev.key === 'j') window.scrollBy(0, 60); }, true);
    document.activeElement && document.activeElement.blur();
  });
  const settle = () => page.waitForFunction(() => { const w = window.__zzIdle = window.__zzIdle || { y: -1, at: Date.now() }; if (Math.round(window.scrollY) !== w.y) { w.y = Math.round(window.scrollY); w.at = Date.now(); } const max = document.documentElement.scrollHeight - innerHeight; return Date.now() - w.at > 2800 && window.scrollY >= 60 && window.scrollY <= max - 60 && max > 300; }, null, { timeout: 40000, polling: 200 });
  await settle();
  const top = () => page.evaluate(() => document.querySelector('.xmc-scroller').scrollTop);
  const before = await top();
  await page.keyboard.press('j'); await page.waitForTimeout(400);
  assert.ok((await top()) - before >= 50, 'the columns moved: ' + before + ' -> ' + (await top()));
  await page.close();
});

chrome('what the extension saw on x.com (features, the probe of X\'s buttons) is written to chrome.storage for the settings page to show', async (r) => {
  const page = await r.open();
  await page.waitForSelector('.xmc-card', { timeout: 20000 });
  const opts = await r.context.newPage();
  await opts.goto(r.ext('options.html'));
  let rep = null;
  for (let i = 0; i < 60 && !(rep && rep.probe); i++) { rep = (await opts.evaluate(() => chrome.storage.local.get('xmcFeatures'))).xmcFeatures; if (!(rep && rep.probe)) await opts.waitForTimeout(500); }
  assert.ok(rep && rep.probe, 'a report with a probe in it');
  assert.equal(rep.probe.like, true, 'X\'s Like button was found'); assert.equal(rep.probe.homeLink, true);
  assert.ok(rep.parse.tweets > 0, 'the parser read posts');
  await opts.reload();
  await opts.locator('#sections h2').first().waitFor();
  const row = opts.locator('table.status tr', { hasText: 'Timeline data from X' });
  await row.waitFor({ timeout: 8000 });
  assert.match(await row.innerText(), /Working/);
  await opts.close(); await page.close();
});
