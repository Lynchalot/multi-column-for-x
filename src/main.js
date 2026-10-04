// Multi-Column for X: content script.
//
// X's own page keeps running, hidden. We read the timeline data it downloads (src/hook.js -> parse.js),
// draw our own cards from that data, and use X's real (hidden) buttons for the actions that must go
// through X: like, repost, bookmark, reply and navigation.
(() => {
  'use strict';
  if (window.__xmcLoaded) return;
  window.__xmcLoaded = true;

  const GAP = 12;
  const TICK_MS = 100;
  const RESERVED = new Set(['home', 'explore', 'notifications', 'messages', 'settings', 'compose',
    'i', 'search', 'jobs', 'premium', 'tos', 'privacy', 'login', 'logout', 'signup', 'communities']);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------- settings ----------
  const settings = XMCSettings.normalize();
  const ext = typeof browser !== 'undefined' && browser.runtime && browser.runtime.id ? browser : null;
  const storage = ext && ext.storage && ext.storage.local;
  let ready = false;
  let savedDownloads = new Map(); // tweet id -> {id, handle, n, at}   (what has been downloaded)

  function save() {
    const { set, clear } = XMCSettings.diff(settings); // only what differs from the defaults
    if (storage) { storage.set(set).catch(() => {}); if (clear.length) storage.remove(clear).catch(() => {}); return; }
    try { localStorage.setItem('xmc.settings', JSON.stringify(set)); } catch { /* private mode */ }
  }
  function loadHistory(list) {
    savedDownloads = new Map((Array.isArray(list) ? list : []).map((e) => [e.id, e]));
  }
  async function loadAll() {
    try {
      const v = storage ? await storage.get(null) : JSON.parse(localStorage.getItem('xmc.settings') || '{}');
      Object.assign(settings, XMCSettings.normalize(v));
      loadHistory(v.dlHistory);
    } catch { /* defaults */ }
  }
  function onExternalChange(next, hist) {
    Object.assign(settings, XMCSettings.normalize(Object.assign({}, settings, next)));
    if (hist !== undefined) loadHistory(hist);
    settingsChanged();
  }
  if (storage && ext.storage.onChanged) {
    ext.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      const next = {};
      for (const k in changes) if (k !== 'dlHistory') next[k] = changes[k].newValue;
      onExternalChange(next, changes.dlHistory ? changes.dlHistory.newValue : undefined);
    });
  } else {
    window.addEventListener('storage', (e) => {
      if (e.key === 'xmc.settings') { try { onExternalChange(JSON.parse(e.newValue || '{}')); } catch { /* ignore */ } }
    });
  }

  // names that change with the Twitter/X branding setting
  const STR = {
    x: { repost: 'Repost', reposted: 'reposted', reposts: 'Reposts', posts: 'Posts', quote: 'Quote', undo: 'Undo repost', quotes: 'Quotes' },
    twitter: { repost: 'Retweet', reposted: 'retweeted', reposts: 'Retweets', posts: 'Tweets', quote: 'Quote Tweet', undo: 'Undo Retweet', quotes: 'Quote Tweets' },
  };
  const T = (k) => STR[settings.branding === 'twitter' ? 'twitter' : 'x'][k];

  // ---------- routes ----------
  // Explore's other tabs (Trending, News, Sports, Entertainment) are lists of trends and stories rather than posts, so
  // the columns have little to show there: X's page is left alone, with a pill to try columns anyway.
  const isExploreSub = (p) => /^\/explore\/tabs\/(?!for-you(\/|$))/.test(p);
  const canTry = () => isExploreSub(location.pathname.replace(/\/+$/, ''));
  function eligible() {
    const p = location.pathname.replace(/\/+$/, '') || '/';
    if (p === '/home' || p === '/search' || p === '/i/bookmarks' || p.startsWith('/i/lists/') || p === '/explore' || p === '/explore/tabs/for-you') return true;
    if (isExploreSub(p)) return state.trial === routeKey(); // Trending, News, Sports...: X's own page unless you press the Columns pill
    const seg = p.split('/').filter(Boolean);
    if (seg.length === 1) return !RESERVED.has(seg[0].toLowerCase());
    if (seg.length === 2 && !RESERVED.has(seg[0].toLowerCase())) {
      return ['with_replies', 'media', 'likes', 'highlights', 'articles'].includes(seg[1]);
    }
    return false;
  }
  // X shows the compose box (replies) as a modal over the page you came from.
  const isModalRoute = () => location.pathname.startsWith('/compose');
  const routeKey = () => location.pathname + location.search;
  const where = () => XMCLogic.routeKind(location.pathname);

  // ---------- feeds (what X downloaded) ----------
  // Rule: what you are looking at is never replaced behind your back. X sends fresh "first pages" now and
  // then (tab regains focus, periodic checks); those wait behind a "N new" button instead.
  const state = {
    feeds: new Map(),         // feedKey -> { key, items[], keys:Set, index:Map(id -> position), version, pending[], cursors:Set, topCursors:Set }
    latestByRoute: new Map(), // route -> feedKey of the most recent first page
    feedByTab: new Map(),     // route|tabIndex -> feedKey
    cur: { route: '', key: null }, // the feed currently on screen for this route; changes only when YOU change it
    awaiting: null,           // {until, cached}: you just switched tabs and we are waiting for the new feed
    refreshing: null,         // {until}: you pressed refresh and the next first page should replace the view
    sel: -1,                  // selected tab index on X's own tab bar
    route: '',
    routeSince: 0,
    failed: '',               // route on which we gave up and showed X's normal feed
    shown: false,
    proxyUntil: 0,            // while X's hidden page is being driven for an action, don't scroll it for loading
    lastJump: 0,
    waitingPage: false,
    waitSince: 0,             // when we started waiting for X's next page (not reset by our nudges)
    fail: null,               // {status, at, reset}: X refused our last request for more posts
    seenOps: {},
    details: new Map(),       // post id -> its conversation {replies, more}
    peek: null,               // {id, replies}: X's hidden page is on a post's page, fetching its comments
    posting: false,           // we are typing your comment into X's reply box (out of sight)
    homeInit: false, homeHold: false, lastKeep: 0, searchInit: '',
    sub: {},                  // route|tab -> the item picked from that tab's dropdown (Videos/Photos, Popular/Recent...), lower case
    byId: new Map(),          // post id -> post, for every post seen (so buttons on X's own pages know a post's media)
    menuTabs: new Set(),      // route|tab that turned out to have a dropdown
  };
  function remember(list) {
    for (const t of list) { if (t && t.id) { state.byId.delete(t.id); state.byId.set(t.id, t); } }
    while (state.byId.size > 4000) state.byId.delete(state.byId.keys().next().value);
  }

  function onResponse(url, body, reqBody) {
    const op = XMCParse.opOf(url);
    if (op) state.seenOps[op] = (state.seenOps[op] || 0) + 1;
    const isConversation = op === 'TweetDetail' || !!(body && body.data && body.data.threaded_conversation_with_injections_v2);
    if (isConversation) {
      const d = XMCParse.parseDetail(body, url, reqBody, state.peek ? state.peek.id : idOfHref(location.pathname));
      if (d) {
        state.details.set(d.focalId, d); if (state.peek && state.peek.id === d.focalId) state.peek.replies = d;
        remember([d.focal].concat(d.replies));
      }
      return;
    }
    const r = XMCParse.parseResponse(body, url, reqBody);
    if (!r) return;
    remember(r.items);
    // Which feed is this? A page asked for with a "next page" marker we handed out belongs to the feed that gave it
    // out, whatever X put in the request. A first page belongs to the feed of the dropdown item picked on the tab
    // (Videos / Photos, Popular / Recent): those share the same request name, so they'd otherwise be mixed up.
    const base = r.feedKey, sub = subFor(state.sel), want = sub ? base + '#' + sub : base;
    const cands = r.reqCursor ? [...state.feeds.values()].filter((x) => (x.key === base || x.key.startsWith(base + '#')) && x.cursors.has(r.reqCursor)) : [];
    const owner = cands.find((x) => x.key === want) || cands[0];
    r.feedKey = owner ? owner.key : want;
    const asked = Date.now() - state.lastJump < 20000; // we asked X for more a moment ago
    state.waitingPage = false; state.waitSince = 0;
    state.fail = null;
    let f = state.feeds.get(r.feedKey);
    if (!f) {
      f = { key: r.feedKey, items: [], keys: new Set(), index: new Map(), version: 0, exhausted: false, empty: 0, misses: 0, pending: [], cursors: new Set(), topCursors: new Set() };
      state.feeds.set(r.feedKey, f);
    }
    const rk = routeKey();
    const isRefreshOfTop = f.topCursors.has(r.reqCursor);
    const repeatedBottom = !!r.bottomCursor && f.cursors.has(r.bottomCursor); // X pointed at a page we already followed
    if (r.bottomCursor) f.cursors.add(r.bottomCursor);
    if (r.topCursor) f.topCursors.add(r.topCursor);

    const first = r.known ? r.first : false; // never assume "first page" when the request couldn't be read
    const kind = XMCLogic.classifyResponse({
      hasItems: f.items.length > 0, known: r.known, first: r.first, topRefresh: isRefreshOfTop, asked,
      refreshing: !!state.refreshing && state.cur.key === f.key,
    });
    const established = kind === 'establish' && r.items.length > 0; // the first data we have for this feed
    if (kind === 'establish') {
      addItems(f, r.items);
      if (established) { state.latestByRoute.set(rk, f.key); state.feedByTab.set(slotFor(state.sel), f.key); }
    } else if (kind === 'refresh') { // you asked for a refresh
      f.items = []; f.keys.clear(); f.index.clear(); f.pending = []; f.exhausted = false; f.empty = 0; f.version++;
      f.cursors = new Set(r.bottomCursor ? [r.bottomCursor] : []);
      addItems(f, r.items);
      state.refreshing = null;
    } else if (kind === 'pending') { // X refreshed on its own: keep what you're reading, offer the new posts
      const have = new Set(f.pending.map((t) => t.key));
      for (const t of r.items) if (!f.keys.has(t.key) && !have.has(t.key)) f.pending.push(t);
    } else { // 'append': "load more", added at the bottom
      const before = f.items.length;
      addItems(f, r.items);
      const p = XMCLogic.nextPaging(f, { added: f.items.length - before, bottomCursor: r.bottomCursor, repeated: repeatedBottom });
      f.empty = p.empty; f.exhausted = p.exhausted;
    }
    if ((first || established) && r.items.length) {
      state.latestByRoute.set(rk, state.latestByRoute.get(rk) || f.key);
      if (state.feedByTab.get(slotFor(state.sel)) === undefined) state.feedByTab.set(slotFor(state.sel), f.key);
      if (state.awaiting) { state.cur = { route: rk, key: f.key }; state.feedByTab.set(slotFor(state.sel), f.key); state.awaiting = null; }
    }
  }
  function addItems(f, items) {
    for (const t of items) {
      if (f.keys.has(t.key)) continue;
      f.keys.add(t.key);
      f.items.push(t);
      if (!f.index.has(t.id)) f.index.set(t.id, f.items.length - 1);
    }
  }
  function applyPending(f) {
    const m = XMCLogic.mergeNew(f.items, f.pending);
    f.pending = [];
    if (!m.added) return;
    f.items = m.items;
    f.keys = new Set(f.items.map((t) => t.key));
    f.index = new Map();
    f.items.forEach((t, i) => { if (!f.index.has(t.id)) f.index.set(t.id, i); });
    f.version++;
  }

  window.addEventListener('message', (e) => {
    const d = e.data;
    if (e.source !== window || !d) return;
    if (d.source === 'xmc') {
      try { onResponse(d.url, d.body, d.reqBody); } catch (err) { console.error('[xmc] could not read a timeline response', err); }
    } else if (d.source === 'xmc-fail') {
      const op = XMCParse.opOf(d.url) || '';
      if (/Timeline|Tweets|Likes|Bookmarks/.test(op)) state.fail = { status: d.status, at: Date.now(), reset: d.reset };
    } else if (d.source === 'xmc-key') {
      if (d.key === 'Escape') closeLightbox();
      else if (d.key === 'ArrowRight') stepLightbox(1);
      else if (d.key === 'ArrowLeft') stepLightbox(-1);
    }
  });
  window.postMessage({ source: 'xmc-ready' }, location.origin); // ask the page hook to replay what it saw before we loaded

  // The dropdown item chosen on tab i (X shows Videos/Photos on the tab itself; others we remember from what was picked)
  function subFor(i) {
    const own = state.sub[routeKey() + '|' + i];
    if (own) return own;
    const tab = realTabs()[i];
    const label = tab ? tab.textContent.trim().toLowerCase() : '';
    return label === 'videos' || label === 'photos' ? label : '';
  }
  const slotFor = (i) => { const sub = subFor(i); return routeKey() + '|' + i + (sub ? '#' + sub : ''); };

  function activeFeed() {
    const rk = routeKey();
    if (state.awaiting) { // you switched tabs: show the new feed as soon as we know which it is
      const mapped = state.feedByTab.get(slotFor(state.sel));
      if (mapped && state.feeds.get(mapped) && state.feeds.get(mapped).items.length && state.awaiting.cached) {
        state.cur = { route: rk, key: mapped }; state.awaiting = null; return state.feeds.get(mapped);
      }
      if (Date.now() < state.awaiting.until) return null;
      state.awaiting = null;
    }
    if (state.cur.route === rk && state.cur.key && state.feeds.has(state.cur.key)) return state.feeds.get(state.cur.key);
    const k = state.feedByTab.get(slotFor(state.sel)) || state.latestByRoute.get(rk);
    if (k && state.feeds.get(k) && state.feeds.get(k).items.length) { state.cur = { route: rk, key: k }; return state.feeds.get(k); }
    return null;
  }

  // ---------- tiny DOM helpers ----------
  const h = (tag, props, ...kids) => {
    const n = Object.assign(document.createElement(tag), props || {});
    n.append(...kids.filter((k) => k !== null && k !== undefined && k !== false));
    return n;
  };
  const SVGNS = 'http://www.w3.org/2000/svg';
  const ICONS = {
    reply: ['M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8z'],
    repost: ['M17 1l4 4-4 4', 'M3 11V9a4 4 0 0 1 4-4h14', 'M7 23l-4-4 4-4', 'M21 13v2a4 4 0 0 1-4 4H3'],
    like: ['M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21.2l7.8-7.7 1.1-1.1a5.5 5.5 0 0 0 0-7.8z'],
    bookmark: ['M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z'],
    download: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M7 10l5 5 5-5', 'M12 15V3'],
    done: ['M20 6L9 17l-5-5'],
    link: ['M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7', 'M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7'],
    more: ['M5 12h.01', 'M12 12h.01', 'M19 12h.01'],
    check: ['M5 12.5l4.5 4.5L19 7'],
    bird: [XMCSite.BIRD],
    refresh: ['M21 12a9 9 0 1 1-2.6-6.4', 'M21 4v5h-5'],
    eye: ['M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'],
    eyeoff: ['M17.9 17.9A10.1 10.1 0 0 1 12 20c-7 0-11-8-11-8a18.5 18.5 0 0 1 5.1-5.9', 'M9.9 4.2A9.1 9.1 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.2 3.2', 'M14.1 14.1a3 3 0 1 1-4.2-4.2', 'M1 1l22 22'],
    ban: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M5.6 5.6l12.8 12.8'],
    gear: ['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z'],
    close: ['M18 6L6 18', 'M6 6l12 12'],
    columns: ['M4 4h4.5v16H4z', 'M9.75 4h4.5v10.5h-4.5z', 'M15.5 4H20v13h-4.5z'],
    prev: ['M15 18l-6-6 6-6'],
    next: ['M9 18l6-6-6-6'],
  };
  function icon(name, cls) {
    const s = document.createElementNS(SVGNS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    if (cls) s.setAttribute('class', cls);
    for (const d of ICONS[name]) { const p = document.createElementNS(SVGNS, 'path'); p.setAttribute('d', d); s.append(p); }
    return s;
  }
  const spinner = () => h('span', { className: 'xmc-spin' });
  function relTime(ms) {
    const s = Math.max(0, (Date.now() - ms) / 1000);
    if (s < 60) return Math.floor(s) + 's';
    if (s < 3600) return Math.floor(s / 60) + 'm';
    if (s < 86400) return Math.floor(s / 3600) + 'h';
    const d = new Date(ms);
    const sameYear = d.getFullYear() === new Date().getFullYear();
    return d.toLocaleDateString(undefined, sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
  }
  function fmt(n) {
    if (!n) return '';
    if (n < 1000) return String(n);
    if (n < 1e6) return (n / 1000).toFixed(n < 1e4 ? 1 : 0).replace(/\.0$/, '') + 'K';
    return (n / 1e6).toFixed(n < 1e7 ? 1 : 0).replace(/\.0$/, '') + 'M';
  }

  // ---------- card rendering ----------
  const tweetOf = new WeakMap(); // card element -> tweet
  // GIFs (and videos, if you asked for autoplay) play while mostly on screen and pause when not. A video you started
  // yourself is paused as soon as it is half scrolled away (it is only watched while it plays).
  const playObserver = new IntersectionObserver((entries) => {
    for (const en of entries) {
      const v = en.target;
      if (document.fullscreenElement === v || document.pictureInPictureElement === v) continue;
      const act = XMCLogic.videoAction({ gif: !!v.dataset.gif, ratio: en.intersectionRatio, paused: v.paused });
      if (act === 'play') v.play().catch(() => {}); else if (act === 'pause') v.pause();
    }
  }, { threshold: [0, 0.25, 0.5, 0.75] });

  function renderSegs(segs) {
    const frag = document.createDocumentFragment();
    for (const s of segs) {
      if (s.t === 'text') frag.append(document.createTextNode(s.v));
      else if (s.t === 'url') frag.append(h('a', { href: s.href, textContent: s.label, target: '_blank', rel: 'noopener noreferrer' }));
      else if (s.t === 'mention') frag.append(h('a', { href: '/' + s.handle, textContent: '@' + s.handle, className: 'xmc-nav' }));
      else if (s.t === 'tag') frag.append(h('a', { href: '/hashtag/' + encodeURIComponent(s.tag), textContent: '#' + s.tag, className: 'xmc-nav' }));
    }
    return frag;
  }
  const textLength = (segs) => segs.reduce((n, s) => n + (s.v ? s.v.length : (s.label || s.handle || s.tag || '').length + 1), 0);

  const photoUrl = (u, size) => u + (u.includes('?') ? '&' : '?') + 'name=' + size;
  const clampRatio = (w, hh) => Math.max(0.6, Math.min(3, w / hh));

  function pickMp4(m) {
    // cards are small: prefer the best rendition up to ~1.3 Mbps, else the smallest available
    return m.mp4.find((v) => v.bitrate <= 1300000 && v.bitrate > 0) || m.mp4[m.mp4.length - 1] || null;
  }
  function renderVideo(m, t) {
    const gif = m.type === 'gif';
    const src = pickMp4(m);
    if (!src) { // HLS-only: we can't play it here, so link out
      return h('a', { className: 'xmc-video xmc-novideo', href: t.url, target: '_blank', rel: 'noopener' },
        h('img', { src: photoUrl(m.thumb, 'medium'), loading: 'lazy', alt: '' }), h('span', { textContent: 'Watch on ' + (settings.branding === 'twitter' ? 'Twitter' : 'X') }));
    }
    const auto = gif || settings.autoplayVideo === 'muted';
    const v = h('video', { poster: m.thumb, preload: auto ? 'metadata' : 'none', playsInline: true, controls: !gif, loop: gif, src: src.url });
    v.muted = auto;
    if (auto) { v.dataset.gif = '1'; playObserver.observe(v); }
    return h('div', { className: 'xmc-video' }, v, gif ? h('span', { className: 'xmc-gif', textContent: 'GIF' }) : null);
  }
  function renderMedia(t) {
    const list = t.media.slice(0, 4);
    const n = list.length;
    const box = h('div', { className: 'xmc-media ' + (n === 1 ? 'single' : 'grid n' + n) });
    let photoIdx = 0;
    for (const m of list) {
      let node;
      if (m.type === 'photo') {
        node = h('img', { src: photoUrl(m.thumb, n === 1 ? 'large' : 'medium'), alt: m.alt, loading: 'lazy', decoding: 'async' });
        node.dataset.lb = String(photoIdx++);
      } else node = renderVideo(m, t);
      if (n === 1) box.style.aspectRatio = String(clampRatio(m.w, m.h));
      box.append(node);
    }
    if (t.sensitive) { // blurred or not is decided by the NSFW setting (CSS), so the top-bar button works instantly
      box.classList.add('sensitive');
      box.append(h('button', { className: 'xmc-reveal', type: 'button', textContent: 'Sensitive content — click to view' }));
    }
    return box;
  }
  function renderQuote(q) {
    if (q.unavailable) return h('div', { className: 'xmc-quote xmc-dim', textContent: 'This post is unavailable.' });
    const first = q.media[0];
    const box = h('div', { className: 'xmc-quote' },
      h('div', { className: 'xmc-qhead' },
        h('img', { className: 'xmc-qava', src: q.author.avatar, alt: '', loading: 'lazy' }),
        h('b', { textContent: q.author.name }), h('span', { className: 'xmc-dim', textContent: ' @' + q.author.handle })),
      h('div', { className: 'xmc-text xmc-qtext' }, renderSegs(q.segs)),
      first ? h('img', { className: 'xmc-qmedia' + (q.sensitive ? ' sens' : ''), src: photoUrl(first.thumb, 'medium'), alt: '', loading: 'lazy' }) : null);
    box.dataset.href = q.url;
    return box;
  }
  function renderLinkCard(c) {
    if (c.poll) return h('div', { className: 'xmc-quote xmc-dim', textContent: 'Poll — open the post to vote' });
    return h('a', { className: 'xmc-link', href: c.url, target: '_blank', rel: 'noopener noreferrer' },
      c.image ? h('img', { src: c.image, alt: '', loading: 'lazy' }) : null,
      h('div', { className: 'xmc-linkmeta' },
        c.domain ? h('div', { className: 'xmc-dim', textContent: c.domain }) : null,
        c.title ? h('div', { className: 'xmc-linktitle', textContent: c.title }) : null));
  }

  function actionBtn(act, label, ic) {
    const b = h('button', { className: 'xmc-act', title: label, type: 'button' }, icon(ic || act), h('span', { className: 'xmc-n' }));
    b.dataset.act = act;
    return b;
  }
  function moreButton() {
    const b = h('button', { className: 'xmc-act xmc-moreBtn', title: 'More', type: 'button' }, icon('more'));
    b.dataset.act = 'more';
    return b;
  }
  function badge(a) {
    if (!a.blue && !a.verified) return null;
    const paid = a.blue && !a.verified;
    return h('span', { className: 'xmc-badge' + (paid ? ' blue' : ''), title: paid ? 'Paid verification' : 'Verified' }, icon('check', 'chk'), icon('bird', 'bird'));
  }
  function renderCard(t) {
    const card = h('article', { className: 'xmc-card' });
    tweetOf.set(card, t);
    if (t.repostedBy) card.append(h('div', { className: 'xmc-ctx' }, icon('repost'), ' ' + t.repostedBy.name + ' ' + T('reposted')));
    const sub = h('div', { className: 'xmc-sub' }, '@' + t.author.handle + ' · ',
      h('a', { className: 'xmc-time xmc-nav', href: t.url, title: new Date(t.createdAt).toLocaleString(), textContent: relTime(t.createdAt) }));
    if (settings.showSource && t.source) sub.append(h('span', { className: 'xmc-src', textContent: ' · via ' + t.source }));
    card.append(h('div', { className: 'xmc-head' },
      h('a', { className: 'xmc-avatar xmc-nav', href: '/' + t.author.handle }, h('img', { src: t.author.avatar, alt: '', loading: 'lazy' })),
      h('div', { className: 'xmc-who' },
        h('a', { className: 'xmc-name xmc-nav', href: '/' + t.author.handle }, t.author.name, badge(t.author)), sub),
      moreButton()));
    if (t.replyTo) card.append(h('div', { className: 'xmc-dim xmc-reply', textContent: 'Replying to @' + t.replyTo }));
    if (t.segs.length) {
      const long = textLength(t.segs) > 420;
      card.append(h('div', { className: 'xmc-text' + (long ? ' clamp' : '') }, renderSegs(t.segs)));
      if (long) card.append(h('button', { className: 'xmc-more', type: 'button', textContent: 'Show more' }));
      if (needsTranslation(t)) {
        const tb = h('button', { className: 'xmc-translate', type: 'button', textContent: 'Translate post' });
        card.append(tb);
        if (t.translation) queueMicrotask(() => showTranslation(t, card));
        else if (settings.autoTranslate) translateObserver.observe(tb);
      }
    }
    if (t.media.length) card.append(renderMedia(t));
    if (t.card) card.append(renderLinkCard(t.card));
    if (t.quoted) card.append(renderQuote(t.quoted));
    const actions = h('div', { className: 'xmc-actions' });
    actions.append(actionBtn('reply', 'Show comments'), actionBtn('repost', T('repost')), actionBtn('like', 'Like'), actionBtn('bookmark', 'Bookmark'));
    if (hasMedia(t)) actions.append(actionBtn('download', 'Download media', 'download'));
    actions.append(actionBtn('share', 'Copy link', 'link'));
    if (t.counts.quote > 0) actions.append(h('a', { className: 'xmc-qlink xmc-nav', href: t.url + '/quotes', textContent: fmt(t.counts.quote) + ' ' + T('quotes') }));
    if (t.counts.views) actions.append(h('span', { className: 'xmc-views xmc-n', textContent: fmt(t.counts.views) + ' views' }));
    card.append(actions);
    updateActions(t, card);
    return card;
  }
  function updateActions(t, card) {
    card = card || t.el;
    if (!card) return;
    const set = (act, on, n) => {
      const b = card.querySelector(`[data-act="${act}"]`);
      if (!b) return;
      b.classList.toggle('on', !!on);
      b.querySelector('.xmc-n').textContent = fmt(n);
    };
    set('reply', !!card.querySelector('.xmc-replies'), t.counts.reply);
    set('repost', t.state.reposted, t.counts.repost);
    set('like', t.state.liked, t.counts.like);
    set('bookmark', t.state.bookmarked, t.counts.bookmark);
    const dl = card.querySelector('[data-act="download"]');
    if (dl) {
      const done = settings.dlHistory && savedDownloads.has(t.id);
      dl.classList.toggle('done', !!done);
      dl.title = done ? 'Downloaded — click to download again' : 'Download media';
      dl.replaceChildren(icon(done ? 'done' : 'download'));
    }
  }
  const refreshDownloadMarks = () => { for (const t of view.cards) updateActions(t); };

  // rough card height, used only to spread a batch of new cards over the columns
  function estimate(t, w) {
    let hh = 100 + (t.repostedBy ? 22 : 0);
    hh += Math.ceil(textLength(t.segs) / Math.max(20, w / 7.4)) * 21 + 8;
    if (t.media.length) hh += t.media.length === 1 ? w * Math.min(1 / clampRatio(t.media[0].w, t.media[0].h), 1.67) : w * 0.5625;
    if (t.card) hh += 200;
    if (t.quoted) hh += 130;
    return Math.round(hh);
  }

  // ---------- overlay UI ----------
  const tabsEl = h('div', { className: 'xmc-tabs' });
  tabsEl.style.display = 'contents';
  const countEl = h('span', { className: 'xmc-count' });
  const btn = (text, title, onclick, cls) => h('button', { textContent: text, title, onclick, type: 'button', className: cls || '' });
  const VIEW_LABELS = { all: () => 'All', posts: () => T('posts'), reposts: () => T('reposts'), quotes: () => T('quotes'), replies: () => 'Replies', media: () => 'Media', photos: () => 'Photos', videos: () => 'Videos' };
  const viewEls = {};
  for (const key of Object.keys(VIEW_LABELS)) viewEls[key] = btn('', '', () => setFilter(key), 'xmc-chip');
  // X's profile Media tab is now split into Videos and Photos (a dropdown on the tab); these two press X's real choice
  const kindEls = {
    videos: btn('Videos', 'Show videos (X\u2019s own Videos view)', () => pickMediaKind('Videos'), 'xmc-chip'),
    photos: btn('Photos', 'Show photos (X\u2019s own Photos view)', () => pickMediaKind('Photos'), 'xmc-chip'),
  };
  const mediaSplit = () => { const tb = realTabs()[state.sel]; return !!tb && /^(videos|photos)$/i.test(tb.textContent.trim()); };
  const gearBtn = h('button', { className: 'xmc-gear', title: 'Settings', type: 'button', onclick: () => openOptions() }, icon('gear'));
  const refreshBtn = h('button', { className: 'xmc-refresh', title: 'Refresh', type: 'button', onclick: () => refresh() }, icon('refresh'), h('span', { className: 'xmc-newn' }));
  const nsfwBtn = h('button', { className: 'xmc-nsfw', type: 'button', onclick: () => cycleNsfw() }, h('span', { className: 'xmc-nsfwi' }), h('span', { className: 'xmc-nsfwl', textContent: 'NSFW' }));

  const colGroup = h('div', { className: 'xmc-colgroup' },
    btn('\u2212', 'Fewer columns', () => setCols(colCount() - 1)), countEl,
    btn('+', 'More columns', () => setCols(colCount() + 1)),
    btn('Auto', 'Fit columns to width', () => setCols(0)));
  const row1 = h('div', { className: 'xmc-bar1' }, tabsEl, h('span', { className: 'xmc-spacer' }), refreshBtn, colGroup, nsfwBtn, gearBtn);
  const row2 = h('div', { className: 'xmc-bar2' }, ...Object.values(viewEls), ...Object.values(kindEls)); // the "All / Tweets / Retweets / ..." views, on a line of their own
  const bar = h('div', { className: 'xmc-bar' }, row1, row2);
  const statusEl = h('div', { className: 'xmc-status' });
  const colsEl = h('div', { className: 'xmc-cols' });
  const loaderText = h('span', { textContent: 'Loading more…' });
  const diagBtn = btn('Copy diagnostics', 'Copies a private snapshot (no post text) to paste when asking for help', () => copyDiagnostics(), 'xmc-diagbtn');
  const loaderEl = h('div', { className: 'xmc-loader', hidden: true }, spinner(), loaderText, diagBtn);
  const endEl = h('div', { className: 'xmc-end', hidden: true }, h('span', { textContent: 'That’s everything X has sent.' }),
    btn('Try loading more', '', () => { const f = activeFeed(); if (f) { f.exhausted = false; f.empty = 0; f.misses = 0; f.retryOnce = true; pump(); } }));
  const scroller = h('div', { className: 'xmc-scroller', tabIndex: -1 }, colsEl, loaderEl, endEl, statusEl);
  const root = h('div', { id: 'xmc-root', hidden: true }, bar, scroller);
  const toastEl = h('div', { id: 'xmc-toast', hidden: true });
  document.body.append(root, toastEl);

  // Vimium and friends scroll "the element you last clicked in", so make that our columns
  const focusScroller = () => { if (!root.hidden && !/^(input|textarea|select)$/i.test((document.activeElement || {}).tagName || '')) scroller.focus({ preventScroll: true }); };
  root.addEventListener('pointerdown', (e) => { if (!e.target.closest('input, textarea, select')) setTimeout(focusScroller, 0); });
  let drawSoon = 0;
  let lastScrollAt = 0;
  scroller.addEventListener('scroll', () => {
    if (root.hidden) return;
    lastScrollAt = Date.now();
    view.memoTop = scroller.scrollTop;
    if (!drawSoon) drawSoon = setTimeout(() => { drawSoon = 0; if (!root.hidden) guard('render', renderFeed); }, 40); // fill blank space as it appears, not on the next tick
  }, { passive: true });

  // A permanent pill in X's left sidebar, shaped like its Post/Tweet button: columns on/off for this page, and the way back
  // if they ever fall back to X's normal feed. (It used to float bottom-right, where it covered X's chat button.)
  const pill = h('button', { id: 'xmc-pill', type: 'button', hidden: true, onclick: () => togglePage() });
  function togglePage() {
    const route = routeKey();
    if (canTry() && state.trial !== route) { state.trial = route; state.failed = ''; state.failedBy = ''; state.routeSince = Date.now(); tick(); return; }
    if (state.failed === route) { state.failed = ''; state.failedBy = ''; state.routeSince = Date.now(); } else { state.failed = route; state.failedBy = 'user'; }
    tick();
  }
  // Looks like part of the sidebar: X's own font, size and height (copied from the Post button), and the icon-only
  // round shape X switches to when the sidebar is narrow.
  const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
  function placePill() {
    const host = document.querySelector('[data-testid="SideNav_NewTweet_Button"]') || document.querySelector('header[role="banner"] nav');
    if (!host) return;
    if (!pill.isConnected || pill.previousElementSibling !== host) host.after(pill);
    const box = host.getBoundingClientRect();
    const width = box.width || (host.closest('nav') || host).getBoundingClientRect().width; // the Post button may be hidden by a setting
    const compact = width > 0 && width < 140;
    pill.classList.toggle('compact', compact);
    const label = [...host.querySelectorAll('span')].reverse().find((n) => !n.children.length && n.textContent.trim());
    const cs = getComputedStyle(label || host);
    const family = (cs.fontFamily && cs.fontFamily !== 'serif' ? cs.fontFamily + ', ' : '') + SANS;
    if (pill.style.fontFamily !== family) pill.style.fontFamily = family;
    const size = cs.fontSize;
    if (size && pill.style.fontSize !== size) pill.style.fontSize = size;
    const height = box.height > 30 ? Math.round(box.height) + 'px' : '';
    if (pill.style.minHeight !== height) pill.style.minHeight = height;
    const wide = !compact && box.width > 140 ? Math.round(box.width) + 'px' : ''; // as wide as the Post button
    if (pill.style.width !== wide) pill.style.width = wide;
  }
  function updatePill(show, on) {
    pill.hidden = !show;
    pill.classList.toggle('off', !on);
    const text = on ? 'Columns' : canTry() && state.trial !== routeKey() ? 'Try columns' : state.failedBy === 'user' ? 'Columns off \u2014 turn on' : 'Retry columns';
    if (pill.dataset.text !== text) { // only touch the DOM when it changes
      pill.dataset.text = text;
      pill.replaceChildren(icon('columns'), h('span', { className: 'xmc-pill-label', textContent: text }));
    }
    pill.title = on ? 'Columns are on for this page. Click to see X\u2019s normal feed instead.' : 'Click to show this page in columns';
    pill.setAttribute('aria-label', text);
  }

  let toastTimer = 0;
  function toast(msg) {
    toastEl.textContent = msg; toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, 2800);
  }
  function openOptions() {
    if (ext && ext.runtime && ext.runtime.sendMessage) ext.runtime.sendMessage({ type: 'xmc-open-options' }).catch(() => {});
    else toast('Settings are in the extension’s options page.');
  }

  const NSFW = { blur: ['eyeoff', 'NSFW blurred'], show: ['eye', 'NSFW shown'], hide: ['ban', 'NSFW hidden'] };
  function cycleNsfw() {
    const order = ['blur', 'show', 'hide'];
    settings.nsfw = order[(order.indexOf(settings.nsfw) + 1) % order.length];
    save();
    settingsChanged();
    toast({ blur: 'Sensitive media is blurred', show: 'Sensitive media is shown', hide: 'Sensitive posts are hidden' }[settings.nsfw]);
  }

  // settings that change what's drawn
  function settingsChanged() {
    XMCSite.apply(settings);
    applyBar();
    if (columns.length && colCount() !== columns.length) relayout(); // column settings changed
    refreshDownloadMarks();
  }
  function applyBar() {
    const feed = activeFeed();
    const split = mediaSplit();
    const views = split ? ['all'] : XMCLogic.availableViews(where(), settings, feed ? feed.items : [], settings.filter, { mediaTab: XMCLogic.isMediaTab(location.pathname) });
    if (!views.includes(settings.filter)) { settings.filter = 'all'; save(); }
    for (const key of Object.keys(viewEls)) {
      const el = viewEls[key];
      el.hidden = split || !views.includes(key);
      el.textContent = VIEW_LABELS[key]();
      el.classList.toggle('on', settings.filter === key);
    }
    const kind = subFor(state.sel);
    for (const key of Object.keys(kindEls)) { kindEls[key].hidden = !split; kindEls[key].classList.toggle('on', kind === key); }
    row2.hidden = !split && views.length <= 1; // nothing to choose between yet
    const [ic, label] = NSFW[settings.nsfw] || NSFW.blur;
    nsfwBtn.title = label + ' — click to change';
    nsfwBtn.classList.toggle('shown', settings.nsfw === 'show');
    nsfwBtn.classList.toggle('hidden-mode', settings.nsfw === 'hide');
    nsfwBtn.firstChild.replaceChildren(icon(ic));
  }
  function setFilter(key) { settings.filter = key; save(); applyBar(); guard('render', renderFeed); } // draw now, not on the next tick
  function setCols(n) { settings.cols = Math.max(0, Math.min(8, n)); save(); relayout(); }
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { if (lightbox) closeLightbox(); closeMenu(); }
    if (lightbox && e.key === 'ArrowRight') stepLightbox(1);
    if (lightbox && e.key === 'ArrowLeft') stepLightbox(-1);
  }, true);

  // ---------- columns ----------
  let columns = [];
  const view = { feedKey: null, version: -1, sig: '', renderSig: '', upto: 0, cards: [] };
  function colCount() {
    return settings.cols > 0 ? settings.cols : XMCLogic.autoCols(colsEl.clientWidth, settings, GAP);
  }
  // everything that changes which posts pass; when it changes the view is rebuilt
  const FILTER_KEYS = ['filter', 'repostsHome', 'quotesHome', 'repliesHome', 'repostsProfile', 'repostsLists', 'onlyFollowed',
    'hideBlueReplies', 'hideMutedQuotes', 'mutedWords', 'mutedAccounts', 'nsfw'];
  // everything that changes how a card is built
  const RENDER_KEYS = ['branding', 'showSource', 'autoplayVideo'];
  const sigOf = (keys) => keys.map((k) => String(settings[k])).join('|') + '|' + where() + '|' + settings.mutedQuoteIds.length;
  const passCtx = () => ({
    s: settings, view: settings.filter, where: where(), words: XMCSettings.words(settings.mutedWords),
    accounts: new Set(XMCSettings.handles(settings.mutedAccounts)), quoteIds: new Set(settings.mutedQuoteIds),
  });

  // Read the real column heights once per batch (one layout pass), then spread the batch using estimates.
  function placeBatch(items) {
    if (!items.length || !columns.length) return;
    const heights = columns.map((c) => c.offsetHeight);
    const w = columns[0].clientWidth || 360;
    for (const { t, est } of items) {
      let i = 0;
      for (let j = 1; j < heights.length; j++) if (heights[j] < heights[i]) i = j;
      const guess = est || estimate(t, w);
      const el = t.el || (t.el = renderCard(t));
      // a card that hasn't been drawn yet counts as our estimate (not a flat 420px), so the columns stay level
      if (!el.dataset.sized) { el.style.containIntrinsicSize = 'auto ' + guess + 'px'; el.dataset.sized = '1'; }
      columns[i].append(el);
      heights[i] += guess + GAP;
    }
  }
  // Where the SHORTEST column ends, in scroller coordinates. That is what decides when to draw more: the tallest
  // column says nothing about the blank space under a short one.
  function shortestBottom() {
    if (!columns.length) return 0;
    const base = scroller.getBoundingClientRect().top - scroller.scrollTop;
    let m = Infinity;
    for (const c of columns) m = Math.min(m, c.getBoundingClientRect().bottom - base);
    return m;
  }
  function relayout() {
    const n = colCount();
    countEl.textContent = (settings.cols ? '' : 'auto · ') + n;
    const real = view.cards.map((t) => (t.el ? t.el.offsetHeight : 0));
    columns = Array.from({ length: n }, () => h('div', { className: 'xmc-col' }));
    colsEl.classList.toggle('auto', !settings.cols); // automatic: columns keep about one width, the window shows more or fewer
    root.style.setProperty('--xmc-colw', settings.minColWidth + 'px');
    colsEl.replaceChildren(...columns);
    placeBatch(view.cards.map((t, i) => ({ t, est: real[i] || undefined })));
  }
  function resetView(feed) {
    view.feedKey = feed ? feed.key : null;
    view.version = feed ? feed.version : -1;
    view.sig = sigOf(FILTER_KEYS);
    view.renderSig = sigOf(RENDER_KEYS);
    view.upto = 0;
    view.cards = [];
    view.memoTop = 0;
    scroller.scrollTop = 0;
    relayout();
  }
  let statusKey = '';
  function setStatus(msg, spinning) {
    const key = (msg || '') + '|' + (spinning ? 1 : 0);
    if (key !== statusKey) { // rebuilding it every tick restarted the spinner each time, so it never got to turn
      statusKey = key;
      statusEl.replaceChildren(...(msg ? [spinning ? spinner() : null, h('span', { textContent: msg })].filter(Boolean) : []));
    }
    statusEl.hidden = !msg;
  }
  function dropCards(pred) { // remove cards in place (e.g. after muting) without rebuilding or losing your place
    view.cards = view.cards.filter((t) => { if (pred(t)) { if (t.el) t.el.remove(); return false; } return true; });
  }

  // Draw only what you can reach soon (about four screens ahead) instead of every loaded post at once:
  // switching views stays instant however much is loaded, and more is drawn as you scroll.
  const CHUNK = 14;
  function renderFeed() {
    // Never while X's hidden side is on a post's page or the compose box (comments, translation, replying): there is no
    // feed for that page, and "no feed" would wipe the columns and throw you back to the top.
    if (state.peek || state.posting || onPostPage() || isModalRoute()) return;
    if (settings.disableHome && where() === 'home') {
      if (view.feedKey) resetView(null);
      setStatus('The Home timeline is turned off in settings.');
      loaderEl.hidden = true; endEl.hidden = true;
      return;
    }
    const f = activeFeed();
    if (!f || !f.items.length || state.homeHold) {
      if (view.feedKey) resetView(null);
      setStatus('Loading…', true);
      loaderEl.hidden = true; endEl.hidden = true;
      updateRefreshBtn(null);
      return;
    }
    if (view.renderSig !== sigOf(RENDER_KEYS)) for (const feed of state.feeds.values()) for (const t of feed.items) t.el = null; // rebuild the cards themselves
    if (view.feedKey !== f.key || view.version !== f.version || view.sig !== sigOf(FILTER_KEYS) || view.renderSig !== sigOf(RENDER_KEYS)) resetView(f);
    if (!columns.length) relayout();
    // Draw while ANY column has room: its end is within about three screens below where you are. If there is blank
    // space on screen right now, catch up faster (up to four batches in one go).
    const c = passCtx();
    for (let batch = 0; batch < 4 && view.upto < f.items.length; batch++) {
      const bottom = shortestBottom(), seen = scroller.scrollTop + scroller.clientHeight;
      if (view.cards.length >= 8 && bottom >= seen + scroller.clientHeight * 2) break; // every column has two screens to go
      if (batch > 0 && bottom >= seen) break; // only the first batch of a tick unless there is blank space on screen
      const fresh = [];
      let scanned = 0;
      while (view.upto < f.items.length && fresh.length < CHUNK && scanned < 400) {
        const t = f.items[view.upto++];
        scanned++;
        if (XMCLogic.passes(t, c)) { fresh.push({ t }); view.cards.push(t); }
      }
      placeBatch(fresh);
      if (!fresh.length) break;
    }
    updateRefreshBtn(f);
    const drawn = view.upto >= f.items.length;
    setStatus(!view.cards.length && drawn && (f.exhausted || !state.waitingPage) ? (f.exhausted ? 'Nothing in this view.' : 'Nothing here matches this view yet...') : '');
    // spinner while we're fetching more; a note when X has no more to give
    const waiting = state.waitingPage && !f.exhausted;
    loaderEl.hidden = !waiting;
    loaderEl.classList.toggle('xmc-sticky', waiting && shortestBottom() < scroller.scrollTop + scroller.clientHeight); // blank space on screen: keep the spinner in view
    const fl = state.fail && Date.now() - state.fail.at < 90000 ? state.fail : null;
    const loaderMsg = waiting && fl
      ? (fl.status === 429 ? 'X says slow down (rate limit) - retrying shortly...' : 'X returned an error (' + fl.status + ') - retrying...')
      : waiting && Date.now() - state.waitSince > 12000 ? 'Still waiting for X...' : 'Loading more...';
    if (loaderText.textContent !== loaderMsg) loaderText.textContent = loaderMsg;
    diagBtn.hidden = !(waiting && Date.now() - state.waitSince > 20000 || waiting && fl);
    endEl.hidden = !(f.exhausted && drawn && view.cards.length);
  }
  function updateRefreshBtn(f) {
    const n = f ? f.pending.length : 0;
    refreshBtn.classList.toggle('has-new', n > 0);
    refreshBtn.querySelector('.xmc-newn').textContent = n ? n + ' new' : '';
    refreshBtn.title = n ? `${n} new posts — click to show them` : 'Refresh';
  }
  new ResizeObserver(() => { if (!root.hidden && !settings.cols && colCount() !== columns.length) relayout(); }).observe(scroller);

  // Refresh only ever happens when you press the button.
  function refresh() {
    const f = activeFeed();
    if (f && f.pending.length) { applyPending(f); return; }
    state.refreshing = { until: Date.now() + 8000 };
    state.proxyUntil = Date.now() + 8000;
    window.scrollTo(0, 0);
    const home = document.querySelector('[data-testid="AppTabBar_Home_Link"]');
    const tab = realTabs()[state.sel];
    if (where() === 'home' && home) fire(home); else if (tab) fire(tab); else if (home) fire(home);
    toast('Refreshing…');
    setTimeout(() => {
      if (state.refreshing) { state.refreshing = null; toast('Nothing new right now.'); }
    }, 8000);
  }

  // ---------- loading more ----------
  // X asks for the next page when its (hidden) list has been scrolled to the end, and it draws every screen it is
  // scrolled to, which takes it a moment. So don't pass through each screen: go most of the way in one move (like
  // dragging the scrollbar), then scroll the last couple of screens like a person. If X still doesn't answer,
  // nudge it; if that doesn't work either, switch to walking the whole way for the rest of the session.
  function pump() {
    if (Date.now() < state.proxyUntil) return;
    if (settings.disableHome && where() === 'home') return;
    const f = activeFeed();
    if (!f || f.exhausted) return;
    if (f.items.length - view.upto > 40) return; // plenty already waiting to be drawn; stay about two pages ahead, not more
    const need = scroller.scrollTop + scroller.clientHeight > shortestBottom() - innerHeight * 8;
    if (!need) return;
    const now = Date.now();
    const doc = document.documentElement;
    const left = doc.scrollHeight - (window.scrollY + innerHeight); // how far X's list still goes below the hidden page
    if (left > 80) {
      if (now - (state.lastStep || 0) < 200) return; // space the moves out so each one registers as a scroll of its own
      state.lastStep = now;
      if (!state.walkOnly && left > innerHeight * 5) window.scrollTo(0, doc.scrollHeight - innerHeight * 4);
      else window.scrollBy(0, Math.min(innerHeight * 0.85, left));
      state.waitingPage = true; if (!state.waitSince) state.waitSince = now;
      state.lastJump = now;
      return;
    }
    // at the end of X's list: X should be fetching. If nothing arrives, wiggle the scroll to wake its end-marker
    if (!state.waitingPage) { state.waitingPage = true; if (!state.waitSince) state.waitSince = now; state.lastJump = now; f.misses = 0; return; }
    const gap = state.fail || f.misses >= 3 ? 15000 : 3500;
    if (now - state.lastJump < gap) return;
    if (f.retryOnce) { f.retryOnce = false; f.exhausted = true; state.waitingPage = false; state.waitSince = 0; return; } // you asked once; X really has nothing
    f.misses++;
    if (f.misses >= 4 && !state.fail) { // X has not answered four nudges in a row (and isn't refusing): this is the end of what it will send
      f.exhausted = true; state.waitingPage = false; state.waitSince = 0;
      return;
    }
    state.lastJump = now;
    if (f.misses === 2 && !state.walkOnly) { // the big move didn't convince X: go back up and walk down, a screen at a time
      state.walkOnly = true;
      window.scrollBy(0, -innerHeight * 6);
      console.warn('[xmc] X ignored the big scroll; walking the whole way instead. ' + diag());
      return;
    }
    window.scrollBy(0, -innerHeight * 0.7);
    setTimeout(() => window.scrollTo(0, document.documentElement.scrollHeight), 180); // a timer, not a frame: frames stop in background tabs
    if (f.misses === 3 || f.misses % 10 === 0) console.warn('[xmc] X is not sending more posts. ' + diag());
  }
    // A private snapshot for when things stall (counts and request names only: no post text, no names, no cookies)
  function diagnostics() {
    const d = document.documentElement;
    return JSON.stringify({
      version: ext && ext.runtime.getManifest ? ext.runtime.getManifest().version : 'dev',
      page: location.pathname,
      layout: { columns: columns.length, shortestPx: Math.round(shortestBottom()), tallestPx: Math.round(Math.max(0, ...columns.map((c) => c.getBoundingClientRect().bottom - scroller.getBoundingClientRect().top + scroller.scrollTop))), drawn: view.upto, loaded: (activeFeed() || { items: [] }).items.length },
      hiddenPage: { scrollY: Math.round(window.scrollY), height: d.scrollHeight, viewport: innerHeight, postsMountedByX: articles().length },
      requestsSeen: state.seenOps,
      feeds: [...state.feeds.values()].map((f) => ({ name: f.key.split('|')[0] + (f.key.includes('#') ? '#' + f.key.split('#').pop() : ''), posts: f.items.length, parkedNew: f.pending.length, exhausted: f.exhausted, misses: f.misses })),
      lastRefusal: state.fail, waitingForPage: state.waitingPage, secondsSinceAsked: Math.round((Date.now() - state.lastJump) / 1000), secondsWaiting: state.waitSince ? Math.round((Date.now() - state.waitSince) / 1000) : 0,
      commentsInProgress: state.peek ? state.peek.id : null, cachedConversations: state.details.size,
      tabs: { labels: realTabs().map((x) => x.textContent.trim().slice(0, 20)), xSelected: realTabs().findIndex((x) => x.getAttribute('aria-selected') === 'true'), weThink: state.sel, homeInit: state.homeInit, awaiting: !!state.awaiting, dropdownTabs: [...state.menuTabs], picked: state.sub, fastComments: state.fastPeek !== false, onFeed: state.cur.key ? state.cur.key.split('|')[0] : null },
      mode: { walkOnly: !!state.walkOnly, tickMsAverage: Math.round(tickTimes.reduce((a, b) => a + b, 0) / Math.max(1, tickTimes.length)), tickMsWorst: Math.round(Math.max(0, ...tickTimes)) },
    }, null, 2);
  }
  async function copyDiagnostics() {
    try { await navigator.clipboard.writeText(diagnostics()); toast('Copied \u2014 paste it to whoever is helping you'); } catch { console.log('[xmc] diagnostics', diagnostics()); toast('Couldn\u2019t copy; it\u2019s in the browser console'); }
  }
  // a one-line snapshot for when things stall
  function diag() {
    const d = document.documentElement;
    return `hidden page ${Math.round(window.scrollY)}/${d.scrollHeight}px, X's list shows ${articles().length} posts, ` +
      `requests seen: ${JSON.stringify(state.seenOps)}` + (state.fail ? `, last refusal: ${state.fail.status}` : '');
  }

  // X's own copy of the timeline is hidden behind our columns but still alive, and X starts its videos (streaming and
  // decoding them for nothing). Keep them stopped.
  function stopHiddenVideos() {
    const col = mainCol();
    if (!col) return;
    for (const v of col.querySelectorAll('video')) { if (!v.paused) v.pause(); if (v.autoplay) v.autoplay = false; }
  }

  // ---------- driving X's real (hidden) page for actions ----------
  const mainCol = () => document.querySelector('[data-testid="primaryColumn"]');
  const idOfHref = (href) => { const m = /\/status\/(\d+)/.exec(href || ''); return m ? m[1] : null; };
  const articles = () => [...(mainCol() || document).querySelectorAll('article[data-testid="tweet"]')];
  const articleId = (a) => { const t = a.querySelector('a[href*="/status/"] time'); return t ? idOfHref(t.closest('a').getAttribute('href')) : null; };
  const findArticle = (id) => articles().find((a) => articleId(a) === id) || null;

  function fire(node) {
    const opts = { bubbles: true, cancelable: true, view: window, button: 0 };
    for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      node.dispatchEvent(new (t.startsWith('pointer') ? PointerEvent : MouseEvent)(t, opts));
    }
  }
  async function waitFor(fn, ms) {
    const end = Date.now() + ms;
    for (;;) {
      const v = fn();
      if (v || Date.now() > end) return v || null;
      await sleep(50);
    }
  }

  // Get X to mount a tweet: its list is virtual, so walk the hidden page towards the tweet's position a couple of
  // screens at a time (we know its index in the feed; the distance is corrected by looking at what is mounted).
  // Leaping instead of walking leaves X's measurements of the posts in between wrong.
  async function realArticle(t) {
    state.proxyUntil = Date.now() + 20000;
    let art = findArticle(t.id);
    if (art) return art;
    const f = activeFeed();
    const idx = f && f.index.get(t.id);
    if (idx === undefined) return null;
    for (let i = 0; i < 70 && !art; i++) {
      const here = articles().map((a) => f.index.get(articleId(a))).filter((n) => n !== undefined).sort((a, b) => a - b);
      let dy = here.length ? (idx - here[here.length >> 1]) * 520 : idx * 520 - window.scrollY;
      if (Math.abs(dy) < innerHeight * 0.5) dy = Math.sign(dy || 1) * innerHeight * 0.5;
      const hop = Math.min(innerHeight * 6, Math.max(innerHeight * 1.5, Math.abs(dy) / 3)); // far away: bigger steps, small ones near the post
      window.scrollBy(0, Math.max(-hop, Math.min(hop, dy)));
      await sleep(150);
      art = findArticle(t.id);
    }
    if (art) await sleep(120);
    return art;
  }
  async function withReal(t, fn) {
    const art = await realArticle(t);
    if (!art) return false;
    await fn(art);
    return true;
  }
  const normHref = (s) => String(s || '').split('?')[0].toLowerCase();
  // the link on a post's time stamp, found by the post's number (exact), not by how X spells the handle
  const timeLinkOf = (art, id) => [...art.querySelectorAll('a[href]')].find((a) => idOfHref(a.getAttribute('href')) === id && a.querySelector('time'));
  async function navigate(href, t) {
    if (settings.openIn === 'newtab') { window.open(new URL(href, location.origin).href, '_blank', 'noopener'); return; }
    if (t) {
      const art = await realArticle(t);
      const a = art && ([...art.querySelectorAll('a[href]')].find((x) => normHref(x.getAttribute('href')) === normHref(href))
        || (normHref(href) === normHref(t.url) ? timeLinkOf(art, t.id) : null));
      if (a) { fire(a); return; }
    }
    location.assign(href); // fallback: a normal page load
  }

  async function toggleAction(t, key, onSel, offSel, countKey) {
    const want = !t.state[key];
    t.state[key] = want;
    if (countKey) t.counts[countKey] = Math.max(0, t.counts[countKey] + (want ? 1 : -1));
    updateActions(t);
    const ok = await withReal(t, (art) => { const b = art.querySelector(want ? onSel : offSel); if (b) fire(b); });
    if (!ok) {
      t.state[key] = !want;
      if (countKey) t.counts[countKey] = Math.max(0, t.counts[countKey] + (want ? -1 : 1));
      updateActions(t);
      toast('Couldn’t reach that post just now — try again in a moment');
    }
  }
  async function repost(t, quote) {
    const doc = document.documentElement;
    if (!quote) doc.classList.add('xmc-acting'); // X's little repost menu is clicked for us; keep it from flashing
    try {
      const ok = await withReal(t, async (art) => {
        const b = art.querySelector('[data-testid="retweet"],[data-testid="unretweet"]');
        if (!b) return;
        fire(b);
        if (quote) {
          const item = await waitFor(() => [...document.querySelectorAll('#layers [role="menuitem"]')]
            .find((m) => /quote/i.test(m.textContent)) || document.querySelectorAll('#layers [role="menuitem"]')[1], 1500);
          if (item) fire(item);
        } else {
          const confirm = await waitFor(() => document.querySelector('[data-testid="retweetConfirm"],[data-testid="unretweetConfirm"]'), 1500);
          if (confirm) {
            fire(confirm);
            t.state.reposted = !t.state.reposted;
            t.counts.repost = Math.max(0, t.counts.repost + (t.state.reposted ? 1 : -1));
            updateActions(t);
          }
        }
      });
      if (!ok) toast('Couldn’t reach that post just now — try again in a moment');
    } finally { setTimeout(() => doc.classList.remove('xmc-acting'), 500); }
  }

  // ---------- comments ----------
  // X only sends a post's replies when its own page is opened. So we open that page on X's hidden side (nothing
  // changes on screen: our columns stay put), read the conversation as it arrives, and go straight back.
  const onPostPage = () => /\/status\/\d+/.test(location.pathname);
  // resolves to {data} or {why}: the reason is shown to the person (and tells me what X did)
  // Only one post can be open on X's hidden side at a time, so comments asked for together are fetched one after the
  // other (each panel opens at once and fills in as its turn comes), instead of refusing all but the first.
  let replyQueue = Promise.resolve();
  let repliesWaiting = 0;
  function loadReplies(t, opts) {
    opts = opts || {};
    const cached = state.details.get(t.id);
    if (cached && !opts.translate) return Promise.resolve({ data: cached });
    repliesWaiting++;
    const run = replyQueue.then(async () => {
      repliesWaiting--;
      const again = state.details.get(t.id); // an earlier request for the same post may have fetched it meanwhile
      if (again && !opts.translate) return { data: again };
      if (opts.wanted && !opts.wanted()) return { why: 'Closed before it loaded.' };
      if (opts.onStart) opts.onStart();
      await waitFor(() => !state.posting, 15000);
      return fetchReplies(t, opts);
    });
    replyQueue = run.catch(() => {});
    return run;
  }
  // On the post's own page (X's copy of the post is the one marked tabindex -1), press "Translate post" and read the result
  async function translateOnPage() {
    const art = await waitFor(() => document.querySelector('article[data-testid="tweet"][tabindex="-1"]'), 3000);
    if (!art) return '';
    const textEl = () => art.querySelector('[data-testid="tweetText"]');
    const before = textEl() ? textEl().textContent : '';
    const link = await waitFor(() => [...art.querySelectorAll('[role="button"], button, a')].find((el) => /^\s*translate\b/i.test(el.textContent || '')), 2500);
    if (!link) return '';
    fire(link);
    return (await waitFor(() => { const now = textEl() ? textEl().textContent : ''; return now && now !== before ? now : ''; }, 6000)) || '';
  }
  async function fetchReplies(t, opts) {
    opts = opts || {};
    state.peek = { id: t.id, replies: null };
    state.proxyUntil = Date.now() + 40000;
    try {
      // Fast way: go to the post's page the way X's own router follows the back button (no need to scroll X's hidden list
      // to the post first, which is what made comments slow). If X doesn't react, undo it and do it the slow way.
      if (state.fastPeek !== false) {
        const was = location.pathname;
        try {
          window.history.pushState({ key: 'xmc' + Math.random().toString(36).slice(2, 8) }, '', t.url);
          window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }));
        } catch { /* fall through to the slow way */ }
        const quick = await waitFor(() => state.peek && state.peek.replies, 3500);
        if (quick) { state.fastFails = 0; return { data: quick, translation: opts.translate ? await translateOnPage() : '' }; }
        state.fastFails = (state.fastFails || 0) + 1;
        if (state.fastFails >= 2) state.fastPeek = false; // X ignores it: stop trying for this page load
        if (location.pathname !== was) { window.history.back(); await waitFor(() => location.pathname === was, 3000); }
      }
      const art = await realArticle(t);
      if (!art) return { why: 'Couldn\u2019t find this post on X\u2019s side (it may have scrolled out of X\u2019s list).' };
      const link = timeLinkOf(art, t.id);
      if (!link) return { why: 'Found the post but not its link, so couldn\u2019t open it.' };
      const before = location.pathname;
      fire(link);
      await waitFor(() => location.pathname !== before || state.peek.replies, 3000);
      if (!state.peek.replies && location.pathname === before) { link.click(); await waitFor(() => location.pathname !== before || state.peek.replies, 2500); } // a plain click as a second try
      const got = await waitFor(() => state.peek && state.peek.replies, 9000);
      if (got) return { data: got, translation: opts.translate ? await translateOnPage() : '' };
      return { why: location.pathname === before
        ? 'X didn\u2019t open the post when asked to.'
        : 'X opened the post but sent no comments. Requests seen: ' + Object.keys(state.seenOps).join(', ') };
    } finally {
      if (onPostPage()) {
        window.history.back();
        await waitFor(() => !onPostPage(), 3500);
      }
      state.peek = null;
      state.proxyUntil = Date.now() + 1500;
    }
  }
  function renderReply(r) {
    const text = h('div', { className: 'xmc-text' }, renderSegs(r.segs));
    for (const a of text.querySelectorAll('a.xmc-nav')) { a.classList.remove('xmc-nav'); a.target = '_blank'; a.rel = 'noopener'; }
    const photos = r.media.slice(0, 2).map((m) => h('a', { href: photoUrl(m.thumb, 'large'), target: '_blank', rel: 'noopener' },
      h('img', { className: 'xmc-rmedia', src: photoUrl(m.thumb, 'small'), alt: '', loading: 'lazy' })));
    return h('div', { className: 'xmc-ritem d' + (r.depth || 0) },
      h('a', { className: 'xmc-ravatar', href: '/' + r.author.handle, target: '_blank', rel: 'noopener' }, h('img', { src: r.author.avatar, alt: '', loading: 'lazy' })),
      h('div', { className: 'xmc-rbody' },
        h('div', { className: 'xmc-rtop' },
          h('a', { className: 'xmc-name', href: '/' + r.author.handle, target: '_blank', rel: 'noopener', textContent: r.author.name }), badge(r.author),
          h('span', { className: 'xmc-dim', textContent: ' @' + r.author.handle + ' · ' + relTime(r.createdAt) })),
        text,
        photos.length ? h('div', { className: 'xmc-rmedias' }, ...photos) : null,
        r.counts.like ? h('div', { className: 'xmc-dim xmc-rlikes', textContent: fmt(r.counts.like) + ' likes' }) : null));
  }
  const SORTS = [['relevant', 'Relevant'], ['recent', 'Recent'], ['likes', 'Most liked']];
  function fillReplies(panel, t, res) {
    panel.replaceChildren();
    const d = res && res.data;
    const list = d ? XMCLogic.sortReplies(d.replies.slice(0, 60), settings.commentSort) : [];
    const sortSel = h('select', { className: 'xmc-rsort', title: 'Order comments' },
      ...SORTS.map(([v, l]) => h('option', { value: v, textContent: l, selected: settings.commentSort === v })));
    sortSel.addEventListener('change', () => { settings.commentSort = sortSel.value; save(); fillReplies(panel, t, res); });
    panel.append(h('div', { className: 'xmc-rhead' },
      h('b', { textContent: list.length ? 'Comments' : d ? 'No comments yet' : 'Couldn’t load comments' }),
      list.length > 1 ? sortSel : null,
      h('button', { className: 'xmc-rclose', type: 'button', title: 'Close comments' }, icon('close'))));
    for (const r of list) panel.append(renderReply(r));
    if (!d) {
      panel.append(h('div', { className: 'xmc-dim xmc-rempty', textContent: (res && res.why) || 'Try again in a moment.' }));
      panel.append(btn('Copy diagnostics', '', () => copyDiagnostics(), 'xmc-rbtn'));
    }
    panel.append(renderComposer(panel, t));
    const more = h('button', { className: 'xmc-rbtn', type: 'button', textContent: d && d.more ? 'See all comments' : 'Open conversation' });
    more.dataset.act = 'conversation';
    panel.append(h('div', { className: 'xmc-rfoot' }, more));
  }

  // Posting a comment from here: X's own reply box is opened out of sight, the text is typed into it and Send
  // is pressed, exactly as you would. If any step fails, X's reply box is left open for you to finish.
  async function postReply(t, text) {
    await replyQueue; // comment loads borrow the same hidden page
    state.posting = true;
    const doc = document.documentElement;
    doc.classList.add('xmc-acting');
    let res = { ok: false, why: 'Something went wrong.' };
    try {
      const art = await realArticle(t);
      const rb = art && art.querySelector('[data-testid="reply"]');
      if (!rb) { res = { ok: false, why: 'Couldn’t find this post on X’s side.' }; return res; }
      fire(rb);
      const editor = await waitFor(() => document.querySelector('[data-testid="tweetTextarea_0"]'), 5000);
      if (!editor) { res = { ok: false, why: 'X’s reply box didn’t open.' }; return res; }
      editor.focus();
      document.execCommand('selectAll', false);
      document.execCommand('insertText', false, text);
      const sendBtn = await waitFor(() => {
        const b = document.querySelector('[data-testid="tweetButton"]');
        return b && b.getAttribute('aria-disabled') !== 'true' && !b.disabled ? b : null;
      }, 4000);
      if (!sendBtn) { res = { ok: false, why: 'X wouldn’t accept the text.' }; return res; }
      fire(sendBtn);
      const closed = await waitFor(() => !document.querySelector('[data-testid="tweetTextarea_0"]'), 10000);
      res = closed ? { ok: true } : { ok: false, why: 'X didn’t confirm it was sent.' };
      return res;
    } finally {
      state.posting = false;
      if (res.ok) setTimeout(() => doc.classList.remove('xmc-acting'), 500);
      else { doc.classList.remove('xmc-acting'); toast(res.why + ' Finish it in X’s reply box.'); }
    }
  }
  function renderComposer(panel, t) {
    const box = h('textarea', { className: 'xmc-cbox', placeholder: 'Write a comment…', rows: 2, maxLength: 1000 });
    const send = h('button', { className: 'xmc-rbtn xmc-csend', type: 'button', textContent: 'Reply', disabled: true });
    const note = h('span', { className: 'xmc-dim xmc-cnote' });
    box.addEventListener('input', () => {
      send.disabled = !box.value.trim();
      box.style.height = 'auto';
      box.style.height = Math.min(box.scrollHeight, 180) + 'px';
    });
    const go = async () => {
      const text = box.value.trim();
      if (!text || send.disabled) return;
      send.disabled = true; box.disabled = true; note.textContent = 'Sending…';
      const res = await postReply(t, text);
      box.disabled = false;
      if (res.ok) {
        box.value = ''; box.style.height = 'auto'; note.textContent = 'Sent ✓';
        t.counts.reply += 1; updateActions(t); toast('Reply sent');
        reloadComments(panel, t);
      } else { send.disabled = false; note.textContent = res.why; }
    };
    send.addEventListener('click', go);
    box.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); go(); } });
    return h('div', { className: 'xmc-compose' }, box, h('div', { className: 'xmc-crow' }, note, send));
  }
  async function reloadComments(panel, t) {
    state.details.delete(t.id);
    await sleep(1200); // give X a moment to include the new reply
    if (!panel.isConnected) return;
    panel.replaceChildren(h('div', { className: 'xmc-rhead' }, spinner(), h('span', { textContent: ' Refreshing comments…' })));
    fillReplies(panel, t, await loadReplies(t));
  }
  async function toggleComments(t) {
    const card = t.el;
    if (!card) return;
    const open = card.querySelector('.xmc-replies');
    if (open) { open.remove(); updateActions(t); return; }
    const label = h('span', { textContent: repliesWaiting || state.peek ? ' Waiting for the comments above…' : ' Loading comments…' });
    const panel = h('div', { className: 'xmc-replies' }, h('div', { className: 'xmc-rhead' }, spinner(), label));
    card.querySelector('.xmc-actions').after(panel);
    updateActions(t);
    const res = await loadReplies(t, { wanted: () => panel.isConnected, onStart: () => { label.textContent = ' Loading comments…'; } });
    if (!panel.isConnected) return; // closed while loading
    fillReplies(panel, t, res);
  }

  // ---------- popover menus ----------
  let menuEl = null;
  let menuDismiss = null; // called when the menu is closed without choosing anything
  function closeMenu() {
    const d = menuDismiss; menuDismiss = null;
    if (menuEl) { menuEl.remove(); menuEl = null; if (d) d(); }
  }
  function openMenu(anchor, items, onDismiss) {
    closeMenu();
    const r = anchor.getBoundingClientRect(), rr = root.getBoundingClientRect();
    menuEl = h('div', { className: 'xmc-menu' }, ...items.map(([label, fn]) => h('button', {
      type: 'button', textContent: label, onclick: () => { menuDismiss = null; closeMenu(); fn(); },
    })));
    menuDismiss = onDismiss || null;
    root.append(menuEl);
    const mh = menuEl.offsetHeight;
    const below = r.bottom - rr.top + 6;
    menuEl.style.left = Math.max(8, Math.min(r.left - rr.left, rr.width - 230)) + 'px';
    menuEl.style.top = (below + mh > rr.height ? Math.max(8, r.top - rr.top - mh - 6) : below) + 'px';
  }
  document.addEventListener('mousedown', (e) => { if (menuEl && !menuEl.contains(e.target)) closeMenu(); }, true);

  function muteAccount(handle) {
    const list = XMCSettings.handles(settings.mutedAccounts);
    if (!list.includes(handle.toLowerCase())) list.push(handle.toLowerCase());
    settings.mutedAccounts = list.join(', ');
    save();
    const c = passCtx();
    dropCards((t) => !XMCLogic.passes(t, c));
    view.sig = sigOf(FILTER_KEYS); // already applied in place: don't rebuild the view and lose your place
    toast('Muted @' + handle + ' — manage in settings');
  }
  function muteQuotesOf(t) {
    if (!settings.mutedQuoteIds.includes(t.id)) settings.mutedQuoteIds = settings.mutedQuoteIds.concat(t.id).slice(-500);
    save();
    const c = passCtx();
    dropCards((x) => !XMCLogic.passes(x, c));
    view.sig = sigOf(FILTER_KEYS);
    toast('Hiding quotes of that post');
  }
  function openMore(t, button) {
    openMenu(button, [
      ['Mute @' + t.author.handle, () => muteAccount(t.author.handle)],
      ['Hide quotes of this post', () => muteQuotesOf(t)],
      ['Mute words…', () => openOptions()],
      ['Copy post text', async () => {
        const plain = t.segs.map((s) => (s.t === 'text' ? s.v : s.t === 'url' ? s.href : s.t === 'mention' ? '@' + s.handle : '#' + s.tag)).join('');
        try { await navigator.clipboard.writeText(plain); toast('Copied'); } catch { toast('Couldn’t copy'); }
      }],
      ['Open in a new tab', () => window.open('https://' + location.host + t.url, '_blank', 'noopener')],
    ]);
  }

  // ---------- media: download + viewer ----------
  function collectMedia(t) {
    // posts without media of their own may be quoting one that has some
    const own = t.media.map((m) => ({ m, src: t }));
    if (own.length) return own;
    return t.quoted && !t.quoted.unavailable ? t.quoted.media.map((m) => ({ m, src: t.quoted })) : [];
  }
  const hasMedia = (t) => collectMedia(t).length > 0;
  function mediaFiles(t, only) {
    const out = [];
    for (const [idx, { m, src }] of collectMedia(t).entries()) {
      if (only && m !== only) continue; // just this one (the image viewer)
      const base = (m.thumb.split('/').pop() || '').replace(/\.\w+(\?.*)?$/, '');
      let url, ext2;
      if (m.type === 'photo') {
        ext2 = (/\.(\w{3,4})(\?|$)/.exec(m.thumb) || [])[1] || 'jpg';
        url = `${m.thumb.split('?')[0]}?format=${ext2 === 'png' ? 'png' : 'jpg'}&name=orig`;
      } else {
        const v = m.mp4[0];
        if (!v) continue;
        url = v.url; ext2 = 'mp4';
      }
      out.push({
        url,
        filename: XMCLogic.buildDownloadPath(settings, {
          account: src.author.handle, name: src.author.name, tweetId: src.id, serial: idx + 1, hash: base,
          createdAt: src.createdAt, ext: ext2,
        }),
      });
    }
    return out;
  }
  async function downloadMedia(t, only) {
    const files = mediaFiles(t, only);
    if (!files.length) { toast('Nothing to download here (this video can only stream)'); return; }
    try {
      if (ext && ext.runtime && ext.runtime.sendMessage) {
        const res = await ext.runtime.sendMessage({
          type: 'xmc-download', files, via: settings.aria2Enabled ? 'aria2' : 'browser', saveAs: !!settings.dlAsk,
          aria2: { url: settings.aria2Url, token: settings.aria2Token, dir: settings.aria2Dir },
        });
        if (!res || !res.ok) throw new Error((res && res.error) || 'download failed');
      } else { // plain-page fallback (tests)
        for (const f of files) {
          const blob = await (await fetch(f.url)).blob();
          const a = h('a', { href: URL.createObjectURL(blob), download: f.filename.split('/').pop() });
          document.body.append(a); a.click(); a.remove();
        }
      }
    } catch (err) { console.warn('[xmc] download failed', err); toast('Download failed: ' + (err.message || err)); return; }
    toast(files.length > 1 ? `Downloading ${files.length} files…` : 'Downloading…');
    if (settings.dlHistory) recordDownload(t, files.length);
  }
  function recordDownload(t, n) {
    const src = collectMedia(t)[0].src;
    savedDownloads.set(src.id, { id: src.id, handle: src.author.handle, n, at: Date.now() });
    savedDownloads.set(t.id, { id: t.id, handle: t.author.handle, n, at: Date.now() });
    const list = [...savedDownloads.values()].sort((a, b) => b.at - a.at).slice(0, 5000);
    savedDownloads = new Map(list.map((e) => [e.id, e]));
    if (storage) storage.set({ dlHistory: list }).catch(() => {});
    updateActions(t);
  }

  let lightbox = null;
  function openLightbox(t, start) {
    const photos = t.media.filter((m) => m.type === 'photo');
    if (!photos.length) return;
    closeLightbox();
    const img = h('img', { alt: '' });
    const prev = h('button', { className: 'xmc-lb-nav prev', type: 'button', onclick: (e) => { e.stopPropagation(); stepLightbox(-1); } }, icon('prev'));
    const next = h('button', { className: 'xmc-lb-nav next', type: 'button', onclick: (e) => { e.stopPropagation(); stepLightbox(1); } }, icon('next'));
    const close = h('button', { className: 'xmc-lb-close', type: 'button', title: 'Close (Esc)', onclick: closeLightbox }, icon('close'));
    const tools = h('div', { className: 'xmc-lb-tools', onclick: (e) => e.stopPropagation() },
      h('button', { className: 'xmc-lb-btn', type: 'button', title: 'Download this image', onclick: () => downloadMedia(t, lightbox && lightbox.photos[lightbox.i]) }, icon('download')),
      h('button', { className: 'xmc-lb-btn', type: 'button', title: 'Copy link to the post', onclick: () => copyLink(t) }, icon('link')));
    const el = h('div', { id: 'xmc-lightbox', onclick: closeLightbox }, img, prev, next, close, tools);
    img.addEventListener('click', (e) => e.stopPropagation());
    lightbox = { el, img, photos, i: start, prev, next };
    document.body.append(el);
    document.documentElement.classList.add('xmc-viewer'); // lets the page hook route Escape/arrows to us
    stepLightbox(0);
  }
  function stepLightbox(d) {
    if (!lightbox) return;
    const L = lightbox;
    L.i = Math.max(0, Math.min(L.photos.length - 1, L.i + d));
    L.img.src = photoUrl(L.photos[L.i].thumb, 'large');
    L.prev.hidden = L.i === 0; L.next.hidden = L.i === L.photos.length - 1;
  }
  function closeLightbox() {
    if (lightbox) { lightbox.el.remove(); lightbox = null; }
    document.documentElement.classList.remove('xmc-viewer');
  }

  // ---------- translation ----------
  // X translates a post when you press its "Translate post" link. We press it on X's own copy of the post, out of sight,
  // and show the result under the original. (Only works when X offers it, and the link is matched by its English wording.)
  const uiLang = () => String(document.documentElement.lang || navigator.language || 'en').slice(0, 2).toLowerCase();
  const needsTranslation = (t) => !!t.lang && !/^(und|qme|qht|qam|qst|zxx|art)$/.test(t.lang) && t.lang.slice(0, 2).toLowerCase() !== uiLang();
  const langName = (code) => { try { return new Intl.DisplayNames([uiLang()], { type: 'language' }).of(code) || code; } catch { return code.toUpperCase(); } };
  // The translation replaces the post's text, as on X, with a line to get the original back.
  function showTranslation(t, cardEl) {
    const textEl = cardEl.querySelector(':scope > .xmc-text');
    const button = cardEl.querySelector('.xmc-translate');
    if (button) button.remove();
    if (!textEl || cardEl.querySelector('.xmc-trans')) return;
    const box = h('div', { className: 'xmc-trans' },
      h('div', { className: 'xmc-text', textContent: t.translation }),
      h('button', { className: 'xmc-translabel', type: 'button', textContent: 'Translated from ' + langName(t.lang) + ' \u00b7 Show original' }));
    textEl.before(box);
    textEl.hidden = true;
    const more = cardEl.querySelector('.xmc-more'); if (more) more.hidden = true;
  }
  function toggleTranslation(cardEl, label) {
    const textEl = cardEl.querySelector(':scope > .xmc-text'), box = cardEl.querySelector('.xmc-trans');
    const t = tweetOf.get(cardEl);
    if (!textEl || !box || !t) return;
    const wasOriginal = !textEl.hidden;
    textEl.hidden = wasOriginal;               // original shown -> hide it and show the translation
    box.firstChild.hidden = !wasOriginal;
    label.textContent = wasOriginal ? 'Translated from ' + langName(t.lang) + ' \u00b7 Show original' : 'Show translation';
  }
  async function translatePost(t, cardEl, button) {
    button.disabled = true; button.textContent = 'Translating...';
    t.transBusy = true;
    const res = t.translation ? { translation: t.translation } : await loadReplies(t, { translate: true });
    t.transBusy = false;
    button.disabled = false;
    if (!res || !res.translation) { button.textContent = 'Translate post'; toast('X didn\u2019t offer a translation for this post.'); return; }
    t.translation = res.translation;
    showTranslation(t, cardEl);
  }

  // Automatically, like X: translate posts in other languages once they've been on screen for a moment, one at a time
  // and not while comments are loading (each one is two quick requests on X's hidden side, so it is paced).
  const autoPending = new Set();
  const autoLog = [];
  let autoLast = 0;
  const translateObserver = new IntersectionObserver((entries) => {
    for (const en of entries) {
      const card = en.target.closest('.xmc-card'), t = card && tweetOf.get(card);
      if (!t) continue;
      if (en.intersectionRatio >= 0.5) { if (!t.visibleSince) t.visibleSince = Date.now(); autoPending.add(t); }
      else { t.visibleSince = 0; autoPending.delete(t); }
    }
  }, { threshold: [0, 0.5] });
  function autoTranslateTick() {
    if (!settings.autoTranslate || !autoPending.size) return;
    const now = Date.now();
    if (state.peek || repliesWaiting || state.posting || state.fail || now < state.proxyUntil || now - autoLast < 2200) return;
    while (autoLog.length && now - autoLog[0] > 60000) autoLog.shift();
    if (autoLog.length >= 10) return; // at most ten a minute
    const t = [...autoPending].find((x) => x.visibleSince && now - x.visibleSince > 700 && !x.translation && !x.transBusy && (x.transTries || 0) < 2 && x.el && x.el.isConnected);
    if (!t) return;
    autoLast = now; autoLog.push(now);
    t.transBusy = true;
    const btn = t.el.querySelector('.xmc-translate');
    if (btn) btn.textContent = 'Translating...';
    loadReplies(t, { translate: true, wanted: () => !!(t.el && t.el.isConnected) }).then((res) => {
      t.transBusy = false;
      if (res && res.translation) { t.translation = res.translation; autoPending.delete(t); if (t.el) showTranslation(t, t.el); }
      else { t.transTries = (t.transTries || 0) + 1; if (t.transTries >= 2) autoPending.delete(t); const b = t.el && t.el.querySelector('.xmc-translate'); if (b) b.textContent = 'Translate post'; }
    });
  }

  // ---------- clicks on cards ----------
  async function copyLink(t) {
    try { await navigator.clipboard.writeText('https://x.com' + t.url); toast('Link copied'); } catch { toast('Couldn\u2019t copy the link'); }
  }
  // Download and Copy-link buttons on X's own posts (a post's own page, or anywhere the columns aren't showing)
  function decorateNative() {
    if (!settings.nativeTools) return;
    const col = mainCol();
    if (!col) return;
    for (const art of col.querySelectorAll('article[data-testid="tweet"]')) {
      const id = articleId(art);
      if (!id) continue;
      let wrap = art.querySelector('.xmc-nat');
      const t = state.byId.get(id);
      if (!wrap) {
        const replyBtn = art.querySelector('[data-testid="reply"]');
        const bar = replyBtn && replyBtn.closest('[role="group"]');
        if (!bar) continue;
        const stop = (e) => e.stopPropagation(); // pressing it must not also open the post
        const mk = (cls, title, ico, fn) => {
          const b = h('button', { type: 'button', className: 'xmc-nat-btn ' + cls, title, ariaLabel: title }, icon(ico));
          b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); fn(); });
          for (const ev of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) b.addEventListener(ev, stop);
          return b;
        };
        const live = () => state.byId.get(id);
        wrap = h('div', { className: 'xmc-nat' },
          mk('dl', 'Download the media in this post', 'download', () => { const p = live(); if (p) downloadMedia(p); else toast('Open the post once so the extension can see it'); }),
          mk('lnk', 'Copy link to this post', 'link', () => copyLink(live() || { url: '/i/status/' + id })));
        bar.append(wrap);
      }
      const dl = wrap.querySelector('.dl');
      const has = !!(t && t.media && t.media.length);
      if (dl.hidden === has) dl.hidden = !has;
    }
  }
  async function composeReply(t) {
    const ok = await withReal(t, (art) => { const b = art.querySelector('[data-testid="reply"]'); if (b) fire(b); });
    if (!ok) navigate(t.url, t);
  }
  async function act(t, kind, button) {
    switch (kind) {
      case 'like': return toggleAction(t, 'liked', '[data-testid="like"]', '[data-testid="unlike"]', 'like');
      case 'bookmark': return toggleAction(t, 'bookmarked', '[data-testid="bookmark"]', '[data-testid="removeBookmark"]', 'bookmark');
      case 'repost':
        return openMenu(button, [[t.state.reposted ? T('undo') : T('repost'), () => repost(t, false)], [T('quote'), () => repost(t, true)]]);
      case 'reply': return toggleComments(t);
      case 'compose': return composeReply(t);
      case 'conversation': return navigate(t.url, t);
      case 'share': return copyLink(t);
      case 'download': return downloadMedia(t);
      case 'more': return openMore(t, button);
      default: return undefined;
    }
  }
  colsEl.addEventListener('click', (e) => {
    const cardEl = e.target.closest('.xmc-card');
    const t = cardEl && tweetOf.get(cardEl);
    if (!t) return;
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return; // let the browser open links in a new tab/window
    const actBtn = e.target.closest('[data-act]');
    if (actBtn) { e.preventDefault(); e.stopPropagation(); act(t, actBtn.dataset.act, actBtn); return; }
    if (e.target.closest('.xmc-rclose')) { const p = cardEl.querySelector('.xmc-replies'); if (p) p.remove(); updateActions(t); return; }
    if (e.target.closest('.xmc-replies')) return; // links inside comments open normally (new tab); clicking text doesn't open the post
    const tr = e.target.closest('.xmc-translate');
    if (tr) { e.preventDefault(); translatePost(t, cardEl, tr); return; }
    const tl = e.target.closest('.xmc-translabel');
    if (tl) { e.preventDefault(); toggleTranslation(cardEl, tl); return; }
    const reveal = e.target.closest('.xmc-reveal');
    if (reveal) { reveal.parentElement.classList.remove('sensitive'); reveal.remove(); return; }
    const more = e.target.closest('.xmc-more');
    if (more) { cardEl.querySelector('.xmc-text').classList.remove('clamp'); more.remove(); return; }
    const photo = e.target.closest('[data-lb]');
    if (photo) { e.preventDefault(); if (!photo.closest('.sensitive')) openLightbox(t, Number(photo.dataset.lb)); return; }
    if (e.target.closest('video, .xmc-gif')) return; // native player controls
    const nav = e.target.closest('a.xmc-nav');
    if (nav) { e.preventDefault(); navigate(nav.getAttribute('href'), t); return; }
    if (e.target.closest('a[href]')) return; // external link: new tab (target=_blank)
    if (String(getSelection())) return;
    const quote = e.target.closest('.xmc-quote[data-href]');
    if (quote) { if (settings.openIn === 'newtab') window.open(new URL(quote.dataset.href, location.origin).href, '_blank', 'noopener'); else location.assign(quote.dataset.href); return; }
    navigate(t.url, t);
  });
  // Hovering the comments button starts fetching them, so they are often there by the time you click
  const prefetching = new Set();
  colsEl.addEventListener('pointerover', (e) => {
    const b = e.target.closest && e.target.closest('[data-act="reply"]');
    if (!b) return;
    const card = b.closest('.xmc-card');
    const t = card && tweetOf.get(card);
    if (Date.now() - lastScrollAt < 600) return; // content scrolling under a resting pointer fires "hover" too: not a real hover
    if (!t || !t.counts.reply || state.details.has(t.id) || prefetching.has(t.id) || state.peek || repliesWaiting || state.posting) return;
    prefetching.add(t.id);
    loadReplies(t).finally(() => prefetching.delete(t.id));
  });
  // only one (non-autoplaying) video plays at a time, and it is watched while it plays so it stops when scrolled away
  colsEl.addEventListener('play', (e) => {
    if (e.target.tagName !== 'VIDEO' || e.target.dataset.gif) return;
    for (const v of colsEl.querySelectorAll('video')) if (v !== e.target && !v.dataset.gif) v.pause();
    playObserver.observe(e.target);
  }, true);
  colsEl.addEventListener('pause', (e) => { if (e.target.tagName === 'VIDEO' && !e.target.dataset.gif) playObserver.unobserve(e.target); }, true);
  colsEl.addEventListener('ended', (e) => { if (e.target.tagName === 'VIDEO' && !e.target.dataset.gif) playObserver.unobserve(e.target); }, true);

  // ---------- tabs (For you / Following, Top / Latest, Posts / Replies...) ----------
  let lastSig = '';
  const realTabs = () => {
    const tl = document.querySelector('[data-testid="primaryColumn"] [role="tablist"]');
    return tl ? [...tl.querySelectorAll('[role="tab"]')] : [];
  };
  function selectedIndex(tabs) {
    const sel = tabs.findIndex((tab) => tab.getAttribute('aria-selected') === 'true');
    if (sel >= 0) return sel;
    const weight = (tab) => { // extensions that add tabs don't always set aria-selected
      let n = tab;
      while (n.firstElementChild) n = n.firstElementChild;
      return parseInt(getComputedStyle(n).fontWeight, 10) || 400;
    };
    const bold = tabs.map((tab, i) => [i, weight(tab)]).filter(([, w]) => w >= 700).map(([i]) => i);
    return bold.length === 1 ? bold[0] : -1;
  }
  // user (or a rule below) picks tab i: wait for that feed, never guess
  function switchTab(i, anchor) {
    const live = realTabs()[i];
    if (!live) return;
    const rk = routeKey();
    const again = i === state.sel && live.getAttribute('aria-selected') === 'true'; // pressing the tab you are on may open X's dropdown
    const before = { cur: state.cur, awaiting: state.awaiting };
    const cached = state.feedByTab.has(slotFor(i));
    state.awaiting = { until: Date.now() + 2500, cached };
    state.cur = { route: rk, key: null };
    state.sel = i;
    state.switchTries = (state.switchTries || 0) + 1;
    if (again) document.documentElement.classList.add('xmc-acting'); // keep X's menu from flashing while we look
    if (state.switchTries % 2 === 1) live.click(); else fire(live); // retries press it the way a mouse would
    lastSig = '';
    if (again) tabMenu(i, anchor, before);
  }

  // Some of X's tabs open a dropdown when pressed again (the profile's Videos tab: Videos / Photos; Following:
  // Popular / Recent). X draws it over the hidden page, in the wrong place, so read it and offer the same choices
  // in a menu of our own, pressing the real item for you.
  const findXMenu = () => [...document.querySelectorAll('[role="menu"]')].find((m) => m.querySelector('[role="menuitem"]'));
  const menuText = (el) => el.textContent.trim().replace(/\s+/g, ' ');
  const releaseLayers = () => setTimeout(() => document.documentElement.classList.remove('xmc-acting'), 600);
  function closeXMenu() {
    const m = findXMenu();
    if (m) {
      for (const t of [m, document.activeElement, document.body]) {
        if (t) t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true }));
      }
      setTimeout(() => { const still = findXMenu(); const mask = still && document.querySelector('#layers [data-testid="mask"]'); if (mask) fire(mask); }, 250);
    }
    releaseLayers();
  }
  async function tabMenu(i, anchor, before) {
    const menu = await waitFor(findXMenu, 700);
    if (!menu) { releaseLayers(); return; } // no dropdown: it was an ordinary second press
    state.menuTabs.add(routeKey() + '|' + i);
    state.awaiting = before.awaiting; state.cur = before.cur; // pressing it again does not change the feed
    lastSig = '';
    const items = [...menu.querySelectorAll('[role="menuitem"]')];
    const svgs = items.map((el) => el.querySelectorAll('svg').length);
    const base = Math.min(...svgs);
    const picked = subFor(i);
    const list = items.map((el, k) => {
      const text = menuText(el);
      const checked = picked ? text.toLowerCase() === picked : svgs[k] > base; // X marks the current one with a tick
      return { text, checked };
    });
    const at = anchor && anchor.isConnected ? anchor : tabsEl.querySelector('.on') || tabsEl.firstElementChild || root;
    openMenu(at, list.map(({ text, checked }) => [(checked ? '\u2713\u2002' : '\u2003\u2002') + text, () => pickTabItem(i, text, checked)]), closeXMenu);
  }
  function pickTabItem(i, text, alreadyCurrent) {
    const rk = routeKey();
    if (alreadyCurrent) { closeXMenu(); return; }
    const el = [...(findXMenu() || document).querySelectorAll('[role="menuitem"]')].find((m) => menuText(m) === text);
    if (!el) { toast('X\u2019s menu closed \u2014 press the tab again'); releaseLayers(); return; }
    state.sub[rk + '|' + i] = text.toLowerCase();
    state.cur = { route: rk, key: null };
    state.awaiting = { until: Date.now() + 6000, cached: state.feedByTab.has(slotFor(i)) };
    fire(el);
    lastSig = '';
    releaseLayers();
  }
  // X's own Videos / Photos switch (the profile Media tab), without opening anything on screen
  async function pickMediaKind(kind) {
    const tabs = realTabs();
    const i = tabs.findIndex((tb) => /^(media|videos|photos)$/i.test(tb.textContent.trim()));
    if (i < 0 || subFor(i) === kind.toLowerCase()) return;
    document.documentElement.classList.add('xmc-acting');
    const live = tabs[i];
    if (i !== state.sel) { switchTab(i); await sleep(500); }
    fire(live);
    const menu = await waitFor(findXMenu, 1500);
    if (!menu) { toast('X didn\u2019t offer that choice just now \u2014 try again'); releaseLayers(); return; }
    pickTabItem(i, [...menu.querySelectorAll('[role="menuitem"]')].map(menuText).find((tx) => tx.toLowerCase() === kind.toLowerCase()) || kind, false);
  }
  function syncTabs() {
    const tabs = realTabs();
    if (tabs.length) { // keep the last known selection if X is momentarily redrawing its tabs
      const sel = selectedIndex(tabs);
      if (sel >= 0) state.sel = sel;
    }
    const hideForYou = settings.hideForYou && where() === 'home';
    const sig = tabs.map((tab) => tab.textContent).join('|') + '#' + state.sel + '#' + hideForYou + '#' + state.menuTabs.size;
    if (sig === lastSig) return;
    lastSig = sig;
    tabsEl.replaceChildren(...tabs.map((tab, i) => {
      if (hideForYou && i === 0) return null;
      const label = tab.textContent.trim();
      const dropdown = /^(videos|photos)$/i.test(label) || state.menuTabs.has(routeKey() + '|' + i);
      const b = btn(label + (dropdown ? ' \u25be' : ''), '', () => switchTab(i, b));
      b.classList.toggle('on', i === state.sel);
      return b;
    }).filter(Boolean));
  }
  // "Following by default", "keep me on Following", "Search on Latest"
  function tabRules() {
    const tabs = realTabs();
    if (tabs.length < 2) return;
    const w = where();
    const now = Date.now();
    if (w === 'home') {
      const wantFollowing = settings.homeDefault === 'following' || settings.hideForYou;
      if (!state.homeInit) {
        state.homeInit = true;
        if (wantFollowing && state.sel === 0) { state.homeHold = true; setTimeout(() => { state.homeHold = false; }, 3500); switchTab(1); }
        else if (settings.homeDefault === 'forYou' && !settings.hideForYou && state.sel === 1) switchTab(0);
      } else if (settings.keepFollowing && wantFollowing && state.sel === 0 && now - state.lastKeep > 3000 && !state.awaiting) {
        state.lastKeep = now;
        switchTab(1);
      }
      if (state.homeHold && state.sel === 1 && !state.awaiting) state.homeHold = false;
    } else if (w === 'search' && settings.searchLatest && state.searchInit !== location.search) {
      state.searchInit = location.search;
      if (!/[?&]f=/.test(location.search) && state.sel === 0) switchTab(1);
    }
  }

  // ---------- X's sidebars ----------
  // Left: X centers its layout; pin its nav to the left edge so the columns get the room. Right: X's own
  // sidebar (search, trends...) is kept, pinned to the right edge, unless you've turned it off.
  // If pinning ever leaves either unclickable we fall back (for a while) to where X put it.
  const pin = {
    nav: { el: () => document.querySelector('header[role="banner"]'), width: 0, fails: 0, fallback: false, retryAt: 0 },
    side: { el: () => document.querySelector('[data-testid="sidebarColumn"]'), width: 0, fails: 0, fallback: false, retryAt: 0 },
  };
  function navMeasure(nav) { // bounding box of the nav's links (the <header> itself is wider than what you see)
    const acct = nav.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]');
    let minL = Infinity, maxR = -Infinity;
    for (const n of nav.querySelectorAll('a, button, [role="button"]')) {
      if (acct && acct.contains(n)) continue;
      if (getComputedStyle(n).display === 'none') continue;
      const b = n.getBoundingClientRect();
      if (!b.width || !b.height) continue;
      minL = Math.min(minL, b.left); maxR = Math.max(maxR, b.right);
    }
    if (minL === Infinity) { const b = nav.getBoundingClientRect(); minL = b.left; maxR = b.right; }
    return { minL, maxR };
  }
  function unpin(which) {
    const el = pin[which].el();
    if (!el || el.dataset.xmcStyle === undefined) return;
    if (el.dataset.xmcStyle) el.setAttribute('style', el.dataset.xmcStyle); else el.removeAttribute('style');
    delete el.dataset.xmcStyle;
    if (which === 'nav') {
      const acct = el.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]');
      if (acct) { acct.style.maxWidth = ''; acct.style.overflow = ''; }
    }
  }
  const navRestore = () => { unpin('nav'); unpin('side'); };
  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    navRestore(); // X may swap layouts; re-measure
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (!root.hidden) { guard('position', position); if (!settings.cols && colCount() !== columns.length) relayout(); } }, 120);
  });

  // Is something we pinned still what you'd click? A probe that is off screen (or missing) says nothing, so it is not a
  // failure: counting it as one made the sidebar fall back to X's own spot for 10s and jump.
  function probeOk(b, container) {
    if (!b || !b.width || b.top < 0 || b.bottom > innerHeight || b.left < 0 || b.right > innerWidth) return true;
    const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    return !hit || container.contains(hit) || !!hit.closest('#layers');
  }
  function positionNav() {
    const p = pin.nav, nav = p.el();
    if (!nav) { root.style.left = '0px'; return; }
    if (p.fallback && Date.now() > p.retryAt) { p.fallback = false; p.fails = 0; }
    if (p.fallback) { root.style.left = (navMeasure(nav).maxR + 20) + 'px'; return; }
    const acct = nav.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]');
    if (nav.dataset.xmcStyle === undefined) {
      const m = navMeasure(nav);
      const r = nav.getBoundingClientRect();
      nav.dataset.xmcStyle = nav.getAttribute('style') || '';
      p.width = Math.round(m.maxR - m.minL);
      nav.style.cssText += `;position:fixed !important;top:0 !important;height:100vh !important;margin:0 !important;` +
        `transform:none !important;z-index:6 !important;width:${Math.round(r.width)}px !important;` +
        `left:${Math.round(-(m.minL - r.left))}px !important`;
      if (acct) { acct.style.maxWidth = p.width + 'px'; acct.style.overflow = 'hidden'; }
    } else {
      const link = nav.querySelector('a[href="/home"], a[href^="/notifications"]');
      const b = link && link.getBoundingClientRect();
      const ok = probeOk(b, nav);
      p.fails = ok ? 0 : p.fails + 1;
      if (p.fails >= 3) { p.fallback = true; p.retryAt = Date.now() + 10000; unpin('nav'); return; }
    }
    root.style.left = (p.width + 20) + 'px';
  }
  function positionSide() {
    const p = pin.side, side = p.el();
    if (!side || settings.hideSidebar) { root.style.right = '0px'; unpin('side'); return; }
    if (p.fallback && Date.now() > p.retryAt) { p.fallback = false; p.fails = 0; }
    if (side.dataset.xmcStyle === undefined) {
      const r = side.getBoundingClientRect();
      if (!r.width) { root.style.right = '0px'; return; } // X hides it on narrow windows
      if (p.fallback) { root.style.right = Math.max(0, innerWidth - r.left + 12) + 'px'; return; }
      side.dataset.xmcStyle = side.getAttribute('style') || '';
      p.width = Math.round(r.width);
      side.style.cssText += `;position:fixed !important;top:0 !important;right:8px !important;left:auto !important;height:100vh !important;` +
        `overflow-y:auto !important;scrollbar-width:none !important;margin:0 !important;z-index:6 !important;width:${p.width}px !important`;
    } else if (!p.fallback) {
      // probe whichever of its links is on screen right now (the sidebar scrolls, so the first one often isn't)
      const probe = [...side.querySelectorAll('input, a[href]')].find((el) => { const r = el.getBoundingClientRect(); return r.width && r.top >= 0 && r.bottom <= innerHeight; });
      const b = probe && probe.getBoundingClientRect();
      const ok = probeOk(b, side);
      p.fails = ok ? 0 : p.fails + 1;
      if (p.fails >= 3) { p.fallback = true; p.retryAt = Date.now() + 10000; unpin('side'); root.style.right = '0px'; return; }
    }
    root.style.right = (p.width + 8 + 16) + 'px';
  }

  // Which sidebar entries exist right now; remembered so the settings page can offer to hide any of them.
  function scanNavItems() {
    const items = XMCSite.sidebarItems();
    if (!items.length) return;
    const known = new Map(settings.navItems.map((i) => [i.key, i]));
    let changed = false;
    for (const it of items) {
      const k = known.get(it.key);
      if (!k || k.label !== it.label) { known.set(it.key, it); changed = true; }
    }
    if (changed) { settings.navItems = [...known.values()].slice(0, 60); save(); }
  }

  // X's floating buttons (Grok, messages) sit under our columns. They are removed (the sidebar already has both);
  // anything else floating gets a hole cut in the columns so it stays visible and clickable.
  let lastScan = 0;
  const GROK_SEL = '[data-testid*="grok" i], [aria-label*="grok" i], a[href="/i/grok"]';
  const DM_SEL = '[data-testid*="dmdrawer" i], [aria-label*="message" i], [aria-label*="chat" i], a[href="/messages"], a[href="/i/chat"]';
  function wrapperBelow(container, el, other) { // the outermost element holding `el` but not `other`, inside `container`
    let n = el;
    while (n.parentElement && n.parentElement !== container && !(other && n.parentElement.contains(other))) n = n.parentElement;
    return n;
  }
  function scanFloaters() {
    if (Date.now() - lastScan < 1500) return;
    lastScan = Date.now();
    const rr = document.getElementById('react-root');
    const main = mainCol();
    const nav = pin.nav.el();
    const side = pin.side.el();
    if (!rr) return;
    const rects = [];
    for (const d of rr.querySelectorAll('div')) {
      if (main && (main.contains(d) || d.contains(main))) continue;
      if ((nav && nav.contains(d)) || (side && (side.contains(d) || d.contains(side)))) continue;
      if (getComputedStyle(d).position !== 'fixed') continue;
      const r = d.getBoundingClientRect();
      if (!r.width || r.width > 450 || r.height > 450 || r.bottom < innerHeight * 0.4) continue;
      const g = d.matches(GROK_SEL) ? d : d.querySelector(GROK_SEL);
      const m = d.matches(DM_SEL) ? d : d.querySelector(DM_SEL);
      if (g || m) {
        if (g) (g === d ? d : wrapperBelow(d, g, m)).dataset.xmcGrok = '1';
        if (m && m !== g) (m === d ? d : wrapperBelow(d, m, g)).dataset.xmcDm = '1';
        if ((!g || settings.hideGrokDrawer) && (!m || settings.hideDmDrawer)) continue; // all of it is being removed
      }
      if (rects.some((o) => r.left >= o.left && r.right <= o.right && r.top >= o.top && r.bottom <= o.bottom)) continue;
      rects.push(r);
    }
    state.floaters = rects.length;
    const rb = root.getBoundingClientRect();
    if (root.hidden || !rb.width) return;
    const keep = rects.filter((r) => r.right >= rb.left && r.left <= rb.right);
    if (!keep.length) { root.style.clipPath = ''; return; }
    const holes = keep.map((r) => {
      const x = Math.round(r.left - rb.left - 4), y = Math.round(r.top - rb.top - 4);
      return `M${x} ${y}h${Math.round(r.width) + 8}v${Math.round(r.height) + 8}h-${Math.round(r.width) + 8}Z`;
    }).join('');
    root.style.clipPath = `path(evenodd, 'M0 0H${Math.round(rb.width)}V${Math.round(rb.height)}H0Z${holes}')`;
  }

  // ---------- main loop ----------
  function position() {
    positionNav();
    positionSide();
    const cs = getComputedStyle(document.body);
    // use the sidebar's own label font ("Home"); the sans fallbacks keep it from ever dropping to serif
    const nav = pin.nav.el();
    const label = nav && ([...nav.querySelectorAll('span')].find((s) => s.textContent.trim() === 'Home') || nav.querySelector('span'));
    root.style.fontFamily = settings.systemFont ? 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
      : `${getComputedStyle(label || document.body).fontFamily}, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
    const clear = (c) => !c || c === 'transparent' || /,\s*0\)$/.test(c);
    let bg = [document.body, document.documentElement].map((el) => getComputedStyle(el).backgroundColor).find((c) => !clear(c));
    if (!bg) { // nothing opaque found: pick black or white from the text colour
      const m = /(\d+)[, ]+(\d+)[, ]+(\d+)/.exec(cs.color || '');
      bg = m && (0.299 * m[1] + 0.587 * m[2] + 0.114 * m[3]) > 140 ? 'rgb(0, 0, 0)' : 'rgb(255, 255, 255)';
    }
    for (const el of [root, toastEl, document.documentElement]) {
      el.style.setProperty('--xmc-bg', cs.backgroundColor); // exactly what X's page has: may be see-through (a themed or wallpaper background shows through the columns)
      el.style.setProperty('--xmc-solid', bg);              // for things that must stay readable over anything: menus, toast, the loading pill
      el.style.setProperty('--xmc-fg', cs.color);
    }
  }

  const guard = (name, fn) => { try { fn(); } catch (err) { console.error('[xmc]', name, err); } };
  let tickN = 0;
  let wasActive = false;
  const tickTimes = []; // how long our own work took recently (to tell our slowness from X's)
  function tick() {
    if (!ready) return;
    if (tickN % 20 === 0) { guard('site', () => XMCSite.refresh()); guard('sidebar items', scanNavItems); }
    if (tickN % 15 === 0) guard('floaters', scanFloaters);
    const quiet = state.posting && isModalRoute(); // our own reply automation: X's reply box is open, out of sight
    const modal = isModalRoute() && state.shown && !state.posting;
    const peeking = (!!state.peek && onPostPage()) || quiet; // X's hidden page is busy for us; our columns stay
    const okNow = (eligible() || modal || peeking) && !!mainCol();
    if (okNow) state.lastOk = Date.now();
    // X briefly has no main column while it swaps pages (e.g. while we fetch comments); hold on for a moment instead of
    // dropping the overlay, which is what made the page flash
    const ok = okNow || (state.shown && (eligible() || peeking) && Date.now() - (state.lastOk || 0) < 1500);
    const route = routeKey();
    const active = ok && state.failed !== route;
    state.shown = active;
    if (!active) { navRestore(); wasActive = false; }
    document.documentElement.classList.toggle('xmc-on', active);
    root.hidden = !active;
    root.classList.toggle('xmc-under', modal);
    const pillShown = eligible() || canTry();
    if (pillShown) placePill();
    updatePill(pillShown, active);
    document.documentElement.classList.toggle('xmc-onpost', onPostPage());
    if (!active) {
      if (tickN % 4 === 0) guard('native tools', decorateNative);
      tickN++; if (!modal) { state.route = ''; state.homeInit = false; } return;
    }
    if (!wasActive) { wasActive = true; setTimeout(focusScroller, 50); setTimeout(() => { if (view.memoTop) scroller.scrollTop = view.memoTop; }, 60); } // back to the exact spot
    if (scroller.scrollTop > 0) view.memoTop = scroller.scrollTop; // belt and braces: scroll events don't fire in every situation
    if (modal || peeking) { if (tickN++ % 5 === 0) guard('position', position); return; }
    // new page: reset per-page bookkeeping BEFORE the rules below can start waiting for a feed
    if (route !== state.route) {
      state.route = route; state.routeSince = Date.now(); state.waitingPage = false; state.waitSince = 0;
      state.awaiting = null; state.refreshing = null; lastSig = ''; state.sub = {}; applyBar(); // X resets its dropdowns on a new page
    }
    if (tickN % 5 === 2) { guard('auto translate', autoTranslateTick); guard('hidden videos', stopHiddenVideos); }
    if (tickN++ % 5 === 0) {
      guard('position', position);
      guard('tabs', syncTabs);
      guard('tab rules', tabRules);
      guard('bar', applyBar);
    }
    const f = activeFeed();
    if (document.hidden) state.routeSince = Date.now(); // don't count time spent in a background tab
    if (!(f && f.items.length) && !(settings.disableHome && where() === 'home') && Date.now() - state.routeSince > 10000) {
      // No timeline data arrived (X changed its format, or the feed really is empty): show the normal feed.
      console.warn('[xmc] no timeline data after 10s; showing the normal feed. Seen:', JSON.stringify(state.seenOps),
        'feeds:', [...state.feeds.keys()]);
      state.failed = route; state.failedBy = 'error';
      return;
    }
    guard('render', renderFeed);
    guard('pump', pump);
  }

  window.__xmc = { state, settings, view, diagnostics, autoPending, downloads: () => savedDownloads }; // for debugging from the console

  loadAll().then(() => {
    ready = true;
    settingsChanged();
    setInterval(() => { const t0 = performance.now(); guard('tick', tick); tickTimes.push(performance.now() - t0); if (tickTimes.length > 50) tickTimes.shift(); }, TICK_MS);
  });
})();
