const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../src/logic.js');
const S = require('../src/settings.js');
const P = require('../src/parse.js');
const F = require('./fixtures.js');

const tweets = P.parseResponse(F.homeTimeline(), 'https://x.com/i/api/graphql/a/HomeTimeline?variables={}').items;
const T = (id) => tweets.find((t) => t.id === String(id));
const ctx = (over = {}, s = {}) => Object.assign({ s: Object.assign({}, S.DEFAULTS, s), view: 'all', where: 'home', words: [], accounts: new Set(), quoteIds: new Set() }, over);
const ids = (c) => tweets.filter((t) => L.passes(t, c)).map((t) => t.key);

test('kinds', () => {
  assert.equal(L.kindOf(T(1001)), 'post');
  assert.equal(L.kindOf(tweets.find((t) => t.key === '1003')), 'repost');
  assert.equal(L.kindOf(T(1004)), 'quote');
  assert.equal(L.kindOf(T(1007)), 'reply');
});

test('reposts on their own tab: gone from All, shown under Reposts', () => {
  const all = ids(ctx({}, { repostsHome: 'tab' }));
  assert.ok(!all.includes('1003'));
  assert.ok(ids(ctx({}, { repostsHome: 'show' })).includes('1003'));
  const only = ids(ctx({ view: 'reposts' }, { repostsHome: 'tab' }));
  assert.deepEqual(only, ['1003']);
});

test('hiding a kind removes it everywhere, including its own view', () => {
  assert.ok(!ids(ctx({}, { repostsHome: 'hide' })).includes('1003'));
  assert.deepEqual(ids(ctx({ view: 'reposts' }, { repostsHome: 'hide' })), []);
  assert.ok(!L.viewsFor('home', Object.assign({}, S.DEFAULTS, { repostsHome: 'hide' })).includes('reposts'));
  assert.ok(L.viewsFor('home', S.DEFAULTS).includes('reposts'));
});

test('where you are decides the rule: profile and list reposts have their own switch', () => {
  const s = { repostsHome: 'show', repostsProfile: 'hide', repostsLists: 'show' };
  assert.ok(ids(ctx({ where: 'home' }, s)).includes('1003'));
  assert.ok(!ids(ctx({ where: 'profile' }, s)).includes('1003'));
  assert.ok(ids(ctx({ where: 'list' }, s)).includes('1003'));
  assert.equal(L.routeKind('/home'), 'home');
  assert.equal(L.routeKind('/i/lists/123'), 'list');
  assert.equal(L.routeKind('/someone'), 'profile');
  assert.equal(L.routeKind('/search'), 'search');
});

test('quotes and replies can be tabbed or hidden too', () => {
  assert.ok(!ids(ctx({}, { quotesHome: 'tab' })).includes('1004'));
  assert.deepEqual(ids(ctx({ view: 'quotes' }, { quotesHome: 'tab' })), ['1004', '1005']);
  assert.ok(!ids(ctx({}, { repliesHome: 'hide' })).includes('1007'));
});

test('media view and posts view', () => {
  assert.ok(ids(ctx({ view: 'media' })).every((k) => T(k) ? T(k).media.length : true));
  assert.ok(ids(ctx({ view: 'posts' }, { repostsHome: 'show' })).every((k) => !tweets.find((t) => t.key === k).repostedBy));
});

test('muted words, accounts, quotes of a muted post', () => {
  assert.ok(!ids(ctx({ words: ['hello world 1001'] }, { repostsHome: 'show' })).includes('1001'));
  assert.ok(!ids(ctx({ accounts: new Set(['user2']) })).includes('1002'));
  assert.ok(!ids(ctx({ accounts: new Set(['user1']) }, { repostsHome: 'show' })).includes('1003'), 'a repost of a muted account goes too');
  assert.ok(!ids(ctx({ accounts: new Set(['user1']) })).includes('1004'), 'quoting a muted account goes too');
  assert.ok(!ids(ctx({ quoteIds: new Set(['1001']) })).includes('1004'), 'quotes of a muted post');
});

test('hide quotes of accounts X says I muted or blocked', () => {
  const q = JSON.parse(JSON.stringify(T(1004)));
  q.quoted.author.muting = true;
  const c = ctx({}, { hideMutedQuotes: true });
  assert.equal(L.passes(q, c), false);
  assert.equal(L.passes(q, ctx({}, { hideMutedQuotes: false })), true);
});

