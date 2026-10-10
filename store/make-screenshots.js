'use strict';
// Makes the screenshots for the Firefox Add-ons page from the stand-in x.com in test/e2e/mock: invented accounts and posts, generated
// pictures, X's menu redrawn plainly and without its logo. Nothing here comes from X, so nobody's real post or name is shown.
//   XMC_BROWSER=/path/to/chrome node store/make-screenshots.js        ->  store/screenshots/01-columns.png, 02-post-panel.png ...
// (1280x800 each; needs ImageMagick's `convert`.) Take the real thing on x.com too if you want a shot with your own feed in it.
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright-core');
const { start } = require('../test/e2e/mock/server.js');

const OUT = process.env.XMC_OUT || path.join(__dirname, 'screenshots'); // (XMC_OUT: somewhere else, with XMC_THEME=catppuccin-mocha for the same shots in a colour theme)

// ---------- the people and posts (all invented) ----------
const CAST = [
  { name: 'Marlow Finch', handle: 'marlowfinch', verified: true },
  { name: 'Ines Okafor', handle: 'inesokafor', verified: false },
  { name: 'Harbour Bakery', handle: 'harbourbakery', verified: true },
  { name: 'Tomasz Wren', handle: 'tomaswren', verified: false },
  { name: 'Ada Lindqvist', handle: 'adalind', verified: false },
  { name: 'Kiran Bose', handle: 'kiranbose', verified: true },
  { name: 'Pip & Moss Nursery', handle: 'pipandmoss', verified: false },
  { name: 'Oriel Vance', handle: 'orielvance', verified: false },
  { name: 'Dev Halloran', handle: 'devhalloran', verified: false },
  { name: 'Saltmarsh Press', handle: 'saltmarshpress', verified: true },
];
const CAPTIONS = [
  'Morning swim, the quiet kind. The only other person in the water was a heron, and he was judging me.',
  'Ferry wharf at six. Coffee, wet rope and a man whistling something I almost recognised.',
  'Bluebell wood, one week early. Nobody told the bluebells about the forecast.',
  'The old lighthouse from the south path. Forty steps, a flask, and a view that makes you whisper.',
  'Night market lanterns. I bought nothing and photographed everything.',
  'A road with no other cars and a sky that has not finished its sentence.',
  'First light on the ridge, 5:40am. The kettle was still boiling when the sky did this.',
  'Low tide at the point. Forty minutes of nothing but wind and gulls.',
  'Last ferry of the night. The harbour does its best work after dark.',
  'Rainforest after a downpour. Everything smells of wet bark and ferns.',
  'Salt flats, mid-afternoon. The horizon doesn’t bother to start.',
  'Fog came in over the valley and took the whole town with it.',
  'Dunes at golden hour. I lost the light and found my sandwich.',
  'The city from the rooftop garden. The tomatoes have opinions about the view.',
];
const TEXTS = [
  'The trick to a good stew is to start it the day before. The trick to a good week is the same.',
  'Learned today that my grandmother’s “pinch of salt” was precisely 1.4 grams. She would have been unbearable about it.',
  'A reminder to the draft in my drawer: you are allowed to be bad for a while.',
  'Found a pressed violet in a second-hand atlas, somewhere around the Baltic. Whoever left it there had good taste in pages.',
  'The neighbour’s dog has learned to open the gate. The neighbour has learned to say “sorry” very quickly.',
  'A half-finished project in the drawer is still a project. Go and look at it today.',
  'Spent the morning replacing every “utilise” in my draft with “use”. The book is 4,000 words shorter and much better.',
  'Small joy: the library finally sent the novel I reserved in March. Someone’s bus ticket is still in it as a bookmark.',
  'Three rules for good sourdough: patience, a warm kitchen, and not opening the oven door.',
  'Overheard on the train: “It’s not a bug, it’s a surprise feature.” Said by a very tired man holding a cake.',
  'The best code review comment I ever got was just “why?”. It took me a week to answer.',
  'Day 9 of learning the cello. The neighbours have started waving at me with great warmth and some effort.',
  'New batch of seedlings is up. Basil first, as always. It has no patience and neither do I.',
  'If a recipe says “season to taste” and you have never tasted it before, you are doing research, not cooking.',
];
const NOTES = ['A small note on editing. The first draft is for you; the second is for the reader; the third is for the reader who has had a bad day and still has to get to the end. '
  + 'Every sentence has to earn its place for that last person. Cut the throat-clearing, keep the one image that made you look up from the page, and read the whole thing aloud once. '
  + 'Where you stumble, they will too. It is slow work and it is the whole job.',
  'Notes from a week of mornings at the pool. Lane three is for people who say they are slow and are not. Lane one is for people who say they are not slow and are. '
  + 'I have joined lane two, where nobody says anything and everybody counts. The water is the temperature of a decision you are about to regret, and then, around the tenth length, it is not.',
  'On keeping a garden journal: write down the date, the weather, and one thing that surprised you. After a year you will know when the frost really comes, which beans sulk, and that the thing you were certain you would remember is gone. '
  + 'The journal is not for the garden. It is for the person who will forget that they were once patient.'];
