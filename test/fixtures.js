// Synthetic responses shaped like X's GraphQL timeline output. Not real user data.
const user = (n, { legacyOnly = false } = {}) => legacyOnly
  ? { __typename: 'User', rest_id: 'u' + n, legacy: { name: 'Old Schema ' + n, screen_name: 'old' + n, profile_image_url_https: `https://pbs.twimg.com/profile_images/${n}/a_normal.jpg` } }
  : { __typename: 'User', rest_id: 'u' + n, is_blue_verified: n % 2 === 0, core: { name: 'User ' + n, screen_name: 'user' + n },
      avatar: { image_url: `https://pbs.twimg.com/profile_images/${n}/a_normal.jpg` }, legacy: {} };

const tweet = (id, un, legacy = {}, extra = {}) => ({
  __typename: 'Tweet',
  rest_id: String(id),
  core: { user_results: { result: user(un, extra.userOpts) } },
  views: { count: '1234' },
  legacy: Object.assign({
    id_str: String(id), full_text: 'Hello world ' + id, display_text_range: [0, 20], created_at: 'Wed Oct 04 12:00:00 +0000 2026',
    reply_count: 1, retweet_count: 2, quote_count: 0, favorite_count: 3, bookmark_count: 4,
    favorited: false, retweeted: false, bookmarked: false, entities: {},
  }, legacy),
  ...(extra.top || {}),
});

const item = (result, extra = {}) => ({ itemType: 'TimelineTweet', tweet_results: { result }, ...extra });
const entry = (id, content) => ({ entryId: id, sortIndex: id, content: { entryType: 'TimelineTimelineItem', ...content } });
const tweetEntry = (t, extra) => entry('tweet-' + t.rest_id, { itemContent: item(t, extra) });
const wrap = (entries) => ({ data: { home: { home_timeline_urt: { instructions: [{ type: 'TimelineAddEntries', entries }] } } } });

const photo = { id_str: 'm1', type: 'photo', media_url_https: 'https://pbs.twimg.com/media/AAA.jpg', original_info: { width: 1200, height: 800 }, indices: [13, 29] };
const video = {
  id_str: 'm2', type: 'video', media_url_https: 'https://pbs.twimg.com/ext_tw_video_thumb/1/pu/img/B.jpg', original_info: { width: 1280, height: 720 },
  video_info: { aspect_ratio: [16, 9], duration_millis: 5000, variants: [
    { content_type: 'application/x-mpegURL', url: 'https://video.twimg.com/x/pl.m3u8' },
    { bitrate: 256000, content_type: 'video/mp4', url: 'https://video.twimg.com/x/256.mp4' },
    { bitrate: 2176000, content_type: 'video/mp4', url: 'https://video.twimg.com/x/2176.mp4' },
    { bitrate: 832000, content_type: 'video/mp4', url: 'https://video.twimg.com/x/832.mp4' },
  ] }, indices: [10, 33],
};
const gif = { id_str: 'm3', type: 'animated_gif', media_url_https: 'https://pbs.twimg.com/tweet_video_thumb/G.jpg', original_info: { width: 400, height: 400 },
  video_info: { variants: [{ bitrate: 0, content_type: 'video/mp4', url: 'https://video.twimg.com/tweet_video/G.mp4' }] }, indices: [0, 0] };

const plain = tweet(1001, 1);
const withMedia = tweet(1002, 2, {
  full_text: 'Look at this https://t.co/abc', display_text_range: [0, 33],
  entities: { urls: [], media: [photo] }, extended_entities: { media: [photo, video, gif] },
});
const retweet = tweet(1003, 3, { full_text: 'RT @user1: Hello world 1001', retweeted_status_result: { result: tweet(1001, 1) } });
const quoted = tweet(1004, 4, {
  full_text: 'Quoting this https://t.co/q1', display_text_range: [0, 28], quoted_status_id_str: '1001',
  entities: { urls: [{ url: 'https://t.co/q1', expanded_url: 'https://x.com/user1/status/1001', display_url: 'x.com/user1/status/1001', indices: [13, 28] }] },
}, { top: { quoted_status_result: { result: tweet(1001, 1) } } });
const tombstoneQuote = tweet(1005, 5, { quoted_status_id_str: '999', full_text: 'q' }, { top: { quoted_status_result: { result: { __typename: 'TweetTombstone' } } } });
// "&amp;" counts as ONE character for entity offsets; emoji is one code point (two UTF-16 units)
const tricky = tweet(1006, 6, {
  full_text: 'A &amp; B \u{1F600} @user1 #tag https://t.co/zz', display_text_range: [0, 35],
  entities: {
    user_mentions: [{ screen_name: 'user1', indices: [8, 14] }],
    hashtags: [{ text: 'tag', indices: [15, 19] }],
    urls: [{ url: 'https://t.co/zz', expanded_url: 'https://example.com/long/path', display_url: 'example.com/long/path', indices: [20, 35] }],
  },
});
const reply = tweet(1007, 7, { full_text: '@user1 @user2 actual reply text', display_text_range: [14, 31], in_reply_to_screen_name: 'user1',
  entities: { user_mentions: [{ screen_name: 'user1', indices: [0, 6] }, { screen_name: 'user2', indices: [7, 13] }] } });