test('only followed accounts: hides explicit non-follows, keeps unknowns and reposts by people I follow', () => {
  const t = JSON.parse(JSON.stringify(T(1001)));
  t.author.following = false;
  assert.equal(L.passes(t, ctx({}, { onlyFollowed: true })), false);
  t.author.following = undefined;
  assert.equal(L.passes(t, ctx({}, { onlyFollowed: true })), true);
  t.author.following = false; t.repostedBy = { name: 'F', handle: 'f' };
  assert.equal(L.passes(t, ctx({}, { onlyFollowed: true, repostsHome: 'show' })), true);
});

test('hide replies from paid-verified accounts only', () => {
  const r = JSON.parse(JSON.stringify(T(1007)));
  r.author.blue = true; r.author.verified = false;
  assert.equal(L.passes(r, ctx({}, { hideBlueReplies: true })), false);
  r.author.verified = true;
  assert.equal(L.passes(r, ctx({}, { hideBlueReplies: true })), true);
});

test('automatic columns respect the cap and the minimum width', () => {
  const s = Object.assign({}, S.DEFAULTS, { maxAutoCols: 5, minColWidth: 440 });
  assert.equal(L.autoCols(3300, s), 5, 'a huge screen stops at the cap');
  assert.equal(L.autoCols(1800, s), 4);
  assert.equal(L.autoCols(1300, s), 2);
  assert.equal(L.autoCols(400, s), 1);
  assert.equal(L.autoCols(3300, Object.assign({}, s, { maxAutoCols: 4 })), 4);
});

test('download names', () => {
  const info = { account: 'user1', name: 'User One', tweetId: '123', serial: 2, hash: 'AbC', createdAt: Date.UTC(2026, 9, 4, 12, 5, 9), ext: 'jpg' };
  assert.equal(L.formatFilename('X/{account}/{tweetId}-{serial}', info), 'X/user1/123-2.jpg');
  assert.equal(L.formatFilename('{date}_{account}_{hash}', info), '20261004_user1_AbC.jpg');
  assert.equal(L.formatFilename('{datetime}', info), '20261004-120509.jpg');
  assert.equal(L.formatFilename('{name}', { ...info, name: 'a/b:c*d?' }), 'a_b_c_d_.jpg');
  assert.equal(L.formatFilename('../../etc/{account}', info), 'etc/user1.jpg', 'cannot climb out of the Downloads folder');
  assert.equal(L.formatFilename('{nonsense}', info), '{nonsense}.jpg');
  assert.equal(L.formatFilename('', info), 'user1-123-2.jpg');
  assert.equal(L.formatFilename('/abs/{account}', info), 'abs/user1.jpg');
});

test('new posts are put in front without duplicates', () => {
  const a = [{ key: '2' }, { key: '1' }];
  const m = L.mergeNew(a, [{ key: '3' }, { key: '2' }]);
  assert.deepEqual(m.items.map((t) => t.key), ['3', '2', '1']);
  assert.equal(m.added, 1);
});

test('settings: defaults are sane and bad values fall back', () => {
  const d = S.normalize({});
  assert.equal(d.hideForYou, true);
  assert.equal(d.maxAutoCols, 5);
  const n = S.normalize({ cols: 99, repostsHome: 'bogus', counts: 'yes', maxAutoCols: 3, mutedWords: 'a, b', hideSidebar: true, extra: 1 });
  assert.equal(n.cols, 8, 'clamped');
  assert.equal(n.repostsHome, 'tab', 'unknown option ignored');
  assert.equal(n.counts, true, 'wrong type ignored');
  assert.equal(n.maxAutoCols, 3);
  assert.equal(n.hideSidebar, true);
  assert.ok(!('extra' in n));
  assert.deepEqual(S.words(' Foo, bar baz ,\nQux'), ['foo', 'bar baz', 'qux']);
  assert.deepEqual(S.handles('@Foo, bar'), ['foo', 'bar']);
  assert.equal(S.normalize({ muted: 'old, words' }).mutedWords, 'old, words', 'older saved setting is migrated');
});

