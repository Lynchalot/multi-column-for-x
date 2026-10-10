// Background jobs the page itself can't do: saving media (downloads API) and opening the options page.
const api = typeof browser !== 'undefined' ? browser : chrome;
const ALLOWED_HOSTS = /^https:\/\/(pbs|video)\.twimg\.com\//; // only ever fetch X's own media servers

// "X/someone/123-1.jpg" -> a safe path inside the Downloads folder
const clean = (n) => String(n || 'x-media').replace(/[^\w.\-/ ]/g, '_').replace(/\.\.+/g, '.').replace(/^\/+/, '').slice(0, 200);

async function viaBrowser(files, saveAs) {
  for (const f of files) await api.downloads.download({ url: f.url, filename: clean(f.filename), conflictAction: 'uniquify', saveAs: !!saveAs });
}

// The toolbar button says "off" while the master switch (Enabled, in the settings) is off, and "!" while the extension has no access to x.com (Firefox lets a
// person switch that off, and then nothing runs on the site and nothing on the page says why).
const X_ORIGINS = ['https://x.com/*', 'https://twitter.com/*'];
const badge = { off: false, noAccess: false };
function paintBadge() {
  try {
    api.action.setBadgeText({ text: badge.noAccess ? '!' : badge.off ? 'off' : '' });
    api.action.setBadgeBackgroundColor({ color: badge.noAccess ? '#d93025' : '#6b7280' });
    if (api.action.setBadgeTextColor) api.action.setBadgeTextColor({ color: '#ffffff' });
    api.action.setTitle({ title: badge.noAccess ? 'Multi-Column for X: allow access to x.com' : badge.off ? 'Multi-Column for X: switched off' : 'Multi-Column for X: settings' });
    api.action.setPopup({ popup: badge.noAccess ? '' : 'popup.html' }); // (no popup while access is missing: the press is the request, see onClicked below)
  } catch { /* no action API here */ }
}
async function checkAccess() {
  try { badge.noAccess = !(await api.permissions.contains({ origins: X_ORIGINS })); } catch { badge.noAccess = false; }
  paintBadge();
}
api.storage.local.get('enabled').then((v) => { badge.off = !!v && v.enabled === false; paintBadge(); }).catch(() => {});
api.storage.onChanged.addListener((ch, area) => { if (area === 'local' && ch.enabled) { badge.off = ch.enabled.newValue === false; paintBadge(); } });
checkAccess();
// With no popup (above) a press on the toolbar button arrives here, and it is the request for x.com: Firefox's prompt is then the only thing on the screen (from the popup it
// opened underneath it). Firefox only takes a request made straight from the press, so it is the first thing done. Allowed: the x.com tabs open are reloaded so the extension
// is on them, or x.com is opened if there are none.
if (api.action && api.action.onClicked) {
  api.action.onClicked.addListener(async () => {
    let ok = false;
    try { ok = await api.permissions.request({ origins: X_ORIGINS }); } catch { /* refused, or not from a press */ }
    await checkAccess();
    if (!ok) return;
    let n = 0;
    try { const tabs = await api.tabs.query({ url: X_ORIGINS }); n = tabs.length; for (const t of tabs) Promise.resolve(api.tabs.reload(t.id)).catch(() => {}); } catch { /* none to reload */ }
    if (!n) api.tabs.create({ url: 'https://x.com/home' });
  });
}
if (api.permissions && api.permissions.onAdded) { api.permissions.onAdded.addListener(checkAccess); api.permissions.onRemoved.addListener(checkAccess); }

// (the answer goes by sendResponse, with `return true` to keep the channel open: Chrome does not take a promise returned from the listener, Firefox takes either)
api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || sender.id !== api.runtime.id) return false;
  const answer = (job) => { job.then(sendResponse, (e) => sendResponse({ ok: false, error: String((e && e.message) || e) })); return true; };
  if (msg.type === 'xmc-open-options') return answer(api.runtime.openOptionsPage().then(() => ({ ok: true })));
  if (msg.type !== 'xmc-download') return false;
  const files = (Array.isArray(msg.files) ? msg.files : []).filter((f) => f && typeof f.url === 'string' && ALLOWED_HOSTS.test(f.url)).slice(0, 20);
  if (!files.length) { sendResponse({ ok: false, error: 'nothing to download' }); return false; }
  return answer(viaBrowser(files, msg.saveAs).then(() => ({ ok: true })));
});

// on first install, open the settings page at the presets
api.runtime.onInstalled.addListener(async (info) => {
  if (!info || info.reason !== 'install') return;
  try { // a fresh install starts on the Calm preset (unless there are settings already, e.g. restored from sync)
    const have = await api.storage.local.get('v');
    if (have.v === undefined && typeof XMCSettings !== 'undefined') await api.storage.local.set(XMCSettings.freshInstall());
  } catch { /* the defaults are fine */ }
  api.tabs.create({ url: api.runtime.getURL('options.html?welcome=1') }); // (welcome: the starting points as large choices at the top, and the banner for the permission, if it is missing, says it is one more step)
});
