const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../src/parse.js');
const F = require('./fixtures.js');

const HOME = 'https://x.com/i/api/graphql/abc123/HomeTimeline?variables=' + encodeURIComponent('{"count":20}');
const res = P.parseResponse(F.homeTimeline(), HOME);
const byId = (id) => res.items.find((t) => t.id === String(id));
const text = (t) => t.segs.map((s) => (s.t === 'text' ? s.v : s.t === 'url' ? `[${s.label}]` : s.t === 'mention' ? '@' + s.handle : '#' + s.tag)).join('');

test('only timeline operations are parsed', () => {
  assert.equal(P.parseResponse(F.homeTimeline(), 'https://x.com/i/api/graphql/abc/TweetDetail?variables={}'), null);
  assert.equal(P.parseResponse(F.homeTimeline(), 'https://x.com/i/api/1.1/foo.json'), null);
});

test('feed identity ignores paging but not the query', () => {
  const a = P.parseResponse(F.homeTimeline(), 'https://x.com/i/api/graphql/a/SearchTimeline?variables=' + encodeURIComponent('{"rawQuery":"cats","cursor":"X"}'));
  const b = P.parseResponse(F.homeTimeline(), 'https://x.com/i/api/graphql/a/SearchTimeline?variables=' + encodeURIComponent('{"rawQuery":"cats"}'));
  const c = P.parseResponse(F.homeTimeline(), 'https://x.com/i/api/graphql/a/SearchTimeline?variables=' + encodeURIComponent('{"rawQuery":"dogs"}'));
  assert.equal(a.feedKey, b.feedKey);
  assert.notEqual(a.feedKey, c.feedKey);
  assert.equal(a.first, false);
  assert.equal(b.first, true);
});

test('ads, suggestion modules and cursors are dropped; conversation modules are kept', () => {
  const ids = res.items.map((t) => t.id);
  assert.ok(!ids.includes('2001'), 'ad leaked');
  assert.ok(!ids.some((i) => i === '30'), 'user suggestion leaked');
  assert.ok(ids.includes('3001') && ids.includes('3002'));
  assert.equal(res.items.length, new Set(res.items.map((t) => t.key)).size);
});

test('new (core/avatar) and old (legacy) user schemas both work', () => {
  const n = byId(1001);
  assert.equal(n.author.handle, 'user1');
  assert.equal(n.author.name, 'User 1');
  assert.match(n.author.avatar, /a_bigger\.jpg$/);
  const o = byId(1012);
  assert.equal(o.author.handle, 'old12');
  assert.match(o.author.avatar, /a_bigger\.jpg$/);
});

test('counts, state and date', () => {
  const t = byId(1001);
  assert.deepEqual(t.counts, { reply: 1, repost: 2, quote: 0, like: 3, bookmark: 4, views: 1234 });
  assert.deepEqual(t.state, { liked: false, reposted: false, bookmarked: false });
  assert.equal(t.createdAt, Date.UTC(2026, 9, 4, 12, 0, 0));
  assert.equal(t.url, '/user1/status/1001');
});

test('reposts show the original with a "reposted by" marker', () => {
  const t = res.items.find((x) => x.key === '1003');
  assert.equal(t.id, '1001');
  assert.deepEqual(t.repostedBy, { name: 'User 3', handle: 'user3' });
});

test('quote tweets: nested tweet, quote link removed from text, tombstones tolerated', () => {
  const q = byId(1004);
  assert.equal(q.quoted.id, '1001');
  assert.equal(text(q), 'Quoting this');
  assert.deepEqual(byId(1005).quoted, { unavailable: true });
});

test('media: photo, video (best mp4 first, HLS noted) and gif; media link stripped from text', () => {
  const t = byId(1002);
  assert.equal(t.media.length, 3);
  assert.equal(t.media[0].type, 'photo');
  assert.equal(t.media[1].type, 'video');
  assert.deepEqual(t.media[1].mp4.map((v) => v.bitrate), [2176000, 832000, 256000]);
  assert.equal(t.media[1].hls, 'https://video.twimg.com/x/pl.m3u8');
  assert.equal(t.media[2].type, 'gif');
  assert.equal(t.media[2].mp4[0].url, 'https://video.twimg.com/tweet_video/G.mp4');
  assert.equal(text(t), 'Look at this');
});

