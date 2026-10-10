const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../src/parse.js');
const L = require('../src/logic.js');
const S = require('../src/settings.js');

// People lists (Followers, Following, a List's members): what the parser makes of them, how they are filtered, and which pages they are
const user = (n, o) => Object.assign({ __typename: 'User', rest_id: String(n), is_blue_verified: n % 2 === 0, core: { name: 'Person ' + n, screen_name: 'person' + n },
  avatar: { image_url: 'https://pbs.twimg.com/profile_images/' + n + '_normal.jpg' }, relationship_perspectives: { following: n % 3 === 0, followed_by: true }, legacy: { description: 'Bio of person ' + n } }, o);
const response = (users, cursor, extra) => ({ data: { user: { result: { timeline: { timeline: { instructions: [{ type: 'TimelineAddEntries', entries: [].concat(extra || [],
  users.map((u) => ({ entryId: 'user-' + u.rest_id, content: { entryType: 'TimelineTimelineItem', itemContent: { itemType: 'TimelineUser', user_results: { result: u } } } })),
  cursor ? [{ entryId: 'cursor-bottom-1', content: { entryType: 'TimelineTimelineCursor', value: cursor, cursorType: 'Bottom' } }] : []) }] } } } } } });
const url = (op, vars) => 'https://x.com/i/api/graphql/abc/' + op + '?variables=' + encodeURIComponent(JSON.stringify(vars || { userId: '5', count: 20 }));

test('Followers, Following and the rest are read as people: a card of their own, the bio, who follows whom', () => {
  for (const op of ['Followers', 'Following', 'BlueVerifiedFollowers', 'FollowersYouKnow', 'ListMembers', 'ListSubscribers']) {
    const r = P.parseResponse(response([user(3), user(4), user(6)], 'next'), url(op));
    assert.ok(r, op + ' is a feed');
    assert.equal(r.items.length, 3, op);
    assert.equal(r.bottomCursor, 'next');
  }
  const r = P.parseResponse(response([user(3), user(4)]), url('Followers'));
  const [a, b] = r.items;
  assert.equal(a.person, true);
  assert.equal(a.key, 'u3'); assert.equal(a.id, 'u3');
  assert.equal(a.author.handle, 'person3'); assert.equal(a.author.name, 'Person 3');
  assert.match(a.author.avatar, /_bigger\./);
  assert.equal(a.bio, 'Bio of person 3');
  assert.deepEqual(a.segs, [{ t: 'text', v: 'Bio of person 3' }]);
  assert.equal(a.author.following, true); assert.equal(b.author.following, false);
  assert.equal(a.followedBy, true);
  assert.equal(a.url, '/person3');
  assert.deepEqual(a.media, []); assert.equal(a.quoted, null);
  assert.equal(b.author.blue, true); assert.equal(a.author.blue, false);
});

test('the older shape of a user (everything in `legacy`) and the newer one (`profile_bio`) both read', () => {
  const old = { __typename: 'User', rest_id: '9', legacy: { screen_name: 'oldie', name: 'Old Shape', description: 'from legacy', profile_image_url_https: 'https://pbs.twimg.com/a_normal.jpg', following: true, followed_by: false } };
  const newer = user(8, { legacy: {}, profile_bio: { description: 'from profile_bio' } });
  const r = P.parseResponse(response([old, newer]), url('Following'));
  const [o, n] = r.items;
  assert.equal(o.author.handle, 'oldie'); assert.equal(o.bio, 'from legacy'); assert.equal(o.author.following, true); assert.equal(o.followedBy, false);
  assert.equal(n.bio, 'from profile_bio');
  const none = P.parseResponse(response([user(7, { legacy: {} })]), url('Followers')).items[0];
  assert.equal(none.bio, ''); assert.deepEqual(none.segs, []);
});

test('who-to-follow, promoted and cursor entries are not people, and a user with no handle is left out; a timeline of posts is still posts', () => {
  const extra = [{ entryId: 'who-to-follow-1', content: { itemContent: { user_results: { result: user(99) } } } }];
  const r = P.parseResponse(response([user(3), { __typename: 'User', rest_id: '5' }], null, extra), url('Followers'));
  assert.deepEqual(r.items.map((x) => x.id), ['u3']);
  assert.equal(P.parseResponse(response([user(3)]), url('SomethingElse')), null);
  const keys = new Set([P.parseResponse(response([user(3)]), url('Followers', { userId: '5' })).feedKey, P.parseResponse(response([user(3)]), url('Followers', { userId: '6' })).feedKey, P.parseResponse(response([user(3)]), url('Following', { userId: '5' })).feedKey]);
  assert.equal(keys.size, 3, 'a feed for each list');
});

test('the pages: Followers, Following, the verified and the ones you know, and a List’s members, are people; a profile and a List are not', () => {
  for (const p of ['/me/followers', '/me/following/', '/me/verified_followers', '/me/followers_you_follow', '/i/lists/123/members', '/i/lists/123/followers']) assert.equal(L.routeKind(p), 'people', p);
  assert.equal(L.routeKind('/me'), 'profile'); assert.equal(L.routeKind('/me/media'), 'profile'); assert.equal(L.routeKind('/i/lists/123'), 'list');
  assert.equal(L.routeKind('/i/bookmarks'), 'bookmarks'); assert.equal(L.routeKind('/home'), 'home');
  assert.equal(L.isPeoplePage('/i/followers'), false);
});

test('a person passes unless the account is muted or the search leaves them out; the settings that are about posts do not touch them', () => {
  const people = P.parseResponse(response([user(3), user(4), user(5)]), url('Followers')).items;
  const ctx = (o, s) => Object.assign({ s: Object.assign({}, S.DEFAULTS, s), view: 'all', where: 'people', words: ['person'], accounts: new Set(), quoteIds: new Set() }, o);
  const keep = (c) => people.filter((t) => L.passes(t, c)).map((t) => t.id);
  assert.deepEqual(keep(ctx({})), ['u3', 'u4', 'u5'], 'muted words are for posts');
  assert.deepEqual(keep(ctx({}, { onlyFollowed: true, nsfw: 'hide', hideBlueReplies: true })), ['u3', 'u4', 'u5'], 'Calm’s “only people you follow” does not hide the people you do not');
  assert.deepEqual(keep(ctx({ accounts: new Set(['person4']) })), ['u3', 'u5']);
  assert.deepEqual(keep(ctx({ find: { q: 'bio of person 4', accounts: [], kinds: [] } })), ['u4'], 'the bio is searched');
  assert.deepEqual(keep(ctx({ find: { q: 'PERSON 5', accounts: [], kinds: [] } })), ['u5'], 'and the name and the handle');
  // not following back: on Followers, the ones you do not follow; on Following, the ones who do not follow you
  assert.deepEqual(keep(ctx({ find: { q: '', accounts: [], kinds: ['noback'], people: 'followers' } })), ['u4', 'u5']);
  const following = P.parseResponse(response([user(3, { relationship_perspectives: { following: true, followed_by: false } }), user(4, { relationship_perspectives: { following: true, followed_by: true } })]), url('Following')).items;
  assert.deepEqual(following.filter((t) => L.passes(t, ctx({ find: { q: '', accounts: [], kinds: ['noback'], people: 'following' } }))).map((t) => t.id), ['u3']);
  assert.deepEqual(following.filter((t) => L.passes(t, ctx({ find: { q: '', accounts: [], kinds: ['noback'], people: 'list' } }))).map((t) => t.id), ['u3', 'u4'], 'a List has no “back”: the choice means nothing there');
});
