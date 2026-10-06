// A stand-in for the parts of X's GraphQL API the extension reads: Home-style timelines (20 posts a page, "cursor-bottom" paging)
// and a post's conversation. Posts cycle through text, photos, a video, a GIF, a repost, a quote and a long note.
'use strict';

function makeApi(origin, pages) {
  const user = (n) => ({
    __typename: 'User', rest_id: `u${n}`, is_blue_verified: n % 2 === 0,
    core: { name: `User ${n}`, screen_name: `user${n}` },
    avatar: { image_url: `${origin}/img/a${n}_normal.svg` }, legacy: {},
  });

  function tweet(i, un, kind, feed) {
    const base = {
      id_str: String(i), full_text: `[${feed}] tweet ${i} kind ${kind} lorem ipsum dolor sit amet`, display_text_range: [0, 200],
      created_at: 'Wed Oct 04 12:00:00 +0000 2026', reply_count: i % 7, retweet_count: i % 11, quote_count: 0, favorite_count: i % 13, bookmark_count: i % 3,
      lang: i % 7 === 0 ? 'ja' : 'en', possibly_sensitive: kind === 1 && i % 5 === 4, favorited: false, retweeted: false, bookmarked: false, entities: {},
    };
    const r = {
      __typename: 'Tweet', rest_id: String(i), core: { user_results: { result: user(un) } }, views: { count: String(i * 3) },
      source: '<a href="x">Twitter for Zen</a>', legacy: base,
    };
    const photo = (k) => ({ id_str: `p${i}${k}`, type: 'photo', media_url_https: `${origin}/img/m${i}${k}.svg`, original_info: { width: 1200, height: 800 + k * 200 }, indices: [0, 0] });
    if (kind === 1) base.extended_entities = { media: [photo(0)] };
    if (kind === 2) base.extended_entities = { media: [photo(0), photo(1), photo(2)] };
    if (kind === 3) {
      base.extended_entities = { media: [{ id_str: `v${i}`, type: 'video', media_url_https: `${origin}/img/m${i}v.svg`, original_info: { width: 1280, height: 720 },
        video_info: { aspect_ratio: [16, 9], variants: [{ content_type: 'application/x-mpegURL', url: 'x.m3u8' },
          { bitrate: 2176000, content_type: 'video/mp4', url: `${origin}/vid/lo.mp4` }, { bitrate: 832000, content_type: 'video/mp4', url: `${origin}/vid/lo.mp4` }] }, indices: [0, 0] }] };
    }
    if (kind === 4) {
      base.extended_entities = { media: [{ id_str: `g${i}`, type: 'animated_gif', media_url_https: `${origin}/img/m${i}g.svg`, original_info: { width: 400, height: 400 },
        video_info: { variants: [{ bitrate: 0, content_type: 'video/mp4', url: `${origin}/vid/lo.mp4` }] }, indices: [0, 0] }] };
    }
    // the dupes feed has two people reposting the same post on every page (a post is the same post whoever reposts it)
    if (kind === 5) r.legacy.retweeted_status_result = { result: feed === 'DupesTimeline' ? tweet(700000 + Math.floor(i / 20), 40, 0, feed) : tweet(i + 500000, un + 40, 0, feed) };
    if (kind === 6) r.quoted_status_result = { result: tweet(i + 600000, un + 50, 1, feed) };
    if (kind === 7) r.note_tweet = { note_tweet_results: { result: { text: `Long form text number ${i}. `.repeat(40), entity_set: {} } } };
    return r;
  }

  function page(feed, cur, newer) {
    const p = cur ? Number(String(cur).slice(1)) : 0;
    const ents = [];
    for (let k = 0; k < 20; k++) {
      const i = 90000 + (newer || 0) * 5 - p * 20 - k;
      if (feed === 'UserTweetsAndReplies' && k === 2) { // a reply, sent together with the post it answers (as X's Replies tab does)
        const grand = tweet(i + 800000, 32, 0, feed), parent = tweet(i + 700000, 31, 1, feed), reply = tweet(i, 6, 0, feed);
        parent.legacy.in_reply_to_status_id_str = String(i + 800000); parent.legacy.in_reply_to_screen_name = 'user32';
        reply.legacy.in_reply_to_status_id_str = String(i + 700000); reply.legacy.in_reply_to_screen_name = 'user31';
        const wrap = (t) => ({ entryId: `conversation-${i}-tweet-${t.rest_id}`, item: { itemContent: { itemType: 'TimelineTweet', tweet_results: { result: t } } } });
        ents.push({ entryId: `conversation-${i}`, sortIndex: String(i), content: { entryType: 'TimelineTimelineModule', items: [wrap(grand), wrap(parent), wrap(reply)] } });
        continue;
      }
      const lone = feed === 'UserTweetsAndReplies' && k === 5; // a reply sent on its own: what it answers has to be looked up
      if (lone) { const r = tweet(i, 7, 0, feed); r.legacy.in_reply_to_status_id_str = '555555'; r.legacy.in_reply_to_screen_name = 'user40'; ents.push({ entryId: `tweet-${i}`, sortIndex: String(i), content: { entryType: 'TimelineTimelineItem', itemContent: { itemType: 'TimelineTweet', tweet_results: { result: r } } } }); continue; }
      const thread = feed === 'ThreadsTimeline' && k >= 3 && k <= 5; // three posts by user5, each answering the one before (newest first, as the feed lists them)
      const t = tweet(i, thread ? 5 : (i % 9) + 1, thread ? 0 : k % 8, feed);
      if (thread && k < 5) { t.legacy.in_reply_to_status_id_str = String(i - 1); t.legacy.in_reply_to_screen_name = 'user5'; }
      ents.push({ entryId: `tweet-${i}`, sortIndex: String(i), content: { entryType: 'TimelineTimelineItem', itemContent: { itemType: 'TimelineTweet', tweet_results: { result: t } } } });
    }
    ents.splice(3, 0, { entryId: 'promoted-tweet-1', content: { entryType: 'TimelineTimelineItem', itemContent: { itemType: 'TimelineTweet', promotedMetadata: {}, tweet_results: { result: tweet(777000 + p, 9, 0, 'AD') } } } });
    if (p < pages) ents.push({ entryId: 'cursor-bottom-1', content: { entryType: 'TimelineTimelineCursor', value: `c${p + 1}`, cursorType: 'Bottom' } });
    return { data: { home: { home_timeline_urt: { instructions: [{ type: 'TimelineAddEntries', entries: ents }] } } } };
  }

  function detail(focal) {
    const item = (t) => ({ itemType: 'TimelineTweet', tweet_results: { result: t } });
    const reply = (i, un, text, to) => {
      const t = tweet(i, un, 0, 'DETAIL'); t.legacy.full_text = text; t.legacy.display_text_range = [0, text.length]; t.legacy.in_reply_to_status_id_str = String(to); return t;
    };
    const f = tweet(Number(focal), 3, Number(focal) % 8, 'DETAIL');
    const entries = [];
    if (focal === '89995') { const above = tweet(555555, 40, 0, 'DETAIL'); entries.push({ entryId: 'tweet-555555', content: { entryType: 'TimelineTimelineItem', itemContent: item(above) } }); f.legacy.in_reply_to_status_id_str = '555555'; f.legacy.in_reply_to_screen_name = 'user40'; }
    entries.push({ entryId: `tweet-${focal}`, content: { entryType: 'TimelineTimelineItem', itemContent: item(f) } });
    for (let k = 0; k < 3; k++) {
      const a = reply(Number(focal) * 10 + k * 2 + 1, 20 + k, `Reply number ${k + 1} to the post`, focal);
      if (k === 0) { // the first reply has a sensitive picture
        a.legacy.possibly_sensitive = true;
        a.legacy.extended_entities = { media: [{ id_str: 'ps' + focal, type: 'photo', media_url_https: `${origin}/img/ms.svg`, original_info: { width: 800, height: 600 }, indices: [0, 0] }] };
      }
      const b = reply(Number(focal) * 10 + k * 2 + 2, 3, `The author answers reply ${k + 1}`, Number(focal) * 10 + k * 2 + 1);
      entries.push({ entryId: `conversationthread-${focal}-${k}`, content: { entryType: 'TimelineTimelineModule', items: [
        { entryId: `conversationthread-${focal}-${k}-tweet-${a.rest_id}`, item: { itemContent: item(a) } },
        { entryId: `conversationthread-${focal}-${k}-tweet-${b.rest_id}`, item: { itemContent: item(b) } }] } });
    }
    entries.push({ entryId: 'cursor-bottom-d', content: { entryType: 'TimelineTimelineCursor', value: 'MORE', cursorType: 'Bottom' } });
    return { data: { threaded_conversation_with_injections_v2: { instructions: [{ type: 'TimelineAddEntries', entries }] } } };
  }

  // op = the GraphQL operation name, vars = its variables
  function respond(op, vars) {
    if (op === 'TweetDetail') return detail(vars.focalTweetId);
    if (op === 'UserByScreenName') {
      return { data: { user: { result: { rest_id: '5', is_blue_verified: true, core: { name: 'User Five', screen_name: 'user5', created_at: 'Sun Jun 01 00:00:00 +0000 2008' },
        avatar: { image_url: `${origin}/img/a5_normal.svg` }, location: { location: 'Valley Forge' },
        legacy: { description: 'Bio of user five', followers_count: 1234, friends_count: 97, profile_banner_url: `${origin}/img/b5`, entities: { description: { urls: [] } } } } } } };
    }
    if (op === 'ListByRestId') return { data: { list: { __typename: 'List', id_str: '123', name: 'Psyop' } } };
    return page(op, vars.cursor, vars.newer || 0);
  }
  return { respond, tweet, page, detail };
}

module.exports = { makeApi };
