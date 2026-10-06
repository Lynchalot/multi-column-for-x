// Shared set-up for the browser tests: one headless Chrome, the stand-in x.com, and a page opener that fails the test on any script error.
'use strict';
const { chromium } = require('playwright-core');
const { start } = require('./mock/server.js');

async function launchBrowser() {
  try {
    return await chromium.launch(process.env.XMC_BROWSER ? { executablePath: process.env.XMC_BROWSER, headless: true } : { channel: 'chrome', headless: true });
  } catch (err) {
    if (process.env.CI) throw err; // on GitHub the browser must be there
    return null; // on a machine without Chrome these tests are skipped
  }
}

async function setup(opts = {}) {
  const browser = await launchBrowser();
  if (!browser) return null;
  const server = await start(opts);
  const pages = [];
  const api = {
    server,
    // path: where to go. settings: saved extension settings (e.g. { cols: 5 }). width/height: window size.
    // seen: post ids already "read" in an earlier visit (what the extension keeps in its read-posts memory)
    async open(path, { settings, seen, width = 1700, height = 900 } = {}) {
      const context = await browser.newContext({ viewport: { width, height } });
      if (settings) await context.addInitScript((s) => { try { if (!localStorage.getItem('xmc.settings')) localStorage.setItem('xmc.settings', JSON.stringify(s)); } catch { /* ignore */ } }, settings);
      if (seen) await context.addInitScript((ids) => { try { if (!localStorage.getItem('xmc.seen')) localStorage.setItem('xmc.seen', JSON.stringify(ids)); } catch { /* ignore */ } }, seen);
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
      page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console.error: ' + m.text()); });
      await page.goto(server.origin + path);
      const handle = { page, errors, async close() { await context.close(); } };
      pages.push(handle);
      return handle;
    },
    // columns are up and have drawn some posts
    async ready(page, n = 8) { await page.waitForFunction((k) => window.__xmc && window.__xmc.view.cards.length >= k, n, { timeout: 20000 }); },
    async teardown() { for (const p of pages) await p.close().catch(() => {}); await browser.close(); await server.close(); },
  };
  return api;
}

module.exports = { setup };
