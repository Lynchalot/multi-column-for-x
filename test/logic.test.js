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
  assert.equal(S.normalize({}).hideGrokDrawer, false, 'the floating Grok and Chat buttons are shown');
  assert.equal(S.normalize({}).hideDmDrawer, false);
  assert.deepEqual(S.normalize({ hiddenNav: ['/i/grok', 5, null, '/explore'] }).hiddenNav, ['/i/grok', '/explore']);
  assert.deepEqual(S.normalize({ navItems: [{ key: '/a', label: 'A' }, { key: 5 }, 'x'] }).navItems, [{ key: '/a', label: 'A' }]);
  assert.equal(S.normalize({ enabled: false }).enabled, false, 'the master switch is kept (0.32.4): it was dropped once, and is back, with the toggle at the top of every settings page');
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
  // the floating Grok / Chat buttons are shown for everyone from settings v8: whatever an older version stored is dropped
  assert.equal(S.normalize({ v: 7, hideGrokDrawer: true }).hideGrokDrawer, false);
  assert.equal(S.normalize({ hideDmDrawer: true }).hideDmDrawer, false);
  assert.equal(S.normalize({ v: 8, hideDmDrawer: true }).hideDmDrawer, true, 'but a value written by v8 is kept');
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
  assert.equal(S.normalize({}).openIn, 'view');
  assert.equal(S.normalize({ openIn: 'newtab' }).openIn, 'view', 'an older version\'s saved choice was the old default');
  assert.equal(S.normalize({ v: 9, openIn: 'newtab' }).openIn, 'newtab', 'but a choice made on this version is kept');
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

test('health: each rule fires on what was seen failing, and a healthy page reports nothing', () => {
  const ok = { active: true, isHome: true, sinceRoute: 60, opsSeen: 4, tabCount: 2, waitingSeconds: 0, actionFails: 0, commentFails: 0, navFallback: false, sideFallback: false };
  assert.deepEqual(L.healthIssues(ok), []);
  const keys = (o) => L.healthIssues(Object.assign({}, ok, o)).map((i) => i.key);
  assert.deepEqual(keys({ opsSeen: 0 }), ['no-data']);
  assert.deepEqual(keys({ opsSeen: 0, sinceRoute: 5 }), [], 'give it a few seconds first');
  assert.deepEqual(keys({ tabCount: 0 }), ['no-tabs']);
  assert.deepEqual(keys({ tabCount: 0, isHome: false }), [], 'only Home needs its tab bar');
  assert.deepEqual(keys({ waitingSeconds: 50 }), ['stalled']);
  assert.deepEqual(keys({ actionFails: 3 }), ['actions']);
  assert.deepEqual(keys({ commentFails: 3 }), ['comments']);
  assert.deepEqual(keys({ navFallback: true }), [], 'one sidebar falling back is fine');
  assert.deepEqual(keys({ navFallback: true, sideFallback: true }), ['pinning']);
  assert.deepEqual(L.healthIssues({ active: false, sinceRoute: 99, opsSeen: 0, tabCount: 0, waitingSeconds: 99 }), [], 'columns off: nothing to report');
});

test('layouts: per-page picks win only when the setting is on; smaller posts get narrower automatic columns', () => {
  const s = Object.assign(S.normalize(), { cols: 4, density: 'normal', pageLayouts: { home: { cols: 2 }, list: { density: 'text' } } });
  assert.deepEqual(L.pageLayout(s, 'home'), { cols: 4, density: 'normal' }, 'ignored while the setting is off');
  s.perPageLayout = true;
  assert.deepEqual(L.pageLayout(s, 'home'), { cols: 2, density: 'normal' }, 'a page keeps its own columns, and falls back for what it has not set');
  assert.deepEqual(L.pageLayout(s, 'list'), { cols: 4, density: 'text' });
  assert.deepEqual(L.pageLayout(s, 'search'), { cols: 4, density: 'normal' }, 'a page with nothing saved follows the global settings');
  assert.deepEqual(L.pageLayout(Object.assign({}, s, { cols: 0 }), 'home'), { cols: 2, density: 'normal' }, 'a saved 0 would mean automatic, and an unset page follows the global 0');
  assert.deepEqual(L.pageLayout(Object.assign({}, s, { cols: 0, pageLayouts: { home: { cols: 0 } } }), 'home'), { cols: 0, density: 'normal' }, 'automatic can be chosen for one page');
  assert.equal(L.minColFor(s, 'normal'), 500);
  assert.ok(L.minColFor(s, 'compact') < 500 && L.minColFor(s, 'text') < L.minColFor(s, 'compact'));
  assert.ok(L.minColFor({ minColWidth: 280 }, 'text') >= 240, 'never absurdly narrow');
  const wide = 3400;
  assert.ok(L.autoCols(wide, { minColWidth: L.minColFor(s, 'text'), maxAutoCols: 8 }) > L.autoCols(wide, { minColWidth: 500, maxAutoCols: 8 }));
});

