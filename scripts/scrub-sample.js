// Takes a file "Save sample for the developer" wrote and makes the copy that may go into the repository (test/fixtures/real/):
//   node scripts/scrub-sample.js in.json out.json      (XMC_BROWSER=/path/to/chromium if there is no Playwright browser)
// The sample already has the words replaced. This is for what a word-for-word replacement leaves: the numbers and names that point at a real post or
// person. Post and user numbers are replaced by others of the same length that keep their order (so a timeline still sorts the way it did), addresses
// of pictures and videos lose their file names, and the markup is run through the current sanitiser again (older files kept a post's author in a link).
// Dates and counts stay: they are what a timeline's shape is made of.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

const [, , inFile, outFile] = process.argv;
if (!inFile || !outFile) { console.error('usage: node scripts/scrub-sample.js in.json out.json'); process.exit(2); }
const sample = JSON.parse(fs.readFileSync(inFile, 'utf8'));

// ---- numbers: every run of 9 or more digits, and the user numbers X writes in base64 ("User:123" as VXNlcjoxMjM=)
const b64 = (s) => Buffer.from(s, 'base64').toString('utf8');
const unb64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const USERID = /VXNlcjo[A-Za-z0-9+/]+={0,2}/g;
const text = JSON.stringify(sample.ops);
const numbers = new Set();
for (const m of text.matchAll(/\d{9,}/g)) numbers.add(m[0]);
for (const m of text.matchAll(USERID)) { const d = /\d+/.exec(b64(m[0])); if (d) numbers.add(d[0]); }
const byLen = new Map();
for (const n of numbers) { if (!byLen.has(n.length)) byLen.set(n.length, []); byLen.get(n.length).push(n); }
const mapping = new Map();
for (const [len, list] of byLen) {
  list.sort((a, b) => (a.length === b.length ? (a < b ? -1 : a > b ? 1 : 0) : a.length - b.length));
  list.forEach((n, i) => mapping.set(n, '1' + String(i + 1).padStart(len - 1, '0')));
}
let scrubbed = text.replace(USERID, (m) => { const t = b64(m); const d = /\d+/.exec(t); return d ? unb64(t.replace(d[0], mapping.get(d[0]))) : m; });
scrubbed = scrubbed.replace(/\d{9,}/g, (n) => mapping.get(n) || n);

// ---- addresses: a picture's or video's file name is a post's identity
const KEEP_SEG = /^(media|profile_images|profile_banners|ext_tw_video_thumb|amplify_video_thumb|tweet_video_thumb|ext_tw_video|amplify_video|vid|pl|aud|img|card_img|semantic_core_img|video_thumb|\d+x\d+|[a-z]{1,4})$/;
const cleanUrl = (u) => {
  let x; try { x = new URL(u); } catch { return u; }
  if (/^(pbs|video)\.twimg\.com$/.test(x.host)) {
    const segs = x.pathname.split('/').filter(Boolean).map((seg, i, a) => {
      if (KEEP_SEG.test(seg)) return seg;
      const dot = seg.lastIndexOf('.');
      return dot > 0 ? 'x'.repeat(dot) + seg.slice(dot) : 'x'.repeat(seg.length);
    });
    return x.origin + '/' + segs.join('/') + (x.searchParams.get('format') ? '?format=' + x.searchParams.get('format') + (x.searchParams.get('name') ? '&name=' + x.searchParams.get('name') : '') : '');
  }
  if (x.host === 't.co') return 'https://t.co/' + 'x'.repeat(x.pathname.length - 1);
  if (/(^|\.)x\.com$|(^|\.)twitter\.com$/.test(x.host)) return x.origin + x.pathname.split('/').map((s, i) => (i === 1 && s && !/^(i|home|search|explore|settings)$/.test(s) ? 'user' : s)).join('/');
  return u;
};
scrubbed = scrubbed.replace(/https?:\/\/[^"\\\s]+/g, (u) => cleanUrl(u));
sample.ops = JSON.parse(scrubbed);

// ---- markup: through the sanitiser as it is now, in a browser (it works on a DOM)
(async () => {
  const browser = await chromium.launch(process.env.XMC_BROWSER ? { executablePath: process.env.XMC_BROWSER } : { channel: 'chromium' });
  const page = await browser.newPage();
  await page.setContent('<!doctype html><body></body>');
  await page.addScriptTag({ content: fs.readFileSync(path.join(__dirname, '..', 'src', 'sample.js'), 'utf8') });
  for (const [k, html] of Object.entries(sample.controls || {})) {
    sample.controls[k] = await page.evaluate((h) => { const d = document.createElement('div'); d.innerHTML = h; return XMCSample.sanitizeMarkup(d.firstElementChild || d).replace(/^<div>|<\/div>$/g, ''); }, html);
  }
  await browser.close();
  // the probe and features carry times and counts only; the user agent is the browser's, not the person's
  fs.writeFileSync(outFile, JSON.stringify(sample));
  console.log('wrote ' + outFile + ' (' + Math.round(fs.statSync(outFile).size / 1024) + ' kB); ' + mapping.size + ' numbers replaced');
})().catch((e) => { console.error(e); process.exit(1); });
