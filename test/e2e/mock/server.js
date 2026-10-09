// Serves the stand-in x.com pages, its API, and the extension's own files under /ext/ (so the pages load them like a content script would).
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { makeApi } = require('./api.js');
const { pageFor } = require('./pages.js');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const TYPES = { '.js': 'application/javascript; charset=utf-8', '.css': 'text/css', '.html': 'text/html; charset=utf-8', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.png': 'image/png' };

// A small solid-colour PNG (so that a picture costs the page one image and no document).
function png(shade) {
  const zlib = require('node:zlib');
  const w = 16, h = 10, raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = shade; raw[o + 1] = 90 + shade % 80; raw[o + 2] = 200 - shade % 120; }
  const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// tls: { key, cert } serves https. bare: pages without the extension's scripts and stylesheet (an installed extension puts them there itself).
// publicOrigin: what the pages call themselves (e.g. https://x.com, when the browser maps that name to this server).
// twimg: pictures and videos are said to live on pbs.twimg.com and video.twimg.com, as on X (the browser must map those names to this server too).
// raster: pictures are small PNGs, not SVG (every SVG used as an image is a document of its own in the browser, which a count of documents and nodes would show as growth).
// csp: a Content-Security-Policy header for the pages (a strict one, like X's, shows what the extension's frames and styles do under it).
function start({ pages = 30, port = 0, tls = null, bare = false, publicOrigin = '', csp = '', twimg = false, raster = false } = {}) {
  let origin = '';
  let api = null;
  let cspHeader = csp;
  const handler = (req, res) => {
    const u = new URL(req.url, 'http://localhost');
    const send = (code, type, body) => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(body); };
    const gql = /^\/i\/api\/graphql\/[^/]+\/(\w+)/.exec(u.pathname);
    if (gql) {
      const finish = (vars) => send(200, 'application/json', JSON.stringify(api.respond(gql[1], vars)));
      if (req.method === 'POST') {
        let raw = ''; req.on('data', (c) => { raw += c; });
        req.on('end', () => { let v = {}; try { v = JSON.parse(raw || '{}').variables || {}; } catch { /* empty */ } finish(v); });
      } else { let v = {}; try { v = JSON.parse(u.searchParams.get('variables') || '{}'); } catch { /* empty */ } finish(v); }
      return;
    }
    if (raster && u.pathname.startsWith('/img/')) {
      const n = path.basename(u.pathname).replace(/\.\w+$/, ''); const hue = [...n].reduce((a, c) => a + c.charCodeAt(0), 0) * 37 % 256;
      return send(200, 'image/png', png(hue));
    }
    if (u.pathname.startsWith('/img/')) {
      const n = path.basename(u.pathname).replace(/\.\w+$/, ''); const hue = [...n].reduce((a, c) => a + c.charCodeAt(0), 0) * 37 % 360;
      return send(200, 'image/svg+xml', `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800"><rect width="1200" height="800" fill="hsl(${hue},60%,45%)"/><text x="60" y="400" font-size="90" fill="white">${n}</text></svg>`);
    }
    if (u.pathname.startsWith('/vid/')) return send(200, 'video/mp4', fs.readFileSync(path.join(__dirname, 'vid', 'lo.mp4')));
    if (u.pathname.startsWith('/ext/')) {
      const f = path.join(ROOT, u.pathname.slice(5));
      if (f.startsWith(ROOT) && fs.existsSync(f) && fs.statSync(f).isFile()) return send(200, TYPES[path.extname(f)] || 'application/octet-stream', fs.readFileSync(f));
      return send(404, 'text/plain', 'not found');
    }
    if (u.pathname === '/favicon.ico') return send(204, 'image/x-icon', '');
    let html = pageFor(u.pathname);
    if (html && bare) html = html.replace(/<script src="\/ext\/src\/[^"]+"><\/script>/g, '').replace('<link rel="stylesheet" href="/ext/src/styles.css">', '');
    if (html && cspHeader) res.setHeader('Content-Security-Policy', cspHeader);
    return html ? send(200, 'text/html; charset=utf-8', html) : send(404, 'text/plain', 'not found');
  };
  const server = tls ? require('node:https').createServer(tls, handler) : http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      origin = publicOrigin || ('http://127.0.0.1:' + server.address().port);
      api = makeApi(origin, pages, twimg ? { img: 'https://pbs.twimg.com', vid: 'https://video.twimg.com' } : null);
      resolve({ origin, port: server.address().port, setCsp: (v) => { cspHeader = v; }, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

module.exports = { start };

if (require.main === module) { // npm run mock: look at the pages by hand
  start({ port: Number(process.env.PORT) || 8766 }).then((s) => console.log('mock x.com at', s.origin + '/home/'));
}