test('entity offsets survive &amp; and emoji', () => {
  assert.equal(text(byId(1006)), 'A & B \u{1F600} @user1 #tag [example.com/long/path]');
  const u = byId(1006).segs.find((s) => s.t === 'url');
  assert.equal(u.href, 'https://example.com/long/path');
});

test('reply prefix is hidden using display_text_range', () => {
  const t = byId(1007);
  assert.equal(text(t), 'actual reply text');
  assert.equal(t.replyTo, 'user1');
});

test('long-form posts use the full text', () => {
  const t = byId(1008);
  assert.equal(t.long, true);
  assert.ok(text(t).length > 500);
});

test('link cards parsed; polls flagged; visibility wrapper unwrapped', () => {
  assert.deepEqual(byId(1009).card, { url: 'https://news.example.com/story', title: 'Big Story', desc: 'Something happened', domain: 'news.example.com', image: 'https://pbs.twimg.com/card_img/1/x.jpg' });
  assert.deepEqual(byId(1010).card, { poll: true });
  assert.equal(text(byId(1011)), 'hidden behind a visibility wrapper');
});

test('garbage input never throws', () => {
  for (const bad of [null, undefined, {}, [], 'x', { data: { instructions: 'no' } }, { data: { instructions: [{ entries: [null, {}, { content: 5 }] }] } }]) {
    assert.doesNotThrow(() => P.parseResponse(bad, HOME));
  }
});

test('paid verification, follow and mute flags are read where X puts them', () => {
  const T = F.tweet(1, 5, {}, { top: { core: { user_results: { result: Object.assign(F.user(5), { is_blue_verified: true, verification: { verified: false },
    relationship_perspectives: { following: false, muting: true, blocking: false } }) } } } });
  const t = P.normalizeTweet(T);
  assert.equal(t.author.blue, true);
  assert.equal(t.author.verified, false);
  assert.equal(t.author.following, false);
  assert.equal(t.author.muting, true);
  assert.equal(t.author.blocking, false);
  assert.equal(byId(1001).author.following, undefined, 'unknown stays unknown, not false');
});

test('source app, sensitivity and quote count', () => {
  const t = P.normalizeTweet(F.tweet(9, 1, { possibly_sensitive: true, quote_count: 7 }, { top: { source: '<a href="http://twitter.com/download/iphone" rel="nofollow">Twitter for iPhone</a>' } }));
  assert.equal(t.source, 'Twitter for iPhone');
  assert.equal(t.sensitive, true);
  assert.equal(t.counts.quote, 7);
  assert.equal(byId(1001).sensitive, false);
});

test('paging cursors are reported so "next page" can be told from "X refreshed the top"', () => {
  assert.equal(res.bottomCursor, 'DAAB');
  assert.equal(res.reqCursor, '');
  const paged = P.parseResponse(F.homeTimeline(), 'https://x.com/i/api/graphql/a/HomeTimeline?variables=' + encodeURIComponent('{"cursor":"DAAB"}'));
  assert.equal(paged.reqCursor, 'DAAB');
  assert.equal(paged.first, false);
  // the older response shape: content.operation.cursor
  const old = F.wrap([{ entryId: 'cursor-bottom-9', content: { operation: { cursor: { value: 'OLD1', cursorType: 'Bottom' } } } }, F.tweetEntry(F.tweet(5, 5))]);
  assert.equal(P.parseResponse(old, HOME).bottomCursor, 'OLD1');
});

test('X renaming an operation does not hide the feed, but notification feeds are not feeds', () => {
  const body = F.homeTimeline();
  assert.ok(P.parseResponse(body, 'https://x.com/i/api/graphql/a/HomeLatestTimelineV2?variables={}'));
  assert.equal(P.parseResponse(body, 'https://x.com/i/api/graphql/a/NotificationsTimeline?variables={}'), null);
});

