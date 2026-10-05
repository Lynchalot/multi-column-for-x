// Decision logic with no DOM in it, so it can be unit-tested: which posts a view shows, how many
// columns fit, how a download is named.
var XMCLogic = (function () {
  'use strict';

  const kindOf = (t) => (t.repostedBy ? 'repost' : t.quoted ? 'quote' : t.replyTo ? 'reply' : 'post');

  function routeKind(pathname) {
    const p = (pathname || '').replace(/\/+$/, '') || '/';
    if (p === '/home') return 'home';
    if (p === '/search') return 'search';
    if (p === '/explore' || p.startsWith('/explore/')) return 'explore';
    if (p === '/i/bookmarks') return 'bookmarks';
    if (p.startsWith('/i/lists/')) return 'list';
    return 'profile';
  }

  // show | tab | hide for a kind of post in a given place
  function modeFor(kind, where, s) {
    if (kind === 'post') return 'show';
    if (kind === 'repost') return where === 'home' ? s.repostsHome : where === 'profile' ? s.repostsProfile : where === 'list' ? s.repostsLists : 'show';
    if (kind === 'quote') return where === 'home' ? s.quotesHome : 'show';
    if (kind === 'reply') return where === 'home' ? s.repliesHome : 'show';
    return 'show';
  }

  // which view buttons exist here
  function viewsFor(where, s) {
    const out = ['all', 'posts'];
    if (modeFor('repost', where, s) !== 'hide') out.push('reposts');
    if (modeFor('quote', where, s) !== 'hide') out.push('quotes');
    if (modeFor('reply', where, s) === 'tab') out.push('replies'); // shelved otherwise: a timeline holds a handful of replies and finding them is slow
    out.push('media');
    return out;
  }

  // A profile's Media tab (/name/media), where the views are by kind of media instead of kind of post.
  const isMediaTab = (pathname) => /^\/(?!i\/)[^/]+\/media\/?$/.test(pathname || '');
  const isVideo = (m) => m.type === 'video' || m.type === 'gif'; // a GIF is a short silent video

  // Which view buttons are worth showing: one for a kind of post only appears once the feed actually has some
  // (a Replies button on a timeline that never contains replies just shows an empty page). On the Media tab:
  // All / Photos / Videos, as in X's app.
  function availableViews(where, s, items, current, opts) {
    const have = new Set();
    for (const t of items) {
      have.add(kindOf(t));
      if (t.media && t.media.length) have.add('media');
      for (const m of t.media || []) have.add(isVideo(m) ? 'video' : 'photo');
    }
    if (opts && opts.mediaTab) {
      const kinds = { photos: 'photo', videos: 'video' };
      return ['all', 'photos', 'videos'].filter((v) => v === 'all' || v === current || have.has(kinds[v]));
    }
    const kindOfView = { posts: 'post', reposts: 'repost', quotes: 'quote', replies: 'reply', media: 'media' };
    return viewsFor(where, s).filter((v) => v === 'all' || v === current || have.has(kindOfView[v]));
  }

  const textOf = (t) => t.segs.map((x) => x.v || x.label || x.handle || x.tag || '').join(' ');

  // c = { s: settings, view, where, words:[], accounts:Set, quoteIds:Set }
  function passes(t, c) {
    const s = c.s;
    const handle = t.author.handle.toLowerCase();
    if (c.accounts.has(handle)) return false;
    if (t.repostedBy && c.accounts.has(t.repostedBy.handle.toLowerCase())) return false;
    const q = t.quoted && !t.quoted.unavailable ? t.quoted : null;
    if (q) {
      if (c.accounts.has(q.author.handle.toLowerCase())) return false;
      if (c.quoteIds.has(q.id)) return false;
      if (s.hideMutedQuotes && (q.author.muting || q.author.blocking)) return false;
    }
    if (s.nsfw === 'hide' && (t.sensitive || (q && q.sensitive))) return false;
    if (s.onlyFollowed && !t.repostedBy && t.author.following === false) return false;
    if (s.hideBlueReplies && t.replyTo && t.author.blue && !t.author.verified) return false;
    if (c.words.length) {
      const hay = (textOf(t) + ' ' + t.author.name + ' ' + t.author.handle).toLowerCase();
      if (c.words.some((w) => hay.includes(w))) return false;
    }

    const kind = kindOf(t);
    const mode = modeFor(kind, c.where, s);
    if (mode === 'hide') return false;
    switch (c.view) {
      case 'posts': return kind === 'post';
      case 'reposts': return kind === 'repost';
      case 'quotes': return kind === 'quote';
      case 'replies': return kind === 'reply';
      case 'media': return t.media.length > 0;
      case 'photos': return t.media.some((m) => !isVideo(m));
      case 'videos': return t.media.some(isVideo);
      default: return mode !== 'tab'; // "all" leaves out anything that lives on its own tab
    }
  }

  function autoCols(width, s, gap) {
    const g = gap === undefined ? 12 : gap;
    return Math.max(1, Math.min(s.maxAutoCols, Math.floor((width + g) / (s.minColWidth + g))));
  }

  // ---- download names ----
  const BAD = /[\\/:*?"<>|\u0000-\u001f]/g;
  const cleanSegment = (s) => String(s).replace(BAD, '_').replace(/\s+/g, ' ').replace(/^\.+/, '').replace(/[. ]+$/, '').slice(0, 80);
  const pad = (n) => String(n).padStart(2, '0');

  // info = { account, name, tweetId, serial, hash, createdAt, ext }
  function formatFilename(pattern, info) {
    const d = new Date(info.createdAt || 0);
    const date = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
    const time = `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
    // values come from other people's profiles: a "/" in a display name must not make a folder
    const safe = (v) => String(v === undefined ? '' : v).replace(BAD, '_');
    const tokens = {
      account: safe(info.account), name: safe(info.name), tweetId: safe(info.tweetId), serial: safe(info.serial), hash: safe(info.hash),
      date, time, datetime: date + '-' + time,
    };
    const filled = String(pattern || '{account}-{tweetId}-{serial}').replace(/\{(\w+)\}/g, (m, k) => (k in tokens ? tokens[k] : m));
    const parts = filled.split('/').map(cleanSegment).filter((p) => p && p !== '..');
    if (!parts.length) parts.push(`${info.account}-${info.tweetId}-${info.serial}`);
    const tag = String(info.suffix || '').replace(/[^\w.\-]/g, '').slice(0, 30); // e.g. "twitter"
    parts[parts.length - 1] += (tag ? '-' + tag : '') + '.' + (info.ext || 'bin');
    return parts.join('/');
  }

  const isAbsolutePath = (p) => /^(?:[a-zA-Z]:[\\/]|\/|\\\\|~)/.test(String(p || '').trim());

  // The path to save a media file at, inside the Downloads folder: the optional folder, the optional
  // per-account folder, then the file name (pattern + source tag + extension).
  function buildDownloadPath(s, info) {
    const folders = [];
    const raw = String(s.dlFolder || '').replace(/\\/g, '/').trim();
    const parts = raw.split('/').filter(Boolean);
    const list = isAbsolutePath(raw) ? parts.slice(-1) : parts; // a full path: the browser can't use it, keep just the last folder's name
    for (const seg of list) { const c = cleanSegment(seg); if (c && c !== '..') folders.push(c); }
    if (s.dlByAccount && info.account) { const c = cleanSegment(info.account); if (c) folders.push(c); }
    return folders.concat(formatFilename(s.dlPattern, Object.assign({}, info, { suffix: s.dlSuffix }))).join('/');
  }

  // ---- comments ----
  // X sends a post's replies as threads: a direct reply (depth 0) followed by what continues it (depth 1).
  function groupThreads(replies) {
    const threads = [];
    for (const r of replies) {
      if ((r.depth || 0) === 0 || !threads.length) threads.push([r]); else threads[threads.length - 1].push(r);
    }
    return threads;
  }
  // mode: 'relevant' (the order X sent) | 'recent' (newest thread first) | 'likes' (most liked thread first).
  // Each thread keeps its continuation directly under it.
  function sortReplies(replies, mode) {
    const threads = groupThreads(replies);
    const pos = new Map(threads.map((t, i) => [t, i]));
    const key = {
      recent: (t) => -(t[0].createdAt || 0),
      likes: (t) => -((t[0].counts && t[0].counts.like) || 0),
    }[mode];
    if (!key) return replies.slice();
    return threads.slice().sort((a, b) => (key(a) - key(b)) || (pos.get(a) - pos.get(b))).flat();
  }

  // new first-page posts go in front of what's already loaded, without duplicates
  function mergeNew(items, fresh) {
    const have = new Set(items.map((t) => t.key));
    const add = fresh.filter((t) => !have.has(t.key));
    return { items: add.concat(items), added: add.length };
  }

  // What to do with a timeline response that arrived for a feed.
  //   c = { hasItems: the feed already has posts, known: we could read the request's variables,
  //         first: it was a first-page request, topRefresh: it asked for newer posts from the top cursor,
  //         asked: we asked X for more a moment ago, refreshing: the person pressed refresh on this feed }
  // 'establish' first data for this feed | 'refresh' replace what's shown | 'pending' new posts wait behind
  // the button | 'append' the next page, added at the bottom.
  // When the request's variables can't be read we must NOT assume "first page" (that was how every later page
  // used to end up parked behind the button); a response right after we asked for more is the next page.
  function classifyResponse(c) {
    if (!c.hasItems) return 'establish';
    if (c.refreshing && (c.known ? c.first : true)) return 'refresh';
    const paging = c.known ? (!c.first && !c.topRefresh) : !!c.asked;
    return paging ? 'append' : 'pending';
  }

  // Has X run out of posts? Decided after each "load more" answer. Two empty pages in a row used to count as "the end",
  // but X sometimes sends a page of only ads/suggestions with a perfectly good "next" marker, which showed
  // "That's everything" while more was on its way. Now: no next marker, or a marker we already followed (a loop),
  // or a long run of empty pages. Posts arriving later always cancel it.
  function nextPaging(prev, c) {
    const empty = c.added > 0 ? 0 : (prev.empty || 0) + 1;
    return { empty, exhausted: !c.bottomCursor || (c.added === 0 && !!c.repeated) || empty >= 5 };
  }

  // What to do with a video given how much of it is on screen (0..1): GIFs/autoplay clips play while at least half
  // visible; a video you started yourself pauses as soon as it is more than half scrolled away.
  function videoAction(v) {
    const seen = v.ratio >= 0.5;
    if (v.gif) return seen ? 'play' : 'pause';
    return !seen && !v.paused ? 'pause' : null;
  }

  // Is something the extension relies on missing? h is a snapshot of what it can see (see healthSnapshot in main.js).
  // Each issue is a plain sentence for the person plus a key for diagnostics. Nothing here guesses: every rule is a thing that was seen failing.
  function healthIssues(h) {
    const out = [];
    const add = (key, text) => out.push({ key, text });
    if (h.active && h.sinceRoute > 12 && !h.opsSeen) add('no-data', 'The extension can\u2019t see the data X sends on this page.');
    if (h.active && h.isHome && h.sinceRoute > 12 && !h.tabCount) add('no-tabs', 'The extension can\u2019t find X\u2019s tab bar.');
    if (h.active && h.waitingSeconds > 45) add('stalled', 'X isn\u2019t sending more posts.');
    if (h.actionFails >= 3) add('actions', 'Likes, reposts and bookmarks can\u2019t reach X\u2019s buttons.');
    if (h.commentFails >= 3) add('comments', 'Comments aren\u2019t loading.');
    if (h.active && h.sinceRoute > 12 && h.navFallback && h.sideFallback) add('pinning', 'X\u2019s menus can\u2019t be placed beside the columns.');
    return out;
  }

  const api = { healthIssues, isMediaTab, videoAction, nextPaging, availableViews, isAbsolutePath, classifyResponse, buildDownloadPath, groupThreads, sortReplies, kindOf, routeKind, modeFor, viewsFor, passes, autoCols, formatFilename, mergeNew, cleanSegment };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  return api;
})();