test('every setting is documented in the schema with a label', () => {
  for (const sec of S.SCHEMA) for (const it of sec.items) {
    assert.ok(it.label, it.key);
    assert.ok(it.key in S.DEFAULTS, it.key);
    if (it.type === 'select') assert.ok(it.options.some(([v]) => v === it.def), it.key + ' default must be one of its options');
  }
});

test('sensitive posts: shown, or hidden when the NSFW setting says so (including quotes of them)', () => {
  const t = JSON.parse(JSON.stringify(T(1001))); t.sensitive = true;
  assert.equal(L.passes(t, ctx({}, { nsfw: 'blur' })), true, 'blur is handled by the card, not the filter');
  assert.equal(L.passes(t, ctx({}, { nsfw: 'show' })), true);
  assert.equal(L.passes(t, ctx({}, { nsfw: 'hide' })), false);
  const q = JSON.parse(JSON.stringify(T(1004))); q.quoted.sensitive = true;
  assert.equal(L.passes(q, ctx({}, { nsfw: 'hide' })), false);
});

test('settings: old saved values are migrated and list values are sanitised', () => {
  assert.equal(S.normalize({ autoReveal: true }).nsfw, 'show');
  assert.equal(S.normalize({ nsfw: 'bogus' }).nsfw, 'blur');
  assert.equal(S.normalize({}).hideGrokDrawer, true, 'the floating Grok and Chat buttons are always removed');
  assert.equal(S.normalize({}).hideDmDrawer, true);
  assert.deepEqual(S.normalize({ hiddenNav: ['/i/grok', 5, null, '/explore'] }).hiddenNav, ['/i/grok', '/explore']);
  assert.deepEqual(S.normalize({ navItems: [{ key: '/a', label: 'A' }, { key: 5 }, 'x'] }).navItems, [{ key: '/a', label: 'A' }]);
  assert.ok(!('enabled' in S.normalize({ enabled: false })), 'there is no on/off switch any more');
});

test('settings: only non-default values are stored, so a changed default reaches existing users', () => {
  const d = S.diff(S.normalize({}));
  assert.deepEqual(Object.keys(d.set), ['v'], 'a fresh install stores nothing but the version');
  assert.ok(d.clear.includes('cols') && d.clear.includes('hideDmDrawer'));
  const custom = S.normalize({ cols: 3, mutedWords: 'x' });
  const c = S.diff(custom);
  assert.equal(c.set.cols, 3); assert.equal(c.set.mutedWords, 'x'); assert.ok(!('maxAutoCols' in c.set));
  assert.ok(c.clear.includes('maxAutoCols'));
});

test('settings: values an older version baked in for a key whose default changed are dropped', () => {
  // the floating Grok / Chat buttons are removed for everyone from settings v7: whatever an older version stored is dropped
  assert.equal(S.normalize({ v: 6, hideGrokDrawer: false }).hideGrokDrawer, true);
  assert.equal(S.normalize({ hideDmDrawer: false }).hideDmDrawer, true);
  assert.equal(S.normalize({ v: 7, hideDmDrawer: false }).hideDmDrawer, false, 'but a value written by v7 is kept');
  assert.equal(S.normalize({ cols: 4 }).cols, 4, 'unrelated saved values survive the migration');
  assert.equal(S.normalize({}).v, undefined);
});

test('sorting a timeline response: next pages are appended, only genuinely fresh first pages wait behind the button', () => {
  const base = { hasItems: true, known: true, first: false, topRefresh: false, asked: false, refreshing: false };
  assert.equal(L.classifyResponse({ ...base, hasItems: false }), 'establish');
  assert.equal(L.classifyResponse({ ...base }), 'append', 'a request with a cursor is the next page');
  assert.equal(L.classifyResponse({ ...base, first: true }), 'pending', 'X re-sending the first page by itself');
  assert.equal(L.classifyResponse({ ...base, topRefresh: true }), 'pending', 'newer posts from the top cursor');
  assert.equal(L.classifyResponse({ ...base, first: true, refreshing: true }), 'refresh', 'you pressed refresh');
  // the request couldn't be read (variables not visible): never assume "first page"
  assert.equal(L.classifyResponse({ ...base, known: false, first: true, asked: true }), 'append', 'it arrived right after we asked for more');
  assert.equal(L.classifyResponse({ ...base, known: false, first: true, asked: false }), 'pending', 'unprompted: treat as new posts');
  assert.equal(L.classifyResponse({ ...base, known: false, refreshing: true }), 'refresh');
});

