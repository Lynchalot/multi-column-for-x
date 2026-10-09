// Loads the built Firefox package into a real Firefox (as a temporary add-on, through geckodriver) and points x.com at the stand-in. The stand-in is
// served over https with a throwaway certificate, and the browser reaches it through a small CONNECT proxy of our own (so nothing needs port 443).
// Playwright cannot install an extension in Firefox; this speaks the WebDriver protocol to geckodriver directly, so there is nothing to install.
//   XMC_FIREFOX=/path/to/firefox [XMC_GECKODRIVER=/path/to/geckodriver] node --test test/real/firefox.test.js
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const path = require('node:path');
const http = require('node:http');
const { spawn, execFileSync } = require('node:child_process');
const { start } = require('../e2e/mock/server.js');

const ROOT = path.join(__dirname, '..', '..');
const HOSTS = ['x.com', 'twitter.com', 'pbs.twimg.com', 'video.twimg.com'];
const UUID = '5e0b3a52-6f0c-4b0e-9c57-0d3b1a2f4c11'; // (fixed, so that moz-extension://UUID/ is known: set in the profile's extensions.webextensions.uuids)
const ADDON_ID = 'multi-column-for-x@lynchalot.github.io';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function which(name) {
  try { return execFileSync('which', [name], { encoding: 'utf8' }).trim() || null; } catch { return null; }
}

