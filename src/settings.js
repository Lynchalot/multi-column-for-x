// Every user setting, in one place. The options page builds its UI from SCHEMA and the content script
// reads DEFAULTS/normalize, so adding a setting is one entry here (plus whatever makes it do something).
var XMCSettings = (function () {
  'use strict';

  const SHOW_TAB_HIDE = [['show', 'Show in the timeline'], ['tab', 'Move to its own tab'], ['hide', 'Hide']];
  const SHOW_HIDE = [['show', 'Show'], ['hide', 'Hide']];
  const nav = (key, label) => ({ key, type: 'bool', def: false, label, native: true });

  // native: true  => restyles X's own interface with CSS, so it depends on X's current markup and may
  //                  need a tweak when X redesigns.
  const SCHEMA = [
    { id: 'presets', title: 'Presets', custom: 'presets', items: [
      { key: 'enabled', type: 'bool', def: true, label: 'Enabled', hidden: true }, // the master switch: drawn at the top of every settings page by options.js, not in a section
    ] },
    {
      id: 'columns', title: 'Columns', items: [
        { key: 'cols', type: 'number', min: 0, max: 8, def: 0, label: 'Number of columns', help: '0 = automatic.' },
        { key: 'maxAutoCols', type: 'number', min: 1, max: 8, def: 5, label: 'Most columns when automatic' },
        { key: 'minColWidth', type: 'number', min: 280, max: 900, def: 500, label: 'Column width when automatic (px)' },
        { key: 'density', type: 'select', def: 'normal', label: 'Post size', hidden: true, options: [['normal', 'Normal'], ['compact', 'Compact (tighter, smaller pictures)'], ['text', 'Text only (pictures and video behind a click)']] },
        { key: 'perPageLayout', type: 'bool', def: false, label: 'Remember columns separately for each page', help: 'Home, Search, Lists, Bookmarks and profiles each keep the column count you last picked in the top bar.' },
      ],
    },
    {
      id: 'reading', title: 'Reading', custom: 'reading', items: [
        { key: 'seen', type: 'select', def: 'off', label: 'Posts I\u2019ve already read', options: [['off', 'Leave them alone'], ['dim', 'Fade them'], ['hide', 'Hide them']],
          help: 'On Home and Lists. A post counts as read after you\u2019ve looked at it for a second. Remembered on this device only.' },
        { key: 'skipSeen', type: 'bool', def: false, label: 'Skip posts I\u2019ve already read when stepping through posts in a panel', help: 'The arrow keys and the next-post button. Remembered on this device only.' },
        { key: 'collapseReposts', type: 'bool', def: false, label: 'Show a post once when several people repost it', help: 'Folded into one card: \u201cA, B and 2 others reposted\u201d.' },
        { key: 'foldThreads', type: 'bool', def: true, label: 'Fold a person\u2019s thread into one card', help: 'Their replies to themselves sit under the first post, behind one line.' },
      ],
    },
    {
      id: 'timeline', title: 'Home timeline', items: [
        { key: 'homeDefault', type: 'select', def: 'following', label: 'Open Home on', options: [['following', 'Following (newest first)'], ['forYou', 'For you'], ['remember', 'Whatever X picks']] },
        { key: 'keepFollowing', type: 'bool', def: true, label: 'Switch back to Following if X moves me to For you' },
        { key: 'repostsHome', type: 'select', def: 'tab', label: 'Reposts', options: SHOW_TAB_HIDE },
        { key: 'quotesHome', type: 'select', def: 'show', label: 'Quote posts', options: SHOW_TAB_HIDE },
        { key: 'repliesHome', type: 'select', def: 'show', label: 'Replies', options: SHOW_TAB_HIDE },
        { key: 'repostsProfile', type: 'select', def: 'show', label: 'Reposts on profiles', options: SHOW_HIDE },
        { key: 'repostsLists', type: 'select', def: 'show', label: 'Reposts in Lists', options: SHOW_HIDE },
        { key: 'searchLatest', type: 'bool', def: false, label: 'Open Search on “Latest”' },
        { key: 'disableHome', type: 'bool', def: false, label: 'Disable the Home timeline entirely', help: 'Shows a calm placeholder instead.' },
      ],
    },
    {
      id: 'algorithm', title: 'Algorithmic content', items: [
        { key: 'hideForYou', type: 'bool', def: true, label: 'Hide the \u201cFor you\u201d tab' },
        { key: 'onlyFollowed', type: 'bool', def: false, label: 'Only show posts from accounts I follow', help: 'Hides suggested posts.' },
        nav('hideTrending', 'Hide \u201cWhat\u2019s happening\u201d / Trending in the sidebar'),
        nav('hideWhoToFollow', 'Hide \u201cWho to follow\u201d suggestions'),
        nav('hideTopics', 'Hide \u201cTopics to follow\u201d suggestions'),
        nav('hideDiscoverMore', 'Hide \u201cDiscover more\u201d and similar suggested posts'),
        nav('hidePremiumPromo', 'Hide Premium (the subscribe box)'),
      ],
    },
    {
      id: 'muting', title: 'Muting & filtering', items: [
        { key: 'mutedWords', type: 'text', def: '', label: 'Muted words and phrases', help: 'Separate with comma.' },
        { key: 'mutedAccounts', type: 'text', def: '', label: 'Muted accounts', help: 'Comma separated @handles. Hides their posts, their reposts and quotes of them.' },
        { key: 'hideMutedQuotes', type: 'bool', def: true, label: 'Hide quotes of accounts I’ve blocked or muted on X' },
        { key: 'hideBlueReplies', type: 'bool', def: false, label: 'Hide replies from paid-verified accounts' },
        { key: 'blueBadge', type: 'select', def: 'show', label: 'Paid-verified checkmark', options: [['show', 'Show'], ['logo', 'Replace with the bird logo'], ['hide', 'Hide']] },
      ],
    },
    {
      id: 'posts', title: 'Posts', items: [
        { key: 'profileHeader', type: 'bool', def: true, label: 'Show a profile\u2019s header above its posts', help: 'Name, bio and follower counts.' },
        { key: 'fetchContext', type: 'bool', def: true, label: 'Look up the post a reply answers when X did not send it', help: 'Done out of sight, one at a time, for replies you have been looking at.' },
        { key: 'commentsIn', type: 'select', def: 'panel', label: 'Open comments', options: [['panel', 'In the post panel'], ['card', 'Inside the card']] },
        { key: 'bigText', type: 'bool', def: true, label: 'Set short posts that are only words in larger type' },
        { key: 'hoverVideo', type: 'bool', def: true, label: 'Play a muted preview when I point at a video' },
        { key: 'hoverActions', type: 'bool', def: true, label: 'Show like, repost and save on a picture when I point at it' },
        { key: 'tallPhotos', type: 'select', def: 'cap', label: 'Tall pictures', options: [['cap', 'Trim to fit (click to see all of it)'], ['full', 'Show in full']] },
        { key: 'counts', type: 'bool', def: true, label: 'Show reply, repost and like counts' },
        { key: 'hideViews', type: 'bool', def: false, label: 'Hide view counts' },
        { key: 'hideBookmarkBtn', type: 'bool', def: false, label: 'Hide the bookmark button' },
        { key: 'hideShareBtn', type: 'bool', def: false, label: 'Hide the copy-link button' },
        { key: 'tidyReplies', type: 'bool', def: true, label: 'Fewer buttons on replies', help: 'On a post\u2019s own page, hides the Bookmark and Grok buttons under every reply.', native: true },
        { key: 'nativeTools', type: 'bool', def: true, label: 'Download and Copy-link buttons on X\u2019s own pages', native: true },
        { key: 'reducedInteraction', type: 'bool', def: false, label: 'Reduced interaction mode', help: 'Hides the reply, repost and like buttons and all counts.' },
        { key: 'showSource', type: 'bool', def: false, label: 'Show which app a post was sent from' },
        { key: 'autoTranslate', type: 'bool', def: true, label: 'Show X\u2019s own translations of posts in other languages', help: 'When X has already translated a post on its page it is shown translated here, with \u201cShow original\u201d.' },
        { key: 'nsfw', type: 'select', def: 'blur', label: 'Sensitive media', options: [['blur', 'Blur until I click'], ['show', 'Show'], ['hide', 'Hide those posts']], help: 'Also applies on X\u2019s own pages (a post, a profile), where Hide leaves the picture out.' },
        { key: 'skipAgeCheck', type: 'bool', def: true, label: 'Skip X\u2019s age check on sensitive media', help: 'Turns off the flag that makes X ask for age verification, so its older \u201csensitive content\u201d notice (which the setting above handles) shows instead. Reload X after changing it.' },
        { key: 'autoplayVideo', type: 'select', def: 'off', label: 'Videos', options: [['off', 'Play when I click'], ['muted', 'Autoplay muted while on screen']] },
        { key: 'panelVideo', type: 'select', def: 'off', label: 'Videos in a post\u2019s panel', options: [['off', 'Play when I click'], ['muted', 'Play at once, muted'], ['sound', 'Play at once, with the sound as I left it']] },
        { key: 'videoEnd', type: 'select', def: 'stop', label: 'When a video in the panel ends', options: [['stop', 'Stop'], ['loop', 'Play it again'], ['next', 'Go to the next post']] },
        { key: 'prefetchNext', type: 'bool', def: true, label: 'Get the next post ready while a post is open', help: 'Its pictures, and its comments when the rate of lookups allows.' },
        { key: 'openIn', type: 'select', def: 'view', label: 'Open posts and profiles', options: [['view', 'Posts in a panel over the columns, profiles in a new tab'], ['newtab', 'In a new tab (you keep your place here)'], ['sametab', 'In this tab']] },
        { key: 'blurBehind', type: 'bool', def: true, label: 'Blur the columns behind an open post', help: 'Turns itself off if your computer struggles with it.' },
        { key: 'commentSort', type: 'select', def: 'relevant', label: 'Order comments by', options: [['relevant', 'Relevant (as X ranks them)'], ['recent', 'Most recent'], ['likes', 'Most liked']] },
        { key: 'systemFont', type: 'bool', def: false, label: 'Use my system font instead of X’s Chirp font' },
      ],
    },
    {
      id: 'sidebar', title: 'Navigation & sidebar', blurb: 'These restyle X\u2019s own pages, so they depend on X\u2019s current layout.', custom: 'nav', items: [
        { key: 'leftPanel', type: 'select', def: 'full', label: 'Left menu, while the columns are showing', options: [['full', 'With names'], ['rail', 'Icons only (the logo at its top folds it)']] },
        { key: 'rightPanel', type: 'select', def: 'shown', label: 'Right panel (search, trends, who to follow)', options: [['shown', 'Shown'], ['hidden', 'Slid away (a tab on the edge brings it back)']] },
        { key: 'hideSidebar', type: 'bool', def: false, label: 'Hide X\u2019s right-hand sidebar (search, trends, who to follow)', native: true },
        { key: 'hideTweetButton', type: 'bool', def: false, label: 'Hide the big \u201cPost\u201d button', native: true },
        { key: 'navBookmarks', type: 'bool', def: false, label: 'Add Bookmarks to X\u2019s left menu' },
        { key: 'navLikes', type: 'bool', def: false, label: 'Add Likes to X\u2019s left menu' },
        { key: 'navLists', type: 'bool', def: false, label: 'Add Lists to X\u2019s left menu' },
        { key: 'hideGrokDrawer', type: 'bool', def: false, label: 'Hide the floating Grok button', native: true },
        { key: 'hideDmDrawer', type: 'bool', def: false, label: 'Hide the floating Chat button', native: true },
        { key: 'navFont', type: 'select', def: 'default', label: 'Sidebar font weight', native: true, options: [['default', 'X\u2019s default (bold)'], ['normal', 'Normal']] },
        { key: 'navDensity', type: 'select', def: 'default', label: 'Sidebar spacing', native: true, options: [['compact', 'Compact'], ['default', 'X\u2019s default'], ['comfortable', 'Roomy']] },
        nav('hideVerifiedTabs', 'Hide the \u201cVerified\u201d tabs in Notifications and Followers'),
      ],
    },
    {
      id: 'look', title: 'Look', items: [
        { key: 'branding', type: 'select', def: 'x', label: 'Name and logo', native: true, options: [['x', 'X (as X ships it)'], ['twitter', 'Twitter (bird logo, “Tweet”, “Retweet”)']] },
        { key: 'textSize', type: 'select', def: 'normal', label: 'Text size in posts and the post panel', options: [['small', 'Smaller'], ['normal', 'Normal'], ['large', 'Larger'], ['xlarge', 'Largest']] },
        { key: 'cardStyle', type: 'select', def: 'raised', label: 'Card background', options: [['raised', 'Slightly lighter (or darker) than the page'], ['flat', 'None']] },
        { key: 'customCss', type: 'textarea', def: '', label: 'Custom CSS', help: 'Added to every x.com page.', native: true },
      ],
    },
    {
      id: 'keys', title: 'Keyboard', custom: 'keys', items: [
        { key: 'panelKeys', type: 'bool', def: true, label: 'Keyboard shortcuts in a post\u2019s panel and the picture viewer', help: 'Only while a panel or the viewer is open and nothing is being typed into. The arrow keys are always on.' },
        { key: 'keysAdvance', type: 'bool', def: false, label: 'Move to the next post after the Like, Bookmark or Repost key' },
        { key: 'keyMap', type: 'text', def: '', label: 'Keys that are not the defaults', hidden: true }, // a JSON object, action to key, written by the Keyboard section
        { key: 'keysHintSeen', type: 'bool', def: false, label: 'The keys were pointed out', hidden: true },
      ],
    },
    {
      id: 'downloads', title: 'Downloads', items: [
        { key: 'dlFolder', type: 'text', def: 'X', label: 'Folder to save into', help: 'A folder inside your browser\u2019s download folder, e.g. X or Pictures/X. Browsers can only save inside it; to use another place tick \u201cAsk me where to save\u201d below, or change the download folder in Firefox\u2019s own settings.' },
        { key: 'dlAsk', type: 'bool', def: false, label: 'Ask me where to save each file', help: 'Opens your computer\u2019s save dialog every time, so you can choose Pictures, Videos, Documents\u2026 anywhere.' },
        { key: 'dlByAccount', type: 'bool', def: false, label: 'Also put each account’s media in its own folder' },
        { key: 'dlPattern', type: 'text', def: '{account}-{tweetId}-{serial}', label: 'File name pattern',
          help: 'Tokens: {account} {name} {tweetId} {serial} {hash} {date} {time} {datetime}.' },
        { key: 'dlSuffix', type: 'text', def: 'twitter', label: 'Add this to the end of every file name', hidden: true }, // kept ("-twitter" at the end of file names), not shown
        { key: 'dlHistory', type: 'bool', def: true, label: 'Remember what I’ve downloaded', help: 'Marks the button on posts you have already saved.' },
      ],
    },
    {
      id: 'trouble', title: 'Troubleshooting', custom: 'status', items: [
        { key: 'keepLog', type: 'bool', def: true, label: 'Keep a short log for Copy diagnostics', help: 'The last 300 or so events (kinds and post numbers, no post text) stay in your browser, so a problem is still there after a reload. Nothing is sent anywhere. Turning this off deletes the log.' },
      ],
    },
  ];

  // saved state that isn't edited on the options page
  const INTERNAL = { filter: 'all', mutedQuoteIds: [], hiddenNav: [], navItems: [], pageLayouts: {}, volume: 1, videoMuted: false, hintSeen: false };

  const DEFAULTS = Object.assign({}, INTERNAL);
  const ITEMS = {};
  for (const sec of SCHEMA) for (const it of sec.items) { DEFAULTS[it.key] = it.def; ITEMS[it.key] = it; }

  const PAGES = ['home', 'search', 'explore', 'bookmarks', 'list', 'profile']; // the kinds of page (see routeKind in logic.js)

  // saved lists come from storage, so check them rather than trust them
  function cleanInternal(key, v, fallback) {
    if (key === 'filter') return typeof v === 'string' ? v.slice(0, 20) : fallback;
    if (key === 'pageLayouts') { // { home: { cols, density }, ... }
      const out = {};
      if (!v || typeof v !== 'object' || Array.isArray(v)) return fallback;
      for (const where of PAGES) {
        const e = v[where];
        if (!e || typeof e !== 'object') continue;
        const own = {};
        if (typeof e.cols === 'number' && Number.isFinite(e.cols)) own.cols = Math.max(0, Math.min(8, Math.round(e.cols)));
        if (ITEMS.density.options.some(([val]) => val === e.density)) own.density = e.density;
        if (Object.keys(own).length) out[where] = own;
      }
      return out;
    }
    if (key === 'volume') return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : fallback;
    if (key === 'hintSeen') return typeof v === 'boolean' ? v : fallback;
    if (key === 'videoMuted') return typeof v === 'boolean' ? v : fallback;
    if (key === 'navItems') {
      return Array.isArray(v) ? v.filter((i) => i && typeof i.key === 'string' && typeof i.label === 'string')
        .slice(0, 60).map((i) => ({ key: i.key.slice(0, 200), label: i.label.slice(0, 60) })) : fallback;
    }
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 500).map((x) => x.slice(0, 200)) : fallback;
  }

  // Bump when a default changes: values saved by older versions for those keys were never a choice
  // (older versions saved everything), so they're dropped rather than allowed to pin the old default.
  const VERSION = 10;
  const DEFAULT_CHANGED_IN = { 2: ['hideDmDrawer'], 6: ['hideDmDrawer', 'hideGrokDrawer'], 7: ['hideDmDrawer', 'hideGrokDrawer'], 8: ['hideDmDrawer', 'hideGrokDrawer'], 9: ['openIn'], 10: ['branding'] };
  // the old default of a setting, as older versions saved it: dropped (it was never a choice) so the new default applies
  const OLD_DEFAULTS = { 3: { dlPattern: 'X/{account}/{tweetId}-{serial}' }, 4: { dlFolder: '' }, 5: { minColWidth: 440 } };

  // What to store: only what differs from the defaults (so a future default change reaches everyone),
  // and the keys to clear because they're back at their default.
  function diff(settings) {
    const set = { v: VERSION }, clear = [];
    for (const k of Object.keys(DEFAULTS)) {
      if (JSON.stringify(settings[k]) !== JSON.stringify(DEFAULTS[k])) set[k] = settings[k]; else clear.push(k);
    }
    return { set, clear };
  }

  function normalize(raw) {
    const out = Object.assign({}, DEFAULTS, { mutedQuoteIds: [], hiddenNav: [], navItems: [], pageLayouts: {} });
    if (!raw || typeof raw !== 'object') return out;
    const from = Number(raw.v) || 0;
    for (const [ver, keys] of Object.entries(DEFAULT_CHANGED_IN)) {
      if (from < Number(ver)) { raw = Object.assign({}, raw); for (const k of keys) delete raw[k]; }
    }
    for (const [ver, olds] of Object.entries(OLD_DEFAULTS)) {
      if (from < Number(ver)) { raw = Object.assign({}, raw); for (const [k, old] of Object.entries(olds)) if (raw[k] === old) delete raw[k]; }
    }
    if (raw.mutedWords === undefined && typeof raw.muted === 'string') raw = Object.assign({}, raw, { mutedWords: raw.muted }); // older versions
    if (raw.nsfw === undefined && raw.autoReveal === true) raw = Object.assign({}, raw, { nsfw: 'show' });
    for (const key of Object.keys(DEFAULTS)) {
      const v = raw[key];
      if (v === undefined) continue;
      const it = ITEMS[key];
      if (!it) { out[key] = cleanInternal(key, v, out[key]); continue; }
      if (it.type === 'bool') { if (typeof v === 'boolean') out[key] = v; }
      else if (it.type === 'number') { if (typeof v === 'number' && Number.isFinite(v)) out[key] = Math.max(it.min, Math.min(it.max, Math.round(v))); }
      else if (it.type === 'select') { if (it.options.some(([val]) => val === v)) out[key] = v; }
      else if (typeof v === 'string') out[key] = v.slice(0, 20000);
    }
    return out;
  }

  // Starting points offered on the settings page (and on first install). Each one sets every key that any of them touches, so exactly one
  // of them can match at a time (a preset that named only a few keys went on matching after another was picked, and the box ticked was
  // always the first of them: Media wall and Custom could not be chosen).
  const CONTENT_PLAIN = { hideForYou: false, homeDefault: 'remember', keepFollowing: false, onlyFollowed: false, hideTrending: false, hideWhoToFollow: false, hideTopics: false,
    hideDiscoverMore: false, hidePremiumPromo: false, seen: 'off', collapseReposts: false, foldThreads: false };
  const CONTENT_CALM = { hideForYou: true, homeDefault: 'following', keepFollowing: true, onlyFollowed: true, hideTrending: true, hideWhoToFollow: true, hideTopics: true,
    hideDiscoverMore: true, hidePremiumPromo: true, seen: 'dim', collapseReposts: true, foldThreads: true };
  const MEDIA_WALL = { autoplayVideo: 'muted', minColWidth: 380, maxAutoCols: 8, tallPhotos: 'cap', hideViews: true };
  const MEDIA_OFF = Object.fromEntries(Object.keys(MEDIA_WALL).map((k) => [k, DEFAULTS[k]]));
  const REELS = { panelVideo: 'sound', videoEnd: 'next', skipSeen: true, keysAdvance: true, prefetchNext: true };
  const REELS_OFF = Object.fromEntries(Object.keys(REELS).map((k) => [k, DEFAULTS[k]]));
  // `once` is what picking a preset also does, that is not part of what makes it the one ticked (the Show list is the person's to change afterwards)
  const PRESETS = [
    { id: 'plain', label: 'Just columns', blurb: 'Default X but laid out in columns.', set: Object.assign({}, CONTENT_PLAIN, MEDIA_OFF, REELS_OFF) },
    { id: 'calm', label: 'Calm', blurb: 'All algorithmic content disabled (only people you follow, no trends or suggestions).', set: Object.assign({}, CONTENT_CALM, MEDIA_OFF, REELS_OFF) },
    { id: 'media', label: 'Media wall', blurb: 'Narrower layout with more columns. Videos play muted as you scroll.', set: Object.assign({}, CONTENT_PLAIN, MEDIA_WALL, REELS_OFF) },
    { id: 'reels', label: 'Reels', blurb: 'Posts with pictures and video only. Press Enter, then keep going: videos play with sound and the next post follows when one ends; posts you have read are skipped.',
      set: Object.assign({}, CONTENT_PLAIN, MEDIA_OFF, REELS), once: { filter: 'media' } },
  ];
  // What a fresh install starts with: the Calm preset, stored as a person's own choices (so what is ticked on the settings page is Calm,
  // not "Custom"), and only what differs from the defaults
  const freshInstall = () => diff(Object.assign({}, DEFAULTS, PRESETS.find((p) => p.id === 'calm').set)).set;
  const presetApplies = (preset, settings) => Object.keys(preset.set).every((k) => JSON.stringify(settings[k]) === JSON.stringify(preset.set[k]));

  const words = (s) => String(s || '').split(/[,\n]/).map((w) => w.trim().toLowerCase()).filter(Boolean);
  const handles = (s) => words(s).map((w) => w.replace(/^@/, ''));

  // The panel's keys: what each does and its key out of the box (letters Vimium leaves alone), and the map a person's own choices make of them.
  const PANEL_KEY_ACTIONS = [['open', 'Open the first post in view'], ['like', 'Like'], ['bookmark', 'Bookmark'], ['repost', 'Repost'], ['download', 'Download'], ['share', 'Copy link'], ['reply', 'Comment']];
  const PANEL_KEY_DEFAULTS = { open: 'enter', like: 'a', bookmark: 's', repost: 'w', download: 'e', share: 'q', reply: 'c' };
  const okKey = (k) => k === 'enter' || (typeof k === 'string' && k.length === 1 && k.trim() === k && /[\p{L}\p{N}.,;'\[\]\-=\/\\`]/u.test(k));
  const keyLabel = (k) => (k === 'enter' ? 'Enter' : String(k || '').toUpperCase());
  // text (the JSON in `keyMap`) -> { like: 'a', ... } for every action: an unknown action, a key that is not one printable character, or a key already
  // taken by another action is ignored, and that action keeps its default (or, if its default was taken, nothing).
  function panelKeyMap(text) {
    let mine = {};
    try { const v = JSON.parse(text || '{}'); if (v && typeof v === 'object' && !Array.isArray(v)) mine = v; } catch { /* the defaults */ }
    const out = {}, used = new Set();
    for (const [act] of PANEL_KEY_ACTIONS) { const k = typeof mine[act] === 'string' ? mine[act].toLowerCase() : ''; if (okKey(k) && !(k === 'enter' && act !== 'open') && !used.has(k)) { out[act] = k; used.add(k); } } // (Enter is only for opening a post from the feed: in a panel it is a button's and the picture's)
    for (const [act] of PANEL_KEY_ACTIONS) if (!out[act] && !used.has(PANEL_KEY_DEFAULTS[act])) { out[act] = PANEL_KEY_DEFAULTS[act]; used.add(out[act]); }
    return out;
  }

  const api = { SCHEMA, DEFAULTS, INTERNAL, VERSION, PRESETS, presetApplies, freshInstall, normalize, diff, words, handles, PANEL_KEY_ACTIONS, PANEL_KEY_DEFAULTS, panelKeyMap, okKey, keyLabel };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  return api;
})();
