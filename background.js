// Background jobs the page itself can't do: saving media (downloads API / aria2) and opening the options page.
const api = typeof browser !== 'undefined' ? browser : chrome;
const ALLOWED_HOSTS = /^https:\/\/(pbs|video)\.twimg\.com\//; // only ever fetch X's own media servers
const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\//;

// "X/someone/123-1.jpg" -> a safe path inside the Downloads folder
const clean = (n) => String(n || 'x-media').replace(/[^\w.\-/ ]/g, '_').replace(/\.\.+/g, '.').replace(/^\/+/, '').slice(0, 200);

async function viaBrowser(files, saveAs) {
  for (const f of files) await api.downloads.download({ url: f.url, filename: clean(f.filename), conflictAction: 'uniquify', saveAs: !!saveAs });
}

async function viaAria2(files, cfg) {
  const url = cfg.url || 'http://localhost:6800/jsonrpc';
  if (!LOCAL.test(url)) throw new Error('The aria2 address must be on this computer (localhost).');
  for (const f of files) {
    const opts = { out: clean(f.filename) };
    if (cfg.dir && String(cfg.dir).trim()) opts.dir = String(cfg.dir).trim(); // aria2 can save anywhere on the computer
    const params = [[f.url], opts];
    if (cfg.token) params.unshift('token:' + cfg.token);
    const res = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'xmc', method: 'aria2.addUri', params }),
    });
    const j = await res.json();
    if (j.error) throw new Error('aria2: ' + j.error.message);
  }
}

api.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || sender.id !== api.runtime.id) return undefined;
  if (msg.type === 'xmc-open-options') return api.runtime.openOptionsPage().then(() => ({ ok: true }));
  if (msg.type !== 'xmc-download') return undefined;
  const files = (Array.isArray(msg.files) ? msg.files : []).filter((f) => f && typeof f.url === 'string' && ALLOWED_HOSTS.test(f.url)).slice(0, 20);
  if (!files.length) return Promise.resolve({ ok: false, error: 'nothing to download' });
  const job = msg.via === 'aria2' ? viaAria2(files, msg.aria2 || {}) : viaBrowser(files, msg.saveAs);
  return job.then(() => ({ ok: true }), (e) => ({ ok: false, error: String((e && e.message) || e) }));
});