test('layouts: saved page layouts are checked on the way in', () => {
  const n = S.normalize({ pageLayouts: { home: { cols: 99, density: 'compact' }, nowhere: { cols: 2 }, list: { cols: 'x', density: 'huge' }, search: 5 } });
  assert.deepEqual(n.pageLayouts, { home: { cols: 8, density: 'compact' } });
  assert.deepEqual(S.normalize({ pageLayouts: [1, 2] }).pageLayouts, {});
  assert.deepEqual(S.normalize().pageLayouts, {});
  assert.notEqual(S.normalize().pageLayouts, S.normalize().pageLayouts, 'not one shared object');
  assert.equal(S.normalize({ density: 'text' }).density, 'text');
  assert.equal(S.normalize({ density: 'nonsense' }).density, 'normal');
  assert.equal(S.normalize({ seen: 'hide' }).seen, 'hide');
  assert.equal(S.normalize({ seen: 'nonsense' }).seen, 'off');
  const d = S.diff(Object.assign(S.normalize(), { pageLayouts: { home: { cols: 2 } } }));
  assert.deepEqual(d.set.pageLayouts, { home: { cols: 2 } });
  assert.ok(S.diff(S.normalize()).clear.includes('pageLayouts'), 'back to nothing saved: the stored copy is removed');
});

test('reposts: the line says who, and several people fold into one card', () => {
  assert.equal(L.repostLine(['Ann'], 'reposted'), 'Ann reposted');
  assert.equal(L.repostLine(['Ann', 'Bo'], 'reposted'), 'Ann and Bo reposted');
  assert.equal(L.repostLine(['Ann', 'Bo', 'Cy'], 'retweeted'), 'Ann, Bo and 1 other retweeted');
  assert.equal(L.repostLine(['Ann', 'Bo', 'Cy', 'Di', 'Ed'], 'reposted'), 'Ann, Bo and 3 others reposted');
  const post = (id, by) => ({ id, key: id + (by ? 'rt' + by : ''), repostedBy: by ? { name: by, handle: by.toLowerCase() } : null });
  const c = L.collapser();
  const first = post('1', 'Ann');
  assert.equal(c.offer(first), null, 'the first one gets a card');
  assert.equal(c.offer(post('1', 'Bo')), first, 'a second repost folds into it');
  assert.equal(c.offer(post('1', 'Bo')), first, '...and the same person twice is still one');
  assert.equal(c.offer(post('1', null)), first, 'the original arriving later adds nothing');
  assert.equal(c.offer(post('2', 'Ann')), null, 'a different post is a different card');
  assert.deepEqual(c.who('1').map((b) => b.name), ['Ann', 'Bo']);
  assert.deepEqual(c.who('nope'), []);
  const o = L.collapser(); const orig = post('9', null);
  assert.equal(o.offer(orig), null);
  assert.equal(o.offer(post('9', 'Cy')), orig, 'a repost of a post already shown as an original is folded without being added');
  assert.deepEqual(o.who('9'), [], 'an original has no reposters to list');
});