const longPost = tweet(1008, 8, { full_text: 'short preview…' }, { top: { note_tweet: { note_tweet_results: { result: {
  text: 'This is the full long-form text of the note. '.repeat(20), entity_set: { urls: [], user_mentions: [], hashtags: [] } } } } } });
const withCard = tweet(1009, 9, { full_text: 'read https://t.co/cc', display_text_range: [0, 20],
  entities: { urls: [{ url: 'https://t.co/cc', expanded_url: 'https://news.example.com/story', display_url: 'news.example.com/story', indices: [5, 20] }] } },
{ top: { card: { legacy: { name: 'summary_large_image', url: 'https://t.co/cc', binding_values: [
  { key: 'title', value: { string_value: 'Big Story' } }, { key: 'description', value: { string_value: 'Something happened' } },
  { key: 'vanity_url', value: { string_value: 'news.example.com' } }, { key: 'card_url', value: { string_value: 'https://t.co/cc' } },
  { key: 'thumbnail_image_original', value: { image_value: { url: 'https://pbs.twimg.com/card_img/1/x.jpg' } } }] } } } });
const poll = tweet(1010, 10, { full_text: 'poll' }, { top: { card: { legacy: { name: 'poll2choice_text_only', binding_values: [] } } } });
const visibility = { __typename: 'TweetWithVisibilityResults', tweet: tweet(1011, 11, { full_text: 'hidden behind a visibility wrapper', display_text_range: [0, 34] }) };
const oldSchema = tweet(1012, 12, { full_text: 'from the old user schema', display_text_range: [0, 24] }, { userOpts: { legacyOnly: true } });

const entries = [
  tweetEntry(plain),
  tweetEntry(withMedia),
  tweetEntry(retweet),
  tweetEntry(quoted),
  tweetEntry(tombstoneQuote),
  tweetEntry(tricky),
  tweetEntry(reply),
  tweetEntry(longPost),
  tweetEntry(withCard),
  tweetEntry(poll),
  entry('tweet-1011', { itemContent: item(visibility) }),
  tweetEntry(oldSchema),
  // an advert: must never be shown
  entry('promoted-tweet-1-abc', { itemContent: item(tweet(2001, 20), { promotedMetadata: { advertiser_results: {} } }) }),
  // a non-tweet suggestion module: must be ignored
  entry('who-to-follow-1', { entryType: 'TimelineTimelineModule', items: [{ item: { itemContent: { itemType: 'TimelineUser', user_results: { result: user(30) } } } }] }),
  // a conversation module containing tweets
  entry('conversationthread-1', { entryType: 'TimelineTimelineModule', items: [
    { entryId: 'conversationthread-1-tweet-3001', item: { itemContent: item(tweet(3001, 31)) } },
    { entryId: 'conversationthread-1-tweet-3002', item: { itemContent: item(tweet(3002, 32)) } },
  ] }),
  entry('cursor-bottom-1', { entryType: 'TimelineTimelineCursor', value: 'DAAB', cursorType: 'Bottom' }),
];

// a conversation: the focal post, two direct replies (one with a continuation by the same author), a promoted one
const detail = (focalId) => ({ data: { threaded_conversation_with_injections_v2: { instructions: [{ type: 'TimelineAddEntries', entries: [
  tweetEntry(tweet(focalId, 1)),
  entry('conversationthread-100', { entryType: 'TimelineTimelineModule', items: [
    { entryId: 'conversationthread-100-tweet-5001', item: { itemContent: item(tweet(5001, 41, { in_reply_to_status_id_str: String(focalId), full_text: 'first reply', display_text_range: [0, 11] })) } },
    { entryId: 'conversationthread-100-tweet-5002', item: { itemContent: item(tweet(5002, 1, { in_reply_to_status_id_str: '5001', full_text: 'author answers', display_text_range: [0, 14] })) } },
  ] }),
  tweetEntry(tweet(5003, 43, { in_reply_to_status_id_str: String(focalId), full_text: 'second reply', display_text_range: [0, 12] })),
  entry('promoted-tweet-9', { itemContent: item(tweet(5099, 44), { promotedMetadata: {} }) }),
  entry('cursor-bottom-77', { entryType: 'TimelineTimelineCursor', value: 'MORE', cursorType: 'Bottom' }),
] }] } } });

module.exports = { detail, wrap, entries, tweet, item, tweetEntry, entry, user, photo, video, gif, homeTimeline: () => wrap(entries) };