test('conversation: replies in order, focal post and ads left out, depth, "more" flag', () => {
  const url = 'https://x.com/i/api/graphql/a/TweetDetail?variables=' + encodeURIComponent('{"focalTweetId":"1001"}');
  const d = P.parseDetail(F.detail(1001), url);
  assert.equal(d.focalId, '1001');
  assert.deepEqual(d.replies.map((t) => t.id), ['5001', '5002', '5003']);
  assert.deepEqual(d.replies.map((t) => t.depth), [0, 1, 0]);
  assert.equal(d.replies[0].segs[0].v, 'first reply');
  assert.equal(d.more, true);
  assert.equal(P.parseDetail(F.detail(1001), 'https://x.com/i/api/graphql/a/HomeTimeline?variables={}'), null);
  assert.equal(P.parseDetail(F.detail(1001), 'https://x.com/i/api/graphql/a/TweetDetail?variables={}'), null, 'no focal id, no result');
  assert.doesNotThrow(() => P.parseDetail({}, url));
  assert.equal(P.parseResponse(F.detail(1001), url), null, 'a conversation is not a feed');
});

test('request variables are read from the URL (GET) or the JSON body (POST), and "unknown" is reported', () => {
  const bare = 'https://x.com/i/api/graphql/abc/HomeLatestTimeline';
  const post = (v) => JSON.stringify({ variables: v, features: {}, queryId: 'abc' });
  const a = P.parseResponse(F.homeTimeline(), bare, post({ count: 20, cursor: 'DAAB' }));
  assert.equal(a.known, true);
  assert.equal(a.first, false, 'a cursor in the POST body means this is NOT a first page');
  assert.equal(a.reqCursor, 'DAAB');
  const b = P.parseResponse(F.homeTimeline(), bare, post({ count: 20 }));
  assert.equal(b.known, true);
  assert.equal(b.first, true);
  assert.equal(a.feedKey, b.feedKey, 'same feed whether first page or later page');
  const c = P.parseResponse(F.homeTimeline(), bare, '');
  assert.equal(c.known, false, 'nothing readable: the caller must not assume "first page"');
  assert.equal(P.parseResponse(F.homeTimeline(), bare, 'not json').known, false);
  assert.equal(P.parseResponse(F.homeTimeline(), bare + '?variables=' + encodeURIComponent('{"cursor":"Z"}'), '').reqCursor, 'Z');
  const d = P.parseDetail(F.detail(1001), 'https://x.com/i/api/graphql/a/TweetDetail', JSON.stringify({ variables: { focalTweetId: '1001' } }));
  assert.equal(d.focalId, '1001', 'a conversation request can carry its id in the body too');
});

test('a conversation is recognised by its shape even if X renames the request, using the post we opened', () => {
  const renamed = 'https://x.com/i/api/graphql/zz/TweetDetailV2?variables=%7B%7D';
  assert.equal(P.parseDetail(F.detail(1001), renamed, '', ''), null, 'no idea which post it is about: refuse to guess');
  const d = P.parseDetail(F.detail(1001), renamed, '', '1001');
  assert.deepEqual(d.replies.map((t) => t.id), ['5001', '5002', '5003']);
  assert.equal(P.parseDetail(F.homeTimeline(), renamed, '', '1001'), null, 'a timeline is not a conversation');
});

test('requests seen on a real X page that are not feeds of posts are ignored', () => {
  for (const op of ['PinnedTimelines', 'ExploreSidebar', 'ViewerBadgeCounts', 'SidebarUserRecommendations', 'UsersByRestIds', 'CreateBookmark', 'DataSaverMode', 'CreatorStudioTabBarItemQuery', 'useStoryTopicQuery']) {
    assert.equal(P.parseResponse(F.homeTimeline(), `https://x.com/i/api/graphql/abc/${op}?variables={}`), null, op);
  }
  assert.ok(P.parseResponse(F.homeTimeline(), 'https://x.com/i/api/graphql/abc/HomeTimeline?variables={}'));
});
