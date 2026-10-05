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
        { key: 'collapseReposts', type: 'bool', def: false, label: 'Show a post once when several people repost it', help: 'Folded into one card: \u201cA, B and 2 others reposted\u201d.' },
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
        { key: 'counts', type: 'bool', def: true, label: 'Show reply, repost and like counts' },
        { key: 'hideViews', type: 'bool', def: false, label: 'Hide view counts' },
        { key: 'hideBookmarkBtn', type: 'bool', def: false, label: 'Hide the bookmark button' },
        { key: 'hideShareBtn', type: 'bool', def: false, label: 'Hide the copy-link button' },
        { key: 'tidyReplies', type: 'bool', def: true, label: 'Fewer buttons on replies', help: 'On a post\u2019s own page, hides the Bookmark and Grok buttons under every reply.', native: true },
        { key: 'nativeTools', type: 'bool', def: true, label: 'Download and Copy-link buttons on X\u2019s own pages', native: true },
        { key: 'reducedInteraction', type: 'bool', def: false, label: 'Reduced interaction mode', help: 'Hides the reply, repost and like buttons and all counts.' },
        { key: 'quotesLink', type: 'bool', def: false, label: 'Show a “Quotes” link under posts that have been quoted' },
        { key: 'showSource', type: 'bool', def: false, label: 'Show which app a post was sent from' },
        { key: 'nsfw', type: 'select', def: 'blur', label: 'Sensitive media', options: [['blur', 'Blur until I click'], ['show', 'Show'], ['hide', 'Hide those posts']] },
        { key: 'autoplayVideo', type: 'select', def: 'off', label: 'Videos', options: [['off', 'Play when I click'], ['muted', 'Autoplay muted while on screen']] },
        { key: 'openIn', type: 'select', def: 'newtab', label: 'Open posts and profiles', options: [['newtab', 'In a new tab (you keep your place here)'], ['sametab', 'In this tab']] },
        { key: 'commentSort', type: 'select', def: 'relevant', label: 'Order comments by', options: [['relevant', 'Relevant (as X ranks them)'], ['recent', 'Most recent'], ['likes', 'Most liked']] },
        { key: 'systemFont', type: 'bool', def: false, label: 'Use my system font instead of X’s Chirp font' },
      ],
    },
    {
      id: 'sidebar', title: 'Navigation & sidebar', blurb: 'These restyle X\u2019s own pages, so they depend on X\u2019s current layout.', custom: 'nav', items: [
        { key: 'hideSidebar', type: 'bool', def: false, label: 'Hide X\u2019s right-hand sidebar (search, trends, who to follow)', native: true },
        { key: 'hideTweetButton', type: 'bool', def: false, label: 'Hide the big \u201cPost\u201d button', native: true },
        { key: 'hideGrokDrawer', type: 'bool', def: false, label: 'Hide the floating Grok button', help: 'Grok is in the left menu too.', native: true },
        { key: 'hideDmDrawer', type: 'bool', def: false, label: 'Hide the floating Chat button', help: 'Chat is in the left menu too.', native: true },
        { key: 'navFont', type: 'select', def: 'default', label: 'Sidebar font weight', native: true, options: [['default', 'X\u2019s default (bold)'], ['normal', 'Normal']] },
        { key: 'navDensity', type: 'select', def: 'default', label: 'Sidebar spacing', native: true, options: [['compact', 'Compact'], ['default', 'X\u2019s default'], ['comfortable', 'Roomy']] },
        nav('hideVerifiedTabs', 'Hide the \u201cVerified\u201d tabs in Notifications and Followers'),
      ],
    },
    {
      id: 'look', title: 'Look', items: [
        { key: 'branding', type: 'select', def: 'twitter', label: 'Name and logo', native: true, options: [['twitter', 'Twitter (bird logo, “Tweet”, “Retweet”)'], ['x', 'X (as X ships it)']] },
        { key: 'customCss', type: 'textarea', def: '', label: 'Custom CSS', help: 'Added to every x.com page.', native: true },
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
  ];

  // saved state that isn't edited on the options page
  const INTERNAL = { filter: 'all', mutedQuoteIds: [], hiddenNav: [], navItems: [], pageLayouts: {} };

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
    if (key === 'navItems') {
      return Array.isArray(v) ? v.filter((i) => i && typeof i.key === 'string' && typeof i.label === 'string')
        .slice(0, 60).map((i) => ({ key: i.key.slice(0, 200), label: i.label.slice(0, 60) })) : fallback;
    }
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 500).map((x) => x.slice(0, 200)) : fallback;
  }

  // Bump when a default changes: values saved by older versions for those keys were never a choice
  // (older versions saved everything), so they're dropped rather than allowed to pin the old default.
  const VERSION = 8;
  const DEFAULT_CHANGED_IN = { 2: ['hideDmDrawer'], 6: ['hideDmDrawer', 'hideGrokDrawer'], 7: ['hideDmDrawer', 'hideGrokDrawer'], 8: ['hideDmDrawer', 'hideGrokDrawer'] };
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

  const words = (s) => String(s || '').split(/[,\n]/).map((w) => w.trim().toLowerCase()).filter(Boolean);
  const handles = (s) => words(s).map((w) => w.replace(/^@/, ''));

  const api = { SCHEMA, DEFAULTS, INTERNAL, VERSION, normalize, diff, words, handles };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  return api;
})();