const REPLIES = [
  'This is the best thing I have seen all week. The colours on the left are unreal.',
  'Where was this? Asking for a friend who has been planning a trip since March.',
  'I came for the photo and stayed for the caption.',
  'Saved. Printing this one for the hallway.',
  'The light in the second one is ridiculous. What time did you get up?',
];
const AUTHOR = ['Cheers! It was a ten minute walk from the car park, and worth the early start.', 'Ha, thanks. I nearly slept through the alarm.', 'The thermos did most of the work.'];

// ---------- generated pictures ----------
const rng = (seed) => { let a = (seed * 2654435761) >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const PALETTES = [
  { sky: ['#1b1740', '#7a3b8f', '#f2a07b', '#ffd9a0'], sun: '#fff1c9', land: ['#5b3a7a', '#3a2a5a', '#1d1636'] },
  { sky: ['#0b1d3a', '#1f5a86', '#5fb3b3', '#cfeee0'], sun: '#f6ffe6', land: ['#2d6a74', '#1e4658', '#0e2433'] },
  { sky: ['#40142a', '#c2445a', '#f08a4b', '#ffd27a'], sun: '#fff0b8', land: ['#8a3a4a', '#5a2336', '#2b1220'] },
  { sky: ['#12302b', '#2f7a63', '#8cc7a1', '#e7f3d0'], sun: '#fbffe0', land: ['#3b7a63', '#235443', '#10302a'] },
  { sky: ['#201a4d', '#4b4fa6', '#9a8cd6', '#f1c6d8'], sun: '#fff4f0', land: ['#4a4a8a', '#2f2f66', '#171640'] },
  { sky: ['#3d1f0f', '#b8602b', '#f1a14f', '#ffe2a8'], sun: '#fff6d6', land: ['#a4592a', '#74381c', '#3a1b0d'] },
];
const mix = (a, b, t) => { const p = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)); const x = p(a), y = p(b); return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join(''); };
function hill(r, w, h, base, amp, rough) { // a ridge line as a closed path
  const n = 28, ph = r() * 6, f = 1.2 + r() * 2.2, pts = [];
  for (let i = 0; i <= n; i++) { const x = (i / n) * w; pts.push([x, h * base - amp * h * (Math.sin(i / n * f * Math.PI + ph) * 0.6 + Math.sin(i / n * f * 3.1 * Math.PI + ph * 2) * 0.25 + (r() - 0.5) * rough)]); }
  return 'M0,' + h + ' L' + pts.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' L') + ' L' + w + ',' + h + ' Z';
}
function scene(seed, w, h) {
  const r = rng(seed + 11), pal = PALETTES[(seed * 7 + 3) % PALETTES.length], kind = ['ridge', 'sea', 'city', 'pines', 'dunes'][seed % 5];
  const sx = w * (0.22 + r() * 0.56), sy = h * (0.34 + r() * 0.14), horizon = kind === 'sea' ? h * 0.64 : h * 0.7;
  let body = '';
  if (kind === 'ridge') {
    for (let i = 0; i < 4; i++) body += `<path d="${hill(r, w, h, 0.5 + i * 0.12, 0.16 - i * 0.025, 0.5)}" fill="${mix(pal.land[0], pal.land[2], i / 3)}"/>` + (i < 3 ? `<rect x="0" y="${h * (0.55 + i * 0.12)}" width="${w}" height="${h * 0.16}" fill="url(#mist)" opacity="${0.5 - i * 0.12}"/>` : '');
  } else if (kind === 'sea') {
    body += `<rect x="0" y="${horizon}" width="${w}" height="${h - horizon}" fill="url(#water)"/>`;
    for (let i = 0; i < 14; i++) { const y = horizon + 6 + i * ((h - horizon) / 15), len = (w * 0.22) * (1 - i / 18) * (0.6 + r() * 0.8); body += `<rect x="${sx - len / 2 + (r() - 0.5) * 30}" y="${y}" width="${len}" height="${2 + i * 0.5}" rx="2" fill="${pal.sun}" opacity="${0.55 - i * 0.03}"/>`; }
    body += `<path d="${hill(r, w, h, 0.64, 0.05, 0.3)}" fill="${pal.land[2]}" opacity="0.85"/><rect x="0" y="${horizon + 4}" width="${w}" height="${h - horizon}" fill="url(#water)" opacity="0.5"/>`;
  } else if (kind === 'city') {
    body += `<rect x="0" y="${horizon}" width="${w}" height="${h - horizon}" fill="${pal.land[2]}"/>`;
    let x = -10;
    while (x < w) { const bw = 26 + r() * 60, bh = h * (0.12 + r() * 0.34), top = horizon - bh; body += `<rect x="${x}" y="${top}" width="${bw}" height="${bh + 4}" fill="${mix(pal.land[1], pal.land[2], r())}"/>`; for (let wy = top + 8; wy < horizon - 6; wy += 11) for (let wx = x + 5; wx < x + bw - 6; wx += 9) if (r() > 0.62) body += `<rect x="${wx}" y="${wy}" width="4" height="6" fill="#ffd978" opacity="${0.5 + r() * 0.5}"/>`; x += bw + 2 + r() * 6; }
  } else if (kind === 'pines') {
    body += `<rect x="0" y="0" width="${w}" height="${h}" fill="url(#mist)" opacity="0.18"/>`;
    for (let row = 0; row < 3; row++) { const y0 = h * (0.62 + row * 0.1), size = 0.7 + row * 0.35; let x = -20; while (x < w + 20) { const th = (60 + r() * 70) * size, tw = th * 0.42; body += `<path d="M${x},${y0} l${tw / 2},${-th} l${tw / 2},${th} Z" fill="${mix(pal.land[0], pal.land[2], row / 2)}"/>`; x += tw * (0.55 + r() * 0.4); } body += `<rect x="0" y="${y0 - 6}" width="${w}" height="${h}" fill="${mix(pal.land[0], pal.land[2], row / 2)}"/>`; }
  } else {
    for (let i = 0; i < 4; i++) body += `<path d="${hill(r, w, h, 0.58 + i * 0.1, 0.07 + i * 0.01, 0.1)}" fill="${mix(pal.land[0], pal.land[2], i / 3)}"/>`;
  }
  let stars = '';
  for (let i = 0; i < 40; i++) stars += `<circle cx="${(r() * w).toFixed(0)}" cy="${(r() * h * 0.45).toFixed(0)}" r="${(0.5 + r() * 1.2).toFixed(1)}" fill="#fff" opacity="${(0.25 + r() * 0.5).toFixed(2)}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs>`
    + `<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">${pal.sky.map((c, i) => `<stop offset="${(i / 3).toFixed(2)}" stop-color="${c}"/>`).join('')}</linearGradient>`
    + `<radialGradient id="glow"><stop offset="0" stop-color="${pal.sun}" stop-opacity="0.95"/><stop offset="0.25" stop-color="${pal.sun}" stop-opacity="0.35"/><stop offset="1" stop-color="${pal.sun}" stop-opacity="0"/></radialGradient>`
    + `<linearGradient id="mist" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${pal.sky[2]}" stop-opacity="0"/><stop offset="1" stop-color="${pal.sky[3]}" stop-opacity="0.7"/></linearGradient>`
    + `<linearGradient id="water" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${mix(pal.sky[2], pal.land[0], 0.5)}"/><stop offset="1" stop-color="${pal.land[2]}"/></linearGradient></defs>`
    + `<rect width="${w}" height="${h}" fill="url(#sky)"/>${stars}<circle cx="${sx}" cy="${sy}" r="${h * 0.34}" fill="url(#glow)"/><circle cx="${sx}" cy="${sy}" r="${h * 0.06}" fill="${pal.sun}"/>${body}</svg>`;
}
function avatar(handle) {
  const seed = [...handle].reduce((a, c) => a + c.charCodeAt(0), 0), a = PALETTES[seed % PALETTES.length], c = CAST.find((x) => x.handle === handle);
  const letter = ((c && c.name) || handle)[0].toUpperCase();
  return `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a.sky[1]}"/><stop offset="1" stop-color="${a.sky[2]}"/></linearGradient></defs><rect width="96" height="96" fill="url(#g)"/><text x="48" y="64" text-anchor="middle" font-family="Liberation Sans, Arial, sans-serif" font-size="46" font-weight="700" fill="#fff" fill-opacity="0.92">${letter}</text></svg>`;
}