test('new reading and layout settings exist, off by default, and pageLayouts is not a visible setting', () => {
  const d = S.normalize();
  assert.equal(d.seen, 'off'); assert.equal(d.collapseReposts, true); assert.equal(d.density, 'normal'); assert.equal(d.perPageLayout, false);
  const keys = S.SCHEMA.flatMap((sec) => sec.items.map((i) => i.key));
  for (const k of ['seen', 'collapseReposts', 'density', 'perPageLayout', 'commentSort']) assert.ok(keys.includes(k), k);
  assert.ok(!keys.includes('pageLayouts'));
});

// ---- a person's thread folded under its first post ----
const post = (id, over = {}) => Object.assign({ id, key: id, author: { handle: 'Ann' }, replyTo: '', replyToId: '', createdAt: Number(id), repostedBy: null }, over);
const answer = (id, to, over = {}) => post(id, Object.assign({ replyTo: 'ann', replyToId: to }, over));

test('a thread: replies to themselves fold under the first post, oldest first', () => {
  const plan = L.threadPlan([answer('3', '2'), answer('2', '1'), post('x', { author: { handle: 'bob' } }), post('1')]);
  assert.deepEqual([...plan.kids.keys()], ['1']);
  assert.deepEqual(plan.kids.get('1').map((t) => t.id), ['2', '3']);
  assert.equal(plan.rootOf.get('3').id, '1', 'the root of the whole chain, not of the parent');
});
test('a thread: a reply whose parent is not in the feed, a reply to someone else, and a repost stay as they are', () => {
  const plan = L.threadPlan([answer('9', '8'), post('5'), post('6', { replyTo: 'bob', replyToId: '5' }), answer('7', '5', { repostedBy: { name: 'c', handle: 'c' } })]);
  assert.equal(plan.kids.size, 0);
  assert.equal(plan.rootOf.size, 0);
});
test('a thread: a loop of replies does not hang', () => {
  const plan = L.threadPlan([answer('1', '2'), answer('2', '1')]);
  assert.equal(plan.rootOf.size, 0);
});
test('settings: volume is kept as a number between 0 and 1, and the presets only name real settings', () => {
  assert.equal(S.normalize({ volume: 0.4, videoMuted: true }).volume, 0.4);
  assert.equal(S.normalize({ volume: 7 }).volume, 1);
  assert.equal(S.normalize({ volume: 'loud' }).volume, 1);
  assert.equal(S.normalize({}).foldThreads, true);
  assert.equal(S.normalize({}).tallPhotos, 'cap');
  const keys = new Set(S.SCHEMA.flatMap((sec) => sec.items.map((i) => i.key)));
  for (const p of S.PRESETS) {
    const n = S.normalize(p.set);
    for (const [k, v] of Object.entries(p.set)) { assert.ok(keys.has(k), p.id + ': ' + k); assert.deepEqual(n[k], v, p.id + ': ' + k + ' is not a valid value'); }
  }
  assert.ok(S.presetApplies(S.PRESETS[1], Object.assign({}, S.DEFAULTS, S.PRESETS[1].set)));
  assert.ok(!S.presetApplies(S.PRESETS[1], S.DEFAULTS));
});

test('settings: each preset matches alone, whichever was picked before it, and Custom is what is left', () => {
  const pick = (from, p) => Object.assign({}, S.DEFAULTS, from, p.set);
  for (const before of [{}, ...S.PRESETS.map((p) => p.set)]) for (const p of S.PRESETS) {
    const now = pick(before, p);
    assert.deepEqual(S.PRESETS.filter((q) => S.presetApplies(q, now)).map((q) => q.id), [p.id], p.id + ' picked after another is the only one that matches');
  }
  assert.deepEqual(S.PRESETS.filter((q) => S.presetApplies(q, Object.assign(pick({}, S.PRESETS[0]), { hideTrending: true }))), [], 'one change and none matches');
  assert.equal(S.PRESETS.find((p) => p.id === 'media').set.maxAutoCols, 8);
  assert.equal(S.PRESETS.find((p) => p.id === 'calm').set.maxAutoCols, S.DEFAULTS.maxAutoCols, 'Calm puts the media wall back');
});

