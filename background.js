// Background jobs the page itself can't do: saving media (downloads API) and opening the options page.
const api = typeof browser !== 'undefined' ? browser : chrome;
const ALLOWED_HOSTS = /^https:\/\/(pbs|video)\.twimg\.com\//; // only ever fetch X's own media servers

// "X/someone/123-1.jpg" -> a safe path inside the Downloads folder
const clean = (n) => String(n || 'x-media').replace(/[^\w.\-/ ]/g, '_').replace(/\.\.+/g, '.').replace(/^\/+/, '').slice(0, 200);

async function viaBrowser(files, saveAs) {
  for (const f of files) await api.downloads.download({ url: f.url, filename: clean(f.filename), conflictAction: 'uniquify', saveAs: !!saveAs });
}

api.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || sender.id !== api.runtime.id) return undefined;
  if (msg.type === 'xmc-open-options') return api.runtime.openOptionsPage().then(() => ({ ok: true }));
  if (msg.type !== 'xmc-download') return undefined;
  const files = (Array.isArray(msg.files) ? msg.files : []).filter((f) => f && typeof f.url === 'string' && ALLOWED_HOSTS.test(f.url)).slice(0, 20);
  if (!files.length) return Promise.resolve({ ok: false, error: 'nothing to download' });
  const job = viaBrowser(files, msg.saveAs);
  return job.then(() => ({ ok: true }), (e) => ({ ok: false, error: String((e && e.message) || e) }));
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
