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
  const ext = (() => { const a = typeof browser !== 'undefined' ? browser : typeof chrome !== 'undefined' ? chrome : null; return a && a.runtime && a.runtime.id ? a : null; })(); // (Firefox's `browser`, or Chrome's `chrome`: both give promises; null on a page that is not an extension's, as in the tests)
  const storage = ext && ext.storage && ext.storage.local;
  let ready = false;
  let logCache = [], logPending = []; // the event log kept across reloads (see trace)
  const LOG_KEY = 'xmcLog', LOG_MAX = 300;
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
      logCache = validLog(storage ? v[LOG_KEY] : JSON.parse(localStorage.getItem('xmc.log') || '[]'));
      if (!settings.keepLog) clearLog();
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
      if (changes[LOG_KEY]) logCache = validLog(changes[LOG_KEY].newValue);
      for (const k in changes) if (k !== 'dlHistory' && k !== 'seenPosts' && k !== LOG_KEY && k !== 'xmcFeatures') next[k] = changes[k].newValue;
      if (changes.seenPosts) mergeSeen(changes.seenPosts.newValue);
      if (Object.keys(next).length || changes.dlHistory) onExternalChange(next, changes.dlHistory ? changes.dlHistory.newValue : undefined);
    });
  } else {
    window.addEventListener('storage', (e) => {
      if (e.key === 'xmc.settings') { try { onExternalChange(JSON.parse(e.newValue || '{}')); } catch { /* ignore */ } }
      if (e.key === 'xmc.seen') { try { mergeSeen(JSON.parse(e.newValue || '[]')); } catch { /* ignore */ } }
      if (e.key === 'xmc.log') { try { logCache = validLog(JSON.parse(e.newValue || '[]')); } catch { /* ignore */ } }
    });
  }

  // names that change with the Twitter/X branding setting
  const STR = {
    x: { repost: 'Repost', reposted: 'reposted', reposts: 'Reposts', posts: 'Posts', quote: 'Quote', undo: 'Undo repost', quotes: 'Quotes' },
    twitter: { repost: 'Retweet', reposted: 'retweeted', reposts: 'Retweets', posts: 'Tweets', quote: 'Quote Tweet', undo: 'Undo Retweet', quotes: 'Quote Tweets' },
  };
  const T = (k) => STR[settings.branding === 'twitter' ? 'twitter' : 'x'][k];

  // ---------- what works and what does not ----------
  // Every press of one of X's buttons, every load of comments or translation, and every timeline that arrives is counted by feature. A run of
  // failures switches that one feature off for a few minutes (see featureTracker), with a plain sentence on pressing it; the numbers are in
  // Copy diagnostics and, as a table, on the settings page. (`why` says what was looked for and not found, which is what a fix needs.)
  const feat = XMCLogic.featureTracker();
  const FEATURE_NAMES = { timeline: 'Timeline data from X', like: 'Like', bookmark: 'Bookmark', repost: 'Repost and quote', comments: 'Comments', 'comment actions': 'Like and bookmark on a comment', translate: 'Translate' };
  const syncOffClasses = () => { for (const k of ['like', 'bookmark', 'repost']) root.classList.toggle('xmc-off-' + k, feat.off(k)); };
  const featOk = (k) => { feat.ok(k); syncOffClasses(); };
  const featFail = (k, why) => { feat.fail(k, why); syncOffClasses(); };
  const offSentence = (k) => 'X\u2019s ' + FEATURE_NAMES[k] + ' button could not be found three times in a row, so it is switched off for a few minutes' + (feat.snapshot()[k] && feat.snapshot()[k].why ? ' (' + feat.snapshot()[k].why + ')' : '') + '. \u201cReport a problem\u201d sends the details.';

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
  // the last timeline and conversation X sent, kept (as they arrived) for "Save sample"; a response is only referred to here, not copied
  const rawByOp = new Map();
  function onResponse(url, body, reqBody) {
    const op = XMCParse.opOf(url);
    if (op) state.seenOps[op] = (state.seenOps[op] || 0) + 1;
    if (op && body && typeof body === 'object' && /Timeline|TweetDetail|Bookmarks|Likes|ListLatest|SearchTimeline|UserTweets|UserMedia/.test(op)) { rawByOp.delete(op); rawByOp.set(op, { url: url.split('?')[0], body }); while (rawByOp.size > 8) rawByOp.delete(rawByOp.keys().next().value); }
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
      const addPage = (old, pg) => { // more comments for a conversation we already have: only the new ones are added
        const have = new Set(old.replies.map((x) => x.id));
        const fresh = pg.replies.filter((x) => !have.has(x.id));
        if (fresh.length) { old.replies = old.replies.concat(fresh); old.more = pg.more; } // (a page we had already says nothing new about what is left)
        if (state.peek && state.peek.id === pg.focalId) { state.peek.page = (state.peek.page || 0) + 1; state.peek.fresh = (state.peek.fresh || 0) + fresh.length; }
        remember(fresh);
        const draw = pagers.get(pg.focalId); if (draw) setTimeout(draw, 0);
      };
      const have = d ? state.details.get(d.focalId) : null;
      if (d && have) addPage(have, d); // X sends the first page again whenever the post is opened again, then the later ones
      else if (d && d.paged) { const w = waitingPages.get(d.focalId) || []; w.push(d); waitingPages.set(d.focalId, w); } // arrived before the first page: kept for it
      else if (d) {
        state.details.set(d.focalId, d); if (state.peek && state.peek.id === d.focalId) state.peek.replies = d;
        for (const pg of waitingPages.get(d.focalId) || []) addPage(d, pg);
        waitingPages.delete(d.focalId);
        while (state.details.size > 200) state.details.delete(state.details.keys().next().value);
        remember([d.focal].concat(d.ancestors || [], d.replies));
      }
      return;
    }
    const r = XMCParse.parseResponse(body, url, reqBody);
    if (!r) return;
    if (r.items.length) featOk('timeline');
    else if (r.seen.tweetItems > 0) featFail('timeline', 'X sent ' + r.seen.tweetItems + ' posts and none could be read (' + droppedSummary() + ')');
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
      else if (state.late && Date.now() < state.late.until && slotFor(state.sel) === state.late.slot && state.cur.key !== f.key) { // the feed of the tab you switched to, after we had stopped waiting for it (a slow connection)
        state.cur = { route: rk, key: f.key }; state.feedByTab.set(state.late.slot, f.key); state.late = null;
      }
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
    } else if (d.source === 'xmc-age') {
      state.ageFlag = d.age; console.info('[xmc] age flag', JSON.stringify(d.age));
    } else if (d.source === 'xmc-fail') {
      const op = XMCParse.opOf(d.url) || '';
      if (/TweetDetail/.test(op)) state.detailFail = { status: d.status, at: Date.now() };
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
      state.late = { slot: slotFor(state.sel), until: Date.now() + 120000 }; // gave up waiting; if that tab's feed turns up after all, it is taken then
      state.awaiting = null;
    }
    if (state.cur.route === rk && state.cur.key && state.feeds.has(state.cur.key)) return state.feeds.get(state.cur.key);
    const k = state.feedByTab.get(slotFor(state.sel)) || state.latestByRoute.get(rk);
    if (k && state.feeds.get(k) && state.feeds.get(k).items.length) { state.cur = { route: rk, key: k }; return state.feeds.get(k); }
    return null;
  }

  // ---------- tiny DOM helpers ----------
  const h = (tag, props, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) { if (k.startsWith('aria-')) n.setAttribute(k, v); else n[k] = v; } // aria-* are attributes, not properties
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
    sound: ['M11 5L6 9H2v6h4l5 4V5z', 'M15.5 8.5a5 5 0 0 1 0 7', 'M19 5a9 9 0 0 1 0 14'],
    mute: ['M11 5L6 9H2v6h4l5 4V5z', 'M23 9l-6 6', 'M17 9l6 6'],
    link: ['M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7', 'M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7'],
    more: ['M5 12h.01', 'M12 12h.01', 'M19 12h.01'],
    menu: ['M4 6h16', 'M4 12h16', 'M4 18h16'],
    list: ['M9 6h12', 'M9 12h12', 'M9 18h12', 'M4 6h.01', 'M4 12h.01', 'M4 18h.01'],
    check: ['M5 12.5l4.5 4.5L19 7'],
    bird: [XMCSite.BIRD],
    refresh: ['M21 12a9 9 0 1 1-2.6-6.4', 'M21 4v5h-5'],
    filter: ['M3 5h18', 'M6 12h12', 'M10 19h4'],
    chev: ['M6 9l6 6 6-6'],
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
        box.classList.add('xmc-loading'); // a quiet tint until the picture has arrived, then it fades in
        node = h('img', { src: photoUrl(m.thumb, n === 1 ? 'large' : 'medium'), alt: m.alt, loading: 'eager', decoding: 'async' }); // the card is only drawn a few screens ahead, so loading now keeps photos from sitting black while you scroll
        node.dataset.lb = String(photoIdx++); node.tabIndex = 0; node.setAttribute('role', 'button'); node.setAttribute('aria-label', 'Open photo');
        const arrived = () => box.classList.remove('xmc-loading');
        node.addEventListener('load', arrived); node.addEventListener('error', arrived); setTimeout(arrived, 8000);
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
  // a picture's own width and height, so its box has its shape (and so its height) before the picture has arrived: nothing below it moves when it does
  const sized = (m) => (m && m.w > 0 && m.h > 0 ? { width: m.w, height: m.h } : {});
  function renderQuote(q) {
    if (q.unavailable) return h('div', { className: 'xmc-quote xmc-dim', textContent: 'This post is unavailable.' });
    noteQuote(q);
    const first = q.media[0];
    const box = h('div', { className: 'xmc-quote' },
      h('div', { className: 'xmc-qhead' },
        h('img', { className: 'xmc-qava', src: q.author.avatar, alt: '', loading: 'lazy' }),
        h('b', { textContent: q.author.name }), h('span', { className: 'xmc-dim', textContent: ' @' + q.author.handle })),
      h('div', { className: 'xmc-text xmc-qtext' }, renderSegs(q.segs)),
      first ? h('img', Object.assign({ className: 'xmc-qmedia' + (q.sensitive ? ' sens' : ''), src: photoUrl(first.thumb, 'medium'), alt: '', loading: 'lazy' }, sized(first))) : null);
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
  // A reply whose parent X did not send gets it looked up (X's own page for the post is read out of sight, as for comments), one at a
  // time, only for cards you have been looking at for a moment, only when you are not scrolling, and not more than eight a minute.
  const ctxObserver = new IntersectionObserver((entries) => {
    for (const en of entries) { const t = tweetOf.get(en.target); if (t) t.ctxSince = en.isIntersecting ? (t.ctxSince || Date.now()) : 0; }
  }, { threshold: 0.4 });
  let ctxLast = 0;
  function contextTick() {
    if (!settings.fetchContext) return;
    const now = Date.now();
    if (state.peek || state.posting || repliesWaiting || postView || state.fail || now < state.proxyUntil || now - ctxLast < 2500 || now - lastScrollAt < 1200) return;
    if (!bgAllowed()) return;
    const top = scroller.getBoundingClientRect().top - 4;
    const t = view.cards.find((x) => x.ctxSince && now - x.ctxSince > 900 && x.replyToId && !x.ctxTried && x.el && x.el.isConnected
      && !(x.parents && x.parents.length) && !contextChain(x).length && x.el.getBoundingClientRect().top >= top); // not one above you: growing it would push what you are reading
    if (!t) return;
    t.ctxTried = true; ctxLast = now; bgUsed();
    loadReplies(t, { wanted: () => !!(t.el && t.el.isConnected) }).then((res) => {
      const found = res && res.data && res.data.ancestors;
      if (found && found.length && t.el && t.el.isConnected) restoreCard(t, t.el);
      if (t.el) ctxObserver.unobserve(t.el);
    });
  }
  // like, repost, save and download, on the picture, shown when you point at it
  function hoverBar(t) {
    const bar = h('div', { className: 'xmc-hover' }, actionBtn('like', 'Like'), actionBtn('repost', T('repost')), actionBtn('bookmark', 'Bookmark'), actionBtn('download', 'Download media', 'download'));
    if (t.media.some((m) => m.type === 'video')) { // sound on or off without touching the player
      const off = icon('mute'), on = icon('sound'); off.classList.add('snd-off'); on.classList.add('snd-on');
      bar.append(h('button', { className: 'xmc-act xmc-snd' + (!settings.videoMuted && settings.autoplayVideo !== 'muted' && settings.volume > 0 ? ' on' : ''), type: 'button', title: 'Sound on / off', 'aria-label': 'Sound on or off' }, off, on));
    }
    return bar;
  }
  // the posts a reply is answering, oldest first (up to three): what X sent with it, what we have seen, or what was looked up
  function contextChain(t) {
    if (t.parents && t.parents.length) return t.parents.slice(-3);
    const looked = state.details.get(t.id);
    if (looked && looked.ancestors && looked.ancestors.length) return looked.ancestors.slice(-3);
    const chain = [];
    for (let id = t.replyToId, n = 0; id && n < 3; n++) {
      const p = state.byId.get(id);
      if (!p || !p.author || p === t) break;
      chain.unshift(p); id = p.replyToId;
    }
    return chain;
  }
  const usable = (p) => p && p.author && !p.unavailable && p.segs;
  // the post a reply is answering, above the reply: its words, pictures and what it quotes, as X shows it
  function renderParentContext(p, big) {
    const box = h('div', { className: 'xmc-pctx' },
      h('div', {}, h('b', { textContent: p.author.name }), h('span', { className: 'xmc-dim', textContent: ' @' + p.author.handle + ' · ' + relTime(p.createdAt) })),
      p.segs.length ? h('div', { className: 'xmc-pctx-text' + (big ? ' big' : '') }, renderSegs(p.segs)) : null,
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
  // a short post that is only words (no picture, video, link card or quote) is set larger, so it holds its own beside the pictures
  const onlyWords = (t) => settings.bigText && !t.media.length && !t.card && !t.quoted && textLength(t.segs) <= 140;
  function renderCard(t) {
    const card = h('article', { className: 'xmc-card' });
    tweetOf.set(card, t);
    if (t.repostedBy) card.append(h('div', { className: 'xmc-ctx' }, icon('repost'), h('span', { textContent: ctxText(t) })));
    const chain = t.replyToId || t.parent ? contextChain(t).filter(usable) : [];
    for (const p of chain) card.append(renderParentContext(p, onlyWords(t)));
    const context = chain.length;
    const sub = h('div', { className: 'xmc-sub' }, '@' + t.author.handle + ' · ',
      h('a', { className: 'xmc-time xmc-nav', href: t.url, title: new Date(t.createdAt).toLocaleString(), textContent: relTime(t.createdAt) }));
    if (settings.showSource && t.source) sub.append(h('span', { className: 'xmc-src', textContent: ' · via ' + t.source }));
    card.append(h('div', { className: 'xmc-head' },
      h('a', { className: 'xmc-avatar xmc-nav', href: '/' + t.author.handle, tabIndex: -1, 'aria-hidden': 'true' }, h('img', { src: t.author.avatar, alt: '', loading: 'lazy' })), // (the name beside it goes to the same place: this one is for the pointer only)
      h('div', { className: 'xmc-who' },
        h('a', { className: 'xmc-name xmc-nav', href: '/' + t.author.handle }, t.author.name, badge(t.author)), sub),
      moreButton()));
    if (t.replyTo && !context) card.append(h('div', { className: 'xmc-dim xmc-reply', textContent: 'Replying to @' + t.replyTo }));
    if (t.segs.length) {
      const long = textLength(t.segs) > 420;
      card.append(h('div', { className: 'xmc-text' + (long ? ' clamp' : '') + (onlyWords(t) ? ' big' : '') }, renderSegs(t.segs)));
      if (long) card.append(h('button', { className: 'xmc-more', type: 'button', textContent: 'Show more' }));
      if (needsTranslation(t)) card.append(h('button', { className: 'xmc-translate', type: 'button', textContent: 'Translate post', title: 'Opens the post and translates it' }));
    }
    if (t.media.length) {
      const pics = pageLayout().density === 'text' && !t.revealed ? mediaChip(t) : renderMedia(t);
      if (settings.hoverActions && pics.classList.contains('xmc-media') && hasMedia(t)) pics.append(hoverBar(t));
      card.append(pics);
    }
    if (t.card) card.append(renderLinkCard(t.card));
    if (t.quoted) card.append(renderQuote(t.quoted));
    card.dataset.thr = t.thread && t.thread.length ? t.thread.map((k) => k.id).join(',') : '';
    if (t.thread && t.thread.length) card.append(renderThread(t));
    const actions = h('div', { className: 'xmc-actions' });
    actions.append(actionBtn('reply', 'Show comments'), actionBtn('repost', T('repost')), actionBtn('like', 'Like'), actionBtn('bookmark', 'Bookmark'));
    actions.append(hasMedia(t) ? actionBtn('download', 'Download media', 'download') : h('span', { className: 'xmc-act xmc-gap', 'aria-hidden': 'true' }, icon('download'))); // (an empty slot keeps the icons where they are on every card)
    actions.append(actionBtn('share', 'Copy link', 'link'));
    if (t.counts.quote > 0) actions.append(h('a', { className: 'xmc-qlink xmc-nav', href: t.url + '/quotes', textContent: fmt(t.counts.quote) + ' ' + T('quotes') }));
    if (t.counts.views) actions.append(h('span', { className: 'xmc-views xmc-n', textContent: fmt(t.counts.views) + ' views' }));
    card.append(actions);
    updateActions(t, card);
    return card;
  }
  function updateActions(t, card) {
    const places = card ? [card] : [t.el, postView && postView.t === t ? postView.side : null];
    for (const where_ of places) {
      if (!where_) continue;
      const set = (act, on, n) => {
        for (const b of where_.querySelectorAll(`[data-act="${act}"]`)) {
          b.classList.toggle('on', !!on);
          const label = b.querySelector('.xmc-n');
          if (label) label.textContent = fmt(n);
        }
      };
      set('reply', !!where_.querySelector('.xmc-replies'), t.counts.reply);
      set('repost', t.state.reposted, t.counts.repost);
      set('like', t.state.liked, t.counts.like);
      set('bookmark', t.state.bookmarked, t.counts.bookmark);
      const done = settings.dlHistory && savedDownloads.has(t.id);
      for (const dl of where_.querySelectorAll('[data-act="download"]')) {
        dl.classList.toggle('done', !!done);
        dl.title = done ? 'Downloaded — click to download again' : 'Download media';
        dl.replaceChildren(icon(done ? 'done' : 'download'));
      }
    }
  }
  const refreshDownloadMarks = () => { for (const t of view.cards) updateActions(t); };

  // rough card height, used only to spread a batch of new cards over the columns
  function estimate(t, w) {
    const density = pageLayout().density;
    let hh = (density === 'normal' ? 100 : 84) + (t.repostedBy ? 22 : 0);
    hh += Math.ceil(textLength(t.segs) / Math.max(20, w / (7.4 * textScale()))) * 21 * textScale() + 8;
    if (t.media.length) hh += density === 'text' && !t.revealed ? 36 : (t.media.length === 1 ? w * Math.min(1 / clampRatio(t.media[0].w, t.media[0].h, photoFloor(t.media[0])), 1.67) : w * 0.5625) * (density === 'compact' ? 0.7 : 1);
    if (t.card) hh += density === 'normal' ? 200 : density === 'compact' ? 150 : 70;
    if (t.quoted) hh += density === 'text' ? 100 : 130;
    return Math.round(hh);
  }

  // ---------- overlay UI ----------
  const tabsEl = h('div', { className: 'xmc-tabs' });
  tabsEl.style.display = 'contents';
  const btn = (text, title, onclick, cls) => h('button', { textContent: text, title, onclick, type: 'button', className: cls || '' });
  const VIEW_LABELS = { all: () => 'Everything', posts: () => 'Posts only', reposts: () => T('reposts'), quotes: () => T('quotes'), replies: () => 'Replies', media: () => 'Media', photos: () => 'Photos', videos: () => 'Videos' };
  const viewEls = {};
  for (const key of Object.keys(VIEW_LABELS)) viewEls[key] = btn('', '', () => setFilter(key), 'xmc-chip');
  // X's profile Media tab is now split into Videos and Photos (a dropdown on the tab); these two press X's real choice
  const kindEls = {
    videos: btn('Videos', 'Show videos (X\u2019s own Videos view)', () => pickMediaKind('Videos'), 'xmc-chip'),
    photos: btn('Photos', 'Show photos (X\u2019s own Photos view)', () => pickMediaKind('Photos'), 'xmc-chip'),
  };
  const mediaSplit = () => { const tb = realTabs()[state.sel]; return !!tb && /^(videos|photos)$/i.test(tb.textContent.trim()); };
  const gearBtn = h('button', { className: 'xmc-gear', title: 'Settings', type: 'button', onclick: () => openOptions() }, icon('gear'));
  const healthBtn = h('button', { className: 'xmc-health', type: 'button', hidden: true, textContent: '\u26a0', onclick: () => reportProblem() });
  const refreshBtn = h('button', { className: 'xmc-refresh', title: 'Refresh', type: 'button', onclick: () => refresh() }, icon('refresh'), h('span', { className: 'xmc-newn' }));
  const nsfwBtn = h('button', { className: 'xmc-nsfw', type: 'button', onclick: () => cycleNsfw() }, h('span', { className: 'xmc-nsfwi' }), h('span', { className: 'xmc-nsfwl', textContent: 'NSFW' }));

  // One button for the number of columns: the number now, and a small arrow; it opens a short list to pick from (Auto first)
  const colLabel = h('span', { className: 'xmc-collabel' });
  const colBtn = h('button', { className: 'xmc-colbtn', type: 'button', onclick: () => openColumnsMenu() }, colLabel, icon('chev'));
  function openColumnsMenu(anchor) {
    const lay = pageLayout(), now = colCount();
    const fit = XMCLogic.autoCols(scroller.clientWidth - 24, { minColWidth: MIN_COL, maxAutoCols: 8 }, GAP); // the most that fit at this width
    const tick = (on) => (on ? '\u2713\u2002' : '\u2003\u2002');
    const items = [[tick(!lay.cols) + 'Auto (' + now + ' now)', () => setCols(0)]];
    for (let n = 1; n <= Math.max(fit, lay.cols || 0, 1); n++) items.push([tick(lay.cols === n) + n + (n === 1 ? ' column' : ' columns'), () => setCols(n)]);
    openMenu(anchor || colBtn, items);
  }
  // One "Show" menu for what to show (everything, posts only, reposts...), so the tab row above is X's alone
  const showLabel = h('span', { className: 'xmc-showlabel' });
  const showBtn = h('button', { className: 'xmc-showbtn', type: 'button', onclick: () => openShowMenu() }, icon('filter'), showLabel, icon('chev'));
  function showChoices() {
    if (mediaSplit()) { const kind = subFor(state.sel); return [['Videos', kind === 'videos', () => pickMediaKind('Videos')], ['Photos', kind === 'photos', () => pickMediaKind('Photos')]]; }
    return Object.keys(viewEls).filter((k) => !viewEls[k].hidden).map((k) => [VIEW_LABELS[k](), settings.filter === k, () => setFilter(k)]);
  }
  function openShowMenu(anchor) {
    const tick = (on) => (on ? '\u2713\u2002' : '\u2003\u2002');
    openMenu(anchor || showBtn, showChoices().map(([label, on, fn]) => [tick(on) + label, fn]));
  }
  const DENSITY_LABEL = { normal: 'Normal', compact: 'Compact', text: 'Text' };
  const densityBtn = btn('', '', () => { const all = XMCLogic.DENSITIES; setLayout({ density: all[(all.indexOf(pageLayout().density) + 1) % all.length] }); }, 'xmc-density');
  const seenBtn = btn('', '', () => toggleSeen(), 'xmc-seenbtn');
  seenBtn.hidden = true;
  densityBtn.hidden = DENSITY_SHELVED;
  // On a narrow bar the controls fold into one menu button (the refresh button, which shows "N new", and the tabs stay)
  const menuBtn = h('button', { className: 'xmc-menubtn', title: 'Menu', type: 'button', onclick: () => openBarMenu() }, icon('menu'));
  function openBarMenu() {
    const items = [];
    if (!showBtn.hidden) items.push(['Show: ' + showLabel.textContent.replace(/^Show:\s*/, '') + '  \u203a', () => openShowMenu(menuBtn)]);
    items.push(['Columns: ' + (pageLayout().cols ? colCount() : 'auto, ' + colCount()) + '  \u203a', () => openColumnsMenu(menuBtn)]);
    items.push(['Sensitive media: ' + ({ blur: 'blurred', show: 'shown', hide: 'hidden' }[settings.nsfw] || 'blurred'), () => cycleNsfw()]);
    if (!seenBtn.hidden) items.push([seenBtn.textContent, () => toggleSeen()]);
    items.push(['Settings', () => openOptions()]);
    openMenu(menuBtn, items);
  }
  const pageTitleEl = h('span', { className: 'xmc-pagetitle', hidden: true });
  const row1 = h('div', { className: 'xmc-bar1' }, pageTitleEl, tabsEl, h('span', { className: 'xmc-spacer' }), healthBtn, seenBtn, refreshBtn, showBtn, colBtn, densityBtn, nsfwBtn, gearBtn, menuBtn);
  const row2 = h('div', { className: 'xmc-bar2' }, ...Object.values(viewEls), ...Object.values(kindEls)); // the "All / Tweets / Retweets / ..." views, on a line of their own
  const bar = h('div', { className: 'xmc-bar' }, row1); // (row2, the chips, is no longer shown: its choices are in the Show menu)
  const statusEl = h('div', { className: 'xmc-status' });
  const colsEl = h('div', { className: 'xmc-cols' });
  const loaderText = h('span', { textContent: 'Loading more…' });
  const diagBtn = btn('Report a problem', 'Opens the issue page and copies a private snapshot (no post text) to paste into it', () => reportProblem(), 'xmc-diagbtn');
  const loaderEl = h('div', { className: 'xmc-loader', hidden: true }, spinner(), loaderText, diagBtn);
  const endEl = h('div', { className: 'xmc-end', hidden: true }, h('span', { textContent: 'That’s everything X has sent.' }),
    btn('Try loading more', '', () => { const f = activeFeed(); if (f) { f.exhausted = false; f.empty = 0; f.misses = 0; f.retryOnce = true; pump(); } }));
  const caughtText = h('span');
  const caughtEl = h('div', { className: 'xmc-end', hidden: true }, caughtText,
    h('span', { className: 'xmc-endbtns' },
      btn('Show what I\u2019ve read', '', () => toggleSeen()),
      btn('Keep loading older posts', '', () => { view.keepGoing = true; view.caughtUp = false; const f = activeFeed(); if (f) pump(); guard('render', renderFeed); })));
  const profileEl = h('section', { className: 'xmc-profile', hidden: true });
  const scroller = h('div', { className: 'xmc-scroller', tabIndex: -1 }, colsEl, loaderEl, caughtEl, endEl, statusEl);
  const hintEl = h('div', { className: 'xmc-hint', hidden: true },
    h('ul', {},
      ...['Click a post to open it.', 'Esc closes posts and the arrow keys move between posts.', 'Point at a picture to like, repost or save it.',
        'Move between opened pictures with your mouse scroll wheel.', 'Settings are under the gear in the upper right.'].map((t) => h('li', { textContent: t })),
      h('li', {}, 'Support us ', h('a', { href: (typeof XMCMeta !== 'undefined' && XMCMeta.donate) || 'https://ko-fi.com/falsehamartia', target: '_blank', rel: 'noopener noreferrer', textContent: 'here' }), '.')),
    h('button', { type: 'button', textContent: 'Got it', onclick: () => dismissHint() }));
  const root = h('div', { id: 'xmc-root', hidden: true }, bar, hintEl, scroller);
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

  // A wheel event's distance in pixels: Firefox sends a notch of a mouse wheel as lines (deltaMode 1, a deltaY of 3), Chrome as pixels (100), and a page may be a screen at a time.
  const wheelPx = (e, d) => (e.deltaMode === 1 ? d * 40 : e.deltaMode === 2 ? d * innerHeight : d);
  // Scrolling with the pointer over X's own sidebars: scroll the columns, as X does (the page scrolls wherever the pointer is).
  // Left alone if the sidebar itself has more to show in that direction.
  document.addEventListener('wheel', (e) => {
    if (retired || root.hidden || e.ctrlKey || e.defaultPrevented) return;
    const bar = e.target.closest && e.target.closest('[data-testid="sidebarColumn"], header[role="banner"]');
    if (!bar || bar.id === 'xmc-sidefreeze' || bar.id === 'xmc-navfreeze') return;
    const down = e.deltaY > 0;
    const room = bar.scrollHeight > bar.clientHeight + 2 && (down ? bar.scrollTop + bar.clientHeight < bar.scrollHeight - 1 : bar.scrollTop > 0);
    if (room && getComputedStyle(bar).overflowY !== 'visible') return;
    e.preventDefault();
    scroller.scrollBy({ top: e.deltaMode === 2 ? e.deltaY * scroller.clientHeight : wheelPx(e, e.deltaY) });
  }, { passive: false, capture: true });

  // Vimium and friends scroll "the element you last clicked in", so make that our columns
  const focusScroller = () => { if (!root.hidden && !postView && !/^(input|textarea|select)$/i.test((document.activeElement || {}).tagName || '')) scroller.focus({ preventScroll: true }); };
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
    if (cs.color && document.documentElement.style.getPropertyValue('--xmc-postfg') !== cs.color) document.documentElement.style.setProperty('--xmc-postfg', cs.color); // (the round Post button's plus takes it)
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
      : state.failedBy === 'error' && state.failed === routeKey() ? 'Columns couldn\u2019t load here, so X\u2019s own page is showing' + (state.failWhy ? ' (' + state.failWhy + ')' : '') + '. Click to try again.' : 'Click to show this page in columns';
    if (pill.title !== title) { pill.title = title; pill.setAttribute('aria-label', text); }
  }

  let toastTimer = 0;
  function toast(msg, undo, label, ms) {
    toastEl.textContent = msg; toastEl.hidden = false;
    if (undo) toastEl.append(h('button', { type: 'button', className: 'xmc-undo', textContent: label || 'Undo', onclick: () => { toastEl.hidden = true; clearTimeout(toastTimer); undo(); } }));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, ms || (undo ? 5000 : 2800));
  }
  // The gear opens the settings in a panel over the page: the settings page itself, in a frame (it is the same page the toolbar button
  // opens, so there is one thing to keep right). If the frame has not said it is up within three seconds (a page that will not frame it),
  // the page opens in a tab as it used to.
  let settingsPanel = null;
  function openOptionsTab() {
    if (ext && ext.runtime && ext.runtime.sendMessage) ext.runtime.sendMessage({ type: 'xmc-open-options' }).catch(() => {});
    else window.open(new URL('/ext/options.html', location.origin).href, '_blank', 'noopener');
  }
  function closeSettings() {
    if (!settingsPanel) return;
    clearTimeout(settingsPanel.timer);
    settingsPanel.wrap.remove();
    settingsPanel = null;
    if (!root.hidden && !postView) setTimeout(() => { if (!settingsPanel) focusScroller(); }, 0);
  }
  function openOptions(section) {
    const was = settingsPanel;
    closeSettings();
    if (was && !section) return; // (the gear again puts it away)
    const base = ext && ext.runtime && ext.runtime.getURL ? ext.runtime.getURL('popup.html') : new URL('/ext/popup.html', location.origin).href;
    const rgb = /(\d+)[, ]+(\d+)[, ]+(\d+)/.exec(root.style.getPropertyValue('--xmc-solid') || '');
    const dark = !rgb || (0.299 * rgb[1] + 0.587 * rgb[2] + 0.114 * rgb[3]) < 140; // (the panel is in X's colours, not the system's)
    const frame = h('iframe', { className: 'xmc-sframe', title: 'Settings', src: base + '?framed=1&theme=' + (dark ? 'dark' : 'light') + (section ? '#sec-' + section : '') });
    const panel = h('div', { id: 'xmc-settings', role: 'dialog', 'aria-label': 'Settings' }, frame);
    const wrap = h('div', { className: 'xmc-swrap' }, h('div', { className: 'xmc-sback', onpointerdown: closeSettings }), panel);
    document.body.append(wrap);
    settingsPanel = { wrap, frame, ready: false, timer: setTimeout(() => {
      if (!settingsPanel || settingsPanel.ready) return;
      trace('settings panel', 'did not come up in 3 s: the settings page was opened in a tab instead');
      closeSettings(); openOptionsTab();
    }, 3000) };
  }
  window.addEventListener('message', (e) => {
    if (!settingsPanel || e.source !== settingsPanel.frame.contentWindow || !e.data || typeof e.data !== 'object') return;
    if (e.data.xmc === 'settings-ready') { settingsPanel.ready = true; settingsPanel.frame.focus(); }
    else if (e.data.xmc === 'settings-close') closeSettings();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && settingsPanel) { e.preventDefault(); e.stopImmediatePropagation(); closeSettings(); } }, true);

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
    if (!settings.keepLog && (logCache.length || logPending.length)) clearLog(); // (turned off: what was kept goes)
    window.postMessage({ source: 'xmc-flags', skipAge: !!settings.skipAgeCheck }, location.origin); // the page hook turns X's age-verification flag off or on
    try { window.localStorage.setItem('xmcSkipAge', settings.skipAgeCheck ? '1' : '0'); } catch { /* storage blocked */ } // so the hook knows it at the next page load, before X draws anything
    XMCSite.apply(settings);
    root.classList.toggle('xmc-flat', settings.cardStyle === 'flat');
    root.style.setProperty('--xmc-ts', String(textScale()));
    root.classList.toggle('xmc-blur', !!settings.blurBehind && !blurGuard.off);
    applyBar();
    if (columns.length && (colCount() !== columns.length || layoutSig() !== view.layoutSig)) relayout(); // column or post-size settings changed
    refreshDownloadMarks();
    guard('extra nav', syncExtraNav);
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
    showBtn.hidden = !split && views.length <= 1; // nothing to choose between yet
    const cur = split ? (kind === 'photos' ? 'Photos' : 'Videos') : VIEW_LABELS[settings.filter]();
    if (showLabel.textContent !== 'Show: ' + cur) showLabel.textContent = 'Show: ' + cur;
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
  // Tab stays inside whatever is open over the page (the viewer, else the panel), so it never walks into the covered feed
  function trapTab(e, box) {
    const items = [...box.querySelectorAll('button, a[href], textarea, input, select, [tabindex="0"]')].filter((x) => !x.disabled && x.tabIndex >= 0 && !x.closest('[hidden]') && x.getClientRects().length); // (a tabindex of -1 is not reached by Tab, so it cannot be where the walk starts or ends)
    if (!items.length) { e.preventDefault(); return; }
    const first = items[0], last = items[items.length - 1], now = document.activeElement;
    if (!box.contains(now)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && now === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && now === last) { e.preventDefault(); first.focus(); }
  }
  window.addEventListener('keydown', (e) => {
    if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && (e.code === 'BracketLeft' || e.code === 'BracketRight') && !/^(input|textarea|select)$/i.test((e.target || {}).tagName || '') && !(e.target && e.target.isContentEditable) && document.documentElement.classList.contains('xmc-on') && !root.hidden) {
      e.preventDefault(); e.stopPropagation(); setPanel(e.code === 'BracketLeft' ? 'left' : 'right'); return; // Alt+[ the menu, Alt+] the right panel
    }
    if (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey) { const open = lightbox ? lightbox.el : postView ? postView.el : null; if (open) trapTab(e, open); }
    if ((e.key === 'Enter' || e.key === ' ') && e.target && e.target.dataset && e.target.dataset.lb !== undefined && e.target.getAttribute('role') === 'button') { e.preventDefault(); e.target.click(); }
    if (e.key === 'Escape') { if (lightbox) closeLightbox(); else if (menuEl) closeMenu(); else if (postView) { if (postView.parent) openPostView(postView.parent, true); else closePostView(); } }
    if (lightbox && e.key === 'ArrowRight') stepLightbox(1);
    if (lightbox && e.key === 'ArrowLeft') stepLightbox(-1);
    if (postView && !lightbox && (e.key === 'ArrowRight' || e.key === 'ArrowLeft') && !/^(input|textarea|select|video)$/i.test((e.target || {}).tagName || '')) { // in the pictures: the next picture; anywhere else in the panel: the next post
      e.preventDefault(); const dir = e.key === 'ArrowRight' ? 1 : -1, car = e.target.closest && e.target.closest('.xmc-car');
      if (car) car._go(dir); else stepPostView(dir);
    }
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
  const RENDER_KEYS = ['branding', 'showSource', 'autoplayVideo', 'tallPhotos', 'hoverActions', 'bigText', 'textSize'];
  const TEXT_SCALE = { small: 0.92, normal: 1, large: 1.15, xlarge: 1.3 }; // the stylesheet multiplies every text size in posts and the panel by --xmc-ts
  const textScale = () => TEXT_SCALE[settings.textSize] || 1;
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
    clearGhosts();
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
      if (t.replyToId && settings.fetchContext) ctxObserver.observe(el);
      heights[i] += guess + GAP;
    }
  }
  // Where the SHORTEST column ends, in scroller coordinates. That is what decides when to draw more: the tallest
  // column says nothing about the blank space under a short one.
  function shortestBottom() {
    if (!columns.length) return 0;
    const base = scroller.getBoundingClientRect().top - scroller.scrollTop;
    let m = Infinity;
    for (const c of columns) {
      const g = c.lastElementChild; // a grey placeholder card at the end doesn't count as content
      m = Math.min(m, (g && g.classList.contains('xmc-ghost') ? g.getBoundingClientRect().top - GAP : c.getBoundingClientRect().bottom) - base);
    }
    return m;
  }
  // grey placeholder cards at the foot of each column, only while there is blank space on screen and posts are on their way
  const ghostCard = () => h('div', { className: 'xmc-ghost', 'aria-hidden': 'true' },
    h('div', { className: 'xmc-gh' }, h('i'), h('div', {}, h('b'), h('b'))), h('b'), h('b'), h('b', { className: 'pic' }));
  function clearGhosts() { for (const c of columns) { const g = c.lastElementChild; if (g && g.classList.contains('xmc-ghost')) g.remove(); } }
  function syncGhosts(on) {
    if (!on) { clearGhosts(); return; }
    for (const c of columns) { const g = c.lastElementChild; if (!(g && g.classList.contains('xmc-ghost'))) c.append(ghostCard()); }
  }
  function relayout() {
    const n = colCount();
    const lay = pageLayout();
    view.layoutSig = layoutSig();
    colLabel.textContent = String(n);
    colBtn.title = lay.cols ? 'Columns: ' + n + (lay.cols > n ? ' (all that fit at this width)' : '') + ' \u2014 click to change' : 'Columns: automatic, ' + n + ' at this width \u2014 click to change';
    root.classList.toggle('xmc-compact', lay.density === 'compact');
    root.classList.toggle('xmc-textonly', lay.density === 'text');
    densityBtn.textContent = DENSITY_LABEL[lay.density];
    densityBtn.title = 'Post size: ' + DENSITY_LABEL[lay.density].toLowerCase() + ' \u2014 click to change';
    const real = view.cards.map((t) => (t.el ? t.el.offsetHeight : 0));
    columns = Array.from({ length: n }, () => h('div', { className: 'xmc-col' }));
    colsEl.classList.toggle('auto', !lay.cols); // automatic: columns keep about one width, the window shows more or fewer
    root.style.setProperty('--xmc-colw', XMCLogic.minColFor(settings, lay.density) + 'px');
    colsEl.replaceChildren(...columns);
    if (!profileEl.hidden) columns[0].prepend(profileEl); // a profile's header is the first card of the first column; the posts flow round it
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
    if (feed) enterCols();
  }
  // the columns fade up a little when a new set of posts is drawn (a tab, a filter, a new page), not as you scroll
  let booted = false;
  function enterCols() {
    colsEl.classList.remove('xmc-enter', 'xmc-first');
    void colsEl.offsetWidth;
    if (!booted) { // the first draw of this page load: the columns settle in one after another (see the stylesheet), and how long it took is logged
      booted = true;
      colsEl.classList.add('xmc-first');
      trace('first-draw', Math.round(performance.now()) + ' ms after the page began');
      setTimeout(() => colsEl.classList.remove('xmc-enter', 'xmc-first'), 300); // (a timer, not animationend: a tab in the background never runs the animation)
    }
    colsEl.classList.add('xmc-enter');
  }
  colsEl.addEventListener('animationend', (e) => { if (e.target === colsEl) colsEl.classList.remove('xmc-enter'); });
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
    if (view.feedKey !== f.key || view.version !== f.version || view.sig !== filterSig() || view.renderSig !== rs) { const newFeed = view.feedKey !== f.key; resetView(f); if (newFeed) applyBar(); } // (the Show list and the rest of the bar match this feed from its first card, not from the next slow pass)
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
    syncGhosts(waiting && shortestBottom() < scroller.scrollTop + scroller.clientHeight);
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
  // Laying the columns out again moves every post into new columns, and a video that is moved leaves full screen: so while one is in full
  // screen (or has just been pressed, the window not yet full), a change of width waits. The window growing to the whole screen is
  // exactly such a change.
  let lastVideoPress = 0, layoutCatchUp = 0;
  document.addEventListener('pointerdown', (e) => { if (e.target.closest && e.target.closest('video')) lastVideoPress = Date.now(); }, true);
  const layoutHeld = () => !!document.fullscreenElement || Date.now() - lastVideoPress < 2500;
  function relayoutIfNeeded() {
    clearTimeout(layoutCatchUp);
    if (root.hidden || document.documentElement.classList.contains('xmc-panelanim') || colCount() === columns.length) return; // (not while a side panel is sliding: the posts are laid out once, when it has stopped)
    if (layoutHeld()) { layoutCatchUp = setTimeout(relayoutIfNeeded, 600); return; }
    relayout();
  }
  new ResizeObserver(relayoutIfNeeded).observe(scroller);

  // ---------- keys that scroll the page behind the columns ----------
  // Vimium (j, k, d, u, gg, G) scrolls the element last clicked, or the whole page when that is not inside something that scrolls: before any
  // click, or after one on the menu or the top bar, that is X's own page, hidden behind the columns, and nothing seems to happen. So when a
  // plain key has just been pressed and X's page moves that nobody here moved, the columns move by the same amount and X's page goes back
  // where it was. (Only letters, Space and the paging keys count: Esc closes a post, and X scrolls its own page back when we go back.)
  // X's page is also kept a little way from its top and bottom while it is idle, or "up" and "back to the top" would have no room to move.
  let ownScrollAt = 0, keyAt = 0, hiddenY = window.scrollY;
  const nativeScrollTo = window.scrollTo.bind(window), nativeScrollBy = window.scrollBy.bind(window);
  window.scrollTo = (...a) => { ownScrollAt = Date.now(); return nativeScrollTo(...a); }; // (what this script does to X's page is not a key's doing)
  window.scrollBy = (...a) => { ownScrollAt = Date.now(); return nativeScrollBy(...a); };
  document.addEventListener('keydown', (e) => {
    const t = e.target, editable = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ''));
    if (e.isTrusted && !editable && !e.ctrlKey && !e.metaKey && !e.altKey && (e.key.length === 1 || /^(PageUp|PageDown|Home|End)$/.test(e.key))) keyAt = Date.now();
  }, true);
  function followHiddenPage() {
    const y = window.scrollY, dy = y - hiddenY, now = Date.now();
    if (!dy) return;
    const keyed = now - keyAt < 700 && now - ownScrollAt > 60 && state.shown && !root.hidden && !state.peek && !state.posting && now - (state.lastPeekEnd || 0) > 1500 && !document.getElementById('xmc-lightbox');
    if (!keyed) { hiddenY = y; return; }
    const target = postView ? postView.side : scroller; // (with a post open, the keys are for its comments)
    if (target && target.scrollHeight > target.clientHeight) {
      const jump = Math.abs(dy) > innerHeight * 1.2; // gg and G go the whole way: so do the columns
      if (jump && y <= 60) target.scrollTop = 0;
      else if (jump && y >= document.documentElement.scrollHeight - innerHeight - 60) target.scrollTop = target.scrollHeight;
      else target.scrollTop += dy;
      traceOnce('keys', 'a key scrolled the page behind the columns by ' + Math.round(dy) + ': the columns moved instead', 20000);
    }
    nativeScrollTo(0, hiddenY); // (X's page goes back: hiddenY is left as it was, so that this scroll comes out as no change)
  }
  // Firefox moves a page whose root is overflow:hidden (X's is, under the columns) without firing a scroll event on it, so Vimium's keys would
  // do nothing there: the page's position is looked at as well, a few times a second (a read of scrollY, nothing more).
  window.addEventListener('scroll', followHiddenPage, { passive: true });
  setInterval(() => { if (!document.hidden) followHiddenPage(); }, 50);
  function keepHiddenPageRoom() {
    if (!state.shown || root.hidden || state.peek || state.posting || document.hidden || postView) return;
    const now = Date.now();
    if (now - ownScrollAt < 2000 || now - keyAt < 2000 || now - (state.lastPeekEnd || 0) < 2000) return;
    const max = document.documentElement.scrollHeight - innerHeight;
    if (max < 300) return; // (too short to give room both ways)
    const y = window.scrollY, want = Math.max(60, Math.min(max - 60, y));
    if (Math.abs(want - y) > 1) { window.scrollTo(0, want); hiddenY = want; }
  }

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
      theme: (() => { const c = document.querySelector('.xmc-card'); const ccs = c && getComputedStyle(c); const rcs = getComputedStyle(root); return { cardStyle: settings.cardStyle, seeThrough: root.classList.contains('xmc-seethru'), fg: rcs.getPropertyValue('--xmc-fg').trim(), bg: rcs.getPropertyValue('--xmc-bg').trim(), cardBg: ccs && ccs.backgroundColor, cardEdge: ccs && ccs.borderTopColor, bodyBg: getComputedStyle(document.body).backgroundColor, htmlBg: getComputedStyle(document.documentElement).backgroundColor }; })(),
      ageFlag: state.ageFlag || null,
      features: featureReport(),
      trace: TRACE.slice(-120),
      log: { thisLoad: loadId, kept: !!settings.keepLog, earlier: earlierLog() }, // (from before this page load, and from other x.com tabs; the times are this computer's)
      commentTimes: state.commentTimes || [],
      commentFailures: state.commentFailures || [],
      commentsInProgress: state.peek ? state.peek.id : null, moreProbe: state.moreProbe || null, translateProbe: state.translateProbe || null, translateTimes: state.translateTimes || [], autoTranslate: state.autoXlate || null, popProbe: state.popProbe || null, panels: panelProbe(), cachedConversations: state.details.size, tabMenuTrace: state.tabTrace || [], health: state.health.map((i) => i.key),
      tabs: { labels: realTabs().map((x) => x.textContent.trim().slice(0, 20)), xSelected: realTabs().findIndex((x) => x.getAttribute('aria-selected') === 'true'), weThink: state.sel, homeInit: state.homeInit, awaiting: !!state.awaiting, dropdownTabs: [...state.menuTabs], picked: state.sub, onFeed: state.cur.key ? state.cur.key.split('|')[0] : null },
      floating: floatingReport(),
      corner: cornerReport(),
      mode: { walkOnly: !!state.walkOnly, tickMsAverage: Math.round(tickTimes.reduce((a, b) => a + b, 0) / Math.max(1, tickTimes.length)), tickMsWorst: Math.round(Math.max(0, ...tickTimes)) },
    }, null, 2);
  }
  // opens the project's issue page and copies the details to paste into it (nothing is sent anywhere by the extension itself)
  async function reportProblem() {
    if (typeof XMCMeta !== 'undefined' && XMCMeta.repo) window.open(XMCMeta.repo + '/issues/new/choose', '_blank', 'noopener');
    try { await navigator.clipboard.writeText(diagnostics()); toast('Details copied. Paste them into the report.'); } catch { console.log('[xmc] diagnostics', diagnostics()); toast('Couldn\u2019t copy; the details are in the browser console.'); }
  }
  // A file for whoever has to fix a change in X's pages: the shape of the last timelines X sent and the markup of the buttons this extension
  // presses, with the words, names and addresses taken out (src/sample.js). Nothing is sent; the file goes to the browser's downloads.
  function saveSample() {
    try {
      const ops = {};
      for (const [op, { url, body }] of rawByOp) {
        let j = XMCSample.sanitizeJson(body);
        const raw = JSON.stringify(j);
        if (raw.length > 600000) j = { truncated: true, note: 'over 600 kB: not kept' };
        ops[op] = { url, json: j };
      }
      const art = articles()[0], controls = {};
      if (art) {
        for (const k of ['like', 'repost', 'bookmark', 'reply', 'share', 'tweetText']) { const el = art.querySelector(XMCLogic.controlSel(k)); if (el) controls[k] = XMCSample.sanitizeMarkup(el.closest('[role="group"]') && k !== 'tweetText' ? el.closest('[role="group"]') : el); }
        try { const tc = translateControl(art); if (tc) controls.translate = XMCSample.sanitizeMarkup(tc); } catch { /* none on this post */ }
        controls.article = XMCSample.sanitizeMarkup(art).slice(0, 60000);
      }
      const tabs = document.querySelector('[data-testid="primaryColumn"] [role="tablist"]'); if (tabs) controls.tabs = XMCSample.sanitizeMarkup(tabs);
      const nav = pin.nav.el(); if (nav) { const home = nav.querySelector('a[href="/home"]'); if (home) controls.homeLink = XMCSample.sanitizeMarkup(home); const first = nav.querySelector('nav'); if (first) controls.nav = XMCSample.sanitizeMarkup(first).slice(0, 30000); }
      const sample = { kind: 'multi-column-for-x sample', version: featureReport().version, taken: new Date().toISOString().slice(0, 10), userAgent: navigator.userAgent, pageLang: document.documentElement.lang || '', ops, controls, probe: state.probe || null, features: feat.snapshot(), parse: XMCParse.stats };
      const blob = new Blob([JSON.stringify(sample, null, 1)], { type: 'application/json' });
      const a = h('a', { href: URL.createObjectURL(blob), download: 'multi-column-for-x-sample-' + sample.taken + '.json' });
      document.body.append(a); a.click(); a.remove();
      toast('Sample saved to your downloads (' + Object.keys(ops).length + ' timelines, ' + Object.keys(controls).length + ' pieces of markup). Send it with the report.');
      trace('sample', Object.keys(ops).join(',') + ' / ' + Object.keys(controls).join(','));
    } catch (err) { toast('Couldn’t make a sample: ' + String((err && err.message) || err).slice(0, 100)); }
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
  const findArticle = (id) => { const all = articles().filter((a) => articleId(a) === id); return all.find((a) => a.getClientRects().length) || all[0] || null; }; // (one that is on show, if X still has a stale copy)

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
  async function realArticle(t, budget) { // budget: give up after this many ms (visits then ask X's router instead of hunting on)
    state.proxyUntil = Date.now() + 20000;
    let art = findArticle(t.id);
    if (art) return art;
    const began = Date.now();
    const f = activeFeed();
    const idx = f && f.index.get(t.id);
    if (idx === undefined) return null;
    for (let i = 0; i < 70 && !art; i++) {
      if (budget && Date.now() - began > budget) break;
      const here = articles().map((a) => f.index.get(articleId(a))).filter((n) => n !== undefined).sort((a, b) => a - b);
      let dy = here.length ? (idx - here[here.length >> 1]) * 520 : idx * 520 - window.scrollY;
      if (Math.abs(dy) < innerHeight * 0.5) dy = Math.sign(dy || 1) * innerHeight * 0.5;
      const hop = Math.min(innerHeight * 8, Math.max(innerHeight * 1.5, Math.abs(dy) * 0.7)); // far away: bigger steps (still steps, never one leap), small ones near the post
      window.scrollBy(0, Math.max(-hop, Math.min(hop, dy)));
      art = await waitFor(() => findArticle(t.id), 150); // as soon as X has drawn it, not after a fixed wait
    }
    if (art && !timeLinkOf(art, t.id)) await sleep(120); // (a post whose time stamp is already there needs no settling time)
    return art;
  }
  // realArticle keeps the loader away from X's page for up to 20s while it works; the moment the job is done, give it back
  // (this window used to stay shut for 20s after every like or bookmark, which is what made loading stall)
  const settleProxy = () => { state.proxyUntil = Date.now() + 800; };
  async function withReal(t, fn) {
    try {
      const art = await realArticle(t, 4000); // (a press is shown at once, so this can look longer than a comment visit does before it asks X's router)
      if (art) { return (await fn(art)) !== false; } // (a callback that returns false did not find what it presses)
      // a post that is not in X's list (one seen only as a quote, or one X has not drawn): its own page has the same buttons
      if (!t.url) return false;
      let done = false;
      await inQueue(() => visitPost(t, {}, {}, async ({ opened }) => {
        if (!opened) return;
        const page = await waitFor(() => findArticle(t.id), 6000);
        if (page) { const r = await fn(page); await sleep(500); done = r !== false; }
      }));
      return done;
    } finally { settleProxy(); }
  }
  const normHref = (s) => String(s || '').split('?')[0].toLowerCase();
  // the link on a post's time stamp, found by the post's number (exact), not by how X spells the handle
  const timeLinkOf = (art, id) => [...art.querySelectorAll('a[href]')].find((a) => idOfHref(a.getAttribute('href')) === id && a.querySelector('time'));
  // a link to a post we already have opens in the panel; anything else (a profile, a post we haven't seen) in a new tab
  const quoteById = new Map(); // posts seen only as a quote inside another post: they open in the panel too
  const noteQuote = (q) => { if (q && q.id && q.author) { quoteById.delete(q.id); quoteById.set(q.id, q); while (quoteById.size > 400) quoteById.delete(quoteById.keys().next().value); } };
  function openHref(href) {
    const m = /^\/[^/]+\/status\/(\d+)\/?$/.exec(new URL(href, location.origin).pathname);
    const tw = m && (state.byId.get(m[1]) || quoteById.get(m[1]));
    if (tw && tw.author) { openPostView(tw); return true; }
    window.open(new URL(href, location.origin).href, '_blank', 'noopener');
    return false;
  }
  function openOnX(t) { if (settings.openIn === 'sametab') navigate(t.url, t); else window.open(new URL(t.url, location.origin).href, '_blank', 'noopener'); }
  async function navigate(href, t) {
    if (settings.openIn === 'view') { openHref(href); return; }
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

  async function toggleAction(t, key, onSel, offSel, countKey, quiet) {
    const want = !t.state[key];
    t.state[key] = want;
    if (countKey) t.counts[countKey] = Math.max(0, t.counts[countKey] + (want ? 1 : -1));
    updateActions(t);
    const kind = key === 'liked' ? 'like' : 'bookmark';
    let missing = false;
    const ok = await withReal(t, (art) => {
      const b = art.querySelector(want ? onSel : offSel);
      if (b) { fire(b); return true; }
      if (art.querySelector(want ? offSel : onSel)) return true; // X already shows it as wanted (liked on another device, say): nothing to press, and not a missing button
      missing = true; return false;
    });
    if (ok) featOk(kind);
    else if (missing) featFail(kind, 'not found on X\u2019s post: ' + (want ? onSel : offSel));
    if (!ok) {
      state.actionFails.push(Date.now());
      t.state[key] = !want;
      if (countKey) t.counts[countKey] = Math.max(0, t.counts[countKey] + (want ? -1 : 1));
      updateActions(t);
      toast(missing ? 'Couldn\u2019t find X\u2019s ' + (kind === 'like' ? 'Like' : 'Bookmark') + ' button on that post.' : 'Couldn’t reach that post just now — try again in a moment');
    } else if (key === 'bookmarked' && !quiet) toast(want ? 'Saved to bookmarks' : 'Removed from bookmarks', () => toggleAction(t, key, onSel, offSel, countKey, true));
  }
  async function repost(t, quote, quiet) {
    const doc = document.documentElement;
    if (!quote) doc.classList.add('xmc-acting'); // X's little repost menu is clicked for us; keep it from flashing
    try {
      let missing = '';
      const ok = await withReal(t, async (art) => {
        const b = art.querySelector(XMCLogic.controlSel('repost'));
        if (!b) { missing = 'not found on X\u2019s post: ' + XMCLogic.controlSel('repost'); return false; }
        fire(b);
        if (quote) {
          const item = await waitFor(() => [...document.querySelectorAll('#layers [role="menuitem"]')]
            .find((m) => /quote/i.test(m.textContent)) || document.querySelectorAll('#layers [role="menuitem"]')[1], 1500);
          if (item) fire(item); else { missing = 'X\u2019s repost menu did not offer Quote'; return false; }
        } else {
          const confirm = await waitFor(() => document.querySelector(XMCLogic.controlSel('repostConfirm')), 1500);
          if (!confirm) { missing = 'X\u2019s repost menu did not offer Repost: ' + XMCLogic.controlSel('repostConfirm'); return false; }
          if (confirm) {
            fire(confirm);
            t.state.reposted = !t.state.reposted;
            t.counts.repost = Math.max(0, t.counts.repost + (t.state.reposted ? 1 : -1));
            updateActions(t);
            if (!quiet) toast(t.state.reposted ? 'Reposted' : 'Repost removed', () => repost(t, false, true));
          }
        }
      });
      if (ok) featOk('repost'); else if (missing) featFail('repost', missing);
      if (!ok) { state.actionFails.push(Date.now()); toast(missing ? 'Couldn\u2019t find X\u2019s Repost button or menu on that post.' : 'Couldn’t reach that post just now — try again in a moment'); }
    } finally { setTimeout(() => doc.classList.remove('xmc-acting'), 500); }
  }

  // every history step back that we take ourselves is noted, so the Back button (the person's) can be told from them
  let ownBackAt = 0;
  // A rolling log of what the extension did and anything that looked wrong (X's own page showing through, things shifting), kept
  // for Copy diagnostics so a problem can be read from it without a recording. No post text, only ids and kinds of event.
  const TRACE = [], traceAt = Date.now(), traceSeen = {};
  // The same events are kept in the browser's own storage, so a problem is still there after a reload (a page that flickered and
  // then reloaded is otherwise forgotten). [time, page-load id, kind, info]; the newest 300 are kept, shared by every x.com tab.
  const loadId = Math.random().toString(36).slice(2, 5);
  let logTimer = 0;
  const validLog = (v) => (Array.isArray(v) ? v.filter((e) => Array.isArray(e) && typeof e[0] === 'number' && typeof e[2] === 'string') : []);
  function writeLog(list) {
    logCache = list;
    if (storage) storage.set({ [LOG_KEY]: list }).catch(() => {});
    else { try { localStorage.setItem('xmc.log', JSON.stringify(list)); } catch { /* private mode */ } }
  }
  function clearLog() {
    logPending = []; logCache = [];
    if (storage) storage.remove(LOG_KEY).catch(() => {});
    else { try { localStorage.removeItem('xmc.log'); } catch { /* private mode */ } }
  }
  async function flushLog(fast) { // fast: the page is going away, so there is no time to read the stored log first
    logTimer = 0;
    if (!logPending.length) return;
    const mine = logPending; logPending = [];
    if (!settings.keepLog) return;
    try {
      const base = fast === true ? logCache : validLog(storage ? (await storage.get(LOG_KEY))[LOG_KEY] : JSON.parse(localStorage.getItem('xmc.log') || '[]'));
      writeLog(base.concat(mine).slice(-LOG_MAX));
    } catch { /* storage unavailable */ }
  }
  function earlierLog() { // what was kept from before this page load (and from other x.com tabs), oldest first
    const p = (n) => String(n).padStart(2, '0');
    return logCache.filter((e) => e[1] !== loadId).slice(-150).map((e) => { const d = new Date(e[0]); return p(d.getDate()) + '/' + p(d.getMonth() + 1) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) + ' ' + e[1] + ' ' + e[2] + (e[3] ? ' ' + e[3] : ''); });
  }
  function trace(kind, info) {
    const text = info === undefined ? '' : String(info).slice(0, 80);
    TRACE.push([Date.now() - traceAt, kind, text]);
    if (TRACE.length > 160) TRACE.shift();
    if (settings.keepLog) { logPending.push([Date.now(), loadId, kind, text]); if (!logTimer) logTimer = setTimeout(flushLog, 4000); }
  }
  const traceOnce = (kind, info, gapMs) => { const n = Date.now(); if (n - (traceSeen[kind] || 0) > (gapMs || 3000)) { traceSeen[kind] = n; trace(kind, info); } };
  trace('load', where() + ' v' + (ext ? ext.runtime.getManifest().version : '?'));
  window.addEventListener('pagehide', () => { trace('pagehide'); flushLog(true); });
  document.addEventListener('visibilitychange', () => { trace('tab', document.visibilityState); if (document.visibilityState === 'hidden') flushLog(true); });
  window.addEventListener('error', (e) => traceOnce('error', (e.message || '') + ' ' + String(e.filename || '').split('/').pop() + ':' + e.lineno, 20000));
  window.addEventListener('unhandledrejection', (e) => traceOnce('rejection', e.reason && e.reason.message ? e.reason.message : String(e.reason), 20000));
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput && e.value > 0.02) trace('layout-shift', e.value.toFixed(3) + ' ' + (e.sources || []).slice(0, 2).map((x) => x.node && (x.node.id || String(x.node.className).slice(0, 24) || x.node.nodeName)).join(' | ')); }).observe({ type: 'layout-shift', buffered: false }); } catch { /* not supported */ }
  let routerPoke = false;
  const ownBacks = []; // when each Back we pressed ourselves was pressed; the browser may take seconds to answer (Zen does)
  function stepBack() { ownBackAt = Date.now(); ownBacks.push(ownBackAt); trace('back', 'ours, on a ' + where() + ' page'); window.history.back(); }

  // ---------- comments ----------
  // X only sends a post's replies when its own page is opened. So we open that page on X's hidden side (nothing
  // changes on screen: our columns stay put), read the conversation as it arrives, and go straight back.
  const onPostPage = () => /\/status\/\d+/.test(location.pathname);
  // resolves to {data} or {why}: the reason is shown to the person (and tells me what X did)
  // Only one post can be open on X's hidden side at a time, so comments asked for together are fetched one after the
  // other (each panel opens at once and fills in as its turn comes), instead of refusing all but the first.
  let replyQueue = Promise.resolve();
  let repliesWaiting = 0;
  // The comments are handed over the moment they arrive; the hidden page then steps back (which the browser may take seconds to
  // do) while you are already reading them. One request per post: asking again while it is on its way waits for that same answer.
  const repliesInflight = new Map();
  function loadReplies(t, opts) {
    opts = opts || {};
    const cached = state.details.get(t.id);
    if (cached) return Promise.resolve({ data: cached });
    if (repliesInflight.has(t.id)) return repliesInflight.get(t.id);
    repliesWaiting++;
    const asked = Date.now();
    let early;
    const earlyP = new Promise((resolve) => { early = resolve; });
    const run = replyQueue.then(async () => {
      repliesWaiting--;
      const again = state.details.get(t.id); // an earlier request for the same post may have fetched it meanwhile
      if (again) { settleXlate(t.id, null); return { data: again }; }
      if (opts.wanted && !opts.wanted()) { settleXlate(t.id, null); return { why: 'Closed before it loaded.' }; }
      if (opts.onStart) opts.onStart();
      await waitFor(() => !state.posting, 15000);
      try { return await fetchReplies(t, Object.assign({}, opts, { early, asked })); } catch (err) {
        console.warn('[xmc] comments failed', err);
        return { why: 'Something went wrong while loading this (' + ((err && err.message) || err) + ').' };
      }
    });
    replyQueue = run.catch(() => {});
    const answer = Promise.race([earlyP, run]);
    repliesInflight.set(t.id, answer);
    run.catch(() => {}).then(() => { if (repliesInflight.get(t.id) === answer) repliesInflight.delete(t.id); });
    return answer;
  }
  // Opens a post's page on X's hidden side, runs body() there, and steps back (all in one place: the finding, the pressing, the
  // recovery when X ignores a press, and the way out). body gets { before, how } and returns what the caller wants.
  async function visitPost(t, opts, keep, body) {
    trace('visit', 'start ' + t.id + (opts.background ? ' (background)' : '') + (keep ? ' (more)' : ''));
    let why = '', how = 'link';
    const T = { start: Date.now() }; // where the time goes, for Copy diagnostics: waiting in line, finding the post, X opening it, X's answer
    state.peek = { id: t.id, replies: keep || null, page: 0 };
    state.proxyUntil = Date.now() + 40000;
    freezeSidebar();
    try {
      let art = await realArticle(t, 1500); // X's list is virtual and does not always draw a post far down it: after a few seconds, ask X's router instead
      T.found = Date.now();
      if (!art) why = 'post not on X’s side';
      const before = location.pathname;
      const opened = () => location.pathname !== before || (state.peek && state.peek.replies && !keep);
      // Press the post's link; X's list swaps its elements as the hidden page scrolls, so the link is found afresh each time.
      let pressed = null;
      for (let attempt = 0; art && attempt < 2 && !opened(); attempt++) {
        if (attempt) { art = findArticle(t.id) || await realArticle(t, 1500); if (!art) break; }
        const link = timeLinkOf(art, t.id);
        if (!link) { why = 'no link on the post'; continue; }
        if (link === pressed) break; // the very same link, already pressed twice: pressing it again would change nothing
        pressed = link;
        why = '';
        fire(link);
        await waitFor(opened, 1800);
        if (!opened()) { link.click(); await waitFor(opened, 1200); } // a plain click as a second try
      }
      if (!opened()) { // last resort (and the way for a post X has not drawn): ask X's own router to go there
        try {
          window.history.pushState(null, '', t.url);
          routerPoke = true; // (our own popstate listener must not take this one for you pressing Back)
          try { window.dispatchEvent(new PopStateEvent('popstate', { state: null })); } finally { routerPoke = false; }
          await waitFor(() => (keep ? onPostPage() : state.peek && state.peek.replies), 3500);
          how = 'router';
        } catch { /* ignore */ }
      }
      T.opened = Date.now();
      return await body({ before, how, why, T, opened: location.pathname !== before });
    } finally {
      if (onPostPage() && idOfHref(location.pathname) === t.id) { // still the page we opened (not one you've since gone to yourself)
        stepBack();
        await waitFor(() => !onPostPage(), 3500);
        if (onPostPage() && idOfHref(location.pathname) === t.id && window.history.state && window.history.state.xmcView) { stepBack(); await waitFor(() => !onPostPage(), 3500); } // our own entry is what is left on the post's page: one more step, rather than leave X's post page showing
      }
      state.peek = null;
      trace('visit', 'end ' + t.id);
      state.lastPeekEnd = Date.now();
      state.proxyUntil = Date.now() + 1500;
    }
  }
  async function fetchReplies(t, opts) {
    opts = opts || {};
    try { return await fetchRepliesVisit(t, opts); } finally { settleXlate(t.id, null); } // (a translation that was waiting for this visit and was not served goes on its own)
  }
  async function fetchRepliesVisit(t, opts) {
    return visitPost(t, opts, null, async ({ before, how, why, T, opened }) => {
      const got = await waitFor(() => state.peek && state.peek.replies, opened ? 9000 : 1500); // (if X never left the timeline there is nothing more to wait for)
      if (got) {
        T.data = Date.now();
        (state.commentTimes = state.commentTimes || []).push({ queueMs: T.start - (opts.asked || T.start), findMs: T.found - T.start, openMs: T.opened - T.found, answerMs: T.data - T.opened, totalMs: T.data - (opts.asked || T.start), how, background: !!opts.background });
        if (state.commentTimes.length > 12) state.commentTimes.shift();
        if (opts.early) opts.early({ data: got });
        if (xlateWaiting.has(t.id)) { // its translation was asked for while the comments were on their way: done here, on the page that is already open
          if (translations.has(t.id)) settleXlate(t.id, { ok: true, ...translations.get(t.id) });
          else { const w = xlateWaiting.get(t.id); xlateWaiting.delete(t.id); const art = findArticle(t.id); w.resolve(art ? await translateHere(t, art, null, w.lap, w.T0) : null); }
        }
        return { data: got };
      }
      (state.commentFailures = state.commentFailures || []).push({ id: t.id, how, why, pageOpened: opened, sawDetail: !!(state.seenOps && state.seenOps.TweetDetail), background: !!opts.background, ms: Date.now() - T.start });
      if (state.commentFailures.length > 8) state.commentFailures.shift();
      trace('visit', 'FAILED ' + t.id + ' ' + (why || (opened ? 'no comments came' : 'X did not open the post')));
      if (state.detailFail && Date.now() - state.detailFail.at < 60000) return { why: 'X is limiting how fast comments can be loaded (error ' + state.detailFail.status + '). Try again in a few minutes.' };
      return { why: opened
        ? 'X opened the post but sent no comments. Requests seen: ' + Object.keys(state.seenOps).join(', ')
        : 'X didn’t open the post when asked to.' };
    });
  }
  // The next page of a post's comments: X sends one more page of them when its own post page is scrolled down, so the hidden
  // page is taken to the post and scrolled, in steps, until a page arrives (merged into state.details by onResponse).
  const moreInflight = new Map();
  // X no longer sends the next comments just because its page is scrolled: at the foot of the conversation it puts a button
  // ("See all comments" and the like). It is found by its place (the last cells of the conversation: no post in it, one button, a few
  // words), not by its wording, so it works in any interface language; what it says is kept in the diagnostics.
  function showMoreCell() {
    const cells = [...document.querySelectorAll('[data-testid="cellInnerDiv"]')];
    state.moreProbe = cells.slice(-4).map((c) => (c.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 40));
    for (let i = cells.length - 1; i >= 0 && i >= cells.length - 4; i--) {
      const c = cells[i];
      if (c.querySelector('article, [data-testid="UserCell"], a[href], input, textarea')) continue;
      const btns = [...c.querySelectorAll('[role="button"], button')];
      const txt = (c.innerText || '').trim();
      if (btns.length === 1 && txt.length >= 4 && txt.length <= 60 && !/spam|offensive|abusive|muted|blocked|sensitive/i.test(txt)) return { btn: btns[0], txt }; // (never the buttons that show what X has hidden)
    }
    return null;
  }
  function loadMoreReplies(t) {
    const d = state.details.get(t.id);
    if (!d || !d.more) return Promise.resolve({ added: [], more: false });
    if (moreInflight.has(t.id)) return moreInflight.get(t.id);
    const had = d.replies.length;
    const run = inQueue(() => visitPost(t, {}, d, async ({ opened }) => {
      if (!opened) return { why: 'X didn’t open the post.' };
      const end = Date.now() + 6000; // X sends the first page again, then the later ones: scroll on until one with new comments comes
      let top = 0;
      const pressed = new Set();
      while (Date.now() < end && state.peek && !state.peek.fresh && !repliesWaiting && pagers.has(t.id)) { // (gives way if another post's comments are waiting, or the panel has gone)
        top = Math.min(top + innerHeight * 1.2, document.documentElement.scrollHeight);
        window.scrollTo(0, top);
        await sleep(250);
        if (top >= document.documentElement.scrollHeight - innerHeight) { // at the foot: X's own button for the rest, if it has put one there
          window.scrollTo(0, document.documentElement.scrollHeight); top = 0; await sleep(400);
          const cell = showMoreCell();
          if (cell && !pressed.has(cell.txt)) { pressed.add(cell.txt); trace('more', 'pressed X’s “' + cell.txt + '”'); fire(cell.btn); await sleep(400); }
        }
      }
      return state.peek && state.peek.fresh ? { ok: true } : { why: 'X sent no more comments.' };
    })).then((res) => {
      const now = state.details.get(t.id);
      return { ok: !!(res && res.ok), added: now ? now.replies.slice(had) : [], more: !!(now && now.more && res && res.ok), why: res && res.why };
    }).finally(() => moreInflight.delete(t.id));
    moreInflight.set(t.id, run);
    return run;
  }
  function renderReply(r, t, panel) {
    const text = h('div', { className: 'xmc-text' }, renderSegs(r.segs));
    for (const a of text.querySelectorAll('a.xmc-nav')) { a.classList.remove('xmc-nav'); a.target = '_blank'; a.rel = 'noopener'; }
    const pics = r.media.filter((m) => m.type === 'photo');
    const photos = r.media.slice(0, 2).map((m) => {
      const a = h('a', { href: photoUrl(m.thumb, 'large'), target: '_blank', rel: 'noopener', 'aria-label': 'Open the picture' },
        h('img', { className: 'xmc-rmedia', src: photoUrl(m.thumb, 'small'), alt: '', loading: 'lazy', style: m.w > 0 && m.h > 0 ? '--ar:' + (m.w / m.h).toFixed(4) : '' })); // (its shape is set from the picture's size, so nothing moves when it arrives and it is never stretched)
      const at = pics.indexOf(m);
      a.addEventListener('click', (e) => { if (at < 0 || a.closest('.sensitive') || e.ctrlKey || e.metaKey || e.shiftKey) return; e.preventDefault(); e.stopPropagation(); openLightbox(r, at); });
      return a;
    });
    const likeBtn = h('button', { className: 'xmc-ract xmc-rlike', type: 'button', title: 'Like' }, icon('like'), h('span', { className: 'xmc-n' }));
    const replyBtn = h('button', { className: 'xmc-ract xmc-rreply', type: 'button', title: 'Reply to this comment' }, icon('reply'), h('span', { textContent: 'Reply' }));
    const markBtn = h('button', { className: 'xmc-ract xmc-rmark', type: 'button', title: 'Bookmark' }, icon('bookmark'), h('span', { className: 'xmc-n' }));
    const linkBtn = h('button', { className: 'xmc-ract xmc-rlink', type: 'button', title: 'Copy link' }, icon('link'));
    const slot = h('div', { className: 'xmc-rslot' });
    const paintLike = () => { likeBtn.classList.toggle('on', !!r.state.liked); likeBtn.querySelector('.xmc-n').textContent = r.counts.like ? fmt(r.counts.like) : ''; };
    const paintMark = () => { markBtn.classList.toggle('on', !!r.state.bookmarked); markBtn.querySelector('.xmc-n').textContent = r.counts.bookmark ? fmt(r.counts.bookmark) : ''; };
    paintLike(); paintMark();
    likeBtn.addEventListener('click', () => likeComment(t, r, paintLike));
    markBtn.addEventListener('click', () => bookmarkComment(t, r, paintMark));
    linkBtn.addEventListener('click', () => copyLink(r));
    replyBtn.addEventListener('click', () => {
      if (slot.firstChild) { slot.replaceChildren(); return; }
      const c = renderComposer(panel, t, r);
      slot.append(c);
      c.querySelector('textarea').focus();
    });
    const xl = needsTranslation(r) && r.segs.length ? h('button', { className: 'xmc-translate', type: 'button', textContent: 'Translate post', title: 'Translates it here, using X\u2019s own translation' }) : null;
    const medias = photos.length ? h('div', { className: 'xmc-rmedias' + (r.sensitive ? ' sensitive' : '') }, ...photos) : null;
    if (medias && r.sensitive) medias.append(h('button', { className: 'xmc-reveal', type: 'button', textContent: 'Sensitive content \u2014 click to view', onclick: (e) => { e.stopPropagation(); medias.classList.remove('sensitive'); e.currentTarget.remove(); } }));
    const item = h('div', { className: 'xmc-ritem d' + (r.depth || 0) },
      h('a', { className: 'xmc-ravatar', href: '/' + r.author.handle, target: '_blank', rel: 'noopener', tabIndex: -1, 'aria-hidden': 'true' }, h('img', { src: r.author.avatar, alt: '', loading: 'lazy' })),
      h('div', { className: 'xmc-rbody' },
        h('div', { className: 'xmc-rtop' },
          h('a', { className: 'xmc-name', href: '/' + r.author.handle, target: '_blank', rel: 'noopener', textContent: r.author.name }), badge(r.author),
          h('span', { className: 'xmc-dim', textContent: ' @' + r.author.handle + ' \u00b7 ' }), h('a', { className: 'xmc-dim xmc-rtime', href: new URL(r.url, location.origin).href, target: '_blank', rel: 'noopener', title: 'Open this comment on X', textContent: relTime(r.createdAt) })),
        text,
        xl,
        medias,
        h('div', { className: 'xmc-ractions' }, likeBtn, replyBtn, markBtn, linkBtn, r.counts.views ? h('span', { className: 'xmc-dim xmc-rviews', textContent: fmt(r.counts.views) + ' views' }) : null),
        slot));
    if (xl) wireTranslate(xl, text, r, t);
    // pressing the comment itself (not a link, button or box in it) opens it in the panel: its picture large, its replies beside it
    item.querySelector('.xmc-rbody').addEventListener('click', (e) => {
      if (e.target.closest('a, button, textarea, video, .xmc-rslot, .xmc-reveal') || (window.getSelection && String(window.getSelection()).length)) return;
      e.stopPropagation();
      openPostView(r, true, false, { parent: t }); // Back and Esc return to the post, whichever comment this is
    });
    return item;
  }
  const SORTS = [['relevant', 'Relevant'], ['recent', 'Recent'], ['likes', 'Most liked']];
  function fillReplies(panel, t, res, focal) {
    panel.replaceChildren();
    const d = res && res.data;
    const list = d ? XMCLogic.sortReplies(d.replies.filter((r) => !(settings.nsfw === 'hide' && r.sensitive)), settings.commentSort) : [];
    const sortSel = h('select', { className: 'xmc-rsort', title: 'Order comments' },
      ...SORTS.map(([v, l]) => h('option', { value: v, textContent: l, selected: settings.commentSort === v })));
    sortSel.addEventListener('change', () => { settings.commentSort = sortSel.value; save(); fillReplies(panel, t, res, focal); });
    panel.append(h('div', { className: 'xmc-rhead' },
      h('b', { textContent: list.length ? (focal ? 'Replies' : 'Comments') : d ? (focal ? 'No replies shown yet' : 'No comments yet') : 'Couldn’t load comments' }),
      list.length > 1 ? sortSel : null,
      h('button', { className: 'xmc-rclose', type: 'button', title: 'Close comments' }, icon('close'))));
    panel.append(focal ? renderComposer(panel, t, focal, () => {}) : renderComposer(panel, t));
    for (const r of list) panel.append(renderReply(r, t, panel));
    if (!d) {
      panel.append(h('div', { className: 'xmc-dim xmc-rempty', textContent: (res && res.why) || 'Try again in a moment.' }));
      panel.append(h('div', { className: 'xmc-rfoot' }, btn('Try again', '', () => reloadComments(panel, t), 'xmc-rbtn'), btn('Report a problem', '', () => reportProblem(), 'xmc-rbtn')));
    }
    const foot = h('div', { className: 'xmc-rfoot', hidden: true }); // (where the "loading more" line goes)
    panel.append(foot);
    // X says a post has this many replies (direct ones): once that many are here there is nothing to wait for, whatever its cursor says
    if (d && d.more && !focal && !(t.counts.reply && d.replies.filter((x) => !(x.depth > 0)).length >= t.counts.reply)) pageComments(panel, t, foot);
  }
  // More comments as you scroll down: when the end of the list comes into view the next page is fetched (see loadMoreReplies) and
  // added below, without disturbing where you are. Whatever has been merged into the stored conversation and is not drawn yet is
  // drawn, whenever it arrived (X may send a further page of its own accord while the hidden page is still on its way back).
  const pagers = new Map(), waitingPages = new Map();
  function pageComments(panel, t, foot) {
    const note = () => [spinner(), h('span', { textContent: ' Loading more comments…' })];
    const sent = h('div', { className: 'xmc-rmore' }, ...note());
    panel.insertBefore(sent, foot);
    let busy = false, shown = (state.details.get(t.id) || { replies: [] }).replies.length, io = null;
    const finish = () => { if (io) io.disconnect(); sent.remove(); pagers.delete(t.id); };
    const flush = () => {
      const cur = state.details.get(t.id);
      if (!sent.isConnected || !cur) { finish(); return null; }
      for (const r of cur.replies.slice(shown)) if (!(settings.nsfw === 'hide' && r.sensitive)) sent.before(renderReply(r, t, panel));
      shown = cur.replies.length;
      return cur;
    };
    pagers.set(t.id, () => { const cur = flush(); if (cur && !cur.more && !busy) finish(); });
    const more = async () => {
      if (busy) return;
      if (!sent.isConnected) { finish(); return; }
      busy = true;
      sent.replaceChildren(...note());
      const res = await loadMoreReplies(t);
      busy = false;
      const cur = flush();
      if (!cur) return;
      if (!cur.more) { finish(); return; }
      if (!res.ok) { // X sent nothing this time: say so, and offer the rest where X keeps it
        if (io) io.disconnect();
        sent.replaceChildren(h('span', { className: 'xmc-dim', textContent: 'That is all X sends here. ' }), btn('See all comments on X', '', () => openOnX(t), 'xmc-rbtn'), btn('Try again', '', () => { sent.replaceChildren(...note()); io.observe(sent); more(); }, 'xmc-rbtn'));
        return;
      }
      io.unobserve(sent); io.observe(sent); // still more: asked again if the end is still in view
    };
    io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) more(); }, { root: panel.closest('.xmc-vside'), rootMargin: '0px 0px 500px 0px' });
    io.observe(sent);
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
  function renderComposer(panel, t, r, after) {
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
        toast('Reply sent');
        if (after) { state.details.delete(t.id); return; } // inside a comment's own view: the post's comments are fetched afresh when you go back to it
        t.counts.reply += 1; updateActions(t);
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
        if (!stay && onPostPage() && idOfHref(location.pathname) === t.id) { stepBack(); await waitFor(() => !onPostPage(), 3500); }
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
      if (!b) return art.querySelector(want ? '[data-testid="unlike"]' : '[data-testid="like"]') ? { ok: true } : { ok: false, why: 'Couldn’t find that comment’s like button.' }; // (the other one there: X already shows it as wanted)
      fire(b);
      return { ok: true };
    });
    if (res.ok) featOk('comment actions'); else featFail('comment actions', res.why || 'could not reach the comment');
    if (!res.ok) { state.actionFails.push(Date.now()); flip(!want); toast(res.why || 'Couldn’t reach that comment just now. Try again in a moment'); }
  }
  // save a comment to bookmarks (or take it off): X's own button on that comment, found the same way
  async function bookmarkComment(t, r, paint) {
    const want = !r.state.bookmarked;
    const flip = (on) => { r.state.bookmarked = on; r.counts.bookmark = Math.max(0, (r.counts.bookmark || 0) + (on ? 1 : -1)); paint(); };
    flip(want);
    const res = await actOnComment(t, r.id, (art) => {
      const b = art.querySelector(want ? '[data-testid="bookmark"]' : '[data-testid="removeBookmark"]');
      if (!b) return art.querySelector(want ? '[data-testid="removeBookmark"]' : '[data-testid="bookmark"]') ? { ok: true } : { ok: false, why: 'Couldn\u2019t find that comment\u2019s bookmark button.' };
      fire(b);
      return { ok: true };
    });
    if (res.ok) featOk('comment actions'); else featFail('comment actions', res.why || 'could not reach the comment');
    if (!res.ok) { state.actionFails.push(Date.now()); flip(!want); toast(res.why || 'Couldn\u2019t reach that comment just now. Try again in a moment'); }
    else toast(want ? 'Saved to bookmarks' : 'Removed from bookmarks');
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
    if (!res || !res.data) { state.commentFails.push(Date.now()); featFail('comments', (res && res.why) || 'no comments came'); } else featOk('comments');
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
    for (const el of clone.querySelectorAll('a[href], [role="button"]')) { // a link that is only a picture needs a name for a screen reader to say
      if (el.getAttribute('aria-label') || (el.textContent || '').trim() || el.querySelector('img[alt]:not([alt=""])')) continue;
      const href = el.getAttribute('href') || '';
      el.setAttribute('aria-label', /header_photo$/.test(href) ? 'Header picture' : /\/photo$/.test(href) ? 'Profile picture' : 'Open');
    }
    headerCopy = { handle: handle.toLowerCase(), html, index };
    profileEl.className = 'xmc-profile xmc-native';
    profileEl.replaceChildren(clone);
    return true;
  }
  // a click in the copy: a link opens as links do here; a button presses X's real one (X's header has to be mounted for that: it is
  // brought back to view first if the loader has moved X's page on)
  // What X puts up when its header button is pressed (the "About this account" popup on Joined) is drawn in its own layer at the place of
  // its hidden header. The layer is real and works as it does on X (a press outside closes it), so it is kept, and its box is moved to sit
  // under the button that was pressed here.
  async function adoptPopup(layers, before, anchor) {
    const layer = await waitFor(() => [...layers.children].find((c) => !before.has(c) && ((c.innerText || '').trim().length > 8) && !c.querySelector('[aria-modal="true"]')), 2500); // (a modal dialog is left where X centres it)
    state.popProbe = { found: !!layer, tag: layer ? layer.tagName : '', text: layer ? (layer.innerText || '').trim().slice(0, 50) : '' };
    if (!layer) return;
    const box = [layer, ...layer.querySelectorAll('*')].find((n) => /(^|;)\s*(top|left)\s*:/.test(n.getAttribute('style') || '') && ((n.innerText || '').trim().length > 8));
    state.popProbe.moved = !!box;
    if (!box) return;
    const a = anchor.getBoundingClientRect();
    box.style.position = 'fixed'; box.style.transform = 'none'; box.style.right = 'auto'; box.style.bottom = 'auto'; box.style.margin = '0';
    box.style.left = Math.round(a.left) + 'px'; box.style.top = Math.round(a.bottom + 6) + 'px';
    const b = box.getBoundingClientRect();
    if (b.right > innerWidth - 8) box.style.left = Math.max(8, Math.round(innerWidth - b.width - 8)) + 'px';
    if (b.bottom > innerHeight - 8) box.style.top = Math.max(8, Math.round(a.top - b.height - 6)) + 'px';
  }
  async function pressHeaderButton(position, anchor) {
    state.proxyUntil = Date.now() + 8000;
    const layers = document.getElementById('layers'), before = new Set(layers ? [...layers.children] : []);
    try {
      let orig = nativeHeader(headerCopy.handle);
      if (!orig) { window.scrollTo(0, 0); orig = await waitFor(() => nativeHeader(headerCopy.handle), 2500); }
      if (!orig || orig.innerHTML !== headerCopy.html) { toast('Couldn’t reach that button just now. Try again in a moment.'); return; }
      const target = [orig, ...orig.querySelectorAll('*')][position];
      // only the Joined / location line brings up a popup worth moving: not Follow's confirmation or the ... menu, which are X's own and stay put
      if (target) { fire(target); if (anchor && layers && anchor.closest('[data-testid="UserProfileHeader_Items"], [data-testid="UserJoinDate"]')) adoptPopup(layers, before, anchor); }
    } finally { settleProxy(); }
  }
  profileEl.addEventListener('click', (e) => {
    if (!headerCopy || !profileEl.classList.contains('xmc-native') || e.ctrlKey || e.metaKey || e.shiftKey) return;
    let hit = e.target.closest('a[href], button, [role="button"], [data-testid="UserJoinDate"]');
    if (!hit || !profileEl.contains(hit)) return;
    if (!hit.matches('a[href], button, [role="button"]')) hit = hit.querySelector('a[href], button, [role="button"]') || hit; // (the Joined line: press the button inside it)
    if (hit.matches('a[href]')) {
      const url = new URL(hit.getAttribute('href'), location.origin);
      if (url.origin !== location.origin) return; // a link out (the bio's): the browser opens it
      e.preventDefault(); navigate(url.pathname + url.search, null);
      return;
    }
    e.preventDefault(); e.stopPropagation();
    const position = headerCopy.index.get(hit);
    if (position !== undefined) pressHeaderButton(position, hit);
  });
  // X underlines Following, Followers, Joined and the links in the bio as you point at them, from script; a copy gets none of that, so
  // the one under the pointer is marked here (the CSS does the underline) instead of relying on :hover alone
  let hovered = null;
  profileEl.addEventListener('pointerover', (e) => {
    if (!profileEl.classList.contains('xmc-native')) return;
    const el = e.target.closest && e.target.closest('a[href], [role="button"]');
    const ok = el && profileEl.contains(el) && !el.querySelector('img, svg') && /[\p{L}\p{N}]{3}/u.test(el.textContent || '')
      && (el.matches('a[href]') || el.closest('[data-testid="UserProfileHeader_Items"], [data-testid="UserJoinDate"]'));
    const next = ok ? el : null;
    if (next === hovered) return;
    if (hovered) hovered.removeAttribute('data-xmc-hover');
    hovered = next; if (hovered) hovered.setAttribute('data-xmc-hover', '');
  });
  profileEl.addEventListener('pointerleave', () => { if (hovered) { hovered.removeAttribute('data-xmc-hover'); hovered = null; } });
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
  function placeProfile() { if (columns.length && profileEl.parentElement !== columns[0]) relayout(); } // it joins the first column, and the posts are placed again around it
  function updateProfile() {
    // While X's hidden page is away on a post for us (comments, translating, liking) the address is the post's and no profile's: the header
    // stays as it is, with its copy of X's markup, which X may not have mounted again by the time the page is back
    if (state.shown && !root.hidden && ((!!state.peek && onPostPage()) || (state.posting && isModalRoute()))) return;
    const handle = settings.profileHeader && state.shown && !root.hidden ? profileHandle() : '';
    if (!handle) { profileEl.hidden = true; profileEl.remove(); profileSig = ''; headerCopy = null; if (!listNameOnBar) pageTitleEl.hidden = true; return; }
    if (headerCopy && headerCopy.handle !== handle.toLowerCase()) { headerCopy = null; profileSig = ''; profileEl.replaceChildren(); profileEl.className = 'xmc-profile'; }
    const api = profileCard(handle);
    if (copyHeader(handle)) {
      profileEl.hidden = false; placeProfile();
      const nm = profileEl.querySelector('[data-testid="UserName"]');
      const name = (api && api.name) || (nm && nm.querySelector('span') ? nm.querySelector('span').textContent.trim() : '');
      pageTitleEl.hidden = !name; if (name && pageTitleEl.textContent !== name) pageTitleEl.textContent = name;
      return;
    }
    // X's own header is not there (yet): after a moment, the plainer one
    if (!api || Date.now() - state.routeSince < 2500) { profileEl.hidden = true; pageTitleEl.hidden = !(api || listNameOnBar); if (api) pageTitleEl.textContent = api.name; return; }
    profileEl.hidden = false; placeProfile();
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
  const GATE_TEXT = /sensitive|age-restricted|adult content/i;
  // X's own age gate: its Show opens a "confirm your age in the X app" dialog and nothing more unless the account is verified, so it is never pressed (Hide still removes it)
  const AGE_GATE = /age[\s\u00a0\u2010-\u2015-]*restricted|adult content|verify your age/i;
  const gatesPressed = new WeakSet();
  // "Hide": X's own notice and the picture under it are removed from X's own page (the box that holds them, never the post's words)
  function hideGates(col) {
    const walker = document.createTreeWalker(col, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!AGE_GATE.test(n.nodeValue || '') && !/potentially sensitive content/i.test(n.nodeValue || '')) continue;
      let box = n.parentElement;
      if (!box || box.closest('[data-xmc-gate]')) continue;
      for (let i = 0; i < 9 && box.parentElement && box.parentElement !== col; i++) {
        const up = box.parentElement;
        if (up.querySelector('[data-testid="tweetText"], [data-testid="User-Name"], [data-testid="UserName"]')) break;
        const r = up.getBoundingClientRect();
        if (r.width > 760 || r.height > 1000) break;
        box = up;
      }
      box.dataset.xmcGate = 'hidden'; box.style.setProperty('display', 'none', 'important');
    }
  }
  function revealNative() {
    if (settings.nsfw === 'hide' && !state.peek && !state.posting && !(state.shown && !(where() === 'profile' && !activeFeed()))) { const c = mainCol(); if (c) hideGates(c); return; }
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
        inNotice = text.length < 700 && GATE_TEXT.test(text);
        if (inNotice && AGE_GATE.test(text)) { gatesPressed.add(b); inNotice = false; break; }
      }
      if (!inNotice) continue;
      gatesPressed.add(b);
      state.gatesPressed = (state.gatesPressed || 0) + 1;
      fire(b);
    }
  }

  // a one-time line saying what you can do here
  function dismissHint() { hintEl.hidden = true; if (!settings.hintSeen) { settings.hintSeen = true; save(); } }
  // a panel closed while X's hidden side was busy leaves our history entry behind: remove it once things are quiet
  let needEntry = false;
  function ensurePanelEntry() {
    if (!needEntry) return;
    if (!postView) { needEntry = false; return; }
    if (state.peek || state.posting || onPostPage() || isModalRoute() || Date.now() - ownBackAt < 1500) return;
    needEntry = false;
    if (!(window.history.state && window.history.state.xmcView)) { try { window.history.pushState({ xmcView: true }, '', location.href); trace('history', 'panel entry added after the visit'); } catch { /* ignore */ } }
  }
  function tidyHistory() { if (Date.now() - ownBackAt > 4000 && !postView && !state.peek && !state.posting && !onPostPage() && window.history.state && window.history.state.xmcView) stepBack(); }
  function updateHint() { const show = !settings.hintSeen && state.shown && view.cards.length >= 3 && !postView; if (hintEl.hidden === show) hintEl.hidden = !show; }

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
      ['Mute words…', () => openOptions('muting')],
      ['Copy post text', async () => {
        const plain = t.segs.map((s) => (s.t === 'text' ? s.v : s.t === 'url' ? s.href : s.t === 'mention' ? '@' + s.handle : '#' + s.tag)).join('');
        try { await navigator.clipboard.writeText(plain); toast('Copied'); } catch { toast('Couldn’t copy'); }
      }],
      ['Open in a new tab', () => window.open('https://' + location.host + t.url, '_blank', 'noopener')],
      ['Copy diagnostics', () => copyDiagnostics()],
      ['Save sample for the developer', () => saveSample()],
      ['Report a problem', () => reportProblem()],
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
    const prev = h('button', { className: 'xmc-lb-nav prev', type: 'button', title: 'Previous picture', 'aria-label': 'Previous picture', onclick: (e) => { e.stopPropagation(); stepLightbox(-1); } }, icon('prev'));
    const next = h('button', { className: 'xmc-lb-nav next', type: 'button', title: 'Next picture', 'aria-label': 'Next picture', onclick: (e) => { e.stopPropagation(); stepLightbox(1); } }, icon('next'));
    const close = h('button', { className: 'xmc-lb-close', type: 'button', title: 'Close (Esc)', onclick: closeLightbox }, icon('close'));
    const tools = h('div', { className: 'xmc-lb-tools', onclick: (e) => e.stopPropagation() },
      h('button', { className: 'xmc-lb-btn', type: 'button', title: 'Download this image', onclick: () => downloadMedia(t, lightbox && lightbox.photos[lightbox.i]) }, icon('download')),
      h('button', { className: 'xmc-lb-btn', type: 'button', title: 'Copy link to the post', onclick: () => copyLink(t) }, icon('link')));
    const el = h('div', { id: 'xmc-lightbox', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Photo', onclick: closeLightbox }, img, prev, next, close, tools);
    const was = document.activeElement;
    img.addEventListener('click', (e) => e.stopPropagation());
    let wheelAt = 0; // the wheel steps between the pictures, as it does in the panel (a trackpad sends a burst: one step per flick)
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      const d = wheelPx(e, Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX);
      if (!lightbox || lightbox.photos.length < 2 || Math.abs(d) < 4 || e.timeStamp - wheelAt < 380) return;
      wheelAt = e.timeStamp; stepLightbox(d > 0 ? 1 : -1);
    }, { passive: false });
    lightbox = { el, img, photos, i: start, prev, next, was };
    document.body.append(el);
    close.focus({ preventScroll: true });
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
    if (lightbox) { const was = lightbox.was; lightbox.el.remove(); lightbox = null; if (was && was.isConnected) was.focus({ preventScroll: true }); }
    document.documentElement.classList.remove('xmc-viewer');
  }

  // ---------- the post panel ----------
  // Opens a post over the columns: its pictures at full size on one side, the words, actions and comments on the other. Esc, the
  // backdrop or the cross closes it and the columns are exactly as they were; the arrow keys go to the next or previous post.
  let postView = null; // { t, el, panel, side }
  let panelOpener = null; // what had the keyboard focus when the panel opened, so closing it gives the focus back
  function viewMedia(t) {
    let photo = 0;
    return t.media.map((m) => {
      const box = h('div', { className: 'xmc-vm' + (t.sensitive ? ' sensitive' : '') });
      if (m.type === 'photo') {
        const img = h('img', { src: photoUrl(m.thumb, 'large'), alt: m.alt || '', decoding: 'async' }); img.dataset.lb = String(photo++);
        img.tabIndex = 0; img.setAttribute('role', 'button'); img.setAttribute('aria-label', 'Open photo full size');
        box.style.setProperty('--xmc-vbg', 'url("' + photoUrl(m.thumb, 'large') + '")'); // (the same address as the picture: nothing more to download)
        box.classList.add('xmc-loading');
        const arrived = () => box.classList.remove('xmc-loading');
        img.addEventListener('load', arrived); img.addEventListener('error', arrived); setTimeout(arrived, 8000);
        box.append(img);
      }
      else box.append(renderVideo(m, t));
      if (t.sensitive) box.append(h('button', { className: 'xmc-reveal', type: 'button', textContent: 'Sensitive content \u2014 click to view', onclick: (e) => { e.stopPropagation(); box.classList.remove('sensitive'); e.currentTarget.remove(); } }));
      return box;
    });
  }
  // A post with several pictures shows one at a time in the panel, with arrows and a dot for each, so the person can see how many there are
  function carousel(pane) {
    const slides = [...pane.querySelectorAll(':scope > .xmc-vm')];
    if (slides.length < 2) return;
    let i = 0;
    const dots = h('div', { className: 'xmc-dots', 'aria-hidden': 'true' }, ...slides.map(() => h('i')));
    const prev = h('button', { className: 'xmc-cnav prev', type: 'button', title: 'Previous picture', 'aria-label': 'Previous picture', onclick: (e) => { e.stopPropagation(); pane._go(-1); } }, icon('prev'));
    const next = h('button', { className: 'xmc-cnav next', type: 'button', title: 'Next picture', 'aria-label': 'Next picture', onclick: (e) => { e.stopPropagation(); pane._go(1); } }, icon('next'));
    pane._go = (d) => {
      i = Math.max(0, Math.min(slides.length - 1, i + d));
      slides.forEach((sl, k) => { sl.hidden = k !== i; if (k !== i) for (const v of sl.querySelectorAll('video')) v.pause(); });
      [...dots.children].forEach((dot, k) => dot.classList.toggle('on', k === i));
      prev.hidden = i === 0; next.hidden = i === slides.length - 1;
    };
    pane.classList.add('xmc-car');
    pane.append(prev, next, dots);
    pane._go(0);
    // the wheel flicks between the pictures (a trackpad sends a burst: one step per flick, not one per event)
    let wheelAt = 0;
    pane.addEventListener('wheel', (e) => {
      e.preventDefault();
      const d = wheelPx(e, Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX);
      if (Math.abs(d) < 4 || e.timeStamp - wheelAt < 380) return;
      wheelAt = e.timeStamp; pane._go(d > 0 ? 1 : -1);
    }, { passive: false });
    // the left or right third of a picture steps to the previous or next one; the middle opens it full size (so does a third with nowhere to go)
    const side = (e) => {
      const img = e.target.closest && e.target.closest('img[data-lb]');
      if (!img || img.closest('.sensitive')) return '';
      const r = img.getBoundingClientRect(), f = (e.clientX - r.left) / (r.width || 1);
      const k = slides.findIndex((x) => !x.hidden);
      return f < 0.3 && k > 0 ? 'l' : f > 0.7 && k < slides.length - 1 ? 'r' : '';
    };
    pane.addEventListener('pointermove', (e) => { const sd = side(e); if ((pane.dataset.side || '') !== sd) pane.dataset.side = sd; });
    pane.addEventListener('pointerleave', () => { pane.dataset.side = ''; });
    pane.addEventListener('click', (e) => {
      if (e.detail === 0) return; // Enter on a focused picture opens it
      const sd = side(e);
      if (sd) { e.preventDefault(); e.stopPropagation(); pane._go(sd === 'r' ? 1 : -1); }
    });
  }
  // a short row of the same person's other posts that we already have (nothing is fetched), to carry on from this one
  function moreFrom(t) {
    const mine = t.author.handle.toLowerCase();
    const seen = new Set([t.id]), found = [];
    for (const x of state.byId.values()) {
      if (x.repostedBy || x.replyToId || seen.has(x.id) || !x.author || x.author.handle.toLowerCase() !== mine) continue;
      seen.add(x.id); found.push(x);
    }
    found.sort((a, b) => b.createdAt - a.createdAt);
    const list = found.slice(0, 8);
    if (list.length < 2) return null;
    const tiles = list.map((x) => {
      const pic = x.media.find((m) => m.thumb);
      const tile = h('button', { className: 'xmc-more-tile' + (pic ? '' : ' words'), type: 'button', title: 'Open this post', onclick: (e) => { e.stopPropagation(); openPostView(x, true); } },
        pic ? h('img', { src: photoUrl(pic.thumb, 'small'), alt: '', loading: 'lazy' }) : h('span', { textContent: x.segs.map((s) => (s.t === 'text' ? s.v : s.label || '')).join('').trim().slice(0, 90) }));
      if (pic && pic.type !== 'photo') tile.append(h('i', { className: 'xmc-more-play' }));
      return tile;
    });
    return h('div', { className: 'xmc-morefrom' }, h('div', { className: 'xmc-more-head', textContent: 'More from @' + t.author.handle }), h('div', { className: 'xmc-more-row' }, ...tiles));
  }
  // the replies to one comment that came with its post's comments (X sends a few of each; the rest are on X)
  function repliesTo(d, id) {
    const out = [], seen = new Set([id]);
    const walk = (pid, depth) => {
      for (const x of d.replies) {
        if (x.replyToId !== pid || seen.has(x.id)) continue;
        seen.add(x.id); out.push(Object.assign(x, { depth: Math.min(depth, 1) })); walk(x.id, depth + 1);
      }
    };
    walk(id, 0);
    return out;
  }
  function viewSide(t, focusBox, parent) {
    const side = h('div', { className: 'xmc-vside' });
    const ctxHost = h('div', { className: 'xmc-vctx' }, ...(parent ? [] : contextChain(t).filter(usable).map((p) => renderParentContext(p, onlyWords(t)))));
    // a reply whose parent we do not have yet keeps the room for it (a grey placeholder), so the post's own words do not jump when it arrives
    if (!parent && t.replyToId && !ctxHost.children.length) {
      ctxHost.append(h('div', { className: 'xmc-sk xmc-vctx-sk' }, h('i'), h('div', {}, h('b'), h('b'))));
      let tries = 0; // if nothing else fills it (a post with no comments to load), look for it a few times, then give the room back
      const look = () => {
        if (!ctxHost.isConnected || !ctxHost.querySelector('.xmc-vctx-sk')) return;
        const chain = contextChain(t).filter(usable);
        if (chain.length || ++tries > 12) {
          const was = side.scrollHeight;
          ctxHost.replaceChildren(...chain.map((p) => renderParentContext(p, onlyWords(t))));
          if (side.scrollTop > 0) side.scrollTop += side.scrollHeight - was;
        } else setTimeout(look, 500);
      };
      setTimeout(look, 500);
    }
    if (parent) side.append(h('button', { className: 'xmc-vback', type: 'button', title: 'Back to the post (Esc)', onclick: (e) => { e.stopPropagation(); openPostView(parent, true); } }, icon('prev'), h('span', { textContent: 'Back to @' + parent.author.handle + '\u2019s post' })));
    side.append(ctxHost);
    const sub = h('div', { className: 'xmc-sub' }, '@' + t.author.handle + ' \u00b7 ', // the time is a real link to the post on X, as on every social site
      h('a', { className: 'xmc-time', href: new URL(t.url, location.origin).href, target: '_blank', rel: 'noopener', title: 'Open this post on X \u00b7 ' + new Date(t.createdAt).toLocaleString(), textContent: relTime(t.createdAt),
        onclick: (e) => { if (settings.openIn === 'sametab' && !(e.ctrlKey || e.metaKey || e.shiftKey)) { e.preventDefault(); openOnX(t); } } }));
    side.append(h('div', { className: 'xmc-head' },
      h('a', { className: 'xmc-avatar xmc-nav', href: '/' + t.author.handle, tabIndex: -1, 'aria-hidden': 'true' }, h('img', { src: t.author.avatar, alt: '' })),
      h('div', { className: 'xmc-who' }, h('a', { className: 'xmc-name xmc-nav', href: '/' + t.author.handle }, t.author.name, badge(t.author)), sub)));
    const wordsEl = h('div', { className: 'xmc-text' + (onlyWords(t) ? ' big' : '') }, renderSegs(t.segs));
    if (t.segs.length) side.append(wordsEl);
    let xlBtn = null;
    if (needsTranslation(t)) { xlBtn = h('button', { className: 'xmc-translate', type: 'button', textContent: 'Translate post', title: 'Translates it here, using X\u2019s own translation' }); side.append(xlBtn); if (t.segs.length) wireTranslate(xlBtn, wordsEl, t, parent || null); }
    if (t.card) side.append(renderLinkCard(t.card));
    if (t.quoted) side.append(renderQuote(t.quoted));
    if (t.thread && t.thread.length) side.append(renderThread(t));
    const actions = h('div', { className: 'xmc-actions' });
    if (parent) actions.append(actionBtn('reply', 'Reply'), actionBtn('like', 'Like'), actionBtn('bookmark', 'Bookmark'));
    else actions.append(actionBtn('reply', 'Comments'), actionBtn('repost', T('repost')), actionBtn('like', 'Like'), actionBtn('bookmark', 'Bookmark'));
    actions.append(hasMedia(t) ? actionBtn('download', 'Download media', 'download') : h('span', { className: 'xmc-act xmc-gap', 'aria-hidden': 'true' }, icon('download'))); // (an empty slot keeps the icons where they are on every card)
    actions.append(actionBtn('share', 'Copy link', 'link'));
    if (t.counts.views) actions.append(h('span', { className: 'xmc-views xmc-n', textContent: fmt(t.counts.views) + ' views' }));
    side.append(actions);
    const more = parent ? null : moreFrom(t);
    if (more) side.append(more);
    const panel = h('div', { className: 'xmc-replies' }, ...(parent ? [] : [0, 1, 2].map(() => h('div', { className: 'xmc-sk' }, h('i'), h('div', {}, h('b'), h('b'), h('b'))))));
    side.append(panel);
    if (parent) {
      const d = state.details.get(parent.id);
      fillReplies(panel, parent, { data: { replies: d ? repliesTo(d, t.id) : [], more: false } }, t);
      if (focusBox) { const box = side.querySelector('.xmc-cbox'); if (box) box.focus({ preventScroll: true }); }
    } else if (t.counts.reply > 0) {
      Promise.race([loadReplies(t, { wanted: () => panel.isConnected }), sleep(30000).then(() => ({ why: 'This is taking too long.' }))]).then((res) => {
        if (!panel.isConnected) return;
        if (!res || !res.data) { state.commentFails.push(Date.now()); featFail('comments', (res && res.why) || 'no comments came'); } else featOk('comments');
        const chain = contextChain(t).filter(usable);
        if (ctxHost.querySelector('.xmc-vctx-sk') || !ctxHost.children.length) { // the post this answers: in the room kept for it (and the panel scrolled by any difference, so nothing you are reading moves)
          const was = side.scrollHeight;
          ctxHost.replaceChildren(...chain.map((p) => renderParentContext(p, onlyWords(t))));
          if (side.scrollTop > 0) side.scrollTop += side.scrollHeight - was;
        }
        fillReplies(panel, t, res); updateActions(t);
        if (focusBox) { const box = side.querySelector('.xmc-cbox'); if (box) box.focus({ preventScroll: true }); }
      });
    } else { fillReplies(panel, t, { data: { replies: [], more: false } }); if (focusBox) { const box = side.querySelector('.xmc-cbox'); if (box) box.focus({ preventScroll: true }); } }
    return side;
  }
  // The blur behind an open post must never cost smoothness: if the first moments of an opening drop frames, it goes off for the
  // session, and after three such openings it is switched off in the settings.
  const blurGuard = { off: false, strikes: 0 };
  function watchBlur() {
    if (!settings.blurBehind || blurGuard.off) return;
    let last = performance.now(), slow = 0;
    const end = last + 900;
    const step = (now) => {
      if (now - last > 110) slow++;
      last = now;
      if (now < end && postView) { requestAnimationFrame(step); return; }
      if (slow >= 2) {
        blurGuard.off = true; blurGuard.strikes++;
        root.classList.remove('xmc-blur');
        if (blurGuard.strikes >= 3) { settings.blurBehind = false; save(); }
      }
    };
    requestAnimationFrame(step);
  }
  function openPostView(t, still, focusBox, opts) {
    const parent = opts && opts.parent;
    trace('panel-open', t.id + (parent ? ' (comment)' : '') + (postView ? ' (switch)' : ''));
    const reopen = !!postView;
    // a video of this post that is playing (or previewing) behind the panel hands over to the panel's own: the one behind stops, the
    // panel's starts where it was; any other video that is playing stops too, so two never play at once
    const live = [...document.querySelectorAll('video')].find((v) => !v.paused && !v.dataset.gif);
    const carry = live && !reopen && t.el && t.el.contains(live) ? { at: live.currentTime, muted: live.muted && live.dataset.preview !== '1' } : null;
    for (const v of document.querySelectorAll('video')) if (!v.paused && !v.dataset.gif) { delete v.dataset.preview; v.controls = true; v.pause(); }
    if (!reopen) panelOpener = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
    closePostView(reopen, reopen);
    closeMenu();
    // a comment without a picture of its own keeps the post's picture beside it, so the panel does not change shape when you step in and out
    const shown = t.media.length || !parent || !parent.media.length ? t : parent;
    const media = shown.media.length ? h('div', { className: 'xmc-vmediapane' }, ...viewMedia(shown)) : null;
    if (media && shown !== t) media.dataset.owner = 'parent';
    if (media) carousel(media);
    const side = viewSide(t, focusBox, parent);
    const panel = h('div', { className: 'xmc-vpanel' + (media ? '' : ' single') }, media, side);
    const idx = view.cards.indexOf(t);
    const nav = (d, ic, label) => h('button', { className: 'xmc-vnav ' + (d < 0 ? 'prev' : 'next'), type: 'button', title: label, hidden: idx < 0 || !view.cards[idx + d], onclick: (e) => { e.stopPropagation(); stepPostView(d); } }, icon(ic));
    const el = h('div', { className: 'xmc-view' + (still ? ' xmc-still' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Post by ' + t.author.name }, panel, nav(-1, 'prev', 'Previous post (\u2190)'), nav(1, 'next', 'Next post (\u2192)'),
      h('button', { className: 'xmc-vclose', type: 'button', title: 'Close (Esc)' }, icon('close')));
    el.addEventListener('click', (e) => {
      if (e.target === el || e.target.closest('.xmc-vclose')) { closePostView(); return; }
      const btn = e.target.closest('[data-act]');
      if (btn) {
        e.preventDefault(); e.stopPropagation();
        const kind = btn.dataset.act;
        if (kind === 'reply') { const box = side.querySelector('.xmc-cbox'); if (box) { box.scrollIntoView({ block: 'nearest' }); box.focus(); } }
        else if (kind === 'conversation') window.open(new URL(t.url, location.origin).href, '_blank', 'noopener');
        else if (parent) { // a comment: X's own buttons are only on its post's page, so like goes through that; the rest are ours
          if (kind === 'like') likeComment(parent, t, () => updateActions(t));
          else if (kind === 'bookmark') bookmarkComment(parent, t, () => updateActions(t));
          else if (kind === 'share') copyLink(t);
          else if (kind === 'download') downloadMedia(t);
        } else act(t, kind, btn);
        return;
      }
      const lb = e.target.closest('[data-lb]');
      if (lb) { e.preventDefault(); if (!lb.closest('.sensitive')) openLightbox(lb.closest('[data-owner="parent"]') ? parent : t, Number(lb.dataset.lb)); return; }
      const near = e.target.closest('.xmc-tpost, .xmc-pctx');
      if (near && !e.target.closest('a[href], video, .xmc-reveal')) { e.preventDefault(); navigate(near.dataset.href, null); return; }
      const quote = e.target.closest('.xmc-quote[data-href]');
      if (quote && !e.target.closest('a[href]')) { openHref(quote.dataset.href); return; }
      const nl = e.target.closest('a.xmc-nav');
      if (nl) { e.preventDefault(); navigate(nl.getAttribute('href'), t); }
    });
    el.addEventListener('wheel', (e) => { if (e.target === el) e.preventDefault(); }, { passive: false }); // not onto the columns or X's page behind
    root.append(el);
    postView = { t, el, panel, side, parent };
    if (!reopen) {
      // so the Back button closes the panel; never while X's hidden side is on, or on its way to, a post's page (the entry would be that page)
      if (!state.peek && !state.posting && !onPostPage() && !isModalRoute()) { try { window.history.pushState({ xmcView: true }, '', location.href); } catch { /* ignore */ } }
      else needEntry = true; // a visit is running: the entry is added the moment it has ended, so Back still closes the panel
      growFrom(t, panel);
      watchBlur();
    }
    updateActions(t);
    if (carry) {
      const pv = el.querySelector('.xmc-vmediapane video:not([data-gif])');
      if (pv) {
        try { pv.currentTime = carry.at; } catch { /* not seekable yet */ }
        pv.muted = carry.muted; if (!carry.muted && !pv.volume) pv.volume = 1;
        pv.play().catch(() => { pv.muted = true; pv.play().catch(() => {}); }); // (if the browser wants a press first, it plays without sound)
      }
    }
    if (opts && opts.translate) { const xb = side.querySelector(':scope > .xmc-translate'); if (xb && xb.textContent !== 'Show original') setTimeout(() => xb.click(), 0); } // (already translated, as X had it: nothing to press)
    const first = el.querySelector('.xmc-vclose'); if (first && !focusBox) first.focus({ preventScroll: true });
    if (!settings.hintSeen) dismissHint();
  }
  function stepPostView(d) {
    if (!postView) return;
    const i = view.cards.indexOf(postView.t), next = i >= 0 ? view.cards[i + d] : null;
    if (next) openPostView(next, true);
  }
  // the panel grows out of the picture (or card) you clicked
  function growFrom(t, panel) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches || !t.el) return;
    const source = t.el.querySelector('.xmc-media') || t.el;
    const from = source.getBoundingClientRect(), to = panel.getBoundingClientRect();
    if (!from.width || !to.width) return;
    const scale = Math.max(0.15, Math.min(1, from.width / to.width, from.height / to.height));
    const dx = from.left + from.width / 2 - (to.left + to.width / 2), dy = from.top + from.height / 2 - (to.top + to.height / 2);
    panel.style.animation = 'none';
    panel.style.transition = 'none';
    panel.style.transform = `translate(${Math.round(dx)}px, ${Math.round(dy)}px) scale(${scale})`;
    panel.style.opacity = '0.4';
    void panel.offsetWidth;
    panel.style.transition = 'transform .15s cubic-bezier(.2, .8, .2, 1), opacity .1s ease-out';
    panel.style.transform = ''; panel.style.opacity = '';
  }
  function closePostView(keepHistory, instant) {
    if (!postView) return;
    trace('panel-close', (instant ? 'switching' : keepHistory ? 'by Back' : 'closed') + ' ' + postView.t.id);
    pagers.clear(); // no panel, no more comments to fetch for it (a visit under way for them stops at its next step)
    const el = postView.el;
    postView = null;
    if (!instant && panelOpener && panelOpener.isConnected && el.contains(document.activeElement)) panelOpener.focus({ preventScroll: true }); // keyboard user: back to the button they pressed
    if (!instant) panelOpener = null;
    if (!instant && !matchMedia('(prefers-reduced-motion: reduce)').matches) { el.classList.add('xmc-out'); setTimeout(() => el.remove(), 90); } else el.remove(); // switching posts or comments inside the panel: no second backdrop while the first fades
    if (!keepHistory && window.history.state && window.history.state.xmcView) stepBack(); // take our own history entry away again
  }
  window.addEventListener('popstate', () => { // the person pressed Back with the panel open: close it (X's own steps, and ours, don't count)
    if (routerPoke) return;
    while (ownBacks.length && Date.now() - ownBacks[0] > 12000) ownBacks.shift();
    if (ownBacks.length) { ownBacks.shift(); trace('popstate', 'answer to ours'); return; } // the answer to one of ours, however late
    if (window.history.state && window.history.state.xmcView) { // landed on the panel's own entry
      if (postView && state.peek && !state.posting) { trace('popstate', 'you went Back during a visit: panel closed'); closePostView(false); return; } // the visit's page was above it: this Back was yours
      trace('popstate', 'on the panel\u2019s entry'); return;
    }
    if (postView && !state.posting) { trace('popstate', 'you went Back: panel closed'); closePostView(true); } // (our own Backs are counted above, so no guessing by time)
  });
  // ---------- translation ----------
  // Posts and comments in another language get a "Translate post" button. X offers translation only on a post's own page, so the
  // hidden page is taken there, X's own button is pressed, and the translated words are read off its page and shown here (with
  // "Show original"). Nothing is sent anywhere else. If X's page offers nothing we can read, the button opens the post on X instead.
  const TRANSLATE_LABEL = XMCLogic.wordPattern('translate'); // (X has used both "post" and "tweet"; the words are in XMCLogic.WORDS)
  const SHOW_ORIGINAL = XMCLogic.wordPattern('original'), TRANSLATED_FROM = XMCLogic.wordPattern('translatedFrom', false);
  // X's control is found by its English label when X is in English; in any other interface language by where it sits: the one plain
  // button beside the post's words (not one of the post's action buttons, nothing with a test id, nothing in the action row).
  function translateControl(art) {
    const matches = (el) => { const label = (el.textContent || '').trim(); return label.length < 30 && TRANSLATE_LABEL.test(label); };
    for (const el of art.querySelectorAll('[role="button"], button')) if (matches(el)) return el; // an actual button first
    for (const el of art.querySelectorAll('span, div')) if (el.children.length <= 2 && matches(el)) return el.closest('[role="button"], button') || el;
    const words = art.querySelector('[data-testid="tweetText"]');
    if (!words) return null;
    let scope = words.parentElement;
    for (let n = 0; n < 2 && scope && scope.parentElement && art.contains(scope.parentElement); n++) scope = scope.parentElement;
    if (!scope) return null;
    const tagged = (b) => { const x = b.closest('[data-testid]'); return !!x && x !== art && art.contains(x); }; // (a button with a test id of its own is one of X's named controls, not this)
    const cands = [...scope.querySelectorAll('[role="button"], button')].filter((b) => !words.contains(b) && !b.closest('[role="group"]') && !tagged(b) && !b.querySelector('[data-testid]')
      && /\p{L}{3}/u.test(b.textContent || '') && (b.textContent || '').trim().length < 40 && !b.closest('a[href]'));
    const after = cands.filter((b) => words.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING); // (the control sits below the words)
    return after.length === 1 ? after[0] : null; // not sure which: nothing is pressed
  }
  // the language X says a post was translated from ("Translated from Spanish", only when X's interface is in English): read from the small
  // line that says it, not from the page's text as a whole (X's line, its "Show original" and the post's words run together there)
  function translatedFrom(art) {
    for (const el of art.querySelectorAll('span, div')) {
      if (el.children.length > 2 || el.querySelector('[data-testid="tweetText"]')) continue;
      const m = /^translated from\s+(.+)$/i.exec((el.textContent || '').trim());
      if (!m || m[1].length > 60) continue;
      const lang = m[1].replace(/\s*show original.*$/i, '').replace(/\s*·.*$/, '').trim();
      if (lang && lang.length < 30) return lang;
    }
    return '';
  }
  // X translates posts in other languages by itself now, with "Show original": when its (hidden) page has already done it for a post, its
  // words are taken from there, so a press on Translate is answered at once and needs no visit. Only what X has translated is taken.
  function harvestTranslations() {
    if (!settings.autoTranslate && !state.autoXlate) return;
    const probe = state.autoXlate = state.autoXlate || { taken: 0, ids: [], foreignOnPage: 0, lastAt: 0 };
    let foreign = 0;
    for (const art of articles()) {
      const id = articleId(art);
      if (!id) continue;
      const t = state.byId.get(id);
      if (t && needsTranslation(t)) foreign++;
      if (translations.has(id)) continue;
      const words = art.querySelector('[data-testid="tweetText"]');
      if (!words) continue;
      const from = translatedFrom(art);
      if (!from && ![...art.querySelectorAll('[role="button"], button')].some((b) => SHOW_ORIGINAL.test((b.textContent || '').trim()))) continue; // (X says it is translated)
      const text = (words.innerText || '').trim();
      if (!text) continue;
      translations.set(id, { text, from });
      probe.taken++; probe.lastAt = Date.now();
      if (probe.ids.length < 6) probe.ids.push(id);
    }
    probe.foreignOnPage = foreign; // (foreign-language posts X's page has drawn just now: next to "taken", says whether X is translating them)
  }
  // What is done on X's page once it is on the post: find X's Translate control (it is drawn a moment after the page opens, once X has
  // judged the language), press it, and read what X's page then shows. lap is filled with where the time went (milliseconds from T0).
  async function translateHere(t, art, root, lap, T0) {
    const words = () => art.querySelector('[data-testid="tweetText"]');
    const shownText = () => ((words() && words().innerText) || '').trim();
    const before = shownText();
    // translated = X's words changed after we pressed its control (works in any interface language), or X says so in English
    const done = () => { const w = shownText(); return w && (w !== before || TRANSLATED_FROM.test(art.textContent || '')) ? w : ''; };
    if (!TRANSLATED_FROM.test(art.textContent || '')) {
      let ctl = null;
      await waitFor(() => { if (!root) art = findArticle(t.id) || art; ctl = translateControl(art); return ctl; }, 5000);
      if (!ctl) {
        state.translateProbe = { id: t.id, lang: t.lang || '', words: (((art.querySelector('[data-testid="tweetText"]') || {}).innerText) || '').slice(0, 50),
          controls: [...art.querySelectorAll('[role="button"], button, a[href]')].map((b) => ((b.getAttribute('aria-label') || b.textContent || '').trim()).slice(0, 30)).filter(Boolean).slice(0, 16) };
        return { why: 'X offers no translation for this one (or its button isn’t one we can tell).' };
      }
      lap.control = Date.now() - T0;
      fire(ctl);
    }
    const got = await waitFor(done, 7000);
    lap.translated = Date.now() - T0;
    if (!got) return { why: 'X didn’t translate it.' };
    return { ok: true, text: got, from: translatedFrom(art) };
  }
  // On its own: the hidden page is taken to the post (or, for a comment, to its post and then the comment) just for this.
  async function translateVisit(t, root, lap, T0) {
    const attempt = () => inQueue(() => visitPost(root || t, {}, {}, async ({ opened }) => {
      lap.open = Date.now() - T0;
      if (!opened) return { why: 'X didn’t open the post.' };
      const art = root ? await mountComment(t.id) : await waitFor(() => findArticle(t.id), 6000);
      lap.post = Date.now() - T0;
      if (!art) return { why: 'Couldn’t find the post on X’s page.' };
      return translateHere(t, art, root, lap, T0);
    }));
    let res = await attempt();
    // X not opening or not drawing the post is usually a passing thing: one more go before the person is told
    if (res && !res.ok && /didn’t open|find the post/.test(res.why || '')) { trace('translate', 'retry ' + t.id + ' (' + res.why + ')'); res = await attempt(); }
    return res;
  }
  // Translating a post (not a comment) that has not had its comments fetched yet: the visit that fetches them translates it too, on the
  // page that is already open, instead of a second visit afterwards. A post asked about while its comments are on their way is
  // served by that same visit (fetchReplies looks in xlateWaiting once the comments are handed over).
  const translations = new Map(); // post id -> { text, from } once translated
  const xlateRuns = new Map(); // post id -> the translation being fetched (asked for by a press, or begun when the button was pointed at)
  const xlateWaiting = new Map(); // post id -> { resolve, lap }: asked for while its comments are on their way
  function settleXlate(id, res) { const w = xlateWaiting.get(id); if (w) { xlateWaiting.delete(id); w.resolve(res); } }
  function translateOnX(t, root, opts) {
    if (translations.has(t.id)) return Promise.resolve({ ok: true, ...translations.get(t.id) });
    if (xlateRuns.has(t.id)) return xlateRuns.get(t.id); // already on its way (you pointed at the button, or pressed it twice)
    const T0 = Date.now(), lap = {}; // where the time goes: the queue and opening the post, finding it, X's Translate control, X's answer
    const run = (async () => {
      let res = null, via = 'visit';
      if (!root && !state.details.has(t.id)) {
        const waiting = new Promise((resolve) => xlateWaiting.set(t.id, { resolve, lap, T0 }));
        const giveUp = setTimeout(() => settleXlate(t.id, null), 40000);
        loadReplies(t, { translate: true }).then(() => { if (xlateWaiting.has(t.id)) settleXlate(t.id, null); }); // (comments in, or not coming, and the visit did not take it: on its own then)
        res = await waiting;
        clearTimeout(giveUp);
        if (res) via = 'comments';
      }
      if (!res || (!res.ok && /find the post/.test(res.why || ''))) { res = await translateVisit(t, root, lap, T0); via = 'visit'; }
      if (res && res.ok) { translations.set(t.id, { text: res.text, from: res.from }); featOk('translate'); }
      else if (res && !/find the post/.test(res.why || '')) featFail('translate', res.why || 'no answer');
      (state.translateTimes = state.translateTimes || []).push(Object.assign({ id: t.id, ok: !!(res && res.ok), via, warm: !!(opts && opts.warm), total: Date.now() - T0 }, lap)); // (in the diagnostics: the last few)
      if (state.translateTimes.length > 8) state.translateTimes.shift();
      res = res || { why: 'Something went wrong.' };
      return opts && opts.warm ? Object.assign({}, res, { warm: true }) : res;
    })().finally(() => xlateRuns.delete(t.id));
    xlateRuns.set(t.id, run);
    return run;
  }
  // Pointing at a Translate button for a moment starts the translation before you press it, in the same visit that fetches the post's
  // comments; if you do not press, nothing is shown and nothing is kept but the translation. It shares the small budget of lookups that
  // are done only in case you want them.
  function warmTranslate(t, root) {
    if (!t || !needsTranslation(t) || translations.has(t.id) || xlateRuns.has(t.id) || xlateWarmed.has(t.id) || !bgAllowed()) return;
    xlateWarmed.add(t.id); bgUsed();
    translateOnX(t, root || null, { warm: true }).catch(() => {});
  }
  const xlateWarmed = new Set(); // (once per post: a failed try is not repeated just because the pointer passes again; pressing the button always tries)
  // The button under a post's or comment's words: translates in place, then switches between the translation and the original
  function wireTranslate(button, wordsEl, t, root) {
    let shown = null, failed = false, fails = 0; // (the translated copy is only made when there is one)
    const paint = (on) => { shown.hidden = !on; wordsEl.hidden = on; button.textContent = on ? 'Show original' : 'Show translation'; };
    const show = (tr) => {
      if (!shown) { shown = h('div', { className: wordsEl.className + ' xmc-xlate' }); wordsEl.after(shown); }
      shown.replaceChildren(h('div', { className: 'xmc-dim xmc-xlfrom', textContent: 'Translated' + (tr.from ? ' from ' + tr.from : '') }), document.createTextNode(tr.text));
      paint(true);
    };
    if (settings.autoTranslate && translations.has(t.id)) show(translations.get(t.id)); // X has already translated it: shown as X shows it, with "Show original"
    let pointed = 0;
    button.addEventListener('pointerenter', () => { // pointing at it for a moment starts the translation (see warmTranslate)
      clearTimeout(pointed);
      pointed = setTimeout(() => { if (button.isConnected && button.matches(':hover') && !shown && !failed && !button.disabled) warmTranslate(t, root); }, 150);
    });
    button.addEventListener('pointerleave', () => clearTimeout(pointed));
    button.addEventListener('click', async (e) => {
      e.preventDefault(); e.stopPropagation();
      if (failed) { openOnX(t); return; }
      if (button.disabled) return;
      if (shown) { paint(shown.hidden); return; } // back and forth between the two, without asking X again
      if (translations.has(t.id)) { show(translations.get(t.id)); return; }
      button.disabled = true; button.textContent = 'Translating\u2026';
      let res = await translateOnX(t, root);
      if (!res.ok && res.warm) res = await translateOnX(t, root); // (a try begun by pointing at the button failed quietly: this one is the press's own)
      button.disabled = false;
      if (res.ok) { show(res); return; }
      fails++;
      if (fails < 2) { button.textContent = 'Try translating again'; button.title = res.why || ''; toast((res.why || 'Couldn\u2019t translate here.') + ' Press the button to try again.'); }
      else { failed = true; button.textContent = 'Translate on X'; button.title = res.why + ' This opens the post on X.'; toast(res.why || 'Couldn\u2019t translate here.'); }
      trace('translate', 'FAILED ' + t.id + ' ' + (res.why || ''));
    });
  }
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
  const bump = (b) => { if (!b) return; b.classList.add('xmc-bump'); setTimeout(() => b.classList.remove('xmc-bump'), 320); }; // the icon gives a small beat when you press it
  async function act(t, kind, button) {
    const offKind = { like: 'like', bookmark: 'bookmark', repost: 'repost' }[kind];
    if (offKind && feat.off(offKind)) { toast(offSentence(offKind), () => reportProblem(), 'Report', 7000); return undefined; }
    switch (kind) {
      case 'like': bump(button); return toggleAction(t, 'liked', XMCLogic.controlSel('like', 0), XMCLogic.controlSel('like', 1), 'like');
      case 'bookmark': bump(button); return toggleAction(t, 'bookmarked', XMCLogic.controlSel('bookmark', 0), XMCLogic.controlSel('bookmark', 1), 'bookmark');
      case 'repost':
        return openMenu(button, [[t.state.reposted ? T('undo') : T('repost'), () => repost(t, false)], [T('quote'), () => repost(t, true)]]);
      case 'reply': return settings.commentsIn === 'panel' ? openPostView(t, false, true) : toggleComments(t);
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
    const box = e.target.closest && e.target.closest('.xmc-media'), sb = box && box.querySelector('.xmc-snd');
    if (sb) sb.classList.toggle('on', !e.target.muted && e.target.volume > 0);
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
    if (e.target.closest('.xmc-translate')) { e.preventDefault(); openPostView(t, false, false, { translate: true }); return; } // opens the post's panel and translates it there
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
    if (quote) { if (settings.openIn === 'view') openHref(quote.dataset.href); else if (settings.openIn === 'newtab') window.open(new URL(quote.dataset.href, location.origin).href, '_blank', 'noopener'); else location.assign(quote.dataset.href); return; }
    navigate(t.url, t);
  });
  // Resting on a post for a moment starts fetching its comments, so they are usually there by the time you open it (a pass over it,
  // or the page scrolling under the pointer, doesn't count; and not while other comments are on their way)
  const prefetching = new Set();
  let hoverTimer = 0;
  // Lookups done only in case you want them (comments on a post you are resting on, the post a reply answers) share one small budget,
  // and stop altogether for a while if X says it is limiting them; the ones you ask for are never held back.
  const bgLog = [];
  function bgAllowed() {
    const now = Date.now();
    if (state.detailFail && now - state.detailFail.at < 15 * 60000) return false;
    while (bgLog.length && now - bgLog[0] > 60000) bgLog.shift();
    return bgLog.length < 8;
  }
  const bgUsed = () => bgLog.push(Date.now());
  // Pointing at a video for a moment plays it, muted; moving away stops it. Pressing on it takes over (sound as you last set it).
  let previewTimer = 0;
  colsEl.addEventListener('pointerover', (e) => {
    const v = settings.hoverVideo && e.target.closest && e.target.closest('video');
    if (!v || v.dataset.gif) return;
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
      if (!v.isConnected || !v.matches(':hover') || !v.paused || v.ended || Date.now() - lastScrollAt < 400) return;
      v.muted = true; v.dataset.preview = '1'; v.controls = false; // (no controls while it only previews: nothing native is left to read a press as "pause")
      trace('video', 'preview ' + (v.currentSrc || '').slice(-24));
      v.play().catch(() => { delete v.dataset.preview; v.controls = true; });
    }, 350);
  });
  colsEl.addEventListener('pointerout', (e) => { // the preview lasts while the pointer is anywhere on the picture (the buttons over it included)
    const box = e.target.closest && (e.target.closest('.xmc-media') || e.target.closest('video'));
    if (!box || (e.relatedTarget && box.contains && box.contains(e.relatedTarget))) return;
    clearTimeout(previewTimer);
    for (const v of box.tagName === 'VIDEO' ? [box] : box.querySelectorAll('video')) {
      if (v.dataset.preview === '1') { delete v.dataset.preview; v.pause(); v.muted = settings.videoMuted; v.volume = settings.volume; v.controls = true; }
    }
  });
  // Sound: pressing on a video that is only previewing keeps it playing and turns the sound ON (you pressed it to watch it);
  // the speaker button over the picture turns it on or off, and starts the video if it was stopped.
  const soundOn = (v) => { v.muted = false; if (!v.volume) v.volume = 1; };
  // takes a previewing video over: the sound comes on and it carries on from where it is (a restart under your finger is jarring).
  // The player's own controls may also read the press as "pause" (some browsers do, whatever the page cancels), so for a moment after it
  // a pause is undone.
  function takeOver(v) {
    delete v.dataset.preview;
    soundOn(v);
    v.play().catch(() => {});
    const at = Date.now();
    const keep = () => { trace('video', 'pause ' + (Date.now() - at) + 'ms after the press: undone'); if (v.paused) v.play().catch(() => {}); };
    v.addEventListener('pause', keep);
    trace('video', 'press: sound on, carries on at ' + Math.round(v.currentTime) + ' s');
    setTimeout(() => { v.controls = true; }, 150); // the player's own controls come back once the press is over
    setTimeout(() => v.removeEventListener('pause', keep), 1200);
  }
  colsEl.addEventListener('click', (e) => {
    const snd = e.target.closest && e.target.closest('.xmc-snd');
    if (snd) {
      e.preventDefault(); e.stopPropagation();
      const v = snd.closest('.xmc-media').querySelector('video:not([data-gif])');
      if (!v) return;
      delete v.dataset.preview; v.controls = true;
      if (v.muted || !v.volume) { soundOn(v); if (v.paused) v.play().catch(() => {}); } else v.muted = true;
      return;
    }
    const v = e.target.closest && e.target.closest('video');
    if (v && v.dataset.preview === '1') { e.preventDefault(); e.stopPropagation(); takeOver(v); } // sound on, carrying on
  }, true);
  let xlatePoint = 0;
  colsEl.addEventListener('pointerover', (e) => { // the Translate button on a card opens the panel: pointing at it for a moment already starts the translation
    const b = e.target.closest && e.target.closest('.xmc-translate');
    if (!b) return;
    const card = b.closest('.xmc-card'), t = card && tweetOf.get(card);
    if (!t) return;
    clearTimeout(xlatePoint);
    xlatePoint = setTimeout(() => { if (b.isConnected && b.matches(':hover') && !postView) warmTranslate(t, null); }, 150);
  });
  colsEl.addEventListener('pointerout', (e) => { if (e.target.closest && e.target.closest('.xmc-translate')) clearTimeout(xlatePoint); });
  colsEl.addEventListener('pointerover', (e) => {
    const card = e.target.closest && e.target.closest('.xmc-card');
    if (!card) return;
    clearTimeout(hoverTimer);
    const onButton = !!e.target.closest('[data-act="reply"]');
    hoverTimer = setTimeout(() => {
      if (Date.now() - lastScrollAt < 600 || !card.isConnected || !card.matches(':hover')) return;
      const t = tweetOf.get(card);
      if (!t || !t.counts.reply || state.details.has(t.id) || prefetching.has(t.id) || state.peek || repliesWaiting || state.posting || postView || !bgAllowed()) return;
      bgUsed(); prefetching.add(t.id);
      loadReplies(t, { background: true, wanted: () => !postView }).finally(() => prefetching.delete(t.id)); // never ahead of a post you have opened
    }, onButton ? 250 : 400);
  });
  colsEl.addEventListener('pointerout', (e) => { const to = e.relatedTarget; if (!to || !(to.closest && to.closest('.xmc-card'))) clearTimeout(hoverTimer); });
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
    state.late = null;
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
      const dropdown = /^(videos|photos)$/i.test(label) || state.menuTabs.has(routeKey() + '|' + i) || (where() === 'home' && /^following$/i.test(label)); // Following's Popular / Recent
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
  // clamp: folded to icons, a link is as wide as its icon and the padding round it, however wide X's own box for it is (a link can be
  // stretched, or keep room for a name that is hidden): the columns must start by the icons, not by the widest of those boxes
  function navMeasure(nav, clamp) { // bounding box of the nav's links (the <header> itself is wider than what you see)
    const acct = nav.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]');
    let minL = Infinity, maxR = -Infinity;
    for (const n of nav.querySelectorAll('a, button, [role="button"]')) {
      if (acct && acct.contains(n)) continue;
      if (getComputedStyle(n).display === 'none') continue;
      const b = n.getBoundingClientRect();
      if (!b.width || !b.height) continue;
      let right = b.right;
      if (clamp) {
        const svg = n.querySelector('svg'), sb = svg && svg.getBoundingClientRect();
        if (sb && sb.width) right = Math.min(right, sb.right + (parseFloat(getComputedStyle(n.firstElementChild || n).paddingLeft) || 12));
        else right = Math.min(right, b.left + 56); // (the round Post button, our own button: 50 px)
      }
      minL = Math.min(minL, b.left); maxR = Math.max(maxR, right);
    }
    if (minL === Infinity) { const b = nav.getBoundingClientRect(); minL = b.left; maxR = b.right; }
    return { minL, maxR };
  }
  function unpin(which) {
    const el = pin[which].el();
    if (!el || el.dataset.xmcStyle === undefined) return;
    trace('unpin', which + (pin[which].fallback ? ' (pin check gave up)' : ''));
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
    if (sideFreeze) return;
    const parts = [];
    for (const [el, id] of [[settings.hideSidebar || rightAway() ? null : pin.side.el(), 'xmc-sidefreeze'], [pin.nav.el(), 'xmc-navfreeze']]) { // the right column and the menu on the left
      if (!el || el.dataset.xmcStyle === undefined || !el.getBoundingClientRect().width) continue;
      const clone = el.cloneNode(true);
      for (const mine of clone.querySelectorAll('#xmc-pill')) mine.remove(); // our own button stays where it is (below), never copied
      for (const x of [clone, ...clone.querySelectorAll('[data-testid], [id]')]) { // (the fold rules need to know the Post button and the account button, so those two are kept under another name)
        const tid = x.getAttribute('data-testid');
        if (tid === 'SideNav_NewTweet_Button' || tid === 'SideNav_AccountSwitcher_Button') x.setAttribute('data-xmc-tid', tid);
        x.removeAttribute('data-testid'); x.removeAttribute('id');
      }
      clone.id = id;
      clone.removeAttribute('role'); // or the page's own menu lookups would find the copy
      clone.setAttribute('inert', ''); clone.setAttribute('aria-hidden', 'true');
      clone.style.setProperty('pointer-events', 'none', 'important');
      document.body.append(clone);
      clone.scrollTop = el.scrollTop;
      el.style.setProperty('visibility', 'hidden', 'important');
      parts.push({ clone, el });
    }
    if (!parts.length) return;
    document.documentElement.classList.add('xmc-frozen'); // also hides a sidebar or menu X builds from scratch meanwhile
    trace('freeze', parts.length + ' still copies');
    sideFreeze = { parts, hardStop: Date.now() + 15000 };
  }
  function thawSidebar() {
    if (!sideFreeze) return;
    const { parts } = sideFreeze;
    trace('thaw');
    sideFreeze = null;
    for (const { el } of parts) el.style.removeProperty('visibility');
    positionSide(); // if X rebuilt the sidebar meanwhile, pin the new one before anyone sees it (the menu is pinned by the next pass, hidden until then)
    document.documentElement.classList.remove('xmc-frozen');
    for (const { clone } of parts) clone.remove();
  }
  const navRestore = () => { thawSidebar(); unpin('nav'); unpin('side'); };
  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { // once you stop: X may have swapped layouts, so re-measure the sidebars
      navRestore();
      if (!root.hidden) { guard('position', position); relayoutIfNeeded(); }
    }, 200);
  });

  // Is something we pinned still what you'd click? A probe that is off screen (or missing) says nothing, so it is not a
  // failure: counting it as one made the sidebar fall back to X's own spot for 10s and jump.
  function probeOk(b, container) {
    if (!b || !b.width || b.top < 0 || b.bottom > innerHeight || b.left < 0 || b.right > innerWidth) return true;
    const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    return !hit || container.contains(hit) || !!hit.closest('#layers, #xmc-root, #xmc-toast, #xmc-lightbox, .xmc-swrap, #xmc-navfreeze, #xmc-sidefreeze'); // our own panel, settings, toast and still copies may cover them: that is not a broken pin
  }
  function positionNav() {
    const p = pin.nav, nav = p.el();
    if (!nav) { root.style.left = '0px'; return; }
    if (p.fallback && Date.now() > p.retryAt) { p.fallback = false; p.fails = 0; }
    if (p.fallback) { root.style.left = (navMeasure(nav, railOn()).maxR + 20) + 'px'; return; }
    const acct = nav.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]');
    if (nav.dataset.xmcStyle === undefined) {
      const m = navMeasure(nav, railOn());
      const r = nav.getBoundingClientRect();
      nav.dataset.xmcStyle = nav.getAttribute('style') || '';
      p.width = Math.round(m.maxR - m.minL);
      if (!railOn()) p.fullW = p.width; // (what the menu measures with its names showing, for when it is folded and opened again)
      // (the header keeps its width: X lays its menu out against the header's right edge, so a narrower box moves the icons, off the screen on a wide
      // window. The part that hangs over the columns past the icons is clipped away instead (--xmc-clip, in the stylesheet): it shows nothing and catches no press)
      const hw = r.width, clipR = railOn() ? Math.max(0, Math.round(r.width - (m.maxR - r.left))) : 0;
      nav.style.cssText += `;position:fixed !important;top:0 !important;height:100vh !important;margin:0 !important;` +
        `transform:none !important;z-index:6 !important;width:${Math.round(hw)}px !important;` +
        `left:${Math.round(-(m.minL - r.left))}px !important;--xmc-clip:${clipR}px`;
      if (acct) { acct.style.maxWidth = p.width + 'px'; acct.style.overflow = 'hidden'; }
    } else if (!sideFreeze) { // (while a still copy stands in for it there is nothing to probe)
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
    if (!(settings.hideSidebar || rightAway()) || (settings.hideGrokDrawer && settings.hideDmDrawer)) return (lastStrip = 0);
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
        `overflow-y:auto !important;scrollbar-width:none !important;margin:0 !important;transform:translateX(var(--xmc-sx, 0px)) !important;z-index:6 !important;width:${p.width}px !important`;
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
    root.style.right = rightAway() ? Math.max(floatStrip(), 24) + 'px' : (p.width + 8 + 24) + 'px'; // (away: only the tab's strip, and room for Grok and Chat)
  }

  // ---------- folding the side panels ----------
  // Left: the menu folds to a rail of icons (its names fade out) when X's logo at the top of it is pressed (the logo is otherwise a second
  // link to Home, so it costs no row). Right: the whole panel slides off the edge, and a tab on its edge brings it back.
  // Alt+[ and Alt+] do the same. The choice is kept. Both only while the columns are showing.
  const rightAway = () => settings.rightPanel === 'hidden';
  const navHasNames = () => { const hdr = pin.nav.el(); return !!hdr && [...hdr.querySelectorAll('nav a[href]')].some((a) => a.textContent.trim()); }; // (X's narrow layout already shows icons only)
  function railOn() { return settings.leftPanel === 'rail' && document.documentElement.classList.contains('xmc-on') && navHasNames(); }
  function railWidth() { // where the right edge of the menu is when only the icons are left
    const hdr = pin.nav.el();
    const a = hdr && [...hdr.querySelectorAll('nav a[href]')].find((x) => x.querySelector('svg') && !x.matches('[data-testid="SideNav_NewTweet_Button"]'));
    const svg = a && a.querySelector('svg');
    if (!svg) return 76;
    const pad = parseFloat(getComputedStyle(a.firstElementChild || a).paddingLeft) || 12;
    return Math.round(svg.getBoundingClientRect().right + pad);
  }
  // The names in the menu are found by their words (the biggest piece of text in a link that has no icon in it), not by where X's markup
  // happens to put them, so a different nesting still folds. Marked with data-xmc-label; the stylesheet fades those.
  function markNavLabels() {
    const hdr = pin.nav.el();
    if (!hdr) return;
    for (const a of hdr.querySelectorAll('nav a[href], nav [role="button"]')) {
      if (a.matches('[data-testid="SideNav_NewTweet_Button"]')) continue;
      const cands = a.querySelector('svg') ? [...a.querySelectorAll('*')].filter((x) => !x.closest('svg') && !x.querySelector('svg') && x.textContent.trim()) : [];
      const best = cands.reduce((m, x) => Math.max(m, x.textContent.trim().length), 0);
      const label = cands.find((x) => x.textContent.trim().length === best); // (document order: the outermost box holding those words)
      for (const old of a.querySelectorAll('[data-xmc-label]')) if (old !== label) delete old.dataset.xmcLabel;
      if (label && label.dataset.xmcLabel !== '1') label.dataset.xmcLabel = '1';
    }
  }
  // Folded, the menu should be about as wide as its icons. If it is not, say so once (the diagnostics have the details).
  function railCheck() {
    const hdr = pin.nav.el();
    if (!railOn() || !hdr || state.railFail) return;
    const marked = [...hdr.querySelectorAll('[data-xmc-label]')];
    const showing = marked.filter((x) => x.getBoundingClientRect().width > 1 && Number(getComputedStyle(x).opacity) > 0.05).length;
    const raw = navMeasure(hdr), want = railWidth(), wide = raw.maxR - raw.minL > want + 30;
    if (showing === 0 && (marked.length || !wide)) return; // the names are gone: folded (a box of X's that is wider than its icon is not something you see)
    state.railFail = { width: Math.round(raw.maxR - raw.minL), expected: want, namesShowing: showing, namesFound: marked.length };
    trace('rail FAILED', showing + ' names still showing, menu ' + state.railFail.width + 'px wide, icons end at ' + want);
    toast('X’s menu would not fold here. Copy diagnostics shows why.');
  }
  // Is the menu there to be seen and pressed? Looked at twice a second while it is pinned. If its first icon is hidden, clipped away or
  // under something that is not ours for a second, the pin is done again; if that does not bring it back, again without the clip that
  // keeps a folded menu's overhang off the columns. What was found goes in the trace and the diagnostics (menuGone).
  let menuBad = 0, menuHealAt = 0, menuHeals = 0;
  function menuSeen(hdr) {
    const a = [...hdr.querySelectorAll('nav a[href]')].find((x) => x.querySelector('svg') && getComputedStyle(x).display !== 'none');
    const svg = a && a.querySelector('svg');
    if (!svg) return null;
    const b = svg.getBoundingClientRect();
    const at = [b.left, b.top, b.width, b.height].map(Math.round).join(',');
    if (!b.width || !b.height) return { why: 'the first icon has no size', at };
    for (let el = svg; el && el !== document.documentElement; el = el.parentElement) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return { why: (el === svg ? 'icon' : el.tagName.toLowerCase()) + ' is ' + (cs.display === 'none' ? 'display:none' : cs.visibility === 'hidden' ? 'visibility:hidden' : 'opacity ' + cs.opacity), at };
    }
    if (b.right <= 0 || b.left >= innerWidth) return { why: 'the first icon is off the screen sideways', at };
    if (b.bottom <= 0 || b.top >= innerHeight) return null; // (a short window: nothing to judge by)
    const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    if (!hit || hdr.contains(hit) || hit.closest('#layers, #xmc-toast, #xmc-lightbox, .xmc-swrap, #xmc-navfreeze, #xmc-pill') || (postView && hit.closest('#xmc-root'))) return null;
    const cs = getComputedStyle(hdr);
    return { why: 'something else is on top of the first icon: ' + (hit.id ? '#' + hit.id : hit.tagName.toLowerCase() + (typeof hit.className === 'string' && hit.className ? '.' + hit.className.trim().split(/\s+/)[0] : '')), at, clip: cs.clipPath, box: [hdr.getBoundingClientRect().left, hdr.getBoundingClientRect().width].map(Math.round).join(',') };
  }
  function menuWatch() {
    const html = document.documentElement, hdr = pin.nav.el();
    const calm = html.classList.contains('xmc-on') && hdr && hdr.dataset.xmcStyle !== undefined && !pin.nav.fallback && !sideFreeze && !state.peek && !state.posting && !root.hidden && !html.classList.contains('xmc-panelanim') && !html.classList.contains('xmc-boot');
    const bad = calm ? menuSeen(hdr) : null;
    if (!bad) { menuBad = 0; return; }
    state.menuGone = Object.assign({ rail: html.classList.contains('xmc-rail'), pinW: pin.nav.width, heals: menuHeals }, bad);
    if (++menuBad < 2) return;
    menuBad = 0;
    if (Date.now() - menuHealAt > 60000) menuHeals = 0;
    menuHealAt = Date.now();
    if (menuHeals >= 2) { traceOnce('menu gone', 'still not showing after two repairs: ' + JSON.stringify(state.menuGone), 30000); return; }
    menuHeals++;
    if (menuHeals === 2) html.classList.add('xmc-noclip');
    trace('menu gone', JSON.stringify(state.menuGone) + (menuHeals === 2 ? ': pinned again without the clip' : ': pinned again'));
    html.classList.remove('xmc-frozen'); // (it is only ever on while a still copy stands in; with none it would hide the menu for good)
    unpin('nav'); positionNav();
  }
  const shape = (el, d = 0) => { // an outline of a link's markup: tags, roles and the words of the name, nothing else
    const tag = el.tagName.toLowerCase();
    if (tag === 'svg') return 'svg';
    const mine = tag + (el.getAttribute('role') ? '[' + el.getAttribute('role') + ']' : '') + (el.dataset && el.dataset.xmcLabel ? '*' : '');
    if (!el.children.length) return mine + '"' + el.textContent.trim().slice(0, 14) + '"';
    return d > 6 ? mine : mine + '(' + [...el.children].map((k) => shape(k, d + 1)).join(' ') + ')';
  };
  function panelProbe() {
    const hdr = pin.nav.el(), side = pin.side.el(), html = document.documentElement;
    const box = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.right)]; };
    const links = hdr ? [...hdr.querySelectorAll('nav a[href], nav [role="button"]')] : [];
    const tpl = links.find((a) => a.querySelector('svg') && a.textContent.trim());
    const marked = hdr ? [...hdr.querySelectorAll('[data-xmc-label]')] : [];
    const m = hdr ? navMeasure(hdr) : null, mc = hdr ? navMeasure(hdr, true) : null;
    const widest = links.map((a) => ({ a, w: Math.round(a.getBoundingClientRect().width) })).sort((x, y) => y.w - x.w).slice(0, 4)
      .map((x) => (x.a.getAttribute('data-testid') || x.a.getAttribute('aria-label') || (x.a.getAttribute('href') || '').slice(0, 24) || x.a.tagName.toLowerCase()) + ' ' + x.w);
    return {
      left: settings.leftPanel, right: settings.rightPanel, classes: ['xmc-rail', 'xmc-sidehide', 'xmc-panelanim', 'xmc-noclip', 'xmc-frozen'].filter((c) => html.classList.contains(c)).join(' '),
      navLinks: links.length, namesFound: marked.length, namesStillShowing: html.classList.contains('xmc-rail') ? marked.filter((x) => x.getBoundingClientRect().width > 1).length : null,
      header: box(hdr), icons: m ? [Math.round(m.minL), Math.round(m.maxR)] : null, iconsClamped: mc ? [Math.round(mc.minL), Math.round(mc.maxR)] : null, widestLinks: widest, columnsFrom: root.style.left, columnsTo: root.style.right, side: box(side),
      tab: sideTab.hidden ? 'hidden' : sideTab.style.right, failed: state.railFail || null, menuGone: state.menuGone || null, menuHeals, linkShape: tpl ? shape(tpl) : '',
    };
  }
  // The logo (the bird, or the X) at the top of X's menu folds and unfolds it: Home already goes home, so the logo is free for this, and
  // there is no extra button taking a row of the menu. Only while the columns are up and there are names to fold (X's narrow layout is
  // icons already); X's own attributes are put back when it stops.
  const logoLink = () => { const hdr = pin.nav.el(); return hdr && (hdr.querySelector('h1 a[href="/home"]') || hdr.querySelector('h1 a[href]')); };
  function syncLogoToggle() {
    const a = logoLink();
    if (!a) return;
    const on = document.documentElement.classList.contains('xmc-on') && (navHasNames() || settings.leftPanel === 'rail');
    if (!on) {
      if (a.dataset.xmcLogo) { // put X's own back
        const was = JSON.parse(a.dataset.xmcWas || '{}');
        for (const k of ['role', 'aria-label', 'title']) { if (was[k] === null || was[k] === undefined) a.removeAttribute(k); else a.setAttribute(k, was[k]); }
        a.removeAttribute('aria-expanded'); delete a.dataset.xmcLogo; delete a.dataset.xmcWas;
      }
      return;
    }
    if (!a.dataset.xmcLogo) { a.dataset.xmcWas = JSON.stringify({ role: a.getAttribute('role'), 'aria-label': a.getAttribute('aria-label'), title: a.getAttribute('title') }); a.dataset.xmcLogo = '1'; a.setAttribute('role', 'button'); }
    const rail = settings.leftPanel === 'rail';
    const name = rail ? 'Show the menu with names' : 'Fold the menu to icons';
    if (a.getAttribute('aria-label') !== name) { a.setAttribute('aria-label', name); a.title = name + ' (Alt+[)'; }
    a.setAttribute('aria-expanded', String(!rail));
  }
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('[data-xmc-logo="1"]');
    if (!a || e.button || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return; // (a modified press still opens Home as a link does)
    e.preventDefault(); e.stopPropagation(); setPanel('left');
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key === ' ' && e.target.closest && e.target.closest('[data-xmc-logo="1"]')) { e.preventDefault(); e.stopPropagation(); setPanel('left'); } // (Enter is a click already)
  }, true);
  const sideTab = h('button', { id: 'xmc-sidetab', type: 'button', hidden: true, onclick: () => setPanel('right') }, icon('next'));
  document.body.append(sideTab);
  function positionTab() {
    const p = pin.side, side = p.el();
    const show = document.documentElement.classList.contains('xmc-on') && !root.hidden && !settings.hideSidebar && !!side && !p.fallback && side.dataset.xmcStyle !== undefined && p.width > 0 && !!side.getBoundingClientRect().width;
    if (sideTab.hidden === show) sideTab.hidden = !show;
    if (!show) return;
    const away = rightAway();
    sideTab.dataset.away = away ? '1' : '';
    const right = away ? 0 : p.width + 8 - 1; // on the inner edge of the panel, or on the edge of the window
    if (sideTab.style.right !== right + 'px') sideTab.style.right = right + 'px';
    const t = (away ? 'Show the right panel' : 'Slide the right panel away') + ' (Alt+])';
    if (sideTab.title !== t) { sideTab.title = t; sideTab.setAttribute('aria-label', away ? 'Show the right panel' : 'Slide the right panel away'); }
    sideTab.setAttribute('aria-expanded', String(!away));
  }
  let panelsSeen = '', panelTimer = 0;
  function settlePanels() { // the slide has stopped: measure the menu again, and lay the posts out for the room there now is
    const html = document.documentElement;
    html.classList.remove('xmc-panelanim');
    unpin('nav'); positionNav(); positionSide();
    if (pill.isConnected && !pill.hidden) placePill();
    railCheck();
    if (!root.hidden && colCount() !== columns.length && layoutHeld()) relayoutIfNeeded();
    else if (!root.hidden && colCount() !== columns.length) { // (a different number of columns fits now: a short fade, not a jump)
      colsEl.classList.add('xmc-fade');
      setTimeout(() => { relayout(); requestAnimationFrame(() => colsEl.classList.remove('xmc-fade')); }, 140);
    }
  }
  function applyPanels() {
    const html = document.documentElement;
    if (!html.classList.contains('xmc-on') || !pin.nav.el()) { html.classList.remove('xmc-rail', 'xmc-sidehide'); return; }
    const rail = railOn(), away = rightAway();
    const sig = (rail ? 'R' : 'F') + (away ? 'A' : 'S');
    if (html.classList.contains('xmc-rail') !== rail) { markNavLabels(); html.classList.toggle('xmc-rail', rail); }
    if (html.classList.contains('xmc-sidehide') !== away) html.classList.toggle('xmc-sidehide', away);
    if (sig === panelsSeen) return;
    const first = panelsSeen === '';
    panelsSeen = sig;
    if (first) { if (rail) setTimeout(railCheck, 600); return; } // as the page was left: no slide on arrival
    html.classList.add('xmc-panelanim');
    clearTimeout(panelTimer);
    panelTimer = setTimeout(settlePanels, 360);
  }
  function setPanel(side) {
    const html = document.documentElement;
    markNavLabels();
    html.classList.add('xmc-panelanim'); void html.offsetWidth; // (the slide is switched on before what slides is changed)
    if (side === 'left') {
      settings.leftPanel = settings.leftPanel === 'rail' ? 'full' : 'rail';
      const target = settings.leftPanel === 'rail' ? railWidth() : (pin.nav.fullW || 270);
      pin.nav.width = target; root.style.left = (target + 20) + 'px'; // the columns' edge goes where it will end up, and slides there
    } else settings.rightPanel = settings.rightPanel === 'hidden' ? 'shown' : 'hidden';
    save();
    applyPanels();
    html.classList.add('xmc-panelanim'); // (applyPanels has already started the timer when the state changed)
    positionSide(); positionTab();
  }

  // Which sidebar entries exist right now; remembered so the settings page can offer to hide any of them.
  // Extra entries in X's left menu (Bookmarks, Likes, Lists), made from one of X's own menu links so they look like the rest.
  // Pressing one loads that page (a normal page load: X's router is not asked).
  const EXTRA_NAV = [
    { key: 'navBookmarks', label: 'Bookmarks', icon: 'bookmark', href: () => '/i/bookmarks' },
    { key: 'navLikes', label: 'Likes', icon: 'like', href: (me) => (me ? '/' + me + '/likes' : '') },
    { key: 'navLists', label: 'Lists', icon: 'list', href: (me) => (me ? '/' + me + '/lists' : '') }, // (/i/lists is an empty page: your lists are under your own name)
  ];
  function syncExtraNav() {
    const nav = pin.nav.el();
    if (!nav) return;
    const want = EXTRA_NAV.filter((x) => settings[x.key]);
    // With both Bookmarks and Likes added, X's own History entry (the two in one) is redundant: hidden, and ours take its place
    const history = [...nav.querySelectorAll('nav a[href]')].find((a) => !a.dataset.xmcNav && (/^\/i\/(bookmarks|history)\b/.test(a.getAttribute('href')) || /^history$/i.test((a.textContent || '').trim())));
    const replaceHistory = !!history && settings.navBookmarks && settings.navLikes;
    for (const a of nav.querySelectorAll('[data-xmc-hidden]')) if (a !== history || !replaceHistory) { a.style.removeProperty('display'); delete a.dataset.xmcHidden; }
    if (replaceHistory && !history.dataset.xmcHidden) { history.dataset.xmcHidden = '1'; history.style.setProperty('display', 'none', 'important'); }
    for (const old of nav.querySelectorAll('[data-xmc-nav]')) if (!want.some((x) => x.key === old.dataset.xmcNav)) old.remove();
    if (!want.length) return;
    const links = [...nav.querySelectorAll('nav a[href]')].filter((a) => !a.dataset.xmcNav && !a.matches('[data-testid="SideNav_NewTweet_Button"]'));
    const template = links.find((a) => /^\/explore\b/.test(a.getAttribute('href'))) || links.find((a) => a.querySelector('svg') && a.textContent.trim());
    if (!template) return;
    const profile = nav.querySelector('a[data-testid="AppTabBar_Profile_Link"]');
    const me = profile ? (profile.getAttribute('href') || '').replace(/^\//, '').split('/')[0] : '';
    const after = links.find((a) => /^\/i\/bookmarks\b/.test(a.getAttribute('href'))) || links.find((a) => /^\/notifications\b/.test(a.getAttribute('href'))) || template;
    // X draws its menu with the names only when it has room (a narrow window, or the first moment before it has measured, shows icons alone).
    // An entry made then has no name for good, so one made from a menu that has since changed is made again.
    const named = template.textContent.trim() ? '1' : '0';
    for (const old of nav.querySelectorAll('[data-xmc-nav]')) if (old.dataset.xmcNamed !== named) old.remove();
    for (const x of want) {
      const href = x.href(me);
      if (!href || nav.querySelector(`[data-xmc-nav="${x.key}"]`)) continue;
      const a = template.cloneNode(true);
      a.dataset.xmcNamed = named;
      for (const el of [a, ...a.querySelectorAll('[data-testid], [id]')]) { el.removeAttribute('data-testid'); el.removeAttribute('id'); }
      a.setAttribute('href', href); a.setAttribute('aria-label', x.label); a.removeAttribute('aria-current'); a.dataset.xmcNav = x.key;
      const svg = a.querySelector('svg');
      if (svg) {
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.replaceChildren(...[...icon(x.icon).children]);
        svg.style.cssText = 'fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round';
      }
      const tl = template.textContent.trim();
      const word = [...a.querySelectorAll('span')].reverse().find((sp) => sp.children.length === 0 && sp.textContent.trim() === tl);
      if (word) word.textContent = x.label;
      a.addEventListener('click', (e) => { if (e.button || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return; e.preventDefault(); e.stopPropagation(); location.assign(href); });
      // placed under the last entry we added (or under History / Bookmarks / Notifications)
      const mine = [...nav.querySelectorAll('[data-xmc-nav]')].pop();
      if (mine) mine.after(a); else if (replaceHistory) history.before(a); else after.after(a); // (in History's place, when it is hidden)
    }
  }
  function scanNavItems() {
    guard('extra nav', syncExtraNav);
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
  const OURS = '#xmc-root, #xmc-toast, #xmc-pill, #xmc-fab, #xmc-sidefreeze, #xmc-navfreeze';
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
    if (settings.hideGrokDrawer || settings.hideDmDrawer || settings.hideSidebar || rightAway() || !chat || chat === grok || chat.contains(grok) || grok.contains(chat)) { undockGrok(grok); return; }
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

  // ---------- failing open ----------
  // When what this extension needs from X has stopped working, X's own page is shown (as "Turn Columns Off" does for this page), with the
  // reason in a line and a Report button: nobody is left with a broken screen. "Turn Columns On" tries again.
  function failOpen(why) {
    const route = routeKey();
    if (state.failed === route) return;
    state.failed = route; state.failedBy = 'error'; state.failWhy = String(why).slice(0, 240);
    trace('FAIL OPEN', state.failWhy);
    toast('Columns stopped working here, so X’s own page is showing. ' + state.failWhy, () => reportProblem(), 'Report', 12000);
  }
  const droppedSummary = () => Object.entries(XMCParse.stats.dropped).filter(([, n]) => n > 0).map(([k, n]) => k + ' ' + n).join(', ') || 'no reason counted';
  // Looks, from X's own (hidden) page, for the things this extension presses or reads, so a change shows before anyone presses anything.
  function probeX() {
    if (state.peek || state.posting || onPostPage()) return;
    const art = articles()[0], nav = pin.nav.el();
    const has = (kind) => !!(art && art.querySelector(XMCLogic.controlSel(kind)));
    state.probe = {
      at: Date.now(), lang: document.documentElement.lang || '', xPosts: articles().length, homeLink: !!(nav && nav.querySelector('a[href="/home"]')), tabs: realTabs().length,
      timeLink: !!(art && art.querySelector('a[href*="/status/"] time')), like: has('like'), repost: has('repost'), bookmark: has('bookmark'), reply: has('reply'), share: has('share'), text: has('tweetText'),
    };
  }
  // what the settings page shows: counted features, the things placed by measurement, the last probe and the parser's numbers
  function featureReport() {
    const nv = pin.nav.el(), sd = pin.side.el();
    return {
      version: ext && ext.runtime.getManifest ? ext.runtime.getManifest().version : 'dev', features: feat.snapshot(), probe: state.probe || null,
      placed: { menu: pin.nav.fallback ? 'failing' : nv && nv.dataset.xmcStyle !== undefined ? 'working' : 'unseen', sidebar: settings.hideSidebar ? 'unseen' : pin.side.fallback ? 'failing' : sd && sd.dataset.xmcStyle !== undefined ? 'working' : 'unseen', menuGone: state.menuGone ? state.menuGone.why : '' },
      parse: { responses: XMCParse.stats.responses, entries: XMCParse.stats.entries, tweetItems: XMCParse.stats.tweetItems, tweets: XMCParse.stats.tweets, dropped: XMCParse.stats.dropped, entryTypes: XMCParse.stats.itemTypes, ops: XMCParse.stats.ops, ignoredOps: XMCParse.stats.ignoredOps },
      failedOpen: state.failed ? { route: state.failed, why: state.failWhy || '' } : null,
    };
  }
  const FEAT_KEY = 'xmcFeatures';
  let featSent = '', featSentAt = 0;
  function publishFeatures() { // for the settings page (it cannot see this page): when it changed, at most every five seconds
    const rep = featureReport(), s = JSON.stringify(rep);
    if (s === featSent || Date.now() - featSentAt < 5000) return;
    featSent = s; featSentAt = Date.now();
    const out = Object.assign({ at: Date.now() }, rep);
    if (storage) storage.set({ [FEAT_KEY]: out }).catch(() => {});
    else { try { localStorage.setItem('xmc.features', JSON.stringify(out)); } catch { /* storage blocked */ } }
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
    if (bad) healthBtn.title = state.health.map((i) => i.text).join('\n') + '\nClick to report it (the details are copied for you to paste).';
  }

  // ---------- main loop ----------
  function position() {
    applyPanels();
    positionNav();
    positionSide();
    positionTab();
    const cs = getComputedStyle(document.body);
    // use the sidebar's own label font ("Home"); the sans fallbacks keep it from ever dropping to serif
    const nav = pin.nav.el();
    const label = nav && ([...nav.querySelectorAll('span')].find((s) => s.textContent.trim() === 'Home') || nav.querySelector('span'));
    root.style.fontFamily = settings.systemFont ? 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
      : `${getComputedStyle(label || document.body).fontFamily}, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
    const clear = (c) => !c || c === 'transparent' || /^rgba\([^)]*,\s*0(\.0+)?\)$/.test(c) || /\/\s*0(\.0+)?\)$/.test(c); // (not plain black, rgb(0, 0, 0): that ends in ", 0)" too)
    let bg = [document.body, document.documentElement].map((el) => getComputedStyle(el).backgroundColor).find((c) => !clear(c));
    if (!bg) { // nothing opaque found: pick black or white from the text colour
      const m = /(\d+)[, ]+(\d+)[, ]+(\d+)/.exec(cs.color || '');
      bg = m && (0.299 * m[1] + 0.587 * m[2] + 0.114 * m[3]) > 140 ? 'rgb(0, 0, 0)' : 'rgb(255, 255, 255)';
    }
    root.classList.toggle('xmc-seethru', clear(cs.backgroundColor)); // a wallpaper or theme shows through: cards need a stronger tint to be seen
    for (const el of [root, toastEl, document.documentElement]) {
      el.style.setProperty('--xmc-bg', cs.backgroundColor); // exactly what X's page has: may be see-through (a themed or wallpaper background shows through the columns)
      el.style.setProperty('--xmc-solid', bg);              // for things that must stay readable over anything: menus, toast, the loading pill
      el.style.setProperty('--xmc-fg', cs.color);
    }
  }

  const CORE_STEPS = new Set(['tick', 'render', 'pump', 'position', 'tabs', 'tab rules', 'bar']);
  const coreErrors = [];
  const guard = (name, fn) => {
    try { fn(); } catch (err) {
      console.error('[xmc]', name, err); traceOnce('error ' + name, err && err.message, 30000);
      if (CORE_STEPS.has(name) && state.shown) { // thirty in ten seconds, in the steps that draw and place the columns: it is not going to stop
        const now = Date.now(); coreErrors.push(now);
        while (coreErrors.length && now - coreErrors[0] > 10000) coreErrors.shift();
        if (coreErrors.length >= 30) { coreErrors.length = 0; failOpen('The script keeps stopping with an error (' + name + ': ' + String((err && err.message) || err).slice(0, 90) + ').'); }
      }
    }
  };
  let veilPath = null;
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
    if (tickN % 4 === 0) { guard('logo toggle', syncLogoToggle); guard('menu names', markNavLabels); }
    if (tickN % 15 === 7) guard('translations', harvestTranslations);
    guard('side panels', applyPanels);
    if (tickN % 5 === 4) guard('menu watch', menuWatch);
    if (tickN % 50 === 25) guard('probe', probeX);
    if (tickN % 20 === 10) guard('publish', publishFeatures);
    if (tickN % 10 === 6) guard('keys room', keepHiddenPageRoom);
    if (tickN % 5 === 3) { guard('reply context', contextTick); guard('hint', updateHint); guard('history', tidyHistory); guard('panel entry', ensurePanelEntry); }
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
    if (document.documentElement.classList.contains('xmc-veil')) { // decided: X's page is either hidden by the columns or meant to be seen
      document.documentElement.classList.remove('xmc-veil');
      if (active) { // (the columns are up: X's menu and sidebar come through with a short fade, not a pop)
        document.documentElement.classList.add('xmc-boot');
        trace('veil-lifted', Math.round(performance.now()) + ' ms after the page began');
        setTimeout(() => document.documentElement.classList.remove('xmc-boot'), 300);
      }
    }
    document.documentElement.classList.toggle('xmc-peeking', !!state.peek || !!state.posting);
    if (active && tickN % 12 === 0 && Date.now() - lastScrollAt > 1500 && !document.documentElement.classList.contains('xmc-viewer')) { // something of X's showing through the columns
      const shows = (el) => { if (!el) return false; const cs = getComputedStyle(el), r = el.getBoundingClientRect(); return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05 && r.width > 40 && r.height > 40 && r.right > 0 && r.left < innerWidth; };
      const pc = mainCol(), nv = pin.nav.el(), sd = pin.side.el();
      if (pc && !state.posting && shows(pc)) traceOnce('LEAK', 'X\u2019s own timeline is visible under the columns');
      if (nv && nv.dataset.xmcStyle === undefined && !pin.nav.fallback && !sideFreeze && shows(nv)) traceOnce('LEAK', 'X\u2019s menu is showing unpinned');
      if (sd && sd.dataset.xmcStyle === undefined && !pin.side.fallback && !sideFreeze && !settings.hideSidebar && shows(sd)) traceOnce('LEAK', 'X\u2019s sidebar is showing unpinned');
    }
    if (!state.peek && !state.posting && !onPostPage() && !isModalRoute()) { const want = active ? location.pathname : ''; if (want !== veilPath) { veilPath = want; try { if (want) window.localStorage.setItem('xmcVeil', want); else window.localStorage.removeItem('xmcVeil'); } catch { /* ignore */ } } }
    root.hidden = !active;
    root.classList.toggle('xmc-under', modal);
    const pillShown = eligible() || canTry() || active; // (while X's hidden page is away on a post for us, the address is the post's and nothing is "eligible", but the columns are up, so the pill stays)
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
      const sx = XMCParse.stats;
      const ign = Object.keys(sx.ignoredOps);
      failOpen(sx.tweetItems && !sx.tweets ? 'X sent ' + sx.tweetItems + ' posts and none could be read (' + droppedSummary() + ').' : ign.length ? 'X sent posts under names this version does not read as timelines: ' + ign.slice(0, 4).join(', ') + '.' : 'No timeline data arrived. \u201cTurn Columns On\u201d tries again.');
      return;
    }
    if (state.homeHold && state.sel === 1 && !state.awaiting) state.homeHold = false; // Following is up: draw it now, not at the next slow pass
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