test('settings: the name and logo are X\'s own unless chosen; an older save of the old default does not hold it', () => {
  assert.equal(S.normalize({}).branding, 'x');
  assert.equal(S.normalize({ v: 9, branding: 'twitter' }).branding, 'x', 'saved by a version that stored everything: never a choice');
  assert.equal(S.normalize({ v: S.VERSION, branding: 'twitter' }).branding, 'twitter', 'a choice made now is kept');
});

test('a fresh install starts on Calm, stored as choices, so Calm is what shows as ticked', () => {
  const stored = S.freshInstall();
  assert.equal(stored.v, S.VERSION);
  const n = S.normalize(stored);
  assert.ok(S.presetApplies(S.PRESETS.find((p) => p.id === 'calm'), n));
  assert.ok(!('hideForYou' in stored), 'what already matches the defaults is not stored');
  assert.ok(!S.PRESETS.some((p) => p.id !== 'calm' && S.presetApplies(p, n)), 'and nothing else is ticked');
  assert.equal(n.keyScheme, 'vim', 'a fresh install has the Vim keys, so the welcome page opens on them');
  assert.equal(S.normalize({}).keyScheme, 'classic', 'for everyone else the default is what it was (the Simple keys)');
  assert.deepEqual([n.leftPanel, n.rightPanel], ['rail', 'hidden'], 'the menu on icons and the right panel slid away');
  assert.deepEqual([S.DEFAULTS.leftPanel, S.DEFAULTS.rightPanel], ['full', 'shown'], 'for everyone else both are shown');
  assert.equal(n.collapseReposts && n.foldThreads, true);
});

test('features: a run of failures switches one feature off for a while, a success puts it back, and the wait starts again after a failure that follows it', () => {
  let t = 1000; const f = L.featureTracker({ limit: 3, cooldownMs: 60000, now: () => t });
  assert.equal(f.state('like'), 'unseen');
  f.ok('like'); assert.equal(f.state('like'), 'working');
  f.fail('like', 'no button'); f.fail('like', 'no button');
  assert.equal(f.state('like'), 'failing'); assert.equal(f.off('like'), false, 'two in a row is not yet enough');
  f.ok('like'); assert.equal(f.snapshot().like.streak, 0, 'a success clears the run');
  f.fail('like', 'a'); f.fail('like', 'b'); f.fail('like', 'c');
  assert.equal(f.off('like'), true); assert.equal(f.state('like'), 'off'); assert.equal(f.off('repost'), false, 'only that one');
  assert.equal(f.snapshot().like.why, 'c');
  t += 59000; assert.equal(f.off('like'), true);
  t += 2000; assert.equal(f.off('like'), false, 'tried again once the wait is over');
  f.fail('like', 'still'); assert.equal(f.off('like'), true, 'and a failure then starts the wait again');
  t += 61000; f.ok('like'); assert.equal(f.off('like'), false); assert.equal(f.state('like'), 'working');
});

test('controls: one list of the test ids of the buttons that are pressed, in the form of a selector', () => {
  assert.equal(L.controlSel('like'), '[data-testid="like"],[data-testid="unlike"]');
  assert.equal(L.controlSel('like', 0), '[data-testid="like"]');
  assert.equal(L.controlSel('bookmark', 1), '[data-testid="removeBookmark"]');
  for (const k of ['like', 'repost', 'repostConfirm', 'bookmark', 'reply', 'tweetText']) assert.ok(L.CONTROLS[k].length, k);
});

test('the words on X\'s translation controls come from one table, and the patterns are anchored to the whole label', () => {
  const tr = L.wordPattern('translate'), orig = L.wordPattern('original'), from = L.wordPattern('translatedFrom', false);
  assert.ok(tr.test('Translate post') && tr.test('translate Tweet') && tr.test('Show translation'));
  assert.ok(!tr.test('Translate post into a poem'), 'a label, not a sentence that contains one');
  assert.ok(orig.test('Show original') && !orig.test('Show original post here'));
  assert.ok(from.test('Translated from Spanish'));
  assert.ok(Object.keys(L.WORDS).includes('en'));
});

