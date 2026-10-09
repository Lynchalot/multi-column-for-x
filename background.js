// Background jobs the page itself can't do: saving media (downloads API) and opening the options page.
const api = typeof browser !== 'undefined' ? browser : chrome;
const ALLOWED_HOSTS = /^https:\/\/(pbs|video)\.twimg\.com\//; // only ever fetch X's own media servers

// "X/someone/123-1.jpg" -> a safe path inside the Downloads folder
const clean = (n) => String(n || 'x-media').replace(/[^\w.\-/ ]/g, '_').replace(/\.\.+/g, '.').replace(/^\/+/, '').slice(0, 200);

async function viaBrowser(files, saveAs) {
  for (const f of files) await api.downloads.download({ url: f.url, filename: clean(f.filename), conflictAction: 'uniquify', saveAs: !!saveAs });
}

// The toolbar button says "off" while the master switch (Enabled, in the settings) is off.
function showSwitch(off) {
  try {
    api.action.setBadgeText({ text: off ? 'off' : '' });
    if (off) { api.action.setBadgeBackgroundColor({ color: '#6b7280' }); if (api.action.setBadgeTextColor) api.action.setBadgeTextColor({ color: '#ffffff' }); }
  } catch { /* no action API here */ }
}
api.storage.local.get('enabled').then((v) => showSwitch(v && v.enabled === false)).catch(() => {});
api.storage.onChanged.addListener((ch, area) => { if (area === 'local' && ch.enabled) showSwitch(ch.enabled.newValue === false); });

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
  api.tabs.create({ url: api.runtime.getURL('options.html#sec-presets') });
});
