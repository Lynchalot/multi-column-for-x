// The Vim key scheme: what the keys are, how a key press becomes a token, and how a sequence of tokens (j, g g, C-d) finds its action. Pure: no page, no DOM,
// so the settings page and the tests use it as the page does. Tokens: a printable character as it is typed (G is Shift+g), Space, Enter, Left Right Up Down,
// C-<letter> for Ctrl, S-<Space|Enter|arrow> for Shift with those. Esc is never bound (it closes things).
var XMCKeys = (function () {
  'use strict';

  // [action, what it does, group]. The group is how the settings page and the keys card set them out.
  const ACTIONS = [
    ['down', 'Scroll down (the comments, in a panel or Reels); in the viewer the next picture', 'Move'],
    ['up', 'Scroll up (the comments, in a panel or Reels); in the viewer the previous picture', 'Move'],
    ['left', 'Card to the left; in a panel the previous picture, then post', 'Move'],
    ['right', 'Card to the right; in a panel the next picture, then post', 'Move'],
    ['top', 'To the top (of the comments, in a panel or Reels)', 'Move'],
    ['bottom', 'To the bottom (of the comments, in a panel or Reels)', 'Move'],
    ['halfDown', 'Half a page down', 'Move'],
    ['halfUp', 'Half a page up', 'Move'],
    ['pageDown', 'A page down (plays or pauses a video in a panel)', 'Move'],
    ['pageUp', 'A page up', 'Move'],
    ['cardUp', 'Mark the card above; in a panel or Reels the previous post', 'Cards'],
    ['cardLeft', 'Mark the card to the left; in a panel or Reels the previous post', 'Cards'],
    ['cardDown', 'Mark the card below; in a panel or Reels the next post', 'Cards'],
    ['cardRight', 'Mark the card to the right; in a panel or Reels the next post', 'Cards'],
    ['open', 'Open the marked card in the panel (a picture full size in a panel)', 'Post'],
    ['like', 'Like', 'Post'],
    ['bookmark', 'Bookmark', 'Post'],
    ['repost', 'Repost', 'Post'],
    ['reply', 'Comment', 'Post'],
    ['share', 'Copy the link', 'Post'],
    ['download', 'Download', 'Post'],
    ['parent', 'Open the post this one quotes or answers (Esc comes back to this one)', 'Post'],
    ['reels', 'Reels from the marked card or the open post; in Reels, leave it', 'Reels and video'],
    ['mute', 'Mute or unmute the video', 'Reels and video'],
    ['fullscreen', 'The video in full screen', 'Reels and video'],
    ['tabPrev', 'The previous tab (For you, Following; a profile’s Posts, Replies, Media)', 'Tabs and tools'],
    ['tabNext', 'The next tab', 'Tabs and tools'],
    ['newPosts', 'Show the new posts', 'Tabs and tools'],
    ['search', 'X’s search box', 'Tabs and tools'],
    ['settings', 'The settings panel', 'Tabs and tools'],
    ['help', 'The card of keys', 'Tabs and tools'],
    ['goHome', 'Go to Home', 'Go to'],
    ['goExplore', 'Go to Explore', 'Go to'],
    ['goNotifications', 'Go to Notifications', 'Go to'],
    ['goProfile', 'Go to your profile', 'Go to'],
    ['goBookmarks', 'Go to Bookmarks', 'Go to'],
    ['goLists', 'Go to your Lists', 'Go to'],
    ['goMessages', 'Go to Messages', 'Go to'],
  ];
  const GROUPS = ['Move', 'Cards', 'Post', 'Reels and video', 'Tabs and tools', 'Go to'];

  const VIM = {
    down: 'j', up: 'k', left: 'h', right: 'l', top: 'g g', bottom: 'G', halfDown: 'C-d', halfUp: 'C-u', pageDown: 'Space', pageUp: 'S-Space',
    cardUp: 'w', cardLeft: 'a', cardDown: 's', cardRight: 'd', open: 'o',
    like: 'f', bookmark: 'b', repost: 't', reply: 'c', share: 'y', download: 'e', parent: 'u',
    reels: 'r', mute: 'm', fullscreen: 'v',
    tabPrev: '[', tabNext: ']', newPosts: '.', search: '/', settings: ',', help: '?',
    goHome: 'g h', goExplore: 'g e', goNotifications: 'g n', goProfile: 'g p', goBookmarks: 'g b', goLists: 'g l', goMessages: 'g m',
  };

  // A key press as a token ('' when it is only a modifier, or has Alt or Meta in it: those are the browser's and the extension's own)
  function token(e) {
    if (!e || e.altKey || e.metaKey) return '';
    let k = e.key;
    if (typeof k !== 'string' || !k) return '';
    if (k === ' ') k = 'Space';
    else if (k === 'Escape') k = 'Esc';
    else if (/^Arrow/.test(k)) k = k.slice(5);
    else if (/^(Shift|Control|Alt|Meta|AltGraph|CapsLock|Tab|Dead|Process|Unidentified|Backspace|Delete|Home|End|PageUp|PageDown|Insert|F\d+)$/.test(k)) return '';
    if (e.ctrlKey) return e.shiftKey ? '' : 'C-' + (k.length === 1 ? k.toLowerCase() : k); // (Ctrl+Shift is the browser's)
    if (e.shiftKey && k.length > 1 && k !== 'Esc') return 'S-' + k; // (Shift with a letter is already the capital: G)
    return k;
  }
  const okToken = (t) => typeof t === 'string' && (
    (t.length === 1 && t.trim() === t && !/[\u0000-\u001f\u007f]/.test(t)) ||
    /^(Space|Enter|Left|Right|Up|Down)$/.test(t) || /^C-[a-z]$/.test(t) || /^S-(Space|Enter|Left|Right|Up|Down)$/.test(t));
  // 'g g' -> ['g', 'g']; null when it is not a sequence of one or two good tokens
  function parse(s) {
    if (typeof s !== 'string') return null;
    const toks = s.trim().split(/\s+/).filter(Boolean);
    return toks.length >= 1 && toks.length <= 2 && toks.every(okToken) ? toks : null;
  }
  const same = (a, b) => a.length === b.length && a.every((t, i) => t === b[i]);
  const prefixOf = (a, b) => a.length < b.length && a.every((t, i) => t === b[i]);
  const clashes = (a, b) => same(a, b) || prefixOf(a, b) || prefixOf(b, a); // (a key that is a whole binding cannot also begin another)

  // action -> tokens, the scheme's keys with a person's own (JSON text, action -> sequence) over them; a choice that is not a sequence, or that clashes with
  // another action's key, is ignored and the action keeps its own
  function bindings(mineText) {
    let mine = {};
    try { const v = JSON.parse(mineText || '{}'); if (v && typeof v === 'object' && !Array.isArray(v)) mine = v; } catch { /* the scheme's own */ }
    const out = {};
    for (const [act] of ACTIONS) out[act] = parse(VIM[act]);
    const taken = (act, seq) => ACTIONS.some(([o]) => o !== act && out[o] && clashes(out[o], seq));
    for (const [act] of ACTIONS) {
      const seq = parse(mine[act]);
      if (!seq || !(act in VIM)) continue;
      const keep = out[act];
      out[act] = null;
      if (taken(act, seq)) out[act] = keep; else out[act] = seq;
    }
    return out;
  }
  // The one a person asked for, put through the same rules: { ok, mine (the new JSON text), why }
  function assign(mineText, act, str) {
    if (!(act in VIM)) return { ok: false, why: 'Not an action.' };
    let mine = {};
    try { const v = JSON.parse(mineText || '{}'); if (v && typeof v === 'object' && !Array.isArray(v)) mine = v; } catch { /* none */ }
    if (str === null) { delete mine[act]; return { ok: true, mine: Object.keys(mine).length ? JSON.stringify(mine) : '' }; }
    const seq = parse(str);
    if (!seq) return { ok: false, why: 'One key, or two in a row (g g), with Ctrl if you like.' };
    const b = bindings(mineText);
    const other = ACTIONS.find(([o]) => o !== act && b[o] && clashes(b[o], seq));
    if (other) return { ok: false, why: label(seq) + ' is already “' + other[1].replace(/;.*$/, '') + '”' + (prefixOf(b[other[0]], seq) || prefixOf(seq, b[other[0]]) ? ' (or begins it)' : '') + '. Change that one first.' };
    if (same(seq, parse(VIM[act]))) delete mine[act]; else mine[act] = seq.join(' ');
    return { ok: true, mine: Object.keys(mine).length ? JSON.stringify(mine) : '' };
  }

  // A sequence as it is written for people: g g -> gg, C-d -> Ctrl+D, S-Space -> Shift+Space, G -> G
  function label(seq) {
    const toks = Array.isArray(seq) ? seq : parse(seq) || [];
    const one = (t) => t.replace(/^C-(.)$/, (m, c) => 'Ctrl+' + c.toUpperCase()).replace(/^S-/, 'Shift+');
    return toks.every((t) => t.length === 1) ? toks.join('') : toks.map(one).join(' ');
  }

  // The tokens so far against the bindings: { kind: 'match', act } | { kind: 'pending' } | { kind: 'none' }
  function matcher(bind) {
    const entries = Object.entries(bind).filter(([, seq]) => seq);
    return function step(tokens) {
      const whole = entries.find(([, seq]) => same(seq, tokens));
      if (whole) return { kind: 'match', act: whole[0] };
      if (entries.some(([, seq]) => prefixOf(tokens, seq))) return { kind: 'pending' };
      return { kind: 'none' };
    };
  }

  const api = { ACTIONS, GROUPS, VIM, token, okToken, parse, bindings, assign, label, matcher, clashes };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  return api;
})();