const dl = (over = {}) => L.buildDownloadPath(Object.assign({}, S.DEFAULTS, over), { account: 'user1', name: 'User One', tweetId: '123', serial: 1, hash: 'AbC', createdAt: Date.UTC(2026, 9, 4), ext: 'jpg' });

test('downloads: an X folder inside Downloads by default, with a source tag before the extension', () => {
  assert.equal(dl(), 'X/user1-123-1-twitter.jpg', 'the default folder is X, and the file says where it came from');
  assert.equal(dl({ dlFolder: '' }), 'user1-123-1-twitter.jpg', 'no folder if you clear it');
  assert.equal(dl({ dlFolder: '', dlSuffix: '' }), 'user1-123-1.jpg', 'the tag can be turned off');
  assert.equal(dl({ dlFolder: '', dlSuffix: 'from x!' }), 'user1-123-1-fromx.jpg', 'the tag is made file-safe');
  assert.equal(L.buildDownloadPath(Object.assign({}, S.DEFAULTS, { dlFolder: '' }), { account: 'a', tweetId: '9', serial: 2, ext: 'mp4', createdAt: 0 }), 'a-9-2-twitter.mp4');
});

test('downloads: the folder is yours to choose, and per-account folders are optional', () => {
  assert.equal(dl({ dlFolder: 'Pictures/X' }), 'Pictures/X/user1-123-1-twitter.jpg');
  assert.equal(dl({ dlByAccount: true }), 'X/user1/user1-123-1-twitter.jpg');
  assert.equal(dl({ dlFolder: 'Pics', dlByAccount: true }), 'Pics/user1/user1-123-1-twitter.jpg');
  assert.equal(dl({ dlFolder: '../../etc' }), 'etc/user1-123-1-twitter.jpg', 'cannot climb out of Downloads');
  assert.equal(dl({ dlFolder: '  ' }), 'user1-123-1-twitter.jpg');
  assert.equal(dl({ dlFolder: '', dlPattern: '{date}/{account}' }), '20261004/user1-twitter.jpg', 'a slash in the pattern still works for people who want it');
});

test('downloads: a full path typed in (which a browser cannot honour) keeps its last folder name instead of being mangled', () => {
  assert.equal(dl({ dlFolder: '/home/me/Pictures/X' }), 'X/user1-123-1-twitter.jpg');
  assert.equal(dl({ dlFolder: 'C:\\Users\\me\\Videos\\Saved' }), 'Saved/user1-123-1-twitter.jpg');
  assert.equal(dl({ dlFolder: '~/Pictures' }), 'Pictures/user1-123-1-twitter.jpg');
  for (const abs of ['/a/b', 'C:\\a', 'c:/a', '\\\\server\\share', '~/x']) assert.equal(L.isAbsolutePath(abs), true, abs);
  for (const rel of ['X', 'Pictures/X', 'a b/c', '']) assert.equal(L.isAbsolutePath(rel), false, rel);
});

test('downloads: old saved values no longer pin existing users, but real choices are kept', () => {
  assert.equal(S.normalize({ dlPattern: 'X/{account}/{tweetId}-{serial}' }).dlPattern, '{account}-{tweetId}-{serial}');
  assert.equal(S.normalize({ dlPattern: '{date}_{account}' }).dlPattern, '{date}_{account}');
  assert.equal(S.normalize({ dlFolder: '' }).dlFolder, 'X', 'an old default of "no folder" gives way to the new default');
  assert.equal(S.normalize({ v: 4, dlFolder: '' }).dlFolder, '', 'but clearing it on this version is a choice');
  assert.equal(S.normalize({ dlFolder: 'My Saves' }).dlFolder, 'My Saves');
  assert.equal(S.normalize({}).dlSuffix, 'twitter');
  assert.equal(S.normalize({}).dlByAccount, false);
  assert.equal(S.normalize({}).dlAsk, false);
  assert.equal(S.normalize({}).openIn, 'newtab');
});

