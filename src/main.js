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
  // SHELVED: post size (Compact / Text only). The code and tests stay, but the Compact layout is wrong, so it is switched off:
  // no setting, no top-bar button, and the size is always Normal. Set to false (and un-hide `density` in settings.js) to bring it back.
  const DENSITY_SHELVED = true;
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
      loadSeen(storage ? v.seenPosts : JSON.parse(localStorage.getItem('xmc.seen') || '[]'));
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
      for (const k in changes) if (k !== 'dlHistory' && k !== 'seenPosts') next[k] = changes[k].newValue;
      if (changes.seenPosts) mergeSeen(changes.seenPosts.newValue);
      if (Object.keys(next).length || changes.dlHistory) onExternalChange(next, changes.dlHistory ? changes.dlHistory.newValue : undefined);
    });
  } else {
    window.addEventListener('storage', (e) => {
      if (e.key === 'xmc.settings') { try { onExternalChange(JSON.parse(e.newValue || '{}')); } catch { /* ignore */ } }
      if (e.key === 'xmc.seen') { try { mergeSeen(JSON.parse(e.newValue || '[]')); } catch { /* ignore */ } }
    });
  }

  // names that change with the Twitter/X branding setting
  const STR = {
    x: { repost: 'Repost', reposted: 'reposted', reposts: 'Reposts', posts: 'Posts', quote: 'Quote', undo: 'Undo repost', quotes: 'Quotes' },
    twitter: { repost: 'Retweet', reposted: 'retweeted', reposts: 'Retweets', posts: 'Tweets', quote: 'Quote Tweet', undo: 'Undo Retweet', quotes: 'Quote Tweets' },
  };
  const T = (k) => STR[settings.branding === 'twitter' ? 'twitter' : 'x'][k];

  // ---------- routes ----------
  // Explore (and its Trending, News, Sports, Entertainment tabs) is mostly Today's News, trends and "Who to follow", with
  // posts only at the bottom: columns of posts would hide most of what's there. X's page is left alone, with a pill to
  // try columns anyway.
  const isExploreSub = (p) => p === '/explore' || p.startsWith('/explore/');
  const canTry = () => isExploreSub(location.pathname.replace(/\/+$/, '') || '/');
  function eligible() {
    const p = location.pathname.replace(/\/+$/, '') || '/';
    if (p === '/home' || p === '/search' || p === '/i/bookmarks' || p.startsWith('/i/lists/')) return true;
    if (isExploreSub(p)) return state.trial === routeKey(); // Explore: X's own page unless you press the Columns pill
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
    subDefault: {},           // route|tab -> the dropdown item X was on before the first pick (its feed is the one with no suffix)
    loadedAt: Date.now(),
    sub: {},                  // route|tab -> the item picked from that tab's dropdown (Videos/Photos, Popular/Recent...), lower case
    byId: new Map(),          // post id -> post, for every post seen (so buttons on X's own pages know a post's media)
    menuTabs: new Set(),      // route|tab that turned out to have a dropdown
    actionFails: [],          // when a like / repost / bookmark couldn't reach X's button (for the health check)
    commentFails: [],         // when comments couldn't be loaded
    health: [],               // what the health check currently sees wrong
    showSeen: false,          // you asked to see the posts you've read (this page only)
    listNames: new Map(),     // list id -> its name (read from what X sends when a list page opens)
    profiles: new Map(),      // handle (lower case) -> a profile's header (read from what X sends when a profile opens)
  };
  function remember(list) {
    for (const t of list) { if (t && t.id) { state.byId.delete(t.id); state.byId.set(t.id, t); } }
    while (state.byId.size > 4000) state.byId.delete(state.byId.keys().next().value);
  }

  // X sends a list's name when a list page opens (the tab title it sets itself just says "List")
  function noteList(op, body) {
    const data = body && body.data;
    if (!data || typeof data !== 'object' || !/^List/.test(op || '')) return;
    for (const v of Object.values(data)) {
      if (v && typeof v === 'object' && typeof v.name === 'string' && v.name && /^\d+$/.test(String(v.id_str || v.rest_id || ''))) {
        state.listNames.set(String(v.id_str || v.rest_id), v.name.slice(0, 100));
        while (state.listNames.size > 100) state.listNames.delete(state.listNames.keys().next().value);
      }
    }
  }
  function onResponse(url, body, reqBody) {
    const op = XMCParse.opOf(url);
    if (op) state.seenOps[op] = (state.seenOps[op] || 0) + 1;
    try { noteList(op, body); } catch { /* not a list */ }
    if (/^User(Result)?By/.test(op || '')) {
      try {
        const p = XMCParse.parseProfile(body);
        if (p) { state.profiles.set(p.handle.toLowerCase(), p); while (state.profiles.size > 50) state.profiles.delete(state.profiles.keys().next().value); }
      } catch { /* not a profile */ }
    }
    const isConversation = op === 'TweetDetail' || !!(body && body.data && body.data.threaded_conversation_with_injections_v2);
    if (isConversation) {
      const d = XMCParse.parseDetail(body, url, reqBody, state.peek ? state.peek.id : idOfHref(location.pathname));
      if (d) {
        state.details.set(d.focalId, d); if (state.peek && state.peek.id === d.focalId) state.peek.replies = d;
        while (state.details.size > 200) state.details.delete(state.details.keys().next().value);
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
      foldSeen();
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
    queueMicrotask(() => { if (state.shown && !state.peek && !state.posting && !onPostPage()) guard('pump', pump); }); // ask for the next page now, not at the next tick
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
    foldSeen();
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

  // ---------- posts you've read ----------
  // A post counts as read once it has been mostly on screen for a second. What is hidden or faded is what you read on EARLIER
  // visits (seenBefore); what you read on this page only joins it when you refresh (foldSeen), so nothing vanishes while you read.
  // Only the post's id is kept (the last few thousand, on this device), and only while the setting is on.
  const SEEN_MAX = 4000;
  const CAUGHT_UP = 30; // this many read posts in a row = you're up to date: stop loading older ones
  let seenAll = new Set();    // every id remembered, oldest first
  let seenBefore = new Set(); // read on earlier visits
  const seenNow = new Set();  // read since this page loaded
  let seenEpoch = 0;          // changes whenever seenBefore does, so the view is redrawn
  let seenDirty = false;
  let seenTimer = 0;
  const cleanIds = (list) => (Array.isArray(list) ? list.filter((x) => typeof x === 'string' && x.length < 30).slice(-SEEN_MAX) : []);
  function loadSeen(list) {
    seenAll = new Set(cleanIds(list));
    seenBefore = new Set(seenAll);
  }
  function mergeSeen(list) { // another tab (or the options page) changed the list
    const ids = cleanIds(list);
    if (!ids.length) { seenAll = new Set(); seenBefore = new Set(); seenNow.clear(); seenEpoch++; return; } // "forget what I've read"
    for (const id of ids) if (!seenAll.has(id)) seenAll.add(id);
  }
  function flushSeen() {
    seenTimer = 0;
    if (!seenDirty) return;
    seenDirty = false;
    while (seenAll.size > SEEN_MAX) seenAll.delete(seenAll.values().next().value);
    const ids = [...seenAll];
    if (storage) storage.set({ seenPosts: ids }).catch(() => {});
    else { try { localStorage.setItem('xmc.seen', JSON.stringify(ids)); } catch { /* private mode */ } }
  }
  function markRead(el) {
    const t = tweetOf.get(el);
    if (!t || settings.seen === 'off' || document.hidden || el.dataset.recycled) return;
    seenNow.add(t.id);
    seenAll.delete(t.id); seenAll.add(t.id); // newest last
    seenDirty = true;
    if (!seenTimer) seenTimer = setTimeout(flushSeen, 4000);
  }
  function foldSeen() { // the posts you read on this page now count as read: they're hidden or faded the next time the feed is drawn
    if (!seenNow.size) return;
    for (const id of seenNow) seenBefore.add(id);
    seenNow.clear();
    seenEpoch++;
  }
  window.addEventListener('pagehide', flushSeen);
  const readTimers = new Map();
  const readObserver = new IntersectionObserver((entries) => {
    for (const en of entries) {
      const el = en.target;
      const mostly = en.isIntersecting && (en.intersectionRatio >= 0.5 || (en.rootBounds && en.intersectionRect.height >= en.rootBounds.height * 0.4)); // a tall post can't reach half
      if (mostly && !readTimers.has(el)) readTimers.set(el, setTimeout(() => { readTimers.delete(el); markRead(el); }, 1000));
      else if (!mostly && readTimers.has(el)) { clearTimeout(readTimers.get(el)); readTimers.delete(el); }
    }
  }, { threshold: [0, 0.25, 0.5, 0.75, 1] });
  // where read posts are hidden or faded: Home and Lists, where the same posts come round again (not a profile or your bookmarks)
  const seenApplies = () => settings.seen !== 'off' && (where() === 'home' || where() === 'list');

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
  const clampRatio = (w, hh, floor) => Math.max(floor || 0.6, Math.min(3, w / hh));
  // a single picture taller than this shape is cropped (the lightbox still shows all of it)
  const photoFloor = (m) => (m && m.type === 'photo' && settings.tallPhotos === 'cap' ? 0.8 : 0.6);

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
    v.volume = settings.volume;
    v.muted = auto || settings.videoMuted; // videos that autoplay always start muted; the rest start the way you last left the volume
    if (auto) { v.dataset.gif = '1'; playObserver.observe(v); }
    return h('div', { className: 'xmc-video' }, v, gif ? h('span', { className: 'xmc-gif', textContent: 'GIF' }) : null);
  }
  function renderMedia(t) {
    const list = t.media.slice(0, 4);
    const n = list.length;
    const box = h('div', { className: 'xmc-media ' + (n === 1 ? 'single' : 'grid n' + n) + (n === 1 && photoFloor(list[0]) > 0.6 ? ' xmc-cap' : '') });
    let photoIdx = 0;
    for (const m of list) {
      let node;
      if (m.type === 'photo') {
        node = h('img', { src: photoUrl(m.thumb, n === 1 ? 'large' : 'medium'), alt: m.alt, loading: 'eager', decoding: 'async' }); // the card is only drawn a few screens ahead, so loading now keeps photos from sitting black while you scroll
        node.dataset.lb = String(photoIdx++);
      } else node = renderVideo(m, t);
      if (n === 1) box.style.aspectRatio = String(clampRatio(m.w, m.h, photoFloor(m)));
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
  // "A reposted", or "A, B and 2 others reposted" when several people's reposts were folded into this card
  function ctxText(t) {
    const by = view.fold ? view.fold.who(t.id) : [];
    return XMCLogic.repostLine((by.length ? by : [t.repostedBy]).map((b) => b.name), T('reposted'));
  }
  // Text-only layout: a small label where the pictures or video would be; one click shows them
  function mediaChip(t) {
    const photos = t.media.filter((m) => m.type === 'photo').length, clips = t.media.length - photos;
    const bits = [];
    if (photos) bits.push(photos + (photos === 1 ? ' photo' : ' photos'));
    if (clips) bits.push(t.media.some((m) => m.type === 'gif') && clips === 1 ? 'GIF' : clips === 1 ? 'video' : clips + ' videos');
    return h('button', { className: 'xmc-mediachip', type: 'button', title: 'Show the pictures and video', textContent: '\u25b6 ' + bits.join(' + ') });
  }
  // the post a reply is answering, above the reply: its words, pictures and what it quotes, as X shows it
  function renderParentContext(p) {
    const box = h('div', { className: 'xmc-pctx' },
      h('div', {}, h('b', { textContent: p.author.name }), h('span', { className: 'xmc-dim', textContent: ' @' + p.author.handle + ' · ' + relTime(p.createdAt) })),
      p.segs.length ? h('div', { className: 'xmc-pctx-text' }, renderSegs(p.segs)) : null,
      p.media.length ? renderMedia(p) : null,
      p.card ? renderLinkCard(p.card) : null,
      p.quoted ? renderQuote(p.quoted) : null);
    box.dataset.href = p.url;
    for (const img of box.querySelectorAll('[data-lb]')) delete img.dataset.lb; // the viewer would show the reply's pictures, not these
    return box;
  }
  // the rest of a person's thread, folded behind one line
  function renderThread(t) {
    const n = t.thread.length;
    const closed = n === 1 ? '1 more post in this thread' : n + ' more posts in this thread';
    const toggle = h('button', { className: 'xmc-thread-toggle', type: 'button', textContent: closed });
    const list = h('div', { className: 'xmc-thread-list', hidden: true }, ...t.thread.map((k) => {
      const post = h('div', { className: 'xmc-tpost' },
        h('a', { className: 'xmc-time xmc-nav', href: k.url, textContent: relTime(k.createdAt) }),
        k.segs.length ? h('div', { className: 'xmc-text' }, renderSegs(k.segs)) : null,
        k.media.length ? renderMedia(k) : null);
      post.dataset.href = k.url;
      for (const img of post.querySelectorAll('[data-lb]')) delete img.dataset.lb; // opening a picture here would show the first post's pictures
      return post;
    }));
    toggle.addEventListener('click', () => { list.hidden = !list.hidden; toggle.textContent = list.hidden ? closed : 'Hide thread'; });
    return h('div', { className: 'xmc-thread' }, toggle, list);
  }
  function renderCard(t) {
    const card = h('article', { className: 'xmc-card' });
    tweetOf.set(card, t);
    if (t.repostedBy) card.append(h('div', { className: 'xmc-ctx' }, icon('repost'), h('span', { textContent: ctxText(t) })));
    const par = t.parent || (t.replyToId && state.byId.get(t.replyToId)) || null;
    const context = par && par !== t && par.author && !par.unavailable && par.segs ? renderParentContext(par) : null;
    if (context) card.append(context);
    const sub = h('div', { className: 'xmc-sub' }, '@' + t.author.handle + ' · ',
      h('a', { className: 'xmc-time xmc-nav', href: t.url, title: new Date(t.createdAt).toLocaleString(), textContent: relTime(t.createdAt) }));
    if (settings.showSource && t.source) sub.append(h('span', { className: 'xmc-src', textContent: ' · via ' + t.source }));
    card.append(h('div', { className: 'xmc-head' },
      h('a', { className: 'xmc-avatar xmc-nav', href: '/' + t.author.handle }, h('img', { src: t.author.avatar, alt: '', loading: 'lazy' })),
      h('div', { className: 'xmc-who' },
        h('a', { className: 'xmc-name xmc-nav', href: '/' + t.author.handle }, t.author.name, badge(t.author)), sub),
      moreButton()));
    if (t.replyTo && !context) card.append(h('div', { className: 'xmc-dim xmc-reply', textContent: 'Replying to @' + t.replyTo }));
    if (t.segs.length) {
      const long = textLength(t.segs) > 420;
      card.append(h('div', { className: 'xmc-text' + (long ? ' clamp' : '') }, renderSegs(t.segs)));
      if (long) card.append(h('button', { className: 'xmc-more', type: 'button', textContent: 'Show more' }));
      if (needsTranslation(t)) card.append(h('button', { className: 'xmc-translate', type: 'button', textContent: 'Translate post', title: 'Opens the post, where X can translate it' }));
    }
    if (t.media.length) card.append(pageLayout().density === 'text' && !t.revealed ? mediaChip(t) : renderMedia(t));
    if (t.card) card.append(renderLinkCard(t.card));
    if (t.quoted) card.append(renderQuote(t.quoted));
    card.dataset.thr = t.thread && t.thread.length ? t.thread.map((k) => k.id).join(',') : '';
    if (t.thread && t.thread.length) card.append(renderThread(t));
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
    const density = pageLayout().density;
    let hh = (density === 'normal' ? 100 : 84) + (t.repostedBy ? 22 : 0);
    hh += Math.ceil(textLength(t.segs) / Math.max(20, w / 7.4)) * 21 + 8;
    if (t.media.length) hh += density === 'text' && !t.revealed ? 36 : (t.media.length === 1 ? w * Math.min(1 / clampRatio(t.media[0].w, t.media[0].h, photoFloor(t.media[0])), 1.67) : w * 0.5625) * (density === 'compact' ? 0.7 : 1);
    if (t.card) hh += density === 'normal' ? 200 : density === 'compact' ? 150 : 70;
    if (t.quoted) hh += density === 'text' ? 100 : 130;
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
  const healthBtn = h('button', { className: 'xmc-health', type: 'button', hidden: true, textContent: '\u26a0', onclick: () => copyDiagnostics() });
  const refreshBtn = h('button', { className: 'xmc-refresh', title: 'Refresh', type: 'button', onclick: () => refresh() }, icon('refresh'), h('span', { className: 'xmc-newn' }));
  const nsfwBtn = h('button', { className: 'xmc-nsfw', type: 'button', onclick: () => cycleNsfw() }, h('span', { className: 'xmc-nsfwi' }), h('span', { className: 'xmc-nsfwl', textContent: 'NSFW' }));

  const autoBtn = btn('Auto', 'Fit the number of columns to the window (highlighted = on)', () => setCols(0));
  const colGroup = h('div', { className: 'xmc-colgroup' },
    btn('\u2212', 'Fewer columns', () => setCols((pageLayout().cols || colCount()) - 1)), countEl,
    btn('+', 'More columns', () => setCols((pageLayout().cols || colCount()) + 1)),
    autoBtn);
  const DENSITY_LABEL = { normal: 'Normal', compact: 'Compact', text: 'Text' };
  const densityBtn = btn('', '', () => { const all = XMCLogic.DENSITIES; setLayout({ density: all[(all.indexOf(pageLayout().density) + 1) % all.length] }); }, 'xmc-density');
  const seenBtn = btn('', '', () => toggleSeen(), 'xmc-seenbtn');
  seenBtn.hidden = true;
  densityBtn.hidden = DENSITY_SHELVED;
  const pageTitleEl = h('span', { className: 'xmc-pagetitle', hidden: true });
  const row1 = h('div', { className: 'xmc-bar1' }, pageTitleEl, tabsEl, h('span', { className: 'xmc-spacer' }), healthBtn, seenBtn, refreshBtn, colGroup, densityBtn, nsfwBtn, gearBtn);
  const row2 = h('div', { className: 'xmc-bar2' }, ...Object.values(viewEls), ...Object.values(kindEls)); // the "All / Tweets / Retweets / ..." views, on a line of their own
  const bar = h('div', { className: 'xmc-bar' }, row1, row2);
  const statusEl = h('div', { className: 'xmc-status' });
  const colsEl = h('div', { className: 'xmc-cols' });
  const loaderText = h('span', { textContent: 'Loading more…' });
  const diagBtn = btn('Copy diagnostics', 'Copies a private snapshot (no post text) to paste when asking for help', () => copyDiagnostics(), 'xmc-diagbtn');
  const loaderEl = h('div', { className: 'xmc-loader', hidden: true }, spinner(), loaderText, diagBtn);
  const endEl = h('div', { className: 'xmc-end', hidden: true }, h('span', { textContent: 'That’s everything X has sent.' }),
    btn('Try loading more', '', () => { const f = activeFeed(); if (f) { f.exhausted = false; f.empty = 0; f.misses = 0; f.retryOnce = true; pump(); } }));
  const caughtText = h('span');
  const caughtEl = h('div', { className: 'xmc-end', hidden: true }, caughtText,
    h('span', { className: 'xmc-endbtns' },
      btn('Show what I\u2019ve read', '', () => toggleSeen()),
      btn('Keep loading older posts', '', () => { view.keepGoing = true; view.caughtUp = false; const f = activeFeed(); if (f) pump(); guard('render', renderFeed); })));
  const profileEl = h('section', { className: 'xmc-profile', hidden: true });
  const scroller = h('div', { className: 'xmc-scroller', tabIndex: -1 }, profileEl, colsEl, loaderEl, caughtEl, endEl, statusEl);
  const root = h('div', { id: 'xmc-root', hidden: true }, bar, scroller);
  const toastEl = h('div', { id: 'xmc-toast', hidden: true });
  document.body.append(root, toastEl);

  // A tab left open while the extension is updated or reloaded keeps the old copy's script running beside the new one, and both
  // draw columns on top of each other (window.__xmcLoaded can't see across that). The newest copy claims the page through the DOM;
  // an older one notices on its next tick and stands down.
  const instance = Math.random().toString(36).slice(2) + Date.now().toString(36);
  document.documentElement.dataset.xmcInstance = instance;
  let retired = false;
  let tickTimer = 0;
  function retire() {
    retired = true;
    clearInterval(tickTimer);
    root.remove(); toastEl.remove();
    if (pill.isConnected) pill.remove();
  }

  // Scrolling with the pointer over X's own sidebars: scroll the columns, as X does (the page scrolls wherever the pointer is).
  // Left alone if the sidebar itself has more to show in that direction.
  document.addEventListener('wheel', (e) => {
    if (retired || root.hidden || e.ctrlKey || e.defaultPrevented) return;
    const bar = e.target.closest && e.target.closest('[data-testid="sidebarColumn"], header[role="banner"]');
    if (!bar || bar.id === 'xmc-sidefreeze') return;
    const down = e.deltaY > 0;
    const room = bar.scrollHeight > bar.clientHeight + 2 && (down ? bar.scrollTop + bar.clientHeight < bar.scrollHeight - 1 : bar.scrollTop > 0);
    if (room && getComputedStyle(bar).overflowY !== 'visible') return;
    e.preventDefault();
    scroller.scrollBy({ top: e.deltaMode === 1 ? e.deltaY * 40 : e.deltaMode === 2 ? e.deltaY * scroller.clientHeight : e.deltaY });
  }, { passive: false, capture: true });

  // Vimium and friends scroll "the element you last clicked in", so make that our columns
  const focusScroller = () => { if (!root.hidden && !/^(input|textarea|select)$/i.test((document.activeElement || {}).tagName || '')) scroller.focus({ preventScroll: true }); };
  root.addEventListener('pointerdown', (e) => { if (!e.target.closest('input, textarea, select')) setTimeout(focusScroller, 0); });
  let drawSoon = 0;
  let lastScrollAt = 0;
  scroller.addEventListener('scroll', () => {
    if (root.hidden) return;
    lastScrollAt = Date.now();
    view.memoTop = scroller.scrollTop;
    if (!drawSoon) drawSoon = setTimeout(() => { drawSoon = 0; if (!root.hidden) { guard('restore', () => recycleCards(true)); guard('render', renderFeed); } }, 40); // fill blank space as it appears, not on the next tick
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
    const text = on ? 'Turn Columns Off' : 'Turn Columns On';
    if (pill.dataset.text !== text) { // only touch the DOM when it changes
      pill.dataset.text = text;
      pill.replaceChildren(icon('columns'), h('span', { className: 'xmc-pill-label', textContent: text }));
    }
    const title = on ? 'Columns are on for this page. Click to see X\u2019s normal feed instead.'
      : state.failedBy === 'error' && state.failed === routeKey() ? 'Columns couldn\u2019t load here, so X\u2019s own page is showing. Click to try again.' : 'Click to show this page in columns';
    if (pill.title !== title) { pill.title = title; pill.setAttribute('aria-label', text); }
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
    if (columns.length && (colCount() !== columns.length || layoutSig() !== view.layoutSig)) relayout(); // column or post-size settings changed
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
      const label = VIEW_LABELS[key]();
      if (el.textContent !== label) el.textContent = label;
      el.classList.toggle('on', settings.filter === key);
    }
    const kind = subFor(state.sel);
    for (const key of Object.keys(kindEls)) { kindEls[key].hidden = !split; kindEls[key].classList.toggle('on', kind === key); }
    row2.hidden = !split && views.length <= 1; // nothing to choose between yet
    const [ic, label] = NSFW[settings.nsfw] || NSFW.blur;
    nsfwBtn.title = label + ' — click to change';
    nsfwBtn.classList.toggle('shown', settings.nsfw === 'show');
    nsfwBtn.classList.toggle('hidden-mode', settings.nsfw === 'hide');
    if (nsfwBtn.dataset.ic !== ic) { nsfwBtn.dataset.ic = ic; nsfwBtn.firstChild.replaceChildren(icon(ic)); }
  }
  function setFilter(key) { settings.filter = key; save(); applyBar(); guard('render', renderFeed); } // draw now, not on the next tick
  // Columns and post size: what you pick in the top bar is kept for this kind of page when "per page" is on, else for every page
  const pageLayout = () => { const l = XMCLogic.pageLayout(settings, where()); return DENSITY_SHELVED ? Object.assign({}, l, { density: 'normal' }) : l; };
  function setLayout(part) {
    if (settings.perPageLayout) {
      const w = where();
      settings.pageLayouts = Object.assign({}, settings.pageLayouts, { [w]: Object.assign({}, settings.pageLayouts[w], part) });
    } else Object.assign(settings, part);
    save(); relayout();
    guard('render', renderFeed);
  }
  const setCols = (n) => setLayout({ cols: Math.max(0, Math.min(8, n)) });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { if (lightbox) closeLightbox(); closeMenu(); }
    if (lightbox && e.key === 'ArrowRight') stepLightbox(1);
    if (lightbox && e.key === 'ArrowLeft') stepLightbox(-1);
  }, true);

  // ---------- columns ----------
  let columns = [];
  const view = { feedKey: null, version: -1, sig: '', renderSig: '', upto: 0, cards: [], drawnIds: new Set() };
  let recycled = 0; // posts that have given their contents back (see recycleCards)
  // Automatic: as many as fit at the chosen width. A fixed number you picked is honoured only while columns stay at least
  // MIN_COL wide; on a narrower window it gives way (down to one) instead of squeezing them to slivers.
  const MIN_COL = 320;
  function colCount() {
    const w = colsEl.clientWidth;
    const lay = pageLayout();
    if (lay.cols > 0) return Math.min(lay.cols, XMCLogic.autoCols(w, { minColWidth: MIN_COL, maxAutoCols: 8 }, GAP));
    return XMCLogic.autoCols(w, { minColWidth: XMCLogic.minColFor(settings, lay.density), maxAutoCols: settings.maxAutoCols }, GAP);
  }
  const layoutSig = () => { const l = pageLayout(); return l.cols + '|' + l.density + '|' + XMCLogic.minColFor(settings, l.density) + '|' + settings.maxAutoCols; };
  // everything that changes which posts pass; when it changes the view is rebuilt
  const FILTER_KEYS = ['filter', 'repostsHome', 'quotesHome', 'repliesHome', 'repostsProfile', 'repostsLists', 'onlyFollowed',
    'hideBlueReplies', 'hideMutedQuotes', 'mutedWords', 'mutedAccounts', 'nsfw', 'seen', 'collapseReposts', 'foldThreads'];
  // everything that changes how a card is built
  const RENDER_KEYS = ['branding', 'showSource', 'autoplayVideo', 'tallPhotos'];
  const sigOf = (keys) => keys.map((k) => String(settings[k])).join('|') + '|' + where() + '|' + settings.mutedQuoteIds.length;
  const filterSig = () => sigOf(FILTER_KEYS) + '|' + (state.showSeen ? 1 : 0) + '|' + seenEpoch;
  const renderSig = () => RENDER_KEYS.map((k) => String(settings[k])).join('|') + '|' + pageLayout().density;
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
      if (!t.el) { t.el = renderCard(t); t.elSig = renderSig(); } // elSig: how it was built, so a layout change rebuilds only what is out of date
      const el = t.el;
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
    const lay = pageLayout();
    view.layoutSig = layoutSig();
    countEl.textContent = (lay.cols ? '' : 'auto · ') + n;
    autoBtn.classList.toggle('on', !lay.cols); // shows whether the number is automatic or fixed
    root.classList.toggle('xmc-compact', lay.density === 'compact');
    root.classList.toggle('xmc-textonly', lay.density === 'text');
    densityBtn.textContent = DENSITY_LABEL[lay.density];
    densityBtn.title = 'Post size: ' + DENSITY_LABEL[lay.density].toLowerCase() + ' \u2014 click to change';
    const real = view.cards.map((t) => (t.el ? t.el.offsetHeight : 0));
    columns = Array.from({ length: n }, () => h('div', { className: 'xmc-col' }));
    colsEl.classList.toggle('auto', !lay.cols); // automatic: columns keep about one width, the window shows more or fewer
    root.style.setProperty('--xmc-colw', XMCLogic.minColFor(settings, lay.density) + 'px');
    colsEl.replaceChildren(...columns);
    placeBatch(view.cards.map((t, i) => ({ t, est: real[i] || undefined })));
  }
  function resetView(feed) {
    view.feedKey = feed ? feed.key : null;
    view.version = feed ? feed.version : -1;
    view.sig = filterSig();
    view.renderSig = renderSig();
    view.upto = 0;
    view.cards = [];
    view.drawnIds = new Set();
    view.fold = settings.collapseReposts ? XMCLogic.collapser() : null; // reposts of the same post share one card
    view.seenRun = 0; view.hiddenSeen = 0; view.caughtUp = false; view.keepGoing = false;
    recycled = 0;
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
  // ---------- recycling ----------
  // After hours of scrolling the page would hold thousands of posts. A post far above or below you gives its contents back
  // (keeping its exact height, so nothing shifts) and gets them again when you scroll towards it.
  const RECYCLE_AFTER = 150; // only once this many posts are on the page
  function recycleCards(restoreOnly) {
    if (root.hidden || (!recycled && (restoreOnly || view.cards.length < RECYCLE_AFTER))) return;
    const vh = scroller.clientHeight, top = scroller.scrollTop, bottom = top + vh;
    const base = scroller.getBoundingClientRect().top - top;
    const t0 = performance.now();
    let made = 0;
    for (const t of view.cards) {
      const el = t.el;
      if (!el || !el.isConnected) continue;
      const gone = el.dataset.recycled === '1';
      if (!gone && restoreOnly) continue;
      const r = el.getBoundingClientRect();
      const y = r.top - base, y2 = r.bottom - base;
      if (gone) {
        if (y2 > top - 4 * vh && y < bottom + 8 * vh) { restoreCard(t, el); made++; recycled--; }
      } else if (!restoreOnly && (y2 < top - 6 * vh || y > bottom + 10 * vh) && !cardBusy(el)) {
        for (const v of el.querySelectorAll('video')) playObserver.unobserve(v);
        el.style.boxSizing = 'border-box'; el.style.height = r.height + 'px'; // exact, fractions of a pixel included: hundreds of them add up
        el.dataset.recycled = '1';
        el.replaceChildren();
        made++; recycled++;
      }
      if (made >= 40 || performance.now() - t0 > 8) break; // a little at a time
    }
  }
  function restoreCard(t, el) {
    const fresh = renderCard(t);
    el.replaceChildren(...fresh.childNodes);
    el.style.height = ''; el.style.boxSizing = '';
    delete el.dataset.recycled;
    updateActions(t, el);
  }
  // not while you're using it: open comments, a playing video, something selected or focused in it
  function cardBusy(el) {
    if (el.querySelector('.xmc-replies') || el.matches(':focus-within')) return true;
    for (const v of el.querySelectorAll('video')) if (!v.paused) return true;
    const sel = getSelection();
    return !!(sel && sel.rangeCount && !sel.isCollapsed && el.contains(sel.anchorNode));
  }

  function dropCards(pred) { // remove cards in place (e.g. after muting) without rebuilding or losing your place
    view.cards = view.cards.filter((t) => {
      if (!pred(t)) return true;
      if (t.el) { for (const v of t.el.querySelectorAll('video')) playObserver.unobserve(v); t.el.remove(); }
      return false;
    });
  }

  // Draw only what you can reach soon (about four screens ahead) instead of every loaded post at once:
  // switching views stays instant however much is loaded, and more is drawn as you scroll.
  const CHUNK = 14;
  // which posts of this feed belong to a thread (worked out again only when the feed has changed)
  function threadsFor(f) {
    if (!settings.foldThreads) return null;
    if (!f.thr || f.thr.n !== f.items.length || f.thr.v !== f.version) f.thr = { n: f.items.length, v: f.version, plan: XMCLogic.threadPlan(f.items) };
    return f.thr.plan;
  }
  function renderFeed() {
    // Never while X's hidden side is on a post's page or the compose box (comments, translation, replying): there is no
    // feed for that page, and "no feed" would wipe the columns and throw you back to the top.
    if (state.peek || state.posting || onPostPage() || isModalRoute()) return;
    if (settings.disableHome && where() === 'home') {
      if (view.feedKey) resetView(null);
      setStatus('The Home timeline is turned off in settings.');
      loaderEl.hidden = true; endEl.hidden = true; seenBtn.hidden = true; caughtEl.hidden = true;
      return;
    }
    const f = activeFeed();
    if (!f && state.awaiting && view.cards.length) { // you switched tab and the new feed is on its way: keep what is on screen, dimmed, instead of going blank
      root.classList.add('xmc-switching');
      loaderText.textContent = 'Loading\u2026'; loaderEl.hidden = false; loaderEl.classList.add('xmc-sticky');
      return;
    }
    root.classList.remove('xmc-switching');
    if (!f || !f.items.length || state.homeHold) {
      if (view.feedKey) resetView(null);
      setStatus('Loading…', true);
      loaderEl.hidden = true; endEl.hidden = true; seenBtn.hidden = true; caughtEl.hidden = true;
      updateRefreshBtn(null);
      return;
    }
    const rs = renderSig();
    if (view.renderSig !== rs) for (const feed of state.feeds.values()) for (const t of feed.items) if (t.el && t.elSig !== rs) t.el = null; // rebuild the cards themselves
    if (view.feedKey !== f.key || view.version !== f.version || view.sig !== filterSig() || view.renderSig !== rs) resetView(f);
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
      const readMode = seenApplies() && !state.showSeen ? settings.seen : 'off';
      const plan = threadsFor(f);
      const showing = (r) => XMCLogic.passes(r, c) && !(readMode === 'hide' && seenBefore.has(r.id)); // will this post get a card of its own?
      while (view.upto < f.items.length && fresh.length < CHUNK && scanned < 400) {
        if (view.caughtUp) break;
        const t = f.items[view.upto++];
        scanned++;
        if (t.moduleParent && where() === 'profile') continue; // the post a reply answers is shown inside that reply's card
        const root = plan && plan.rootOf.get(t.id);
        if (root && showing(root)) continue; // a reply to themselves: it is shown under the first post of the thread
        if (!XMCLogic.passes(t, c)) continue;
        const read = readMode !== 'off' && seenBefore.has(t.id);
        if (read && readMode === 'hide') {
          view.hiddenSeen++;
          if (++view.seenRun >= CAUGHT_UP && !view.keepGoing) view.caughtUp = true; // a long run of posts you've read: you're up to date
          continue;
        }
        if (view.fold) { // another repost of a post already drawn: add to its card instead of drawing it again
          const host = view.fold.offer(t);
          if (host) { const ctx = host.el && !host.el.dataset.recycled && host.el.querySelector(':scope > .xmc-ctx span'); if (ctx) ctx.textContent = ctxText(host); continue; }
        }
        view.seenRun = 0;
        const kids = plan && plan.kids.get(t.id);
        t.thread = kids ? kids.filter((k) => !view.drawnIds.has(k.id) && XMCLogic.passes(k, c)) : null;
        const thr = t.thread ? t.thread.map((k) => k.id).join(',') : '';
        if (t.el && (t.el.dataset.thr || '') !== thr) t.el = null; // its thread changed: build the card again
        fresh.push({ t, read }); view.cards.push(t); view.drawnIds.add(t.id);
      }
      placeBatch(fresh);
      for (const { t, read } of fresh) {
        t.el.classList.toggle('xmc-read', read);
        if (t.repostedBy) { const ctx = t.el.querySelector(':scope > .xmc-ctx span'); if (ctx) ctx.textContent = ctxText(t); } // a card kept from before may say something else now
        if (settings.seen !== 'off') readObserver.observe(t.el);
      }
      if (!fresh.length) break;
    }
    updateSeenUi(f);
    updateRefreshBtn(f);
    const drawn = view.upto >= f.items.length;
    setStatus(!view.cards.length && drawn && (f.exhausted || !state.waitingPage)
      ? (view.hiddenSeen ? 'You\u2019re all caught up: everything here is posts you\u2019ve read.' : f.exhausted ? 'Nothing in this view.' : 'Nothing here matches this view yet...') : '');
    // spinner while we're fetching more; a note when X has no more to give
    const waiting = state.waitingPage && !f.exhausted && !view.caughtUp;
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
  // the "N read" button in the top bar, and the "you're up to date" note under the posts
  function updateSeenUi(f) {
    const hiding = seenApplies() && settings.seen === 'hide';
    const n = view.hiddenSeen;
    seenBtn.hidden = !(hiding && (n > 0 || state.showSeen));
    const label = state.showSeen ? 'Hide read' : n + ' hidden';
    if (seenBtn.textContent !== label) seenBtn.textContent = label;
    seenBtn.title = state.showSeen ? 'Hide the posts you have already read again' : n + (n === 1 ? ' post' : ' posts') + ' you have already read are hidden \u2014 click to show them';
    const caught = hiding && view.caughtUp && !state.showSeen;
    caughtEl.hidden = !caught;
    if (caught) caughtText.textContent = view.cards.length ? 'You\u2019re up to date: everything older is posts you\u2019ve read.' : 'You\u2019re all caught up: nothing here you haven\u2019t read.';
  }
  function toggleSeen() { state.showSeen = !state.showSeen; guard('render', renderFeed); }
  function updateRefreshBtn(f) {
    const n = f ? f.pending.length : 0;
    const flag = n > 0 || !!state.xNewPill;
    refreshBtn.classList.toggle('has-new', flag);
    const text = n ? n + ' new' : state.xNewPill ? 'New' : '';
    const label = refreshBtn.querySelector('.xmc-newn');
    if (label.textContent !== text) label.textContent = text;
    refreshBtn.title = n ? `${n} new posts \u2014 click to show them` : state.xNewPill ? 'There are new posts \u2014 click to load them' : 'Refresh';
  }
  // X shows its own "See new posts" pill (on its hidden page) when its check finds new posts; that counts too
  function findNewPostsPill() {
    const col = mainCol();
    const el = col && col.querySelector(':scope > div > div:first-child > div[style^="transform"]');
    const text = el ? el.textContent.trim() : '';
    return text && text.length < 80 ? el : null;
  }
  // X only checks for new posts while its page sits at the top. The loader keeps the hidden page deep, so while you are reading
  // the top of the feed and nothing needs loading, put it back at the top.
  function parkAtTop(f) {
    if (!f || where() !== 'home' || state.peek || state.posting || Date.now() < state.proxyUntil || state.waitingPage) return;
    if (window.scrollY < 400 || Date.now() - lastScrollAt < 3000 || Date.now() - (state.parkedAt || 0) < 30000) return;
    if (scroller.scrollTop > scroller.clientHeight * 1.5) return; // reading deeper down: the loader may need the page where it is
    if (!f.exhausted && f.items.length - view.upto <= 30) return;
    state.parkedAt = Date.now();
    window.scrollTo(0, 0);
  }
  new ResizeObserver(() => { if (!root.hidden && colCount() !== columns.length) relayout(); }).observe(scroller);

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
    if (!f || f.exhausted || view.caughtUp) return;
    const ahead = Date.now() - lastScrollAt < 4000 ? 120 : 50; // scrolling: keep about six pages waiting; reading: two or three
    if (f.items.length - view.upto > ahead) return; // plenty already waiting to be drawn
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
      layout: { recycledPosts: recycled, density: pageLayout().density, perPage: settings.perPageLayout, readHidden: view.hiddenSeen || 0, readRemembered: seenAll.size, caughtUp: !!view.caughtUp, domNodes: document.getElementsByTagName('*').length, columns: columns.length, shortestPx: Math.round(shortestBottom()), tallestPx: Math.round(Math.max(0, ...columns.map((c) => c.getBoundingClientRect().bottom - scroller.getBoundingClientRect().top + scroller.scrollTop))), drawn: view.upto, loaded: (activeFeed() || { items: [] }).items.length },
      hiddenPage: { scrollY: Math.round(window.scrollY), height: d.scrollHeight, viewport: innerHeight, postsMountedByX: articles().length },
      requestsSeen: state.seenOps,
      feeds: [...state.feeds.values()].map((f) => ({ name: f.key.split('|')[0] + (f.key.includes('#') ? '#' + f.key.split('#').pop() : ''), posts: f.items.length, parkedNew: f.pending.length, exhausted: f.exhausted, misses: f.misses })),
      lastRefusal: state.fail, waitingForPage: state.waitingPage, secondsSinceAsked: Math.round((Date.now() - state.lastJump) / 1000), secondsWaiting: state.waitSince ? Math.round((Date.now() - state.waitSince) / 1000) : 0,
      commentsInProgress: state.peek ? state.peek.id : null, cachedConversations: state.details.size, tabMenuTrace: state.tabTrace || [], health: state.health.map((i) => i.key),
      tabs: { labels: realTabs().map((x) => x.textContent.trim().slice(0, 20)), xSelected: realTabs().findIndex((x) => x.getAttribute('aria-selected') === 'true'), weThink: state.sel, homeInit: state.homeInit, awaiting: !!state.awaiting, dropdownTabs: [...state.menuTabs], picked: state.sub, onFeed: state.cur.key ? state.cur.key.split('|')[0] : null },
      floating: floatingReport(),
      corner: cornerReport(),
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
  // realArticle keeps the loader away from X's page for up to 20s while it works; the moment the job is done, give it back
  // (this window used to stay shut for 20s after every like or bookmark, which is what made loading stall)
  const settleProxy = () => { state.proxyUntil = Date.now() + 800; };
  async function withReal(t, fn) {
    try {
      const art = await realArticle(t);
      if (!art) return false;
      await fn(art);
      return true;
    } finally { settleProxy(); }
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
      settleProxy();
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
      state.actionFails.push(Date.now());
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
      if (!ok) { state.actionFails.push(Date.now()); toast('Couldn’t reach that post just now — try again in a moment'); }
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
    if (cached) return Promise.resolve({ data: cached });
    repliesWaiting++;
    const run = replyQueue.then(async () => {
      repliesWaiting--;
      const again = state.details.get(t.id); // an earlier request for the same post may have fetched it meanwhile
      if (again) return { data: again };
      if (opts.wanted && !opts.wanted()) return { why: 'Closed before it loaded.' };
      if (opts.onStart) opts.onStart();
      await waitFor(() => !state.posting, 15000);
      try { return await fetchReplies(t, opts); } catch (err) {
        console.warn('[xmc] comments failed', err);
        return { why: 'Something went wrong while loading this (' + ((err && err.message) || err) + ').' };
      }
    });
    replyQueue = run.catch(() => {});
    return run;
  }
  async function fetchReplies(t, opts) {
    opts = opts || {};
    state.peek = { id: t.id, replies: null };
    state.proxyUntil = Date.now() + 40000;
    freezeSidebar();
    try {
      const art = await realArticle(t);
      if (!art) return { why: 'Couldn\u2019t find this post on X\u2019s side (it may have scrolled out of X\u2019s list).' };
      const link = timeLinkOf(art, t.id);
      if (!link) return { why: 'Found the post but not its link, so couldn\u2019t open it.' };
      const before = location.pathname;
      fire(link);
      await waitFor(() => location.pathname !== before || state.peek.replies, 3000);
      if (!state.peek.replies && location.pathname === before) { link.click(); await waitFor(() => location.pathname !== before || state.peek.replies, 2500); } // a plain click as a second try
      const got = await waitFor(() => state.peek && state.peek.replies, 9000);
      if (got) return { data: got };
      return { why: location.pathname === before
        ? 'X didn\u2019t open the post when asked to.'
        : 'X opened the post but sent no comments. Requests seen: ' + Object.keys(state.seenOps).join(', ') };
    } finally {
      if (onPostPage() && idOfHref(location.pathname) === t.id) { // still the page we opened (not one you've since gone to yourself)
        window.history.back();
        await waitFor(() => !onPostPage(), 3500);
      }
      state.peek = null;
      state.lastPeekEnd = Date.now();
      state.proxyUntil = Date.now() + 1500;
    }
  }
  function renderReply(r, t, panel) {
    const text = h('div', { className: 'xmc-text' }, renderSegs(r.segs));
    for (const a of text.querySelectorAll('a.xmc-nav')) { a.classList.remove('xmc-nav'); a.target = '_blank'; a.rel = 'noopener'; }
    const photos = r.media.slice(0, 2).map((m) => h('a', { href: photoUrl(m.thumb, 'large'), target: '_blank', rel: 'noopener' },
      h('img', { className: 'xmc-rmedia', src: photoUrl(m.thumb, 'small'), alt: '', loading: 'lazy' })));
    const likeBtn = h('button', { className: 'xmc-ract xmc-rlike', type: 'button', title: 'Like' }, icon('like'), h('span', { className: 'xmc-n' }));
    const replyBtn = h('button', { className: 'xmc-ract xmc-rreply', type: 'button', title: 'Reply to this comment' }, icon('reply'), h('span', { textContent: 'Reply' }));
    const slot = h('div', { className: 'xmc-rslot' });
    const paintLike = () => { likeBtn.classList.toggle('on', !!r.state.liked); likeBtn.querySelector('.xmc-n').textContent = r.counts.like ? fmt(r.counts.like) : ''; };
    paintLike();
    likeBtn.addEventListener('click', () => likeComment(t, r, paintLike));
    replyBtn.addEventListener('click', () => {
      if (slot.firstChild) { slot.replaceChildren(); return; }
      const c = renderComposer(panel, t, r);
      slot.append(c);
      c.querySelector('textarea').focus();
    });
    const medias = photos.length ? h('div', { className: 'xmc-rmedias' + (r.sensitive ? ' sensitive' : '') }, ...photos) : null;
    if (medias && r.sensitive) medias.append(h('button', { className: 'xmc-reveal', type: 'button', textContent: 'Sensitive content \u2014 click to view', onclick: (e) => { e.stopPropagation(); medias.classList.remove('sensitive'); e.currentTarget.remove(); } }));
    return h('div', { className: 'xmc-ritem d' + (r.depth || 0) },
      h('a', { className: 'xmc-ravatar', href: '/' + r.author.handle, target: '_blank', rel: 'noopener' }, h('img', { src: r.author.avatar, alt: '', loading: 'lazy' })),
      h('div', { className: 'xmc-rbody' },
        h('div', { className: 'xmc-rtop' },
          h('a', { className: 'xmc-name', href: '/' + r.author.handle, target: '_blank', rel: 'noopener', textContent: r.author.name }), badge(r.author),
          h('span', { className: 'xmc-dim', textContent: ' @' + r.author.handle + ' \u00b7 ' + relTime(r.createdAt) })),
        text,
        medias,
        h('div', { className: 'xmc-ractions' }, likeBtn, replyBtn),
        slot));
  }
  const SORTS = [['relevant', 'Relevant'], ['recent', 'Recent'], ['likes', 'Most liked']];
  function fillReplies(panel, t, res) {
    panel.replaceChildren();
    const d = res && res.data;
    const list = d ? XMCLogic.sortReplies(d.replies.filter((r) => !(settings.nsfw === 'hide' && r.sensitive)).slice(0, 60), settings.commentSort) : [];
    const sortSel = h('select', { className: 'xmc-rsort', title: 'Order comments' },
      ...SORTS.map(([v, l]) => h('option', { value: v, textContent: l, selected: settings.commentSort === v })));
    sortSel.addEventListener('change', () => { settings.commentSort = sortSel.value; save(); fillReplies(panel, t, res); });
    panel.append(h('div', { className: 'xmc-rhead' },
      h('b', { textContent: list.length ? 'Comments' : d ? 'No comments yet' : 'Couldn’t load comments' }),
      list.length > 1 ? sortSel : null,
      h('button', { className: 'xmc-rclose', type: 'button', title: 'Close comments' }, icon('close'))));
    panel.append(renderComposer(panel, t));
    for (const r of list) panel.append(renderReply(r, t, panel));
    if (!d) {
      panel.append(h('div', { className: 'xmc-dim xmc-rempty', textContent: (res && res.why) || 'Try again in a moment.' }));
      panel.append(btn('Copy diagnostics', '', () => copyDiagnostics(), 'xmc-rbtn'));
    }
    const more = h('button', { className: 'xmc-rbtn', type: 'button', textContent: d && d.more ? 'See all comments' : 'Open conversation' });
    more.dataset.act = 'conversation';
    panel.append(h('div', { className: 'xmc-rfoot' }, more));
  }

  // Posting a comment from here: X's own reply box is opened out of sight, the text is typed into it and Send
  // is pressed, exactly as you would. If any step fails, X's reply box is left open for you to finish.
  // the part both kinds of reply share: press Reply on a (real) post, type, press Send
  async function typeAndSend(art, text) {
    const rb = art.querySelector('[data-testid="reply"]');
    if (!rb) return { ok: false, why: 'Couldn’t find this post on X’s side.' };
    fire(rb);
    const editor = await waitFor(() => document.querySelector('[data-testid="tweetTextarea_0"]'), 5000);
    if (!editor) return { ok: false, why: 'X’s reply box didn’t open.' };
    editor.focus();
    document.execCommand('selectAll', false);
    document.execCommand('insertText', false, text);
    const sendBtn = await waitFor(() => {
      const b = document.querySelector('[data-testid="tweetButton"]');
      return b && b.getAttribute('aria-disabled') !== 'true' && !b.disabled ? b : null;
    }, 4000);
    if (!sendBtn) return { ok: false, why: 'X wouldn’t accept the text.' };
    fire(sendBtn);
    const closed = await waitFor(() => !document.querySelector('[data-testid="tweetTextarea_0"]'), 10000);
    return closed ? { ok: true } : { ok: false, why: 'X didn’t confirm it was sent.' };
  }
  async function postReply(t, text) {
    await replyQueue; // comment loads borrow the same hidden page
    state.posting = true;
    freezeSidebar();
    const doc = document.documentElement;
    doc.classList.add('xmc-acting');
    let res = { ok: false, why: 'Something went wrong.' };
    try {
      const art = await realArticle(t);
      if (!art) { res = { ok: false, why: 'Couldn’t find this post on X’s side.' }; return res; }
      res = await typeAndSend(art, text);
      return res;
    } finally {
      state.posting = false;
      state.lastPeekEnd = Date.now();
      settleProxy();
      if (res.ok) setTimeout(() => doc.classList.remove('xmc-acting'), 500);
      else { doc.classList.remove('xmc-acting'); toast(res.why + ' Finish it in X’s reply box.'); }
    }
  }
  function renderComposer(panel, t, r) {
    const box = h('textarea', { className: 'xmc-cbox', placeholder: r ? 'Reply to @' + r.author.handle + '…' : 'Write a comment…', rows: 2, maxLength: 1000 });
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
      const res = r ? await postCommentReply(t, r, text) : await postReply(t, text);
      box.disabled = false;
      if (res.ok) {
        box.value = ''; box.style.height = 'auto'; note.textContent = 'Sent ✓';
        t.counts.reply += 1; updateActions(t); toast('Reply sent');
        reloadComments(panel, t);
      } else { send.disabled = false; note.textContent = res.why; }
    };
    send.addEventListener('click', go);
    box.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); go(); } });
    return h('div', { className: 'xmc-compose' + (r ? ' xmc-inline' : '') }, box, h('div', { className: 'xmc-crow' }, note, send));
  }

  // ---- acting on one comment: X only has the comment's own buttons while it shows that post's page ----
  function inQueue(job) {
    const run = replyQueue.then(async () => { await waitFor(() => !state.posting, 15000); return job(); });
    replyQueue = run.catch(() => {});
    return run;
  }
  // get X to mount a comment on the post page (its list is virtual too): wait for the page, then walk down
  async function mountComment(id) {
    for (let i = 0; i < 40; i++) {
      const a = findArticle(id);
      if (a) { await sleep(100); return findArticle(id) || a; }
      if (i >= 8) window.scrollBy(0, innerHeight * 0.7);
      await sleep(150);
    }
    return null;
  }
  // Opens the post on X's hidden side, finds the comment, runs fn(its article), and goes back. fn may return {ok:false, why, stay:true}
  // (X's reply box is left open for you to finish, so the page is not left). Resolves to {ok} or {ok:false, why}.
  function actOnComment(t, commentId, fn, opts) {
    opts = opts || {};
    return inQueue(async () => {
      const doc = document.documentElement;
      state.peek = { id: t.id, replies: null };
      state.proxyUntil = Date.now() + 40000;
      freezeSidebar();
      if (opts.posting) doc.classList.add('xmc-acting');
      let stay = false, out = { ok: false, why: 'Something went wrong.' };
      try {
        const art = await realArticle(t);
        const link = art && timeLinkOf(art, t.id);
        if (!link) { out = { ok: false, why: 'Couldn’t find this post on X’s side.' }; return out; }
        const before = location.pathname;
        fire(link);
        await waitFor(() => location.pathname !== before, 3000);
        if (location.pathname === before) { link.click(); await waitFor(() => location.pathname !== before, 2500); }
        if (!onPostPage()) { out = { ok: false, why: 'X didn’t open the post.' }; return out; }
        const cart = await mountComment(commentId);
        if (!cart) { out = { ok: false, why: 'Couldn’t find that comment on X’s side.' }; return out; }
        if (opts.posting) state.posting = true;
        try { const r = await fn(cart); if (r && r.stay) stay = true; out = r && r.ok === false ? r : { ok: true }; } finally { state.posting = false; }
        if (opts.posting && !stay) await waitFor(() => !isModalRoute(), 4000); // X's reply box is still stepping back to the post
        return out;
      } catch (err) {
        console.warn('[xmc] comment action failed', err);
        out = { ok: false, why: 'Something went wrong (' + ((err && err.message) || err) + ').' };
        return out;
      } finally {
        if (!stay && onPostPage() && idOfHref(location.pathname) === t.id) { window.history.back(); await waitFor(() => !onPostPage(), 3500); }
        state.peek = null;
        state.lastPeekEnd = Date.now();
        state.proxyUntil = Date.now() + 1500;
        if (opts.posting) { if (stay) doc.classList.remove('xmc-acting'); else setTimeout(() => doc.classList.remove('xmc-acting'), 500); }
        if (stay) toast(out.why + ' Finish it in X’s reply box.');
      }
    });
  }
  async function likeComment(t, r, paint) {
    const want = !r.state.liked;
    const flip = (on) => { r.state.liked = on; r.counts.like = Math.max(0, r.counts.like + (on ? 1 : -1)); paint(); };
    flip(want);
    const res = await actOnComment(t, r.id, (art) => {
      const b = art.querySelector(want ? '[data-testid="like"]' : '[data-testid="unlike"]');
      if (!b) return { ok: false, why: 'Couldn’t find that comment’s like button.' };
      fire(b);
      return { ok: true };
    });
    if (!res.ok) { state.actionFails.push(Date.now()); flip(!want); toast(res.why || 'Couldn’t reach that comment just now. Try again in a moment'); }
  }
  async function postCommentReply(t, r, text) {
    return actOnComment(t, r.id, async (art) => {
      const sent = await typeAndSend(art, text);
      return sent.ok ? sent : { ok: false, why: sent.why, stay: true };
    }, { posting: true });
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
    if (!res || !res.data) state.commentFails.push(Date.now());
    fillReplies(panel, t, res);
  }

  // A profile page: who it is. X's own header (banner, picture, name, bio with its links, counts, "followed by", buttons) is under our
  // columns, so a copy of it is shown above the posts: the same look, because it is X's own markup. Links in it open as links do
  // elsewhere here; its buttons press the real ones. If X's header can't be found, a plainer one is drawn from what X sent.
  const PROFILE_TABS = ['with_replies', 'media', 'likes', 'highlights', 'articles'];
  function profileHandle() {
    const seg = location.pathname.split('/').filter(Boolean);
    if (!seg.length || RESERVED.has(seg[0].toLowerCase())) return '';
    return seg.length === 1 || (seg.length === 2 && PROFILE_TABS.includes(seg[1])) ? seg[0] : '';
  }
  const plural = (n, one) => fmt(n) + ' ' + one;
  // X's own header block: the smallest element that holds the banner, the picture and the name, and stops short of the tab bar
  function nativeHeader(handle) {
    const col = mainCol(), nameEl = col && col.querySelector('[data-testid="UserName"]');
    if (!nameEl || !(nameEl.textContent || '').toLowerCase().includes('@' + handle.toLowerCase())) return null;
    const need = [col.querySelector('a[href$="/header_photo"]'), col.querySelector('[data-testid^="UserAvatar-Container-"]')].filter(Boolean);
    let box = nameEl;
    while (box.parentElement && box.parentElement !== col && !need.every((n) => box.contains(n))) {
      if (box.parentElement.querySelector('[role="tablist"]')) break; // any higher and the tabs come too
      box = box.parentElement;
    }
    return box.querySelector('[role="tablist"]') ? null : box;
  }
  let headerCopy = null; // { handle, html, index: Map(copy element -> its position) }
  function copyHeader(handle) {
    const orig = nativeHeader(handle);
    if (!orig) return !!(headerCopy && headerCopy.handle === handle.toLowerCase());
    const html = orig.innerHTML;
    if (headerCopy && headerCopy.handle === handle.toLowerCase() && headerCopy.html === html) return true;
    const clone = orig.cloneNode(true);
    const copies = [clone, ...clone.querySelectorAll('*')];
    const index = new Map(copies.map((el, i) => [el, i]));
    for (const el of copies) el.removeAttribute('id');
    headerCopy = { handle: handle.toLowerCase(), html, index };
    profileEl.className = 'xmc-profile xmc-native';
    profileEl.replaceChildren(clone);
    return true;
  }
  // a click in the copy: a link opens as links do here; a button presses X's real one (X's header has to be mounted for that: it is
  // brought back to view first if the loader has moved X's page on)
  async function pressHeaderButton(position) {
    state.proxyUntil = Date.now() + 8000;
    try {
      let orig = nativeHeader(headerCopy.handle);
      if (!orig) { window.scrollTo(0, 0); orig = await waitFor(() => nativeHeader(headerCopy.handle), 2500); }
      if (!orig || orig.innerHTML !== headerCopy.html) { toast('Couldn’t reach that button just now. Try again in a moment.'); return; }
      const target = [orig, ...orig.querySelectorAll('*')][position];
      if (target) fire(target);
    } finally { settleProxy(); }
  }
  profileEl.addEventListener('click', (e) => {
    if (!headerCopy || !profileEl.classList.contains('xmc-native') || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const hit = e.target.closest('a[href], button, [role="button"]');
    if (!hit || !profileEl.contains(hit)) return;
    if (hit.matches('a[href]')) {
      const url = new URL(hit.getAttribute('href'), location.origin);
      if (url.origin !== location.origin) return; // a link out (the bio's): the browser opens it
      e.preventDefault(); navigate(url.pathname + url.search, null);
      return;
    }
    e.preventDefault(); e.stopPropagation();
    const position = headerCopy.index.get(hit);
    if (position !== undefined) pressHeaderButton(position);
  });
  // the plainer header, from what X sent when the profile opened
  function profileCard(handle) {
    const p = state.profiles.get(handle.toLowerCase());
    if (!p) return null;
    const joined = p.joined ? 'Joined ' + new Date(p.joined).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) : '';
    return {
      name: p.name, handle: p.handle, blue: p.blue, verified: p.verified, avatar: p.avatar, banner: p.banner, bio: p.bio,
      meta: [p.location, p.site, joined].filter(Boolean).join(' · '),
      counts: [p.following !== undefined ? plural(p.following, 'Following') : '', p.followers !== undefined ? plural(p.followers, 'Followers') : ''].filter(Boolean).join('   '),
    };
  }
  let profileSig = '';
  function updateProfile() {
    const handle = settings.profileHeader && state.shown && !root.hidden ? profileHandle() : '';
    if (!handle) { profileEl.hidden = true; profileSig = ''; headerCopy = null; if (!listNameOnBar) pageTitleEl.hidden = true; return; }
    if (headerCopy && headerCopy.handle !== handle.toLowerCase()) { headerCopy = null; profileSig = ''; profileEl.replaceChildren(); profileEl.className = 'xmc-profile'; }
    const api = profileCard(handle);
    if (copyHeader(handle)) {
      profileEl.hidden = false;
      const nm = profileEl.querySelector('[data-testid="UserName"]');
      const name = (api && api.name) || (nm && nm.querySelector('span') ? nm.querySelector('span').textContent.trim() : '');
      pageTitleEl.hidden = !name; if (name && pageTitleEl.textContent !== name) pageTitleEl.textContent = name;
      return;
    }
    // X's own header is not there (yet): after a moment, the plainer one
    if (!api || Date.now() - state.routeSince < 2500) { profileEl.hidden = true; pageTitleEl.hidden = !(api || listNameOnBar); if (api) pageTitleEl.textContent = api.name; return; }
    profileEl.hidden = false;
    pageTitleEl.hidden = false; pageTitleEl.textContent = api.name;
    const sig = JSON.stringify(api);
    if (sig === profileSig) return;
    profileSig = sig;
    profileEl.className = 'xmc-profile';
    profileEl.replaceChildren(...[
      api.banner ? h('div', { className: 'xmc-pbanner', style: 'background-image:url("' + api.banner.replace(/"/g, '%22') + '")' }) : null,
      h('div', { className: 'xmc-pmain' },
        api.avatar ? h('img', { className: 'xmc-pavatar', src: api.avatar, alt: '' }) : null,
        h('div', { className: 'xmc-pwho' },
          h('div', { className: 'xmc-pname' }, api.name, badge(api)),
          h('div', { className: 'xmc-dim' }, '@' + api.handle))),
      api.bio ? h('div', { className: 'xmc-pbio', textContent: api.bio }) : null,
      api.meta ? h('div', { className: 'xmc-dim xmc-pmeta', textContent: api.meta }) : null,
      api.counts ? h('div', { className: 'xmc-pcounts', textContent: api.counts }) : null,
    ].filter(Boolean));
  }

  // A list page: its name in the tab title (X leaves it as "List") and at the left of the top bar
  let listNameOnBar = false;
  function listTitle() {
    const m = /^\/i\/lists\/(\d+)/.exec(location.pathname);
    const name = m && state.listNames.get(m[1]);
    listNameOnBar = !!name;
    if (!name) { if (m) pageTitleEl.hidden = true; return; }
    pageTitleEl.hidden = false;
    if (pageTitleEl.textContent !== name) pageTitleEl.textContent = name;
    const want = name + ' / ' + (settings.branding === 'twitter' ? 'Twitter' : 'X');
    if (document.title !== want && /^List( \/ |$)/.test(document.title)) document.title = want;
  }

  // On X's own pages (a post's page, a profile that asks "view profile?") X puts its own notice over sensitive media. With
  // "Sensitive media: Show" it is pressed for you. Only a Show / View button that sits inside a notice about sensitive content.
  const GATE_LABEL = /^(show|view|view post|view profile|yes, view profile|yes, view post)$/i;
  const gatesPressed = new WeakSet();
  function revealNative() {
    if (settings.nsfw !== 'show' || state.peek || state.posting) return;
    if (state.shown && !(where() === 'profile' && !activeFeed())) return; // our own columns are showing: their cards have the setting
    const col = mainCol();
    if (!col) return;
    for (const b of col.querySelectorAll('[role="button"], button, [data-testid="empty_state_button_text"]')) {
      if (gatesPressed.has(b)) continue;
      const label = (b.textContent || '').trim();
      if (label.length > 24 || !GATE_LABEL.test(label)) continue;
      let box = b, inNotice = false;
      for (let i = 0; i < 5 && box.parentElement && !inNotice; i++) {
        box = box.parentElement;
        const text = box.textContent || '';
        inNotice = text.length < 400 && /sensitive/i.test(text);
      }
      if (!inNotice) continue;
      gatesPressed.add(b);
      state.gatesPressed = (state.gatesPressed || 0) + 1;
      fire(b);
    }
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
    for (const ev of ['pointerdown', 'mousedown']) menuEl.addEventListener(ev, (e) => e.stopPropagation());
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
    view.sig = filterSig(); // already applied in place: don't rebuild the view and lose your place
    toast('Muted @' + handle + ' — manage in settings');
  }
  function muteQuotesOf(t) {
    if (!settings.mutedQuoteIds.includes(t.id)) settings.mutedQuoteIds = settings.mutedQuoteIds.concat(t.id).slice(-500);
    save();
    const c = passCtx();
    dropCards((x) => !XMCLogic.passes(x, c));
    view.sig = filterSig();
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
      ['Copy diagnostics', () => copyDiagnostics()],
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
          type: 'xmc-download', files, saveAs: !!settings.dlAsk,
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
  // Posts in another language get a "Translate post" button. It opens the post, where X translates it itself
  // (translating inside the columns kept failing: X offers the control only on the post's own page).
  const uiLang = () => String(document.documentElement.lang || navigator.language || 'en').slice(0, 2).toLowerCase();
  const needsTranslation = (t) => !!t.lang && !/^(und|qme|qht|qam|qst|zxx|art)$/.test(t.lang) && t.lang.slice(0, 2).toLowerCase() !== uiLang();

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
  // The volume you set on a video is kept for the next one (only changes you make with the player's own controls count,
  // not the muting we do for autoplay)
  let adjusting = false, adjustTimer = 0;
  const startAdjust = (e) => { if (e.target && e.target.tagName === 'VIDEO') { adjusting = true; clearTimeout(adjustTimer); adjustTimer = setTimeout(() => { adjusting = false; }, 1500); } };
  colsEl.addEventListener('pointerdown', startAdjust, true);
  colsEl.addEventListener('keydown', startAdjust, true);
  colsEl.addEventListener('pointerup', () => { clearTimeout(adjustTimer); adjustTimer = setTimeout(() => { adjusting = false; }, 400); }, true);
  colsEl.addEventListener('volumechange', (e) => {
    const v = e.target;
    if (!adjusting || !v || v.tagName !== 'VIDEO' || v.dataset.gif) return;
    if (settings.volume === v.volume && settings.videoMuted === v.muted) return;
    settings.volume = v.volume; settings.videoMuted = v.muted;
    for (const other of colsEl.querySelectorAll('video')) if (other !== v && !other.dataset.gif) { other.volume = v.volume; other.muted = v.muted; } // the videos already on screen follow
    save();
  }, true);
  colsEl.addEventListener('click', (e) => {
    const cardEl = e.target.closest('.xmc-card');
    const t = cardEl && tweetOf.get(cardEl);
    if (!t) return;
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return; // let the browser open links in a new tab/window
    const actBtn = e.target.closest('[data-act]');
    if (actBtn) { e.preventDefault(); e.stopPropagation(); act(t, actBtn.dataset.act, actBtn); return; }
    if (e.target.closest('.xmc-thread-toggle')) return;
    const tpost = e.target.closest('.xmc-tpost, .xmc-pctx');
    if (tpost && !e.target.closest('a[href], video, .xmc-reveal')) { e.preventDefault(); navigate(tpost.dataset.href, null); return; }
    if (e.target.closest('.xmc-rclose')) { const p = cardEl.querySelector('.xmc-replies'); if (p) p.remove(); updateActions(t); return; }
    if (e.target.closest('.xmc-replies')) return; // links inside comments open normally (new tab); clicking text doesn't open the post
    if (e.target.closest('.xmc-translate')) { e.preventDefault(); navigate(t.url, t); return; }
    const chip = e.target.closest('.xmc-mediachip');
    if (chip) { t.revealed = true; chip.replaceWith(renderMedia(t)); return; }
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
  // Resting on the comments button for a moment starts fetching them, so they're often there by the time you click
  // (a pass over it, or the page scrolling under the pointer, doesn't count)
  const prefetching = new Set();
  let hoverTimer = 0;
  colsEl.addEventListener('pointerover', (e) => {
    const b = e.target.closest && e.target.closest('[data-act="reply"]');
    if (!b) return;
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => {
      if (Date.now() - lastScrollAt < 600 || !b.isConnected || !b.matches(':hover')) return;
      const card = b.closest('.xmc-card');
      const t = card && tweetOf.get(card);
      if (!t || !t.counts.reply || state.details.has(t.id) || prefetching.has(t.id) || state.peek || repliesWaiting || state.posting) return;
      prefetching.add(t.id);
      loadReplies(t).finally(() => prefetching.delete(t.id));
    }, 350);
  });
  colsEl.addEventListener('pointerout', (e) => { if (e.target.closest && e.target.closest('[data-act="reply"]')) clearTimeout(hoverTimer); });
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
    state.routeSince = Date.now(); // the "no data for 10s" clock starts again from this switch
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
  const ITEM_SEL = '[role="menuitem"], [role="menuitemradio"], [role="option"]';
  const findXMenu = () => [...document.querySelectorAll('[role="menu"], [role="listbox"], [data-testid="Dropdown"]')].find((m) => m.querySelector(ITEM_SEL));
  const traceTab = (o) => { (state.tabTrace = state.tabTrace || []).push(Object.assign({ at: Math.round((Date.now() - state.loadedAt) / 1000) }, o)); if (state.tabTrace.length > 6) state.tabTrace.shift(); };
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
    const menu = await waitFor(findXMenu, 1200);
    const tabLabel = ((realTabs()[i] || {}).textContent || '').trim().slice(0, 20);
    traceTab({ pressed: tabLabel, menu: menu ? menu.getAttribute('role') || menu.getAttribute('data-testid') : null,
      items: menu ? [...menu.querySelectorAll(ITEM_SEL)].map(menuText).filter((x) => x.length <= 30).slice(0, 8) : [], popups: document.querySelectorAll('#layers > div > *').length });
    if (!menu) { // no dropdown: an ordinary second press. Keep what is on screen; go back to the top, as X does
      releaseLayers();
      state.awaiting = before.awaiting; state.cur = before.cur; lastSig = '';
      scroller.scrollTop = 0;
      return;
    }
    state.menuTabs.add(routeKey() + '|' + i);
    state.awaiting = before.awaiting; state.cur = before.cur; // pressing it again does not change the feed
    lastSig = '';
    const items = [...menu.querySelectorAll(ITEM_SEL)];
    const svgs = items.map((el) => el.querySelectorAll('svg').length);
    const base = Math.min(...svgs);
    const picked = subFor(i);
    const ticked = svgs.some((n) => n !== base); // X marks the current one with a tick
    const list = items.map((el, k) => {
      const text = menuText(el);
      const checked = ticked ? svgs[k] > base : !!picked && text.toLowerCase() === picked;
      return { text, checked };
    });
    const first = list.find((x) => x.checked);
    if (first && !state.subDefault[routeKey() + '|' + i] && !state.sub[routeKey() + '|' + i]) state.subDefault[routeKey() + '|' + i] = first.text.toLowerCase(); // what X was showing before we touched it
    const at = anchor && anchor.isConnected ? anchor : tabsEl.querySelector('.on') || tabsEl.firstElementChild || root;
    openMenu(at, list.map(({ text, checked }) => [(checked ? '\u2713\u2002' : '\u2003\u2002') + text, () => pickTabItem(i, text, checked)]), closeXMenu);
  }
  const findXItem = (text) => [...(findXMenu() || document).querySelectorAll(ITEM_SEL)].find((m) => menuText(m) === text);
  async function pickTabItem(i, text, alreadyCurrent) {
    const rk = routeKey(), key = rk + '|' + i;
    if (alreadyCurrent) { closeXMenu(); return; }
    document.documentElement.classList.add('xmc-acting');
    let el = findXItem(text);
    if (!el) { // X closed its menu when we took the click: press the tab again to open it, out of sight
      const live = realTabs()[i];
      if (live) { fire(live); await waitFor(findXMenu, 1500); el = findXItem(text); }
    }
    traceTab({ picked: text, found: !!el });
    if (!el) { toast('X\u2019s menu closed \u2014 press the tab again'); releaseLayers(); return; }
    const name = text.toLowerCase();
    state.sub[key] = name === state.subDefault[key] ? '' : name; // back to what X started on: that feed has no suffix
    state.cur = { route: rk, key: null };
    state.awaiting = { until: Date.now() + 12000, cached: state.feedByTab.has(slotFor(i)) };
    state.routeSince = Date.now();
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
    pickTabItem(i, [...menu.querySelectorAll(ITEM_SEL)].map(menuText).find((tx) => tx.toLowerCase() === kind.toLowerCase()) || kind, false);
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
  // While X's hidden side visits a post's page (comments, translation, replying), X swaps the contents of its right
  // sidebar for the post page's version ("Relevant people"...) and back, which showed as the sidebar spasming. Show a
  // still copy of it for the duration, and put the real one back once it has settled.
  let sideFreeze = null;
  function freezeSidebar() {
    if (sideFreeze || settings.hideSidebar) return;
    const side = pin.side.el();
    if (!side || side.dataset.xmcStyle === undefined || !side.getBoundingClientRect().width) return;
    const clone = side.cloneNode(true);
    for (const el of [clone, ...clone.querySelectorAll('[data-testid], [id]')]) { el.removeAttribute('data-testid'); el.removeAttribute('id'); }
    clone.id = 'xmc-sidefreeze';
    clone.setAttribute('inert', ''); clone.setAttribute('aria-hidden', 'true');
    clone.style.setProperty('pointer-events', 'none', 'important');
    document.body.append(clone);
    clone.scrollTop = side.scrollTop;
    side.style.setProperty('visibility', 'hidden', 'important');
    document.documentElement.classList.add('xmc-frozen'); // also hides a sidebar X builds from scratch meanwhile
    sideFreeze = { clone, side, hardStop: Date.now() + 15000 };
  }
  function thawSidebar() {
    if (!sideFreeze) return;
    const { clone, side } = sideFreeze;
    sideFreeze = null;
    side.style.removeProperty('visibility');
    positionSide(); // if X rebuilt the sidebar meanwhile, pin the new one before anyone sees it
    document.documentElement.classList.remove('xmc-frozen');
    clone.remove();
  }
  const navRestore = () => { thawSidebar(); unpin('nav'); unpin('side'); };
  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { // once you stop: X may have swapped layouts, so re-measure the sidebars
      navRestore();
      if (!root.hidden) { guard('position', position); if (colCount() !== columns.length) relayout(); }
    }, 200);
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
  // X's floating Grok and Chat buttons sit bottom right, on top of the sidebar's lower part. Give them their own room under it.
  const sideHeight = () => (settings.hideGrokDrawer && settings.hideDmDrawer ? '100vh' : 'calc(100vh - 84px)');
  // X moves its sidebar's contents as the page scrolls: a wrapper goes sticky or fixed, or gets an offset, so the contents slide
  // away or jump down. The hidden page scrolls all the time, so the wrappers (the first six levels) are made to stay put, and
  // re-checked the moment X touches their style or class.
  const WRAPPERS = Array.from({ length: 6 }, (_, i) => ':scope' + ' > div'.repeat(i + 1)).join(',');
  function holdStill(side) {
    for (const el of side.querySelectorAll(WRAPPERS)) {
      const st = el.style, pos = getComputedStyle(el).position;
      if ((pos === 'sticky' || pos === 'fixed') && st.position !== 'static') st.setProperty('position', 'static', 'important');
      if (st.top && st.top !== 'auto') st.setProperty('top', 'auto', 'important');
      if (st.bottom && st.bottom !== 'auto') st.setProperty('bottom', 'auto', 'important');
      if (st.marginTop && parseFloat(st.marginTop) > 48) st.setProperty('margin-top', '0', 'important');
      if (st.transform && st.transform !== 'none') st.setProperty('transform', 'none', 'important');
      if (st.translate && st.translate !== 'none') st.setProperty('translate', 'none', 'important');
    }
  }
  const sideWatch = { el: null, obs: null, queued: false };
  function watchSide(side) {
    if (sideWatch.el === side) return;
    if (sideWatch.obs) sideWatch.obs.disconnect();
    sideWatch.el = side;
    sideWatch.obs = new MutationObserver(() => {
      if (sideWatch.queued) return;
      sideWatch.queued = true;
      queueMicrotask(() => { sideWatch.queued = false; if (side.isConnected && side.dataset.xmcStyle !== undefined) holdStill(side); });
    });
    sideWatch.obs.observe(side, { attributes: true, attributeFilter: ['style', 'class'], subtree: true });
  }
  // With X's right-hand sidebar hidden, the floating Grok and Chat buttons would sit on top of the columns: give them a narrow
  // strip of their own down the right edge instead (kept while the chat panel is open, so the columns don't jump)
  let lastStrip = 0;
  function floatStrip() {
    if (!settings.hideSidebar || (settings.hideGrokDrawer && settings.hideDmDrawer)) return (lastStrip = 0);
    let w = 0, found = false;
    for (const el of document.querySelectorAll('[data-xmc-grok], [data-xmc-dm]')) {
      if (el.hasAttribute('data-xmc-grok') ? settings.hideGrokDrawer : settings.hideDmDrawer) continue;
      found = true;
      if (getComputedStyle(el).display === 'none') continue;
      const r = el.getBoundingClientRect();
      if (r.width && r.width <= 120 && r.height <= 120) w = Math.max(w, innerWidth - r.left + 8);
    }
    return (lastStrip = w ? Math.min(160, Math.round(w)) : found ? lastStrip : 0);
  }
  function positionSide() {
    const p = pin.side, side = p.el();
    if (sideFreeze && side && side.dataset.xmcStyle !== undefined) return; // a still copy is showing; leave a pinned one alone (a new one still gets pinned, hidden)
    if (!side || settings.hideSidebar) { root.style.right = floatStrip() + 'px'; unpin('side'); return; }
    if (p.fallback && Date.now() > p.retryAt) { p.fallback = false; p.fails = 0; }
    if (side.dataset.xmcStyle === undefined) {
      const r = side.getBoundingClientRect();
      if (!r.width) { root.style.right = '0px'; return; } // X hides it on narrow windows
      if (p.fallback) { root.style.right = Math.max(0, innerWidth - r.left + 12) + 'px'; return; }
      side.dataset.xmcStyle = side.getAttribute('style') || '';
      p.width = Math.round(r.width);
      side.style.cssText += `;position:fixed !important;top:0 !important;right:8px !important;left:auto !important;height:${sideHeight()} !important;` +
        `overflow-y:auto !important;scrollbar-width:none !important;margin:0 !important;transform:none !important;z-index:6 !important;width:${p.width}px !important`;
    } else if (!p.fallback) {
      const hh = sideHeight();
      if (side.style.getPropertyValue('height') !== hh) side.style.setProperty('height', hh, 'important');
      holdStill(side);
      watchSide(side);
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
  // The other small button in the same floating stack as `el` (X has renamed its Chat button before, so it can't be found by name
  // once Grok has been: whatever else sits beside or under Grok in that stack is Chat)
  function stackMate(container, el) {
    for (let n = el; n.parentElement;) {
      const p = n.parentElement;
      for (const s of p.children) {
        if (s === n || s.contains(el)) continue;
        const r = s.getBoundingClientRect();
        if (r.width >= 30 && r.width <= 120 && r.height >= 30 && r.height <= 120) return s;
      }
      if (p === container) return null;
      n = p;
    }
    return null;
  }
  const floatEls = new Set(); // X's floating elements we have found (so their size can be watched cheaply between scans)
  function scanFloaters() {
    if (document.hidden || Date.now() - lastScan < 1500) return;
    lastScan = Date.now();
    const rr = document.getElementById('react-root');
    const main = mainCol();
    const nav = pin.nav.el();
    const side = pin.side.el();
    if (!rr) return;
    // X mounts some floating things (the chat drawer, popups) under #layers, outside the page's own root
    const layers = document.getElementById('layers');
    for (const d of [...rr.querySelectorAll('div'), ...(layers ? layers.querySelectorAll('div') : [])]) {
      if (main && (main.contains(d) || d.contains(main))) continue;
      if ((nav && nav.contains(d)) || (side && (side.contains(d) || d.contains(side)))) continue;
      if (getComputedStyle(d).position !== 'fixed') continue;
      const r = d.getBoundingClientRect();
      if (!r.width || r.bottom < innerHeight * 0.4) continue;
      const g = d.matches(GROK_SEL) ? d : d.querySelector(GROK_SEL);
      let m = d.matches(DM_SEL) ? d : d.querySelector(DM_SEL);
      // the open chat panel is bigger than any other floating thing; everything else big is part of X's layout
      if ((r.width > 450 || r.height > 450) && !((g || m) && r.width <= 720 && r.height <= 820 && innerWidth - r.right <= 80)) continue;
      // X renames these buttons now and then: a small floating stack in the bottom-right corner is one of them whatever it is called
      // (not a compose button, and not a pop-up)
      if (!g && !m && r.width >= 36 && r.width <= 96 && r.height >= 36 && r.height <= 230 && innerWidth - r.right <= 56 && innerHeight - r.bottom <= 240
          && !d.querySelector('[href="/compose/post"], [data-testid*="FloatingActionButton"]') && !d.closest('[role="dialog"], [role="menu"], [aria-modal="true"]')) m = d;
      if (g && !m && r.width <= 450 && r.height <= 450) m = stackMate(d, g);
      if (g || m) {
        if (g) (g === d ? d : wrapperBelow(d, g, m)).dataset.xmcGrok = '1';
        if (m && m !== g) (m === d ? d : wrapperBelow(d, m, g)).dataset.xmcDm = '1';
        if ((!g || settings.hideGrokDrawer) && (!m || settings.hideDmDrawer)) continue; // all of it is being removed
      }
      floatEls.add(d);
    }
    for (const el of floatEls) if (!el.isConnected) floatEls.delete(el);
    guard('corner probe', probeCorner);
    updateFloaters();
  }
  // Finding the buttons by what is on screen in the bottom-right corner, not by how X positions them (X can keep them inside a
  // full-screen container, where no element of its own is "fixed"). Each point is asked what is on top there; the outermost button-sized
  // wrapper around it is Grok (if it holds Grok) or else Chat.
  const CORNER_PTS = [];
  for (const dx of [30, 50, 65, 80, 100]) for (const dy of [30, 57, 90, 124, 160, 200]) CORNER_PTS.push([dx, dy]);
  const OURS = '#xmc-root, #xmc-toast, #xmc-pill, #xmc-fab, #xmc-sidefreeze';
  const PAGE = '[data-testid="sidebarColumn"], [data-testid="primaryColumn"], header[role="banner"], nav, [role="dialog"], [role="menu"], [role="alertdialog"], [aria-modal="true"]';
  function cornerButton(x, y) {
    for (const e of document.elementsFromPoint(x, y)) {
      if (e === document.documentElement || e === document.body || e.id === 'react-root' || e.id === 'layers') continue;
      if (e.closest(OURS)) continue;
      if (e.closest(PAGE)) return null; // the page itself is under this point: nothing floats here
      let n = e;
      while (n.parentElement) {
        const r = n.parentElement.getBoundingClientRect();
        if (r.width > 100 || r.height > 100 || n.parentElement === document.body) break;
        n = n.parentElement;
      }
      const r = n.getBoundingClientRect();
      if (r.width < 24 || r.height < 24 || r.width > 120 || r.height > 120 || innerWidth - r.right > 140 || innerHeight - r.bottom > 320) return null; // a button, not a page wrapper
      if (n.querySelector(PAGE)) return null;
      for (let a = n.parentElement; a && a !== document.body; a = a.parentElement) { // an open chat panel's insides are not buttons
        const b = a.getBoundingClientRect();
        if (b.width > 200 && b.width <= 760 && b.height > 150 && b.height <= 900 && getComputedStyle(a).position === 'fixed') return null;
      }
      return n;
    }
    return null;
  }
  function probeCorner() {
    if (document.hidden || state.peek) return;
    for (const [dx, dy] of CORNER_PTS) {
      const n = cornerButton(innerWidth - dx, innerHeight - dy);
      if (!n || n.closest('[data-xmc-grok], [data-xmc-dm]') || n.querySelector('[data-xmc-grok], [data-xmc-dm]')) continue;
      if (n.matches(GROK_SEL) || n.querySelector(GROK_SEL)) n.dataset.xmcGrok = '1'; else n.dataset.xmcDm = '1';
      floatEls.add(n);
    }
  }
  function cornerReport() {
    const seen = new Set(), out = [];
    for (const [dx, dy] of CORNER_PTS) {
      for (const e of document.elementsFromPoint(innerWidth - dx, innerHeight - dy).slice(0, 4)) {
        if (seen.has(e) || e.closest(OURS) || out.length >= 16) continue;
        seen.add(e);
        const r = e.getBoundingClientRect();
        out.push({ at: dx + ',' + dy, tag: e.tagName.toLowerCase(), testid: e.dataset.testid || '', label: (e.getAttribute('aria-label') || '').slice(0, 30), id: e.id || '',
          pos: getComputedStyle(e).position, w: Math.round(r.width), h: Math.round(r.height), right: Math.round(innerWidth - r.right), bottom: Math.round(innerHeight - r.bottom),
          in: e.closest('#layers') ? 'layers' : 'root', marked: e.closest('[data-xmc-grok]') ? 'grok' : e.closest('[data-xmc-dm]') ? 'chat' : '' });
      }
    }
    return out;
  }
  // for the diagnostics: small fixed things in the bottom-right corner (what the Chat / Grok buttons are, and whether they were found)
  function floatingReport() {
    const out = [];
    for (const root of [document.getElementById('react-root'), document.getElementById('layers')]) {
      if (!root) continue;
      for (const d of root.querySelectorAll('*')) {
        if (out.length >= 12) return out;
        if (d.closest('#xmc-root')) continue;
        const cs = getComputedStyle(d);
        if (cs.position !== 'fixed') continue;
        const r = d.getBoundingClientRect();
        if (!r.width || r.width > 450 || r.height > 450 || innerWidth - r.right > 120 || innerHeight - r.bottom > 300) continue;
        out.push({ tag: d.tagName.toLowerCase(), testid: d.dataset.testid || '', label: (d.getAttribute('aria-label') || '').slice(0, 30), role: d.getAttribute('role') || '',
          in: d.closest('#layers') ? 'layers' : 'root', w: Math.round(r.width), h: Math.round(r.height), right: Math.round(innerWidth - r.right), bottom: Math.round(innerHeight - r.bottom),
          grok: d.hasAttribute('data-xmc-grok'), chat: d.hasAttribute('data-xmc-dm'), shown: cs.display !== 'none' });
      }
    }
    return out;
  }
  // Every few ticks: cut a hole in the columns where one of X's floating things (the chat panel when it is open) overlaps them,
  // and keep Grok beside Chat.
  function updateFloaters() {
    if (root.hidden) return;
    const rb = root.getBoundingClientRect();
    if (!rb.width) return;
    const rects = [];
    for (const el of floatEls) {
      if (!el.isConnected || getComputedStyle(el).display === 'none') continue;
      const r = el.getBoundingClientRect();
      if (!r.width || r.right < rb.left || r.left > rb.right) continue;
      if (r.width > innerWidth * 0.6 && r.height > innerHeight * 0.6) continue; // never cut the whole screen out of the columns
      if (rects.some((o) => r.left >= o.left && r.right <= o.right && r.top >= o.top && r.bottom <= o.bottom)) continue;
      rects.push(r);
    }
    state.floaters = rects.length;
    const sig = rects.map((r) => [r.left, r.top, r.width, r.height].map(Math.round).join(',')).join(';') + '|' + Math.round(rb.width) + ',' + Math.round(rb.height);
    if (sig !== state.holeSig) {
      state.holeSig = sig;
      if (!rects.length) root.style.clipPath = '';
      else {
        const holes = rects.map((r) => {
          const x = Math.round(r.left - rb.left - 4), y = Math.round(r.top - rb.top - 4);
          return `M${x} ${y}h${Math.round(r.width) + 8}v${Math.round(r.height) + 8}h-${Math.round(r.width) + 8}Z`;
        }).join('');
        root.style.clipPath = `path(evenodd, 'M0 0H${Math.round(rb.width)}V${Math.round(rb.height)}H0Z${holes}')`;
      }
    }
    dockGrok();
  }
  // Grok's button sits above Chat's; put it beside it (to the left) so the pair is one row in the corner. While the chat panel is
  // open Grok steps out of the way.
  const DOCK_PROPS = ['position', 'right', 'bottom', 'top', 'left', 'margin', 'visibility'];
  function undockGrok(grok) {
    if (!grok.dataset.xmcDocked) return;
    for (const p of DOCK_PROPS) grok.style.removeProperty(p);
    delete grok.dataset.xmcDocked;
  }
  // the visible button inside one of X's wrappers (the wrapper can be bigger than the button, with the button off to one side)
  const buttonRect = (el) => { const b = el.querySelector('button, [role="button"], a'); const r = b && b.getBoundingClientRect(); return r && r.width ? r : el.getBoundingClientRect(); };
  function dockGrok() {
    const chat = document.querySelector('[data-xmc-dm]'), grok = document.querySelector('[data-xmc-grok]');
    if (!grok) return;
    if (settings.hideGrokDrawer || settings.hideDmDrawer || settings.hideSidebar || !chat || chat === grok || chat.contains(grok) || grok.contains(chat)) { undockGrok(grok); return; }
    const c = chat.getBoundingClientRect();
    if (!c.width || !c.height) return;
    const set = (k, v) => grok.style.setProperty(k, v, 'important');
    grok.dataset.xmcDocked = '1';
    if (c.width > 120 || c.height > 120) { set('visibility', 'hidden'); return; } // the chat panel is open
    set('visibility', 'visible'); set('position', 'fixed'); set('margin', '0'); set('top', 'auto'); set('left', 'auto');
    // Grok's button goes to the left of Chat's, bottoms level, a small gap between: place its wrapper, then look at where the
    // buttons themselves ended up and move it by the difference
    const cb = buttonRect(chat);
    let right = Math.round(innerWidth - cb.right + cb.width + 12), bottom = Math.round(innerHeight - cb.bottom);
    set('right', right + 'px'); set('bottom', bottom + 'px');
    const gb = buttonRect(grok);
    right += Math.round(gb.right - (cb.left - 12));
    bottom += Math.round(gb.bottom - cb.bottom);
    set('right', right + 'px'); set('bottom', bottom + 'px');
  }

  // ---------- health ----------
  // Notice when something the extension relies on has stopped working (X changed its page), and say so.
  function healthSnapshot() {
    const now = Date.now();
    state.actionFails = state.actionFails.filter((x) => now - x < 120000);
    state.commentFails = state.commentFails.filter((x) => now - x < 300000);
    return {
      active: state.shown, isHome: where() === 'home', sinceRoute: (now - state.routeSince) / 1000, opsSeen: Object.keys(state.seenOps).length, tabCount: realTabs().length,
      waitingSeconds: state.waitingPage && state.waitSince ? (now - state.waitSince) / 1000 : 0,
      actionFails: state.actionFails.length, commentFails: state.commentFails.length, navFallback: pin.nav.fallback, sideFallback: pin.side.fallback,
    };
  }
  function updateHealth() {
    state.health = XMCLogic.healthIssues(healthSnapshot());
    const bad = state.health.length > 0;
    if (healthBtn.hidden === bad) healthBtn.hidden = !bad;
    if (bad) healthBtn.title = state.health.map((i) => i.text).join('\n') + '\nClick to copy a report you can paste into a bug report.';
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
    if (document.documentElement.dataset.xmcInstance !== instance) { retire(); return; }
    if (state.shown) { // a sidebar X has just rebuilt must be pinned at once, not at the next slow pass
      const sd = pin.side.el(), nv = pin.nav.el();
      if (sd && sd.dataset.xmcStyle === undefined && !pin.side.fallback) guard('pin side', positionSide);
      if (nv && nv.dataset.xmcStyle === undefined && !pin.nav.fallback) guard('pin nav', positionNav);
    }
    if (sideFreeze && (Date.now() > sideFreeze.hardStop || (!state.peek && !state.posting && !onPostPage() && !isModalRoute() && Date.now() - (state.lastPeekEnd || 0) > 700))) thawSidebar();
    if (tickN % 20 === 0) { guard('site', () => XMCSite.refresh()); guard('sidebar items', scanNavItems); }
    if (tickN % 5 === 1) { guard('list title', listTitle); guard('profile header', updateProfile); guard('sensitive notices', revealNative); }
    if (tickN % 10 === 5 && Date.now() - lastScrollAt > 500) guard('recycle', () => recycleCards(false));
    if (tickN % 15 === 0) guard('floaters', scanFloaters); else if (tickN % 3 === 0 && state.shown) guard('floaters', updateFloaters);
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
    if (pillShown && (tickN % 10 === 0 || !pill.isConnected)) placePill();
    updatePill(pillShown, active);
    document.documentElement.classList.toggle('xmc-onpost', onPostPage());
    document.documentElement.classList.toggle('xmc-pinside', !pin.side.fallback && !settings.hideSidebar);
    document.documentElement.classList.toggle('xmc-pinnav', !pin.nav.fallback);
    if (document.documentElement.classList.contains('xmc-acting')) { // never leave X's menus invisible for good
      if (!state.actingSince) state.actingSince = Date.now();
      else if (Date.now() - state.actingSince > 20000 && !state.posting && !state.peek) { document.documentElement.classList.remove('xmc-acting'); state.actingSince = 0; }
    } else state.actingSince = 0;
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
      state.awaiting = null; state.refreshing = null; lastSig = ''; state.sub = {}; state.showSeen = false; applyBar(); // X resets its dropdowns on a new page
    }
    if (tickN % 5 === 2) guard('hidden videos', stopHiddenVideos);
    if (tickN++ % 5 === 0) {
      guard('position', position);
      guard('tabs', syncTabs);
      guard('tab rules', tabRules);
      guard('bar', applyBar);
      guard('health', updateHealth);
    }
    const f = activeFeed();
    if (document.hidden) state.routeSince = Date.now(); // don't count time spent in a background tab
    if (!(f && f.items.length) && !state.awaiting && !(settings.disableHome && where() === 'home') && Date.now() - state.routeSince > 10000) {
      // No timeline data arrived (X changed its format, or the feed really is empty): show the normal feed.
      console.warn('[xmc] no timeline data after 10s; showing the normal feed. Seen:', JSON.stringify(state.seenOps),
        'feeds:', [...state.feeds.keys()]);
      state.failed = route; state.failedBy = 'error';
      toast('Columns couldn’t read this page, so X’s own page is showing. “Turn Columns On” tries again.');
      return;
    }
    guard('render', renderFeed);
    guard('pump', pump);
    if (tickN % 5 === 1) { state.xNewPill = where() === 'home' && !!findNewPostsPill(); guard('park', () => parkAtTop(f)); }
  }

  window.__xmc = { state, settings, view, diagnostics, recycle: recycleCards, downloads: () => savedDownloads }; // for debugging from the console

  loadAll().then(() => {
    ready = true;
    settingsChanged();
    tickTimer = setInterval(() => { const t0 = performance.now(); guard('tick', tick); tickTimes.push(performance.now() - t0); if (tickTimes.length > 50) tickTimes.shift(); }, TICK_MS);
  });
})();
