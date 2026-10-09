// The extension as Firefox loads it: the zip `web-ext build` makes, installed as a temporary add-on into a real Firefox, run against the stand-in x.com.
// The page-world tests (test/e2e) run the scripts as plain page scripts in Chromium; this is the one place they run as a content script in Gecko, with
// browser.storage, the background page, the extension's own pages, and the page's CSP in play.
// WebDriver cannot script a top-level extension page, so the extension's pages are reached the way a person reaches them on x.com: the gear's panel (a frame
// over the page) and, for the toolbar panel, the same page framed by hand (it is web-accessible to x.com).
// Run: XMC_FIREFOX=/path/to/firefox XMC_GECKODRIVER=/path/to/geckodriver npm run test:firefox
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setup, sleep } = require('./firefox-rig.js');

// Strict, in the way that matters here: frames only from the page's own origin (an extension page is neither), and scripts and styles from it.
const STRICT = "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:; frame-src 'self'; child-src 'self'; img-src * data: blob:; media-src * blob:; connect-src *; object-src 'none'";

let rig = null;
test.before(async () => { rig = await setup(); });
test.after(async () => { if (rig) await rig.teardown(); });
const firefox = (name, fn, timeout = 90000) => test(name, { timeout }, async (t) => { if (!rig) return t.skip('no Firefox (set XMC_FIREFOX and XMC_GECKODRIVER)'); await fn(rig, rig.d); });

// Back on x.com in the first tab (no other tab left open), the columns drawn, nothing of an earlier test showing.
async function home(r, d, url = 'https://x.com/home/') {
  for (const h of await d.handles()) if (h !== r.main) { await d.switchTo(h); await d.closeTab(); }
  await d.switchTo(r.main);
  await d.go(url);
  await d.waitFor(() => document.querySelectorAll('.xmc-card').length > 0, [], 25000, 'the columns');
}
// Runs fn inside the settings panel's page (the gear opens it over x.com), then comes back out to the page.
async function panel(d, fn) {
  if (!(await d.js(() => !!document.querySelector('#xmc-settings iframe')))) {
    await d.press('.xmc-gear');
    await d.waitFor(() => !!document.querySelector('#xmc-settings iframe'), [], 8000, 'the panel');
  }
  await d.frame('#xmc-settings iframe');
  try {
    await d.waitFor(() => !!document.querySelector('#sections h2 button.fold'), [], 10000, 'the panel\'s page');
    return await fn();
  } finally { await d.topFrame(); }
}
const stored = (key) => browser.storage.local.get(key).then((o) => o[key]); // (runs in an extension page)