const R = (id, depth, like, createdAt) => ({ id, depth, counts: { like }, createdAt });
test('comments: grouped into threads and sorted without splitting a thread', () => {
  const list = [R('a', 0, 5, 100), R('a2', 1, 99, 900), R('b', 0, 50, 300), R('c', 0, 1, 200), R('c2', 1, 0, 50)];
  assert.deepEqual(L.groupThreads(list).map((t) => t.map((r) => r.id)), [['a', 'a2'], ['b'], ['c', 'c2']]);
  assert.deepEqual(L.sortReplies(list, 'relevant').map((r) => r.id), ['a', 'a2', 'b', 'c', 'c2'], 'X’s own order');
  assert.deepEqual(L.sortReplies(list, 'recent').map((r) => r.id), ['b', 'c', 'c2', 'a', 'a2'], 'newest direct reply first, thread kept together');
  assert.deepEqual(L.sortReplies(list, 'likes').map((r) => r.id), ['b', 'a', 'a2', 'c', 'c2'], 'ranked by the direct reply’s likes');
  assert.deepEqual(L.sortReplies(list, 'nonsense').map((r) => r.id), ['a', 'a2', 'b', 'c', 'c2']);
  assert.deepEqual(L.sortReplies([], 'recent'), []);
  assert.deepEqual(L.sortReplies([R('x', 1, 0, 1), R('y', 0, 0, 2)], 'recent').map((r) => r.id), ['y', 'x'], 'a continuation with nothing before it is still kept, as its own thread');
  assert.deepEqual(L.sortReplies([R('p', 0, 3, 5), R('q', 0, 3, 5)], 'likes').map((r) => r.id), ['p', 'q'], 'ties keep X’s order');
});

test('view buttons: a kind of post only gets a button once the feed has some', () => {
  const mk = (extra) => Object.assign({ author: { handle: 'a' }, segs: [], media: [], counts: {} }, extra);
  const onlyPosts = [mk({}), mk({})];
  const s = Object.assign({}, S.DEFAULTS, { repostsHome: 'show' });
  assert.deepEqual(L.availableViews('home', s, onlyPosts, 'all'), ['all', 'posts']);
  const mixed = [mk({}), mk({ repostedBy: { handle: 'x' } }), mk({ media: [{}] }), mk({ replyTo: 'z' })];
  assert.deepEqual(L.availableViews('home', s, mixed, 'all'), ['all', 'posts', 'reposts', 'media'], 'no Replies button unless replies have their own tab (shelved)');
  assert.ok(L.availableViews('home', Object.assign({}, s, { repliesHome: 'tab' }), mixed, 'all').includes('replies'), 'asked for a Replies tab: it is there');
  assert.ok(L.availableViews('home', s, onlyPosts, 'posts').includes('posts'), 'the one you are on never vanishes under you');
  assert.deepEqual(L.availableViews('home', s, [], 'all'), ['all']);
  assert.ok(!L.availableViews('home', Object.assign({}, s, { repostsHome: 'hide' }), mixed, 'all').includes('reposts'), 'a hidden kind stays hidden');
});

test('algorithmic content has its own settings category with every switch independent', () => {
  const sec = S.SCHEMA.find((x) => x.id === 'algorithm');
  assert.ok(sec, 'category exists');
  const keys = sec.items.map((i) => i.key);
  for (const k of ['hideForYou', 'onlyFollowed', 'hideTrending', 'hideWhoToFollow', 'hideTopics', 'hideDiscoverMore', 'hidePremiumPromo']) assert.ok(keys.includes(k), k);
  assert.equal(new Set(S.SCHEMA.flatMap((x) => x.items.map((i) => i.key))).size, S.SCHEMA.flatMap((x) => x.items).length, 'no setting is listed twice');
});

