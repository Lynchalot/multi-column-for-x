// Loads the built Chrome package into a real Chromium, as an installed extension (an isolated world for the scripts, chrome.storage, a service
// worker for the background), and points x.com at the stand-in: https://x.com is mapped to it by the browser, with a throwaway certificate.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright-core');
const { start } = require('../e2e/mock/server.js');

const ROOT = path.join(__dirname, '..', '..');
const HOSTS = ['x.com', 'twitter.com', 'pbs.twimg.com', 'video.twimg.com'];

async function setup({ pages = 30, raster = false } = {}) {
  const exe = process.env.XMC_BROWSER;
  if (!exe && !process.env.CI) return null; // (these need a Chromium that takes --load-extension: not Google Chrome 137 on, which dropped it)
  execFileSync('node', [path.join(ROOT, 'scripts', 'build-chrome.js'), '--no-zip'], { stdio: 'ignore' });
  const ext = path.join(ROOT, 'dist', 'chrome');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xmc-rig-'));
  const key = path.join(tmp, 'key.pem'), cert = path.join(tmp, 'cert.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '2', '-subj', '/CN=x.com', '-addext', 'subjectAltName=' + HOSTS.map((h) => 'DNS:' + h).join(',')], { stdio: 'ignore' });
  const server = await start({ pages, tls: { key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, bare: true, publicOrigin: 'https://x.com', raster });
  const context = await chromium.launchPersistentContext(path.join(tmp, 'profile'), {
    ...(exe ? { executablePath: exe } : { channel: 'chromium' }),
    headless: false, // (the new headless mode, below: the old one takes no extensions)
    ignoreHTTPSErrors: true,
    viewport: { width: 1700, height: 900 },
    args: ['--headless=new', '--disable-extensions-except=' + ext, '--load-extension=' + ext, '--ignore-certificate-errors', '--no-proxy-server',
      '--host-resolver-rules=' + HOSTS.map((h) => `MAP ${h} 127.0.0.1:${server.port}`).join(', ')],
  });
  let sw = context.serviceWorkers()[0];
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 15000 });
  const id = new URL(sw.url()).host;
  const errors = [];
  context.on('weberror', (e) => errors.push(String(e.error())));
  return {
    id, context, server, errors, sw,
    ext: (p) => `chrome-extension://${id}/${p}`,
    async open(url = 'https://x.com/home/') {
      const page = await context.newPage();
      page.on('pageerror', (e) => errors.push('page: ' + e.message));
      page.on('crash', () => { errors.push('page crashed'); console.error('the page crashed (the renderer died: ' + page.url() + ')'); });
      await page.goto(url);
      return page;
    },
    async teardown() { await context.close().catch(() => {}); await server.close(); fs.rmSync(tmp, { recursive: true, force: true }); },
  };
}

module.exports = { setup };