// ---------- the mock's answers, rewritten ----------
const hash = (n) => { let a = (Number(n) * 2246822519) >>> 0; a ^= a >>> 13; a = Math.imul(a, 3266489917) >>> 0; return (a ^ (a >>> 16)) >>> 0; };
const RATIOS = [[1200, 800], [1000, 1250], [1200, 1200], [1600, 900], [1200, 900]];
function twitterDate(msAgo) { const d = new Date(Date.now() - msAgo), D = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], p = (n) => String(n).padStart(2, '0'); return `${D[d.getUTCDay()]} ${M[d.getUTCMonth()]} ${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} +0000 ${d.getUTCFullYear()}`; }
const assigned = new Map(), counters = { cap: 0, txt: 0, note: 0 };
function pick(kind, id, list) { const k = kind + id; if (!assigned.has(k)) assigned.set(k, list[counters[kind]++ % list.length]); return assigned.get(k); }
function remix(origin, json) {
  const fixUser = (u) => {
    const c = CAST[Number(String(u.rest_id).replace(/\D/g, '')) % CAST.length];
    u.core.name = c.name; u.core.screen_name = c.handle; u.is_blue_verified = c.verified; u.avatar = { image_url: `${origin}/art/avatar/${c.handle}.svg` };
  };
  const fixTweet = (t) => {
    const id = Number(t.rest_id), h = hash(id), L = t.legacy, media = (L.extended_entities && L.extended_entities.media) || [];
    media.forEach((m, k) => {
      const [w, hh] = m.type === 'photo' ? RATIOS[hash(id + k) % RATIOS.length] : m.type === 'video' ? [1280, 720] : [800, 800];
      m.media_url_https = `${origin}/art/scene/${(id + k * 3) % 997}/${w}/${hh}.svg`; m.original_info = { width: w, height: hh };
    });
    let text;
    const reply = /Reply number (\d)|Page (\d) reply (\d)/.exec(L.full_text), answer = /The author answers reply (\d)/.exec(L.full_text);
    if (answer) text = AUTHOR[(Number(answer[1]) - 1) % AUTHOR.length];
    else if (reply) text = REPLIES[(Number(reply[1] || reply[2] + reply[3]) + 1) % REPLIES.length];
    else if (media.some((m) => m.type === 'photo')) text = pick('cap', id, CAPTIONS);
    else if (t.note_tweet) { text = pick('note', id, NOTES); t.note_tweet.note_tweet_results.result.text = text; }
    else text = pick('txt', id, TEXTS);
    L.full_text = text; L.display_text_range = [0, text.length]; L.lang = 'en'; L.possibly_sensitive = false; L.entities = {};
    const likes = 40 + (h * 37) % 4800;
    L.favorite_count = likes; L.retweet_count = (h * 13) % 600; L.reply_count = (h * 7) % 90; L.bookmark_count = (h * 11) % 300; if (L.quote_count) L.quote_count = 3 + h % 20;
    if (t.views) t.views.count = String(likes * 23 + h % 900);
    L.created_at = twitterDate((1 + h % 20) * 3600e3 + (h % 50) * 60e3);
  };
  const walk = (o) => {
    if (Array.isArray(o)) { o.forEach(walk); return; }
    if (!o || typeof o !== 'object') return;
    if (o.__typename === 'User' && o.core) fixUser(o);
    if (o.__typename === 'Tweet' && o.legacy) fixTweet(o);
    for (const k of Object.keys(o)) walk(o[k]);
  };
  walk(json);
  return json;
}