test('"that’s everything" is shown only when X really has no more, and posts arriving later cancel it', () => {
  let p = { empty: 0, exhausted: false };
  p = L.nextPaging(p, { added: 0, bottomCursor: 'c1', repeated: false });
  p = L.nextPaging(p, { added: 0, bottomCursor: 'c2', repeated: false });
  assert.equal(p.exhausted, false, 'two ad-only pages with fresh cursors are not the end');
  p = L.nextPaging(p, { added: 7, bottomCursor: 'c3', repeated: false });
  assert.deepEqual(p, { empty: 0, exhausted: false }, 'posts reset the count and the flag');
  assert.equal(L.nextPaging(p, { added: 4, bottomCursor: '', repeated: false }).exhausted, true, 'no next marker: last page');
  assert.equal(L.nextPaging(p, { added: 0, bottomCursor: 'c3', repeated: true }).exhausted, true, 'a marker we already followed is a loop');
  assert.equal(L.nextPaging(p, { added: 3, bottomCursor: 'c3', repeated: true }).exhausted, false, 'a repeated marker that still brought posts is fine');
  let q = { empty: 0 };
  for (let i = 0; i < 4; i++) q = L.nextPaging(q, { added: 0, bottomCursor: 'n' + i, repeated: false });
  assert.equal(q.exhausted, false);
  assert.equal(L.nextPaging(q, { added: 0, bottomCursor: 'n5', repeated: false }).exhausted, true, 'five empty pages in a row: stop asking');
});

test('videos pause when scrolled half away; GIFs also resume when back', () => {
  assert.equal(L.videoAction({ gif: false, ratio: 0.3, paused: false }), 'pause', 'a playing video that is cut off stops');
  assert.equal(L.videoAction({ gif: false, ratio: 0, paused: false }), 'pause');
  assert.equal(L.videoAction({ gif: false, ratio: 0.8, paused: false }), null, 'mostly visible: leave it playing');
  assert.equal(L.videoAction({ gif: false, ratio: 0.2, paused: true }), null, 'already paused');
  assert.equal(L.videoAction({ gif: false, ratio: 1, paused: true }), null, 'never starts a video the person did not start');
  assert.equal(L.videoAction({ gif: true, ratio: 0.9, paused: true }), 'play');
  assert.equal(L.videoAction({ gif: true, ratio: 0.4, paused: false }), 'pause');
});

test('a profile’s Media tab sorts into Photos and Videos (GIFs count as videos)', () => {
  assert.ok(L.isMediaTab('/jack/media') && L.isMediaTab('/jack/media/'));
  assert.ok(!L.isMediaTab('/jack') && !L.isMediaTab('/jack/with_replies') && !L.isMediaTab('/i/media') && !L.isMediaTab('/home'));
  const mk = (type) => ({ author: { handle: 'a' }, segs: [], media: [{ type }], counts: {} });
  const s = Object.assign({}, S.DEFAULTS);
  const mixed = [mk('photo'), mk('video'), mk('gif')];
  assert.deepEqual(L.availableViews('profile', s, mixed, 'all', { mediaTab: true }), ['all', 'photos', 'videos']);
  assert.deepEqual(L.availableViews('profile', s, [mk('photo')], 'all', { mediaTab: true }), ['all', 'photos'], 'no Videos button until there is a video');
  assert.deepEqual(L.availableViews('profile', s, mixed, 'all'), ['all', 'posts', 'media'], 'elsewhere it is the usual views');
  const c = (view) => ctx({ view, where: 'profile' });
  assert.deepEqual(mixed.map((t) => L.passes(t, c('photos'))), [true, false, false]);
  assert.deepEqual(mixed.map((t) => L.passes(t, c('videos'))), [false, true, true]);
  assert.deepEqual(mixed.map((t) => L.passes(t, c('all'))), [true, true, true]);
});

test('column width: old default is dropped, a chosen width is kept; narrower windows give fewer columns, never fewer than one', () => {
  assert.equal(S.DEFAULTS.minColWidth, 500);
  assert.equal(S.normalize({ v: 4, minColWidth: 440 }).minColWidth, 500, 'the old default was never a choice');
  assert.equal(S.normalize({ v: 4, minColWidth: 600 }).minColWidth, 600);
  const s = Object.assign({}, S.DEFAULTS);
  const counts = [3300, 2600, 2000, 1500, 1000, 700, 300].map((w) => L.autoCols(w, s, 12));
  assert.deepEqual(counts, [5, 5, 3, 2, 1, 1, 1]);
  assert.ok(counts.every((n, i) => i === 0 || n <= counts[i - 1]), 'monotonic: shrinking the window never adds columns');
});

test('new settings exist with sensible defaults', () => {
  assert.equal(S.DEFAULTS.tidyReplies, true);
  assert.equal(S.DEFAULTS.nativeTools, true);
});
