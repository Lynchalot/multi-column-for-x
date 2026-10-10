const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// background.js run against a stand-in for the extension API: what the toolbar button does while x.com is not allowed (no popup, a mark, the press is the request)
function boot({ granted, answer = true, tabs = [], withSettings = false }) {
  const calls = { popup: [], badge: [], request: [], reload: [], created: [], stored: [] };
  let clicked = null, onAdded = null, installed = null;
  const order = [];
  const api = {
    action: { setBadgeText: (o) => calls.badge.push(o.text), setBadgeBackgroundColor() {}, setBadgeTextColor() {}, setTitle() {}, setPopup: (o) => calls.popup.push(o.popup), onClicked: { addListener: (fn) => { clicked = fn; } } },
    permissions: { contains: async () => granted.v, request: (o) => { order.push('request'); calls.request.push(o); if (answer) granted.v = true; return Promise.resolve(answer); }, onAdded: { addListener: (fn) => { onAdded = fn; } }, onRemoved: { addListener() {} } },
    storage: { local: { get: async () => ({}), set: async (o) => { calls.stored.push(o); } }, onChanged: { addListener() {} } },
    runtime: { onMessage: { addListener() {} }, onInstalled: { addListener: (f) => { installed = f; } }, getURL: (p) => p, openOptionsPage: async () => {} },
    downloads: { download: async () => {} },
    tabs: { query: async () => tabs.map((id) => ({ id })), reload: async (id) => { calls.reload.push(id); }, create: async (o) => { calls.created.push(o.url); } },
  };
  const ctx = vm.createContext({ browser: api, console, Promise, URL, setTimeout });
  if (withSettings) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'settings.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8'), ctx);
  return { calls, order, click: () => clicked(), onAdded: () => onAdded && onAdded(), install: (info) => installed(info), api };
}
const tick = () => new Promise((r) => setTimeout(r, 20));

test('without access to x.com the toolbar button has no popup and carries a mark; with it, the popup is there and the mark is not', async () => {
  const no = boot({ granted: { v: false } });
  await tick();
  assert.equal(no.calls.popup.at(-1), '', 'no popup');
  assert.equal(no.calls.badge.at(-1), '!');
  const yes = boot({ granted: { v: true } });
  await tick();
  assert.equal(yes.calls.popup.at(-1), 'popup.html');
  assert.equal(yes.calls.badge.at(-1), '');
});

test('a press on the button is the request, made first; allowed, the x.com tabs reload and the popup comes back', async () => {
  const granted = { v: false };
  const b = boot({ granted, tabs: [7, 8] });
  await tick();
  const done = b.click();
  assert.equal(b.calls.request.length, 1, 'asked at once, straight from the press');
  assert.deepEqual(Array.from(b.calls.request[0].origins), ['https://x.com/*', 'https://twitter.com/*']);
  await done; await tick();
  assert.deepEqual(b.calls.reload, [7, 8]);
  assert.deepEqual(b.calls.created, [], 'tabs were open: none opened');
  assert.equal(b.calls.popup.at(-1), 'popup.html', 'the popup is back');
  assert.equal(b.calls.badge.at(-1), '');
});

test('allowed with no x.com tab open, x.com opens; refused, nothing happens and it can be asked again', async () => {
  const none = boot({ granted: { v: false }, tabs: [] });
  await tick(); await none.click(); await tick();
  assert.deepEqual(none.calls.created, ['https://x.com/home']);
  const no = boot({ granted: { v: false }, answer: false, tabs: [7] });
  await tick(); await no.click(); await tick();
  assert.deepEqual(no.calls.reload, []); assert.deepEqual(no.calls.created, []);
  assert.equal(no.calls.popup.at(-1), '', 'still no popup');
  await no.click(); await tick();
  assert.equal(no.calls.request.length, 2, 'asked again');
});

test('a fresh install is given Calm and the Vim keys, and opens the welcome page; an update changes nothing', async () => {
  const b = boot({ granted: { v: true }, withSettings: true });
  await tick(); await b.install({ reason: 'install' }); await tick();
  assert.equal(b.calls.stored.length, 1);
  assert.equal(b.calls.stored[0].keyScheme, 'vim', 'the welcome page opens on the Vim keys');
  assert.equal(b.calls.stored[0].leftPanel, 'rail'); assert.equal(b.calls.stored[0].rightPanel, 'hidden');
  assert.deepEqual(b.calls.created, ['options.html?welcome=1']);
  const up = boot({ granted: { v: true }, withSettings: true });
  await tick(); await up.install({ reason: 'update' }); await tick();
  assert.deepEqual(up.calls.stored, []); assert.deepEqual(up.calls.created, []);
});