// ---------- X's own menu and sidebar, drawn plainly (the stand-in's are bare links) ----------
function dressTheMock() {
  const ICON = {
    home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h5v-6h4v6h5V10"/>', search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
    bell: '<path d="M6 8a6 6 0 0112 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 003.4 0"/>', mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
    mark: '<path d="M6 3h12v18l-6-4-6 4z"/>', user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
  };
  const avatarUrl = (hdl) => '/art/avatar/' + hdl + '.svg';
  const css = document.createElement('style');
  css.textContent = `body{font-family:'Liberation Sans',Arial,sans-serif !important}
    header[role=banner] nav a:not([data-testid=SideNav_NewTweet_Button]), #xmc-navfreeze nav a:not([data-xmc-tid=SideNav_NewTweet_Button]){color:#e7e9ea !important;text-decoration:none !important;font-size:20px;line-height:24px}
    header[role=banner] nav a[href="/home"] span, #xmc-navfreeze nav a[href="/home"] span{font-weight:700}
    #xmc-navfreeze nav a[data-xmc-tid=SideNav_NewTweet_Button]{text-decoration:none}
    header[role=banner] nav br, #xmc-navfreeze nav br{display:none}
    [data-testid=sidebarColumn] a{color:inherit;text-decoration:none}
    [data-testid=SideNav_AccountSwitcher_Button]{display:flex;align-items:center;gap:12px;padding:8px 12px;border-radius:9999px;color:#e7e9ea;font-size:15px;line-height:20px}`;
  document.head.append(css);
  const hd = document.querySelector('header[role=banner]');
  if (hd) {
    const h1 = hd.querySelector('h1'); if (h1) h1.remove();
    const labels = { '/home': ['Home', 'home'], '/explore': ['Explore', 'search'], '/notifications': ['Notifications', 'bell'], '/i/grok': ['Messages', 'mail'], '/i/bookmarks': ['Bookmarks', 'mark'] };
    for (const a of [...hd.querySelectorAll('nav a')]) {
      const href = a.getAttribute('href'), v = labels[href] || (/^\/user\d+$/.test(href) ? ['Profile', 'user'] : null);
      if (/creators/.test(href)) { a.remove(); continue; }
      if (!v) continue;
      const svg = a.querySelector('svg'), sp = a.querySelector('span');
      if (svg) { svg.innerHTML = v[1] === 'x' ? '' : ICON[v[1]]; svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round'); }
      if (sp) sp.textContent = v[0];
    }
    const acct = hd.querySelector('[data-testid=SideNav_AccountSwitcher_Button]');
    if (acct) acct.innerHTML = `<div><img src="${avatarUrl('inesokafor')}" width="40" height="40" style="border-radius:50%;display:block"></div><div><div style="font-weight:700">Ines Okafor</div><div style="color:#71767b">@inesokafor</div></div>`;
  }
  const side = document.querySelector('[data-testid=sidebarColumn]');
  if (side) {
    const trend = (a, b, c) => `<a href="/explore" style="display:block;padding:10px 16px"><div style="color:#71767b;font-size:13px">${a}</div><div style="font-weight:700;font-size:15px;color:#e7e9ea">${b}</div><div style="color:#71767b;font-size:13px">${c}</div></a>`;
    const who = (n, hdl) => `<a href="/explore" style="display:flex;align-items:center;gap:12px;padding:10px 16px"><img src="${avatarUrl(hdl)}" width="40" height="40" style="border-radius:50%"><div style="flex:1;line-height:18px"><div style="font-weight:700;font-size:15px;color:#e7e9ea">${n}</div><div style="color:#71767b;font-size:14px">@${hdl}</div></div><span style="background:#eff3f4;color:#0f1419;font-weight:700;font-size:14px;border-radius:9999px;padding:6px 16px">Follow</span></a>`;
    side.innerHTML = `<div style="width:100%"><div style="background:#202327;border-radius:9999px;padding:12px 18px;color:#71767b;font-size:15px;margin:4px 0 14px;display:flex;gap:12px;align-items:center"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg><input data-testid="SearchBox_Search_Input" placeholder="Search" style="background:none;border:0;color:#e7e9ea;font-size:15px;outline:0;width:100%"></div>`
      + `<div style="border:1px solid #2f3336;border-radius:16px;margin-bottom:14px"><div style="font-weight:800;font-size:20px;padding:12px 16px 4px;color:#e7e9ea">Trends for you</div>${trend('Photography · Trending', 'Golden hour', '12.4K posts')}${trend('Books · Trending', 'Second drafts', '3,208 posts')}${trend('Gardening', 'Seedlings', '8,115 posts')}</div>`
      + `<div style="border:1px solid #2f3336;border-radius:16px"><div style="font-weight:800;font-size:20px;padding:12px 16px 4px;color:#e7e9ea">Who to follow</div>${who('Marlow Finch', 'marlowfinch')}${who('Saltmarsh Press', 'saltmarshpress')}${who('Kiran Bose', 'kiranbose')}</div></div>`;
  }
  const drawer = document.getElementById('drawer'); if (drawer) drawer.remove();
}

// ---------- the shots ----------
async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.XMC_BROWSER, headless: true });
  const server = await start({ pages: 12 });
  const SETTINGS = { v: 10, hintSeen: true, keysHintSeen: true, branding: 'x', cardStyle: 'raised', theme: process.env.XMC_THEME || 'x' };

  async function context(width, height, settings, scheme) {
    const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, colorScheme: scheme || 'light' });
    await ctx.addInitScript((s) => { try { localStorage.setItem('xmc.settings', JSON.stringify(s)); } catch { /* ignore */ } }, settings === null ? {} : Object.assign({}, SETTINGS, settings));
    await ctx.addInitScript(`document.addEventListener('DOMContentLoaded', ${dressTheMock.toString().replace(/^function dressTheMock/, 'function')}.bind(null))`);
    await ctx.route(/\/i\/api\/graphql\//, async (route) => { const res = await route.fetch(); route.fulfill({ response: res, json: remix(server.origin, await res.json()) }); });
    await ctx.route(/\/art\/scene\/(\d+)\/(\d+)\/(\d+)\.svg/, (route) => { const m = /scene\/(\d+)\/(\d+)\/(\d+)/.exec(route.request().url()); route.fulfill({ contentType: 'image/svg+xml', body: scene(Number(m[1]), Number(m[2]), Number(m[3])) }); });
    await ctx.route(/\/art\/avatar\/(\w+)\.svg/, (route) => route.fulfill({ contentType: 'image/svg+xml', body: avatar(/avatar\/(\w+)\.svg/.exec(route.request().url())[1]) }));
    return ctx;
  }
  async function ready(page, n = 10) {
    await page.waitForFunction((k) => window.__xmc && window.__xmc.view.cards.length >= k, n, { timeout: 20000 });
    await page.waitForFunction(() => { const r = document.getElementById('xmc-root'); const c = r && r.querySelector('.xmc-card'); return r && !r.hidden && c && c.getBoundingClientRect().height > 20 && getComputedStyle(r.querySelector('.xmc-cols')).opacity === '1' && !/\bxmc-(veil|boot|frozen)\b/.test(document.documentElement.className); }, null, { timeout: 20000 }); // (the columns are on screen, not just built: the first shot of a cold browser was black)
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(1200);
  }
  async function save(page, name, { scale = true } = {}) {
    const raw = path.join(OUT, name + '.raw.png');
    await page.screenshot({ path: raw });
    execFileSync('convert', [raw, ...(scale ? ['-resize', '1280x800!'] : []), path.join(OUT, name + '.png')]);
    fs.unlinkSync(raw);
    console.log(name);
  }

  // 1. the feed in columns
  let ctx = await context(1920, 1200, { cols: 4 });
  let page = await ctx.newPage();
  await page.goto(server.origin + '/home/');
  await ready(page);
  await save(page, '01-columns');

  // 2. a post open in the panel: the picture, then the comments
  await page.evaluate(() => { const c = [...document.querySelectorAll('.xmc-card')].find((x) => x.querySelector('[data-lb]') && /^(1|2)$/.test(String(Number((x.dataset.id || '0')) % 8))) || document.querySelector('.xmc-card:has([data-lb])'); c.querySelector('.xmc-text, .xmc-head').click(); });
  await page.waitForSelector('.xmc-view', { timeout: 8000 });
  await page.waitForFunction(() => /The thermos|nearly slept|ten minute/.test(document.querySelector('.xmc-view').innerText), null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await save(page, '02-post-panel');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.xmc-view'), null, { timeout: 5000 });

  // 3. a photo in the viewer
  await page.evaluate(() => { const p = [...document.querySelectorAll('.xmc-card [data-lb]')][1]; p.focus(); });
  await page.keyboard.press('Enter');
  await page.waitForSelector('#xmc-lightbox', { timeout: 5000 });
  await page.waitForTimeout(800);
  await save(page, '03-photo-viewer');
  await page.keyboard.press('Escape');

  // 4. the filters
  await page.evaluate(() => document.querySelector('.xmc-showbtn').click());
  await page.waitForSelector('.xmc-menu', { timeout: 3000 });
  await page.waitForTimeout(400);
  await save(page, '04-filters');
  await ctx.close();

  // 5. folded: the menu as icons, the right panel slid away, five columns
  ctx = await context(1920, 1200, { cols: 5, leftPanel: 'rail', rightPanel: 'hidden' });
  page = await ctx.newPage();
  await page.goto(server.origin + '/home/');
  await ready(page);
  await save(page, '05-more-room');
  await ctx.close();

  // 6. the settings page
  ctx = await context(1280, 800, null, 'dark');
  page = await ctx.newPage();
  await page.goto(server.origin + '/ext/options.html');
  await page.waitForSelector('#opt-cols', { timeout: 8000 }).catch(() => {});
  await page.evaluate(() => { document.getElementById('sec-algorithm').scrollIntoView(); window.scrollBy(0, -104); });
  await page.waitForTimeout(800);
  await save(page, '06-settings', { scale: false });
  await ctx.close();

  // 7. the settings panel, over the columns (the gear in the bar), with the presets open and the other sections folded below
  const S = require('../src/settings.js');
  ctx = await context(1920, 1200, Object.assign({ cols: 4 }, S.PRESETS.find((p) => p.id === 'plain').set));
  page = await ctx.newPage();
  await page.goto(server.origin + '/home/');
  await ready(page);
  await page.locator('.xmc-gear').click();
  await page.waitForSelector('#xmc-settings iframe', { timeout: 8000 });
  const frame = page.frames().find((f) => /popup\.html/.test(f.url()));
  await frame.waitForSelector('#sections h2 button.fold', { timeout: 8000 });
  await frame.locator('#sections h2 button.fold', { hasText: 'Presets' }).click();
  await page.waitForTimeout(900);
  await save(page, '07-settings-panel');
  await ctx.close();

  // ---- the features added since: Reels, replying with pictures and emoji, the keyboard, a wall of pictures, the starting points ----
  const png = async (seed, w, h) => { const p = await browser.newPage({ viewport: { width: w, height: h } }); await p.setContent('<body style="margin:0">' + scene(seed, w, h) + '</body>'); const buf = await p.screenshot(); await p.close(); return buf; };
  const openPhotoPost = async (pg) => {
    await pg.evaluate(() => { const c = [...document.querySelectorAll('.xmc-card')].find((x) => x.querySelector('[data-lb]') && /^(1|2)$/.test(String(Number((x.dataset.id || '0')) % 8))) || document.querySelector('.xmc-card:has([data-lb])'); c.querySelector('.xmc-text, .xmc-head').click(); });
    await pg.waitForSelector('.xmc-view', { timeout: 8000 });
    await pg.waitForFunction(() => /The thermos|nearly slept|ten minute/.test(document.querySelector('.xmc-view').innerText), null, { timeout: 15000 }).catch(() => {});
    await pg.waitForTimeout(1500);
  };

  // 8. Reels: one post at a time over the whole page, one rail on the post
  ctx = await context(1920, 1200, { cols: 4, reels: true, filter: 'media', panelVideo: 'sound', videoEnd: 'loop', skipSeen: true, keysAdvance: true });
  page = await ctx.newPage();
  await page.goto(server.origin + '/home/');
  await ready(page);
  await page.waitForSelector('#xmc-root.xmc-reels .xmc-vmediapane', { timeout: 20000 });
  for (let k = 0; k < 12; k++) { // on to a picture with a few comments
    const ok = await page.evaluate(() => { const t = window.__xmc.postView && window.__xmc.postView.t; return !!t && t.media.length === 1 && t.media[0].type === 'photo' && t.counts.reply > 5 && t.media[0].h <= t.media[0].w * 1.1; });
    if (ok) break;
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(900);
  }
  await page.waitForFunction(() => /The thermos|nearly slept|ten minute|best thing|Saved|caption/.test(document.querySelector('.xmc-view').innerText), null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await save(page, '08-reels');
  await ctx.close();

  // 9. replying with pictures and emoji
  ctx = await context(1920, 1200, { cols: 4 });
  page = await ctx.newPage();
  await page.goto(server.origin + '/home/');
  await ready(page);
  await openPhotoPost(page);
  await page.locator('.xmc-view textarea.xmc-cbox').fill('That light is unreal. Where was this taken?');
  const chooser = page.waitForEvent('filechooser');
  await page.locator('.xmc-view .xmc-cimg').click();
  await (await chooser).setFiles([{ name: 'harbour.png', mimeType: 'image/png', buffer: await png(21, 600, 420) }, { name: 'ridge.png', mimeType: 'image/png', buffer: await png(34, 600, 420) }]);
  await page.waitForSelector('.xmc-view .xmc-cthumb', { timeout: 5000 });
  await page.locator('.xmc-view .xmc-cemo').click();
  await page.waitForSelector('.xmc-view .xmc-emoji .xmc-emo', { timeout: 3000 });
  await page.waitForTimeout(700);
  await save(page, '09-reply-tools');

  // 10. the keys, on the card behind the keyboard button
  await page.keyboard.press('Escape'); // (closes the emoji picker; a second would close the post)
  await page.evaluate(() => { const b = document.querySelector('.xmc-view .xmc-cbox'); if (b) b.blur(); });
  await page.waitForTimeout(300);
  await page.locator('.xmc-vkeys').click();
  await page.waitForSelector('.xmc-keylegend', { timeout: 3000 });
  await page.waitForTimeout(500);
  await save(page, '10-keys');
  await ctx.close();

  // 11. a wall of pictures: Media only, six columns, the menu as icons and the side panel away
  ctx = await context(1920, 1200, { cols: 6, filter: 'media', leftPanel: 'rail', rightPanel: 'hidden', tallPhotos: 'cap', hideViews: true });
  page = await ctx.newPage();
  await page.goto(server.origin + '/home/');
  await ready(page, 14);
  await page.evaluate(() => { window.scrollTo(0, 0); const c = document.querySelector('.xmc-cols'); if (c) c.scrollTop = 0; });
  await page.waitForTimeout(900);
  await save(page, '11-media-wall');
  await ctx.close();

  // 12. the starting points, on the page the install opens
  ctx = await context(1280, 800, Object.assign({}, S.PRESETS.find((p) => p.id === 'calm').set), 'dark');
  page = await ctx.newPage();
  await page.goto(server.origin + '/ext/options.html?welcome=1');
  await page.waitForSelector('#welcome .wchoice', { timeout: 8000 });
  await page.waitForTimeout(800);
  await save(page, '12-start', { scale: false });
  await ctx.close();

  await browser.close(); await server.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
