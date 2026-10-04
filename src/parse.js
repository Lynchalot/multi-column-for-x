// Turns X's GraphQL timeline responses into plain tweet objects. Pure functions, no DOM, so it can be
// unit-tested in Node. X changes this format regularly (e.g. user name/handle moved from `legacy` to
// `core`), so every field is read defensively from every location we know of.
var XMCParse = (function () {
  'use strict';

  // X renames operations now and then, so match by family rather than an exact list
  const FEED_OPS = /Timeline|^UserTweets|^UserMedia|^UserHighlights|^Likes$|^Bookmarks|^CommunityTweets|^ExplorePage/;
  const NOT_FEEDS = /Notification|Lists?Management|Trends|ExploreSidebar|Discover|Topics?|Spaces|Jobs|Pinned|Sidebar/;

  const opOf = (url) => { const m = /\/graphql\/[^/]+\/([A-Za-z0-9_]+)/.exec(url); return m ? m[1] : null; };
  // The request's variables: in the address (GET) or in the JSON body (POST). known=false when neither shows
  // any, in which case the caller must not guess "first page".
  function requestVars(url, reqBody) {
    try {
      const v = new URL(url, 'https://x.com').searchParams.get('variables');
      if (v) return { vars: JSON.parse(v) || {}, known: true };
    } catch { /* fall through to the body */ }
    try {
      const b = typeof reqBody === 'string' && reqBody ? JSON.parse(reqBody) : null;
      if (b && b.variables && typeof b.variables === 'object') return { vars: b.variables, known: true };
    } catch { /* not JSON */ }
    return { vars: {}, known: false };
  }
  const varsOf = (url, reqBody) => requestVars(url, reqBody).vars;
  // what makes two responses part of the same feed (everything except paging)
  const feedKeyOf = (op, v) => [op, v.rawQuery || '', v.product || '', v.listId || '', v.userId || '',
    v.bookmark_collection_id || '', v.communityId || ''].join('|');

  // ---- generic JSON walking (robust to X moving things around) ----
  function collectInstructions(json) {
    const out = [];
    (function dfs(n) {
      if (!n || typeof n !== 'object') return;
      if (Array.isArray(n)) { for (const x of n) dfs(x); return; }
      for (const k in n) {
        if (k === 'instructions' && Array.isArray(n[k])) out.push(...n[k]); else dfs(n[k]);
      }
    })(json);
    return out;
  }
  function entriesOf(instructions) {
    const out = [];
    for (const ins of instructions) {
      if (!ins || typeof ins !== 'object') continue;
      if (Array.isArray(ins.entries)) out.push(...ins.entries);
      if (ins.entry) out.push(ins.entry);
      if (Array.isArray(ins.moduleItems)) {
        for (const mi of ins.moduleItems) if (mi) out.push({ entryId: mi.entryId, content: { itemContent: mi.item && mi.item.itemContent } });
      }
    }
    return out;
  }
  function tweetItems(entry) {
    const found = [];
    (function dfs(n) {
      if (!n || typeof n !== 'object') return;
      if (Array.isArray(n)) { n.forEach(dfs); return; }
      if (n.itemType === 'TimelineTweet' && n.tweet_results) { found.push(n); return; }
      for (const k in n) dfs(n[k]);
    })(entry && entry.content);
    return found;
  }

  // ---- small helpers ----
  const decode = (s) => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
  function parseDate(s) {
    // "Wed Oct 04 12:00:00 +0000 2026"
    const m = /^\w{3} (\w{3}) (\d{1,2}) (\d{2}):(\d{2}):(\d{2}) ([+-]\d{4}) (\d{4})$/.exec(s || '');
    if (!m) { const t = Date.parse(s); return Number.isNaN(t) ? 0 : t; }
    const off = (m[6][0] === '-' ? -1 : 1) * (parseInt(m[6].slice(1, 3), 10) * 60 + parseInt(m[6].slice(3), 10));
    return Date.UTC(+m[7], MONTHS[m[1]], +m[2], +m[3], +m[4], +m[5]) - off * 60000;
  }
  const unwrap = (r) => {
    if (!r || typeof r !== 'object') return null;
    if (r.__typename === 'TweetWithVisibilityResults' && r.tweet) return unwrap(r.tweet);
    if (r.tweet && !r.legacy) return unwrap(r.tweet);
    return r;
  };

  function parseUser(u) {
    u = u && (u.result || u);
    if (!u || typeof u !== 'object') return null;
    const legacy = u.legacy || {}, core = u.core || {};
    const handle = core.screen_name || legacy.screen_name;
    if (!handle) return null;
    const avatar = (u.avatar && u.avatar.image_url) || legacy.profile_image_url_https || '';
    const rp = u.relationship_perspectives || {};
    const flag = (k) => { const v = rp[k] !== undefined ? rp[k] : legacy[k] !== undefined ? legacy[k] : u[k]; return typeof v === 'boolean' ? v : undefined; };
    return {
      id: u.rest_id || legacy.id_str || '',
      name: core.name || legacy.name || handle,
      handle,
      avatar: avatar.replace('_normal.', '_bigger.'),
      blue: !!u.is_blue_verified,                                   // paid verification
      verified: !!((u.verification && u.verification.verified) || legacy.verified), // legacy / organisation / government
      following: flag('following'),  // undefined when X doesn't say
      muting: flag('muting'),
      blocking: flag('blocking'),
    };
  }

  // Text -> [{t:'text'|'url'|'mention'|'tag', ...}]. Entity indices count Unicode code points of the
  // HTML-unescaped text, so work on code points, not UTF-16 units.
  function buildSegments(text, ents, range, dropUrl) {
    const chars = Array.from(decode(text || ''));
    const start = range ? range[0] : 0;
    const end = range ? Math.min(range[1], chars.length) : chars.length;
    const reps = [];
    for (const u of ents.urls || []) {
      const expanded = u.expanded_url || u.url;
      reps.push({ s: u.indices[0], e: u.indices[1], seg: dropUrl(expanded) ? null : { t: 'url', href: expanded, label: u.display_url || expanded } });
    }
    for (const m of ents.user_mentions || []) reps.push({ s: m.indices[0], e: m.indices[1], seg: { t: 'mention', handle: m.screen_name } });
    for (const h of ents.hashtags || []) reps.push({ s: h.indices[0], e: h.indices[1], seg: { t: 'tag', tag: h.text } });
    for (const m of ents.media || []) reps.push({ s: m.indices[0], e: m.indices[1], seg: null });
    reps.sort((a, b) => a.s - b.s);
    const out = [];
    let buf = '', i = start;
    const flush = () => { if (buf) { out.push({ t: 'text', v: buf }); buf = ''; } };
    for (const r of reps) {
      if (r.e <= start || r.s >= end || r.s < i) continue;
      buf += chars.slice(i, r.s).join('');
      if (r.seg) { flush(); out.push(r.seg); }
      i = r.e;
    }
    buf += chars.slice(i, end).join('');
    flush();
    if (out.length && out[0].t === 'text') out[0].v = out[0].v.replace(/^\s+/, '');
    const last = out[out.length - 1];
    if (last && last.t === 'text') last.v = last.v.replace(/\s+$/, '');
    return out.filter((s) => s.t !== 'text' || s.v);
  }

  function parseMedia(legacy) {
    const list = (legacy.extended_entities && legacy.extended_entities.media) || (legacy.entities && legacy.entities.media) || [];
    return list.map((m) => {
      const vi = m.video_info || {};
      const variants = vi.variants || [];
      const mp4 = variants.filter((v) => v.content_type === 'video/mp4')
        .map((v) => ({ url: v.url, bitrate: v.bitrate || 0 })).sort((a, b) => b.bitrate - a.bitrate);
      const hls = variants.find((v) => v.content_type === 'application/x-mpegURL');
      const ar = vi.aspect_ratio;
      return {
        id: m.id_str || '',
        type: m.type === 'animated_gif' ? 'gif' : m.type === 'video' ? 'video' : 'photo',
        thumb: m.media_url_https || '',
        w: (m.original_info && m.original_info.width) || (ar && ar[0]) || 16,
        h: (m.original_info && m.original_info.height) || (ar && ar[1]) || 9,
        alt: m.ext_alt_text || '',
        sensitive: !!(m.sensitive_media_warning && Object.values(m.sensitive_media_warning).some(Boolean)),
        mp4,
        hls: hls ? hls.url : '',
      };
    }).filter((m) => m.thumb);
  }

  function parseCard(r, legacy) {
    const c = r.card && r.card.legacy;
    if (!c || !Array.isArray(c.binding_values)) return null;
    if (/poll/i.test(c.name || '')) return { poll: true };
    const bv = {};
    for (const v of c.binding_values) bv[v.key] = v.value || {};
    const str = (k) => (bv[k] && bv[k].string_value) || '';
    const img = ['thumbnail_image_original', 'summary_photo_image_original', 'photo_image_full_size_original', 'thumbnail_image_large', 'thumbnail_image']
      .map((k) => bv[k] && bv[k].image_value && bv[k].image_value.url).find(Boolean) || '';
    const tco = str('card_url') || c.url || '';
    const hit = ((legacy.entities && legacy.entities.urls) || []).find((u) => u.url === tco);
    const title = str('title');
    if (!title && !img) return null;
    return { url: hit ? hit.expanded_url : tco, title, desc: str('description'), domain: str('vanity_url') || str('domain'), image: img };
  }

  function normalizeTweet(result, depth) {
    depth = depth || 0;
    const r = unwrap(result);
    if (!r || !r.legacy) return null;
    const legacy = r.legacy;
    const author = parseUser(r.core && r.core.user_results) || parseUser(r.author_results);
    const id = r.rest_id || legacy.id_str;
    if (!author || !id) return null;

    // a repost wraps the original; show the original with "X reposted" on top
    const rtRaw = legacy.retweeted_status_result && legacy.retweeted_status_result.result;
    if (rtRaw && depth === 0) {
      const inner = normalizeTweet(rtRaw, 1);
      if (inner) { inner.key = id; inner.repostedBy = { name: author.name, handle: author.handle }; return inner; }
    }

    let quoted = null;
    const qRaw = legacy.quoted_status_result ? legacy.quoted_status_result.result : (r.quoted_status_result && r.quoted_status_result.result);
    const qid = legacy.quoted_status_id_str || (unwrap(qRaw) && unwrap(qRaw).rest_id);
    if (qRaw && depth < 2) quoted = normalizeTweet(qRaw, depth + 1) || { unavailable: true };

    const note = r.note_tweet && r.note_tweet.note_tweet_results && r.note_tweet.note_tweet_results.result;
    const text = note ? note.text : legacy.full_text;
    const ents = note ? Object.assign({}, legacy.entities, note.entity_set) : legacy.entities || {};
    const segs = buildSegments(text, ents, note ? null : legacy.display_text_range,
      (u) => !!(qid && String(u).includes('/status/' + qid)));

    const media = parseMedia(legacy);
    return {
      key: id,
      id,
      url: '/' + author.handle + '/status/' + id,
      author,
      segs,
      long: !!note,
      createdAt: parseDate(legacy.created_at),
      counts: {
        reply: legacy.reply_count || 0,
        repost: (legacy.retweet_count || 0) + (legacy.quote_count || 0),
        quote: legacy.quote_count || 0,
        like: legacy.favorite_count || 0,
        bookmark: legacy.bookmark_count || 0,
        views: Number(r.views && r.views.count) || 0,
      },
      state: { liked: !!legacy.favorited, reposted: !!legacy.retweeted, bookmarked: !!legacy.bookmarked },
      media,
      sensitive: !!legacy.possibly_sensitive || media.some((m) => m.sensitive),
      source: String(r.source || '').replace(/<[^>]*>/g, '').trim(),
      quoted,
      repostedBy: null,
      replyTo: legacy.in_reply_to_screen_name || '',
      replyToId: legacy.in_reply_to_status_id_str || '',
      lang: legacy.lang || '',
      card: parseCard(r, legacy),
    };
  }

  // "load more" / "newer posts" markers: {type:'bottom'|'top', value}
  function cursorOf(entry) {
    const c = entry && entry.content;
    if (!c || typeof c !== 'object') return null;
    const node = c.value ? c : (c.operation && c.operation.cursor) || null;
    if (!node || !node.value) return null;
    const type = String(node.cursorType || String(entry.entryId || '').split('-')[1] || '').toLowerCase();
    return { type, value: node.value };
  }

  // Whole response -> { op, feedKey, first, reqCursor, topCursor, bottomCursor, items }.
  // Returns null for responses that aren't timelines.
  function parseResponse(json, url, reqBody) {
    const op = opOf(url);
    if (!op || !FEED_OPS.test(op) || NOT_FEEDS.test(op)) return null;
    const { vars, known } = requestVars(url, reqBody);
    const items = [];
    let topCursor = '', bottomCursor = '';
    for (const entry of entriesOf(collectInstructions(json))) {
      if (!entry || typeof entry !== 'object') continue;
      const cur = cursorOf(entry);
      if (cur && cur.type === 'bottom') bottomCursor = cur.value;
      if (cur && cur.type === 'top') topCursor = cur.value;
      const eid = String(entry.entryId || '');
      if (/^(cursor|who-to-follow|promoted|toptabsfilter|label|messageprompt)/i.test(eid)) continue;
      for (const item of tweetItems(entry)) {
        if (item.promotedMetadata || item.tweet_results.promotedMetadata) continue;
        const t = normalizeTweet(item.tweet_results.result);
        if (t) items.push(t);
      }
    }
    return { op, feedKey: feedKeyOf(op, vars), known, first: !vars.cursor, reqCursor: vars.cursor || '', topCursor, bottomCursor, items };
  }

  // A tweet's conversation (TweetDetail): the replies, in the order X sends them, without the tweet itself.
  // depth 0 = a direct reply, 1 = a reply to a reply (or the author continuing the thread)
  function parseDetail(json, url, reqBody, fallbackFocalId) {
    const shaped = !!(json && json.data && json.data.threaded_conversation_with_injections_v2);
    if (opOf(url) !== 'TweetDetail' && !shaped) return null;
    const focalId = String(varsOf(url, reqBody).focalTweetId || fallbackFocalId || '');
    if (!focalId) return null;
    const replies = [];
    const seen = new Set();
    let more = false;
    let focal = null;
    for (const entry of entriesOf(collectInstructions(json))) {
      if (!entry || typeof entry !== 'object') continue;
      const cur = cursorOf(entry);
      if (cur) { if (cur.type !== 'top') more = true; continue; }
      if (/^(promoted|who-to-follow|tweetdetailrelatedtweets|relatedtweets)/i.test(String(entry.entryId || ''))) continue;
      for (const item of tweetItems(entry)) {
        if (item.promotedMetadata || item.tweet_results.promotedMetadata) continue;
        const t = normalizeTweet(item.tweet_results.result);
        if (t && t.id === focalId && !focal) focal = t; // the post itself (not listed among its replies)
        if (!t || t.id === focalId || seen.has(t.id)) continue;
        seen.add(t.id);
        t.depth = t.replyToId === focalId ? 0 : 1;
        replies.push(t);
      }
    }
    return { focalId, focal, replies, more };
  }

  const api = { parseResponse, parseDetail, normalizeTweet, buildSegments, parseDate, opOf, varsOf, requestVars, feedKeyOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  return api;
})();