test('the master switch is a setting that is on unless it was turned off, and is kept only when it is off', () => {
  const S = require('../src/settings.js');
  assert.equal(S.normalize().enabled, true);
  assert.equal(S.normalize({ enabled: false }).enabled, false);
  assert.equal(S.normalize({ enabled: 'nonsense' }).enabled, true);
  assert.deepEqual(Object.keys(S.diff(S.normalize({ enabled: false })).set).filter((k) => k !== 'v'), ['enabled']);
  assert.ok(S.diff(S.normalize()).clear.includes('enabled'));
});

test('the keys of a post\'s panel: the defaults, and a person\'s own choices with whatever cannot work ignored', () => {
  const S = require('../src/settings.js');
  assert.deepEqual(S.panelKeyMap(''), { open: 'enter', like: 'a', bookmark: 's', repost: 'w', download: 'e', share: 'q', reply: 'c', mute: 'm', parent: 'u' });
  assert.equal(S.panelKeyMap('{"open":"O"}').open, 'o'); assert.equal(S.panelKeyMap('{"like":"Enter"}').like, 'a', 'Enter is only for opening a post'); assert.equal(S.keyLabel('enter'), 'Enter');
  assert.equal(S.panelKeyMap('{"like":"F"}').like, 'f', 'a capital is the same key');
  assert.equal(S.panelKeyMap('{"like":"ab"}').like, 'a', 'two characters: the default stays');
    assert.equal(S.panelKeyMap('{"zzz":"x"}').zzz, undefined, 'an action that is not one');
  assert.equal(S.panelKeyMap('not json').like, 'a');
  const taken = S.panelKeyMap('{"like":"s"}');
  assert.equal(taken.like, 's'); assert.equal(taken.bookmark, undefined, 'a key is for one action: the one whose default it was loses it until it is moved');
  assert.equal(new Set(Object.values(S.panelKeyMap('{"like":"x","bookmark":"x"}'))).size, Object.keys(S.panelKeyMap('{"like":"x","bookmark":"x"}')).length, 'no two share a key');
  assert.ok(S.okKey('a') && S.okKey('7') && S.okKey(',') && !S.okKey(' ') && !S.okKey('') && !S.okKey('Escape'));
});

test('settings: Reels sets the panel to play with sound and go on, and the Show list it also sets is not what makes it the one ticked', () => {
  const reels = S.PRESETS.find((p) => p.id === 'reels');
  assert.deepEqual([reels.set.panelVideo, reels.set.videoEnd, reels.set.skipSeen, reels.set.keysAdvance, reels.set.autoplayVideo], ['sound', 'loop', true, true, S.DEFAULTS.autoplayVideo]);
  assert.equal(reels.once.filter, 'media');
  assert.equal(S.PRESETS.find((p) => p.id === 'media').once.filter, 'media', 'Media wall shows only media, as its line says');
  assert.deepEqual(S.PRESETS.map((p) => p.blurb), ['Your X feed in columns', 'See posts from only people you follow', 'See only media', 'Scroll through posts, one at a time']);
  assert.ok(!('filter' in reels.set), 'changing the Show list afterwards does not untick it');
  for (const p of S.PRESETS.filter((q) => q.id !== 'reels')) assert.equal(p.set.panelVideo, S.DEFAULTS.panelVideo, p.id + ' puts the panel back');
  const n = S.normalize({ panelVideo: 'loud', videoEnd: 'next', skipSeen: 'yes', prefetchNext: false });
  assert.deepEqual([n.panelVideo, n.videoEnd, n.skipSeen, n.prefetchNext], [S.DEFAULTS.panelVideo, 'next', S.DEFAULTS.skipSeen, false], 'a value that is not one of the choices is put back');
});