// A minimal WebDriver (classic) client: only what the tests use.
class Driver {
  constructor(base, sid) { this.base = base; this.sid = sid; }
  async call(method, p, body) {
    const res = await fetch(this.base + '/session/' + this.sid + p, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const j = await res.json();
    if (j.value && j.value.error && typeof j.value.message === 'string' && 'stacktrace' in j.value) { const e = new Error(`${j.value.error}: ${j.value.message}`); e.webdriver = j.value.error; throw e; }
    return j.value;
  }
  go(url) { return this.call('POST', '/url', { url }); }
  url() { return this.call('GET', '/url'); }
  // Runs fn (a function) in the page with args; returns what it returns (a promise is awaited).
  js(fn, ...args) {
    return this.call('POST', '/execute/async', { script: `const done = arguments[arguments.length - 1]; Promise.resolve().then(() => (${fn.toString()}).apply(null, Array.prototype.slice.call(arguments, 0, -1))).then((v) => done(v === undefined ? null : v), (e) => done({ __error: String(e && e.message || e) }));`, args })
      .then((v) => { if (v && v.__error) throw new Error('in page: ' + v.__error); return v; });
  }
  async waitFor(fn, args = [], timeout = 15000, what = '') {
    const end = Date.now() + timeout; let last;
    while (Date.now() < end) { try { last = await this.js(fn, ...args); if (last) return last; } catch (e) { last = e; } await sleep(150); }
    throw new Error('timed out waiting for ' + (what || fn.toString().slice(0, 120)) + (last instanceof Error ? ' (' + last.message + ')' : ''));
  }
  handles() { return this.call('GET', '/window/handles'); }
  handle() { return this.call('GET', '/window'); }
  switchTo(handle) { return this.call('POST', '/window', { handle }); }
  async newTab() { const r = await this.call('POST', '/window/new', { type: 'tab' }); await this.switchTo(r.handle); return r.handle; }
  closeTab() { return this.call('DELETE', '/window'); }
  size(width, height) { return this.call('POST', '/window/rect', { width, height }); }
  async find(css) { const r = await this.call('POST', '/element', { using: 'css selector', value: css }); return Object.values(r)[0]; }
  async click(css) { const id = await this.find(css); return this.call('POST', `/element/${id}/click`, {}); }
  // A pointer press at a point of the viewport (what a mouse does: whatever is topmost there gets it, however it is clipped or pinned).
  pointer(x, y) {
    const actions = [{ type: 'pointer', id: 'p', parameters: { pointerType: 'mouse' }, actions: [{ type: 'pointerMove', x: Math.round(x), y: Math.round(y), origin: 'viewport' }, { type: 'pointerDown', button: 0 }, { type: 'pointerUp', button: 0 }] }];
    return this.call('POST', '/actions', { actions });
  }
  // The same at the middle of the first element the selector finds that nothing else covers there (as a person would pick one they can see).
  async press(css) {
    const r = await this.js((s) => {
      for (const el of document.querySelectorAll(s)) {
        el.scrollIntoView({ block: 'center', inline: 'center' });
        const b = el.getBoundingClientRect(), x = b.x + b.width / 2, y = b.y + b.height / 2, top = document.elementFromPoint(x, y);
        if (top && el.contains(top) && x >= 0 && y >= 0 && x < innerWidth && y < innerHeight) return [x, y];
      }
      return null;
    }, css);
    if (!r) throw new Error('nothing to press at ' + css);
    return this.pointer(r[0], r[1]);
  }
  // Into a frame (the element's), and back out to the page.
  async frame(css) { const id = await this.find(css); return this.call('POST', '/frame', { id: { 'element-6066-11e4-a52e-4f735466cecf': id } }); }
  topFrame() { return this.call('POST', '/frame', { id: null }); }
  // Keys go to whatever has focus, as a person's would (an array of key names or characters).
  keys(...keys) {
    const actions = [{ type: 'key', id: 'k', actions: keys.flatMap((k) => [{ type: 'keyDown', value: KEYS[k] || k }, { type: 'keyUp', value: KEYS[k] || k }]) }];
    return this.call('POST', '/actions', { actions });
  }
  mouse(x, y, wheel = 0) {
    const actions = [{ type: 'wheel', id: 'w', actions: [{ type: 'scroll', x, y, deltaX: 0, deltaY: wheel, origin: 'viewport' }] }];
    return this.call('POST', '/actions', { actions });
  }
  async screenshot(file) { fs.writeFileSync(file, Buffer.from(await this.call('GET', '/screenshot'), 'base64')); }
}
const KEYS = { Escape: '', ArrowRight: '', ArrowLeft: '', ArrowDown: '', ArrowUp: '', Enter: '', Tab: '' };

async function setup({ pages = 30, csp = '' } = {}) {
  const exe = process.env.XMC_FIREFOX || (process.env.CI ? which('firefox') : null);
  const gecko = process.env.XMC_GECKODRIVER || which('geckodriver');
  if (!exe || !gecko) return null;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xmc-ff-'));
  const zipDir = path.join(tmp, 'zip');
  execFileSync('npx', ['--yes', 'web-ext', 'build', '--config', 'web-ext-config.cjs', '--overwrite-dest', '--artifacts-dir', zipDir], { cwd: ROOT, stdio: 'ignore' });
  const zip = path.join(zipDir, fs.readdirSync(zipDir).find((f) => f.endsWith('.zip')));
  const key = path.join(tmp, 'key.pem'), cert = path.join(tmp, 'cert.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '2', '-subj', '/CN=x.com', '-addext', 'subjectAltName=' + HOSTS.map((h) => 'DNS:' + h).join(',')], { stdio: 'ignore' });
  const server = await start({ pages, tls: { key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, bare: true, publicOrigin: 'https://x.com', csp });
  // Every https request the browser makes to one of our hosts is tunnelled to the stand-in; anything else is refused (no traffic leaves).
  const sockets = new Set();
  const proxy = http.createServer((q, s) => { s.writeHead(502); s.end(); });
  proxy.on('connect', (req, client, head) => {
    const host = req.url.split(':')[0];
    if (!HOSTS.includes(host) && host !== '127.0.0.1') { client.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
    const up = net.connect(server.port, '127.0.0.1', () => { client.write('HTTP/1.1 200 Connection Established\r\n\r\n'); if (head.length) up.write(head); up.pipe(client); client.pipe(up); });
    for (const s of [up, client]) { sockets.add(s); s.on('close', () => sockets.delete(s)); s.on('error', () => s.destroy()); }
  });
  await new Promise((r) => proxy.listen(0, '127.0.0.1', r));
  const proxyPort = proxy.address().port;
  const gport = await new Promise((r) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
  const log = fs.openSync(path.join(tmp, 'geckodriver.log'), 'w');
  const gd = spawn(gecko, ['--port', String(gport), '--binary', exe], { stdio: ['ignore', log, log] });
  const base = 'http://127.0.0.1:' + gport;
  for (let i = 0; i < 100; i++) { try { await fetch(base + '/status'); break; } catch { await sleep(100); } }
  const created = await fetch(base + '/session', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ capabilities: { alwaysMatch: {
      browserName: 'firefox', acceptInsecureCerts: true,
      'moz:firefoxOptions': { args: ['-headless'], prefs: {
        'network.proxy.type': 1, 'network.proxy.ssl': '127.0.0.1', 'network.proxy.ssl_port': proxyPort, 'network.proxy.http': '127.0.0.1', 'network.proxy.http_port': proxyPort,
        'network.proxy.no_proxies_on': '', 'network.stricttransportsecurity.preloadlist': false, 'security.cert_pinning.enforcement_level': 0,
        'extensions.webextensions.uuids': JSON.stringify({ [ADDON_ID]: UUID }), 'extensions.autoDisableScopes': 0, 'xpinstall.signatures.required': false,
        'app.update.enabled': false, 'datareporting.policy.dataSubmissionEnabled': false, 'browser.shell.checkDefaultBrowser': false,
        'media.autoplay.default': 0, 'media.autoplay.blocking_policy': 0,
      } },
    } } }),
  }).then((r) => r.json());
  if (!created.value || !created.value.sessionId) { gd.kill(); proxy.close(); await server.close(); throw new Error('no session: ' + JSON.stringify(created.value).slice(0, 400)); }
  const d = new Driver(base, created.value.sessionId);
  await d.size(1700, 950);
  const main = await d.handle();
  await fetch(base + '/session/' + d.sid + '/moz/addon/install', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: zip, temporary: true }) })
    .then((r) => r.json()).then((j) => { if (j.value && j.value.error) throw new Error('install: ' + j.value.message); });
  await d.switchTo(main);
  return {
    d, server, main, version: created.value.capabilities.browserVersion, tmp,
    ext: (p) => `moz-extension://${UUID}/${p}`,
    async teardown() {
      await fetch(base + '/session/' + d.sid, { method: 'DELETE' }).catch(() => {});
      gd.kill(); for (const s of sockets) s.destroy(); proxy.close(); await server.close(); fs.rmSync(tmp, { recursive: true, force: true });
    },
  };
}

module.exports = { setup, sleep };
