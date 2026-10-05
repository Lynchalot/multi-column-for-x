// Serves the stand-in x.com pages, its API, and the extension's own files under /ext/ (so the pages load them like a content script would).
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { makeApi } = require('./api.js');
const { pageFor } = require('./pages.js');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const TYPES = { '.js': 'application/javascript; charset=utf-8', '.css': 'text/css', '.html': 'text/html; charset=utf-8', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.png': 'image/png' };

function start({ pages = 30, port = 0 } = {}) {
  let origin = '';
  let api = null;
  const server = http.createServer((req, res) => {
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
    const html = pageFor(u.pathname);
    return html ? send(200, 'text/html; charset=utf-8', html) : send(404, 'text/plain', 'not found');
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      origin = 'http://127.0.0.1:' + server.address().port;
      api = makeApi(origin, pages);
      resolve({ origin, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

module.exports = { start };

if (require.main === module) { // npm run mock: look at the pages by hand
  start({ port: Number(process.env.PORT) || 8766 }).then((s) => console.log('mock x.com at', s.origin + '/home/'));
}