test('attachments: up to four pictures, or one GIF or video, never both; other files are refused with a reason', () => {
  const ph = { type: 'image/png' }, jp = { type: 'image/jpeg' }, gif = { type: 'image/gif' }, mp4 = { type: 'video/mp4' }, pdf = { type: 'application/pdf' };
  assert.deepEqual(L.attachPlan([], [ph, jp, ph, jp, ph]), { taken: [0, 1, 2, 3], notes: ['Four pictures at most.'] });
  assert.deepEqual(L.attachPlan([ph, ph, ph], [jp, jp]), { taken: [0], notes: ['Four pictures at most.'] });
  assert.deepEqual(L.attachPlan([], [gif]), { taken: [0], notes: [] });
  assert.deepEqual(L.attachPlan([], [mp4, gif]), { taken: [0], notes: ['One GIF or video at most.'] });
  assert.deepEqual(L.attachPlan([ph], [mp4]), { taken: [], notes: ['A GIF or a video goes alone, without pictures.'] });
  assert.deepEqual(L.attachPlan([mp4], [ph]), { taken: [], notes: ['A GIF or a video goes alone.'] });
  assert.deepEqual(L.attachPlan([], [pdf, ph]).taken, [1]);
  assert.match(L.attachPlan([], [pdf]).notes[0], /can.t be attached/);
  assert.deepEqual(L.attachPlan([], []), { taken: [], notes: [] });
});

test('X\'s own viewer is recognised by its address: the post, picture or video, and which one', () => {
  assert.deepEqual(L.viewerRoute('/someone/status/2108686576624562639/photo/2'), { id: '2108686576624562639', kind: 'photo', n: 2 });
  assert.deepEqual(L.viewerRoute('/i/status/123/video/1/'), { id: '123', kind: 'video', n: 1 });
  assert.equal(L.viewerRoute('/someone/status/123'), null);
  assert.equal(L.viewerRoute('/someone/status/123/photo'), null);
  assert.equal(L.viewerRoute('/someone/status/123/quotes'), null);
  assert.equal(L.viewerRoute(''), null);
});

// ---- search and narrowing on Likes and Bookmarks ----
const mkPost = (o) => Object.assign({ id: '1', key: '1', author: { name: 'Ann Lee', handle: 'AnnLee', avatar: 'a.png' }, segs: [{ t: 'text', v: 'a walk in the park' }], media: [], quoted: null, card: null, repostedBy: null, replyTo: '', sensitive: false }, o);

test('Likes is a profile’s own tab, and only that', () => {
  assert.equal(L.isLikesPage('/me/likes'), true);
  assert.equal(L.isLikesPage('/me/likes/'), true);
  assert.equal(L.isLikesPage('/me'), false);
  assert.equal(L.isLikesPage('/me/media'), false);
  assert.equal(L.isLikesPage('/i/likes'), false);
  assert.equal(L.isLikesPage(''), false);
});

test('a search needs every word, anywhere in the post, its quote, its picture’s description, its link card or the names', () => {
  const p = mkPost({ quoted: mkPost({ id: '2', author: { name: 'Bo', handle: 'bo', avatar: '' }, segs: [{ t: 'text', v: 'violins and cellos' }] }), media: [{ type: 'photo', alt: 'a heron over water' }], card: { title: 'Field notes', desc: 'on birds', url: '#' } });
  const m = (q) => L.findMatch(p, { q, accounts: [], kinds: [] });
  assert.equal(m('walk park'), true);
  assert.equal(m('WALK'), true);
  assert.equal(m('walk zebra'), false);
  assert.equal(m('cellos'), true); // the quoted post
  assert.equal(m('heron'), true); // the picture’s description
  assert.equal(m('field notes'), true); // the link card
  assert.equal(m('annlee'), true); // the handle
  assert.equal(m('ann lee'), true); // the name
  assert.equal(m('   '), true); // nothing asked
  assert.equal(L.findMatch(mkPost({ quoted: { unavailable: true } }), { q: 'park', accounts: [], kinds: [] }), true);
});