firefox('the extension loads: the install opened the settings at the presets, and the columns are drawn on x.com', async (r, d) => {
  let urls = [];
  for (let i = 0; i < 60; i++) { // (the install opens it a moment after)
    urls = [];
    for (const h of await d.handles()) { await d.switchTo(h); urls.push(await d.url()); }
    if (urls.some((u) => /options\.html#sec-presets/.test(u))) break;
    await sleep(200);
  }
  assert.ok(urls.some((u) => /options\.html#sec-presets/.test(u)), 'the install opened the settings page at the presets: ' + urls.join(' '));
  await home(r, d);
  assert.ok((await d.js(() => document.querySelectorAll('.xmc-col').length)) >= 1, 'columns');
  assert.equal((await d.js(() => document.getElementById('xmc-pill').innerText)).trim(), 'Turn Columns Off');
});

firefox('the page-world hook and the content scripts both run (the data comes through the hook; the cards are drawn by the isolated scripts)', async (r, d) => {
  await home(r, d);
  const n = await d.js(() => document.querySelectorAll('.xmc-card').length);
  assert.ok(n >= 6, 'cards from the posts the hook captured: ' + n);
  assert.equal(await d.js(() => document.documentElement.classList.contains('xmc-on')), true);
});

firefox('a setting made in the panel goes through browser.storage and reaches the page at once', async (r, d) => {
  await home(r, d);
  const before = await d.js(() => document.querySelectorAll('.xmc-col').length);
  const want = before === 2 ? 3 : 2;
  await panel(d, async () => {
    await d.js((n) => { const el = document.getElementById('opt-cols'); el.value = String(n); el.dispatchEvent(new Event('change', { bubbles: true })); }, want);
    await d.waitFor((n) => browser.storage.local.get('cols').then((o) => o.cols === n), [want], 8000, 'the stored value');
  });
  await d.waitFor((n) => document.querySelectorAll('.xmc-col').length === n, [want], 10000, 'the page to follow');
  await d.keys('Escape');
});

firefox('the gear opens the settings panel, a page of the extension framed over x.com (no fallback tab), and Esc closes it', async (r, d) => {
  await home(r, d);
  const tabs = (await d.handles()).length;
  await d.press('.xmc-gear');
  await d.waitFor(() => !!document.querySelector('#xmc-settings iframe'), [], 8000, 'the panel');
  await sleep(3800); // (longer than the wait for it to say it is up, after which the panel gives up and opens a tab)
  assert.equal(await d.js(() => document.querySelectorAll('#xmc-settings').length), 1, 'still there: it said it was up');
  assert.equal((await d.handles()).length, tabs, 'and no tab opened');
  assert.match(await d.js(() => document.querySelector('#xmc-settings iframe').src), /^moz-extension:\/\//);
  await d.keys('Escape');
  await d.waitFor(() => !document.getElementById('xmc-settings'), [], 4000, 'the panel to close');
});

firefox('the same under a page policy that allows frames only from the page\'s own origin: the panel still opens', async (r, d) => {
  r.server.setCsp(STRICT);
  try {
    await home(r, d);
    const tabs = (await d.handles()).length;
    await d.press('.xmc-gear');
    await d.waitFor(() => !!document.querySelector('#xmc-settings iframe'), [], 8000, 'the panel');
    await sleep(3800);
    assert.equal(await d.js(() => !!document.getElementById('xmc-settings')), true, 'the panel itself held under the page\'s policy (the fallback tab is the safety net, not the plan)');
    assert.equal((await d.handles()).length, tabs, 'and no tab opened');
    await panel(d, async () => assert.ok(await d.js(() => document.querySelectorAll('#sections h2 button.fold').length > 5), 'the panel\'s page loaded its sections'));
    await d.keys('Escape');
  } finally { r.server.setCsp(''); }
});

firefox('the toolbar panel (popup.html, not framed by the extension) saves to browser.storage', async (r, d) => {
  await home(r, d);
  await d.js((u) => { const f = document.createElement('iframe'); f.id = 'zz-popup'; f.src = u; f.style.cssText = 'position:fixed;left:0;top:0;width:480px;height:600px;z-index:2147483647;background:#fff'; document.body.appendChild(f); }, r.ext('popup.html'));
  await d.frame('#zz-popup');
  try {
    await d.waitFor(() => !!document.querySelector('#sections h2 button.fold'), [], 10000, 'the popup');
    assert.equal(await d.js(() => new URLSearchParams(location.search).has('framed')), false, 'the page is the toolbar one, not the gear\'s');
    const was = await d.js(() => { [...document.querySelectorAll('#sections h2 button.fold')].find((b) => /Algorithmic content/.test(b.textContent)).click(); const c = document.getElementById('opt-onlyFollowed'); const w = c.checked; c.click(); return w; });
    await d.waitFor((w) => browser.storage.local.get('onlyFollowed').then((o) => o.onlyFollowed === !w), [was], 6000, 'the stored value');
    await d.js((w) => browser.storage.local.set({ onlyFollowed: w }), was);
  } finally { await d.topFrame(); await d.js(() => document.getElementById('zz-popup').remove()); }
});

firefox('the background answers messages (open the options page; refuse a download that is not one of X\'s media)', async (r, d) => {
  await home(r, d);
  await panel(d, async () => {
    assert.deepEqual(await d.js(() => browser.runtime.sendMessage({ type: 'xmc-download', files: [{ url: 'https://example.com/a.jpg', filename: 'X/a.jpg' }] })), { ok: false, error: 'nothing to download' });
    assert.deepEqual(await d.js(() => browser.runtime.sendMessage({ type: 'xmc-open-options' })), { ok: true });
  });
  let urls = [];
  for (let i = 0; i < 40; i++) {
    urls = [];
    for (const h of await d.handles()) { await d.switchTo(h); urls.push(await d.url()); }
    if (urls.some((u) => /options\.html/.test(u))) break;
    await sleep(200);
  }
  assert.ok(urls.some((u) => /options\.html/.test(u)), 'an options tab: ' + urls.join(' '));
  await d.switchTo(r.main);
});

firefox('keys that move X\'s hidden page move the columns (the content script\'s own world: its scroll wrapper is not the page\'s)', async (r, d) => {
  await home(r, d);
  await d.js(() => { // what Vimium does with no click: it scrolls the page itself, from its own world, not through this extension's
    document.addEventListener('keydown', (ev) => { if (ev.key === 'j') window.scrollBy(0, 60); }, true);
    document.activeElement && document.activeElement.blur();
  });
  // (X's page is left alone for a while once the posts are in; the extension is moving it itself until then, and a key pressed in that time is not told from that)
  await d.waitFor(() => { const w = window.__zzIdle = window.__zzIdle || { y: -1, at: Date.now() }; if (Math.round(window.scrollY) !== w.y) { w.y = Math.round(window.scrollY); w.at = Date.now(); } return Date.now() - w.at > 1500; }, [], 40000, 'X\'s page to be idle');
  const top = () => d.js(() => document.querySelector('.xmc-scroller').scrollTop);
  const before = await top();
  await d.keys('j'); await sleep(600);
  assert.ok((await top()) - before >= 50, 'the columns moved: ' + before + ' -> ' + (await top()));
});

firefox('a tour of the main flows (open a post, a picture full size, fold and unfold the menu with a pointer press on the logo, the gear) leaves everything working', async (r, d) => {
  await home(r, d);
  await d.press('.xmc-card .xmc-text');
  await d.waitFor(() => !!document.querySelector('.xmc-view'), [], 8000, 'a post opened');
  await d.waitFor(() => document.querySelectorAll('.xmc-ritem').length >= 1, [], 20000, 'the comments (X\'s hidden page goes to the post and back, the hook captures what X sends, the panel draws it)');
  await d.keys('Escape');
  await d.waitFor(() => !document.querySelector('.xmc-view'), [], 6000, 'the post to close');
  const settled = () => d.waitFor(() => !document.documentElement.classList.contains('xmc-frozen'), [], 25000, 'the menu to be live again'); // (X's page is away on the post for a moment, a still copy of the menu stands in, and a press goes through it to nothing)
  await settled();
  assert.equal(await d.js(() => !!document.querySelector('.xmc-card [data-lb]')), true, 'the stand-in has a picture to open');
  await d.press('.xmc-card [data-lb]');
  await d.waitFor(() => !!document.getElementById('xmc-lightbox'), [], 6000, 'the viewer');
  await d.keys('ArrowRight'); await sleep(400);
  await d.keys('Escape');
  await d.waitFor(() => !document.getElementById('xmc-lightbox'), [], 4000, 'the viewer to close');
  await settled();
  const logo = 'header[role="banner"] h1 a[data-xmc-logo]';
  await d.waitFor((s) => !!document.querySelector(s), [logo], 15000, 'the logo to take on the fold'); // (a few seconds after the columns)
  await d.press(logo); // a real pointer press on the logo, at its place on the page
  await d.waitFor(() => document.documentElement.classList.contains('xmc-rail'), [], 5000, 'the menu to fold to icons');
  assert.equal(await d.js(() => location.pathname), '/home/', 'the logo did not go anywhere');
  await d.press(logo);
  await d.waitFor(() => !document.documentElement.classList.contains('xmc-rail') && !document.documentElement.classList.contains('xmc-panelanim'), [], 5000, 'the menu to come back');
  await d.press('.xmc-gear'); await sleep(1500); await d.keys('Escape'); await sleep(400);
  assert.equal((await d.js(() => document.getElementById('xmc-pill').innerText)).trim(), 'Turn Columns Off', 'still in columns, nothing failed open');
  const rep = await panel(d, () => d.js(stored, 'xmcFeatures'));
  assert.ok(rep, 'the report was written to browser.storage');
  assert.equal(rep.failedOpen, null, 'did not fail open');
  for (const [name, f] of Object.entries(rep.features || {})) assert.notEqual(f.state, 'off', `${name} switched off: ${JSON.stringify(f)}`);
  await d.keys('Escape');
});

firefox('in the full-size viewer the wheel steps between the pictures (a wheel action of the browser\'s own, and a notch counted in lines as Firefox sends a mouse wheel)', async (r, d) => {
  await home(r, d);
  await d.js(() => { const c = [...document.querySelectorAll('.xmc-card')].find((x) => x.querySelectorAll('[data-lb]').length === 3); c.querySelectorAll('[data-lb]')[0].click(); });
  await d.waitFor(() => !!document.getElementById('xmc-lightbox'), [], 8000, 'the viewer');
  const src = () => d.js(() => document.querySelector('#xmc-lightbox img').src.split('/').pop().split('?')[0]);
  const first = await src();
  await sleep(600);
  await d.js(() => { window.__wheels = []; document.addEventListener('wheel', (e) => window.__wheels.push([e.deltaMode, e.deltaY, e.isTrusted]), true); });
  await d.mouse(850, 450, 120); // (what the browser makes of a wheel turn: its own deltaMode and size, whatever they are)
  await d.waitFor((s) => document.querySelector('#xmc-lightbox img').src.split('/').pop().split('?')[0] !== s, [first], 4000, 'the wheel to step forward (it sent ' + JSON.stringify(await d.js(() => window.__wheels)) + ')');
  const second = await src();
  await sleep(600);
  await d.js(() => document.getElementById('xmc-lightbox').dispatchEvent(new WheelEvent('wheel', { deltaY: -3, deltaMode: 1, bubbles: true, cancelable: true })));
  await d.waitFor((s) => document.querySelector('#xmc-lightbox img').src.split('/').pop().split('?')[0] === s, [first], 4000, 'a notch of three lines back');
  assert.notEqual(second, first);
  await d.keys('Escape');
});

firefox('the download button on a post with pictures saves them through the background (browser.downloads, X\'s media servers) into the folder the settings name', async (r, d) => {
  await home(r, d);
  await d.press('.xmc-card:has([data-lb]) [data-act="download"]');
  await d.waitFor(() => { const t = document.getElementById('xmc-toast'); return !!t && /Downloading/.test(t.textContent); }, [], 6000, 'the toast (' + JSON.stringify(await d.js(() => (document.getElementById('xmc-toast') || {}).textContent)) + ')');
  const files = () => { const out = []; const walk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const f = path.join(dir, e.name); if (e.isDirectory()) walk(f); else out.push(path.relative(r.dlDir, f)); } }; walk(r.dlDir); return out; };
  let got = [];
  for (let i = 0; i < 60 && !got.some((f) => !/\.part$/.test(f)); i++) { await sleep(250); got = files(); }
  assert.ok(got.length >= 1 && got.every((f) => !/\.part$/.test(f)), 'files in the download folder: ' + JSON.stringify(got));
  assert.ok(got.every((f) => /^X[\\/]/.test(f) || f.split(path.sep).length > 1), 'in a folder of their own, as the settings say: ' + JSON.stringify(got));
});

firefox('Copy link and Copy diagnostics reach the clipboard from the content script (a press is the user activation Firefox wants)', async (r, d) => {
  await home(r, d);
  const toastText = () => d.js(() => (document.getElementById('xmc-toast') || {}).textContent || '');
  await d.press('.xmc-card [data-act="share"]');
  await d.waitFor(() => /Link copied|Couldn/.test((document.getElementById('xmc-toast') || {}).textContent || ''), [], 5000, 'a toast for Copy link');
  assert.equal(await toastText(), 'Link copied');
  await sleep(500);
  await d.press('.xmc-card [data-act="more"]');
  await d.waitFor(() => !!document.querySelector('.xmc-menu'), [], 5000, 'the post\'s menu');
  await d.press('.xmc-menu button', 'Copy diagnostics');
  await d.waitFor(() => /copied|Couldn/i.test((document.getElementById('xmc-toast') || {}).textContent || '') && !/Link copied/.test((document.getElementById('xmc-toast') || {}).textContent), [], 6000, 'a toast for Copy diagnostics');
  assert.match(await toastText(), /^Copied/, 'Copy diagnostics: ' + (await toastText()));
});

firefox('what the extension saw on x.com (the probe of X\'s buttons, the parser\'s counts) is written to browser.storage and shown in the panel\'s status table', async (r, d) => {
  await home(r, d);
  await panel(d, async () => {
    let rep = null;
    for (let i = 0; i < 60 && !(rep && rep.probe); i++) { rep = await d.js(stored, 'xmcFeatures'); if (!(rep && rep.probe)) await sleep(500); }
    assert.ok(rep && rep.probe, 'a report with a probe in it');
    assert.equal(rep.probe.like, true, 'X\'s Like button was found'); assert.equal(rep.probe.homeLink, true);
    assert.ok(rep.parse.tweets > 0, 'the parser read posts');
    await d.waitFor(() => [...document.querySelectorAll('table.status tr')].some((tr) => /Timeline data from X/.test(tr.textContent) && /Working/.test(tr.textContent)), [], 10000, 'the status table');
  });
  await d.keys('Escape');
});