test('accounts are any-of, kinds are any-of, and the three groups are all asked', () => {
  const pic = mkPost({ id: '1', media: [{ type: 'photo' }] });
  const vid = mkPost({ id: '2', author: { name: 'Bo', handle: 'Bo', avatar: '' }, media: [{ type: 'video' }, { type: 'gif' }] });
  const link = mkPost({ id: '3', author: { name: 'Cy', handle: 'cy', avatar: '' }, segs: [{ t: 'text', v: 'see' }, { t: 'url', href: 'https://example.org', label: 'example.org' }] });
  const text = mkPost({ id: '4', author: { name: 'Cy', handle: 'cy', avatar: '' } });
  const poll = mkPost({ id: '5', card: { poll: true } });
  const f = (o) => [pic, vid, link, text, poll].filter((t) => L.findMatch(t, Object.assign({ q: '', accounts: [], kinds: [] }, o))).map((t) => t.id);
  assert.deepEqual(f({}), ['1', '2', '3', '4', '5']);
  assert.deepEqual(f({ kinds: ['pictures'] }), ['1']);
  assert.deepEqual(f({ kinds: ['video'] }), ['2']);
  assert.deepEqual(f({ kinds: ['links'] }), ['3']);
  assert.deepEqual(f({ kinds: ['pictures', 'video'] }), ['1', '2']);
  assert.deepEqual(f({ accounts: ['cy'] }), ['3', '4']);
  assert.deepEqual(f({ accounts: ['cy', 'bo'] }), ['2', '3', '4']);
  assert.deepEqual(f({ accounts: ['cy'], kinds: ['links'] }), ['3']);
  assert.deepEqual(f({ accounts: ['cy'], q: 'see' }), ['3']);
  assert.equal(L.findOn({ q: ' ', accounts: [], kinds: [] }), false);
  assert.equal(L.findOn({ q: '', accounts: ['x'], kinds: [] }), true);
  assert.equal(L.findOn(null), false);
});

test('the account chips count what the words and kinds let through, most first, and leave out what the settings hide', () => {
  const by = (h, n, extra) => Array.from({ length: n }, (_, i) => mkPost(Object.assign({ id: h + i, author: { name: h.toUpperCase(), handle: h, avatar: '' } }, extra)));
  const items = [].concat(by('ann', 3), by('bo', 5, { media: [{ type: 'photo' }] }), by('cy', 1), by('dee', 5, { segs: [{ t: 'text', v: 'zebra' }] }));
  assert.deepEqual(L.findAccounts(items, { q: '', accounts: [], kinds: [] }, 8).map((a) => [a.handle, a.n]), [['bo', 5], ['dee', 5], ['ann', 3], ['cy', 1]]);
  assert.deepEqual(L.findAccounts(items, { q: '', accounts: [], kinds: ['pictures'] }, 8).map((a) => [a.handle, a.n]), [['bo', 5]]);
  assert.deepEqual(L.findAccounts(items, { q: 'zebra', accounts: [], kinds: [] }, 8).map((a) => [a.handle, a.n]), [['dee', 5]]);
  assert.deepEqual(L.findAccounts(items, { q: '', accounts: ['ann'], kinds: [] }, 8).map((a) => a.handle), ['bo', 'dee', 'ann', 'cy'], 'the choice of an account does not empty the others');
  assert.equal(L.findAccounts(items, { q: '', accounts: [], kinds: [] }, 2).length, 2);
  assert.deepEqual(L.findAccounts(items, { q: '', accounts: [], kinds: [] }, 8, (t) => t.author.handle !== 'bo').map((a) => a.handle), ['dee', 'ann', 'cy']);
});

test('passes: a find narrows the posts, and none is the same as before', () => {
  const posts = [mkPost({ id: '1' }), mkPost({ id: '2', segs: [{ t: 'text', v: 'zebra crossing' }] })];
  const keep = (find) => posts.filter((t) => L.passes(t, ctx(find === undefined ? {} : { find }))).map((t) => t.id);
  assert.deepEqual(keep(), ['1', '2']);
  assert.deepEqual(keep(null), ['1', '2']);
  assert.deepEqual(keep({ q: 'zebra', accounts: [], kinds: [] }), ['2']);
});

test('the find bar is a setting, on by default', () => {
  assert.equal(S.DEFAULTS.findBar, true);
});
